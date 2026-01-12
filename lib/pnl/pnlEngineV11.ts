/**
 * @deprecated EXPERIMENTAL - DO NOT USE IN PRODUCTION
 * Use pnlEngineV7.ts (API-based) instead
 *
 * PnL Engine V11 - Neg Risk Bundled Trade Consolidation
 *
 * ROOT CAUSE IDENTIFIED:
 * Neg Risk adapter creates bundled trades where:
 * - BUY outcome X at ~$1 (kept position)
 * - SELL outcome Y at ~$0.001 (collateral return)
 * These happen in SAME tx_hash + condition_id.
 *
 * V6 BUG: Treats the sell as separate realized profit
 * CORRECT: Net cost = buy_usdc - sell_usdc (sell offsets entry cost)
 *
 * Example from spot_5:
 * - BUY outcome 1: 117 tokens @ $116.95
 * - SELL outcome 0: 117 tokens @ $0.117
 * - Net cost = $116.95 - $0.117 = $116.83
 * - Resolution [0,1]: payout $117, PnL = $0.17 profit
 *
 * V11 Strategy:
 * For bundled trades (buy+sell DIFFERENT outcomes in same tx+condition):
 * - Consolidate: net_cost = buy_usdc - sell_usdc
 * - Only track the bought outcome position
 * - Ignore the sell entirely (it's just collateral return)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV11 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
  bundledTxCount: number;
  pureTxCount: number;
}

export async function getWalletPnLV11(wallet: string): Promise<PnLResultV11> {
  const w = wallet.toLowerCase();

  // Strategy: Detect bundled Neg Risk trades and consolidate them
  const query = `
    WITH
    -- Step 1: Get all CLOB events grouped by tx + condition + outcome + side
    clob_events AS (
      SELECT
        lower(substring(t.event_id, 1, 66)) as tx_hash,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.token_amount) / 1e6 as tokens,
        max(t.usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY tx_hash, condition_id, outcome_index, side
    ),

    -- Step 2: Find bundled tx+conditions (have both buy AND sell for DIFFERENT outcomes)
    tx_condition_stats AS (
      SELECT
        tx_hash,
        condition_id,
        sum(if(side = 'buy', usdc, 0)) as total_buy_usdc,
        sum(if(side = 'sell', usdc, 0)) as total_sell_usdc,
        countDistinctIf(outcome_index, side = 'buy') as buy_outcomes,
        countDistinctIf(outcome_index, side = 'sell') as sell_outcomes,
        groupArrayIf(outcome_index, side = 'buy') as bought_outcome_list,
        groupArrayIf(outcome_index, side = 'sell') as sold_outcome_list
      FROM clob_events
      GROUP BY tx_hash, condition_id
    ),

    -- Step 3: Mark which tx+conditions are bundled Neg Risk trades
    bundled_flags AS (
      SELECT
        tx_hash,
        condition_id,
        total_buy_usdc,
        total_sell_usdc,
        (buy_outcomes > 0 AND sell_outcomes > 0 AND
         NOT hasAny(bought_outcome_list, sold_outcome_list)) as is_bundled
      FROM tx_condition_stats
    ),

    -- Step 4: Adjust events - for bundled, only keep buys with adjusted cost
    adjusted_events AS (
      SELECT
        e.condition_id as condition_id,
        e.outcome_index as outcome_index,
        e.side as side,
        e.tokens as tokens,
        -- For bundled buys: net_cost = buy_usdc - sell_usdc
        -- For bundled sells: zero (don't count)
        -- For non-bundled: original usdc
        CASE
          WHEN b.is_bundled AND e.side = 'buy' THEN b.total_buy_usdc - b.total_sell_usdc
          WHEN b.is_bundled AND e.side = 'sell' THEN 0
          ELSE e.usdc
        END as adjusted_usdc,
        -- For bundled sells: zero tokens (ignore the position)
        CASE
          WHEN b.is_bundled AND e.side = 'sell' THEN 0
          ELSE e.tokens
        END as adjusted_tokens,
        b.is_bundled as is_bundled
      FROM clob_events e
      JOIN bundled_flags b ON e.tx_hash = b.tx_hash AND e.condition_id = b.condition_id
    )

    -- Step 5: Aggregate per condition + outcome
    SELECT
      condition_id,
      outcome_index,
      sumIf(adjusted_tokens, side = 'buy') as total_bought,
      sumIf(adjusted_tokens, side = 'sell') as total_sold,
      sumIf(adjusted_usdc, side = 'buy') as total_cost,
      sumIf(adjusted_usdc, side = 'sell') as total_proceeds,
      countIf(is_bundled = true) as bundled_count,
      countIf(is_bundled = false) as pure_count
    FROM adjusted_events
    GROUP BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let positionCount = 0;
  let bundledTxCount = 0;
  let pureTxCount = 0;

  const conditionIds = [...new Set(rows.map((r: any) => r.condition_id))];

  if (conditionIds.length === 0) {
    return {
      wallet: w,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      positionCount: 0,
      bundledTxCount: 0,
      pureTxCount: 0,
    };
  }

  const priceQuery = `
    SELECT lower(condition_id) as condition_id, outcome_index, mark_price
    FROM pm_latest_mark_price_v1
    WHERE lower(condition_id) IN (${conditionIds.map((c) => `'${c}'`).join(',')})
  `;

  const resQuery = `
    SELECT lower(condition_id) as condition_id, norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) IN (${conditionIds.map((c) => `'${c}'`).join(',')})
  `;

  const [priceResult, resResult] = await Promise.all([
    clickhouse.query({ query: priceQuery, format: 'JSONEachRow' }),
    clickhouse.query({ query: resQuery, format: 'JSONEachRow' }),
  ]);

  const priceRows = (await priceResult.json()) as any[];
  const resRows = (await resResult.json()) as any[];

  const markPrices = new Map<string, number>();
  for (const row of priceRows) {
    markPrices.set(`${row.condition_id}_${row.outcome_index}`, Number(row.mark_price));
  }

  const resolutions = new Map<string, number[]>();
  for (const row of resRows) {
    resolutions.set(row.condition_id, row.norm_prices);
  }

  for (const row of rows) {
    const bought = Number(row.total_bought) || 0;
    const sold = Number(row.total_sold) || 0;
    const cost = Number(row.total_cost) || 0;
    const proceeds = Number(row.total_proceeds) || 0;
    bundledTxCount += Number(row.bundled_count) || 0;
    pureTxCount += Number(row.pure_count) || 0;

    if (bought === 0 && sold === 0) continue;

    const avgPrice = bought > 0 ? cost / bought : 0;
    const netTokens = Math.max(bought - sold, 0);

    const effectiveSold = Math.min(sold, bought);
    const effectiveProceeds = sold > 0 ? proceeds * (effectiveSold / sold) : 0;

    const resolution = resolutions.get(row.condition_id);
    const outcomeIdx = Number(row.outcome_index);

    let settlementValue = 0;
    let isResolved = false;

    if (resolution && resolution.length > outcomeIdx) {
      isResolved = true;
      const payoutPrice = resolution[outcomeIdx];
      settlementValue = netTokens * payoutPrice;
    }

    const realizedFromSales = effectiveProceeds - effectiveSold * avgPrice;
    const realizedFromSettlement = isResolved ? settlementValue - netTokens * avgPrice : 0;

    realizedPnl += realizedFromSales + realizedFromSettlement;

    if (!isResolved && netTokens > 0) {
      positionCount++;
      const markPrice = markPrices.get(`${row.condition_id}_${outcomeIdx}`) || 0;
      unrealizedPnl += netTokens * (markPrice - avgPrice);
    }
  }

  return {
    wallet: w,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
    positionCount,
    bundledTxCount,
    pureTxCount,
  };
}
