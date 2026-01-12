/**
 * @deprecated EXPERIMENTAL - DO NOT USE IN PRODUCTION
 * Use pnlEngineV7.ts (API-based) instead
 *
 * PnL Engine V13 - WASH Transaction Exclusion
 *
 * KEY DISCOVERY: Neg Risk adapter creates WASH transactions where:
 * - A tx has buy AND sell for SAME or DIFFERENT outcomes
 * - BUT net token change is ZERO (bought = sold at tx level)
 * - These are internal bookkeeping, not real trades
 *
 * V13 Strategy:
 * 1. Identify WASH txs: where net_bought = net_sold (within tx)
 * 2. EXCLUDE wash txs entirely from PnL calculation
 * 3. Only calculate PnL from REAL trades
 *
 * spot_5 test case:
 * - 136 WASH txs (internal bookkeeping)
 * - 85 REAL txs (actual trades)
 * - V1 was counting WASH txs as real, inflating costs/proceeds
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV13 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
  washTxCount: number;
  realTxCount: number;
}

export async function getWalletPnLV13(wallet: string): Promise<PnLResultV13> {
  const w = wallet.toLowerCase();

  // Step 1: Get all trades with tx-level wash detection
  const query = `
    WITH
    -- Dedup trades by tx_hash + condition + outcome + side
    deduped_trades AS (
      SELECT
        substring(t.event_id, 1, 66) as tx_hash,
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
    -- Detect WASH txs: net bought = net sold at tx level
    tx_stats AS (
      SELECT
        tx_hash,
        sumIf(tokens, side = 'buy') as tx_bought,
        sumIf(tokens, side = 'sell') as tx_sold,
        abs(sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell')) < 0.001 as is_wash
      FROM deduped_trades
      GROUP BY tx_hash
    ),
    -- Only keep REAL (non-wash) trades
    real_trades AS (
      SELECT
        d.condition_id,
        d.outcome_index,
        d.side,
        d.tokens,
        d.usdc
      FROM deduped_trades d
      JOIN tx_stats ts ON d.tx_hash = ts.tx_hash
      WHERE NOT ts.is_wash
    ),
    -- Aggregate real trades per condition/outcome
    aggregated AS (
      SELECT
        condition_id,
        outcome_index,
        sumIf(tokens, side = 'buy') as bought,
        sumIf(tokens, side = 'sell') as sold,
        sumIf(usdc, side = 'buy') as buy_usdc,
        sumIf(usdc, side = 'sell') as sell_usdc
      FROM real_trades
      GROUP BY condition_id, outcome_index
    )
    SELECT
      condition_id,
      outcome_index,
      bought,
      sold,
      buy_usdc,
      sell_usdc
    FROM aggregated
  `;

  // Get wash/real tx counts
  const countQuery = `
    WITH
    deduped_trades AS (
      SELECT
        substring(t.event_id, 1, 66) as tx_hash,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY tx_hash, condition_id, outcome_index, side
    ),
    tx_stats AS (
      SELECT
        tx_hash,
        abs(sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell')) < 0.001 as is_wash
      FROM deduped_trades
      GROUP BY tx_hash
    )
    SELECT
      countIf(is_wash) as wash_count,
      countIf(NOT is_wash) as real_count
    FROM tx_stats
  `;

  const [result, countResult] = await Promise.all([
    clickhouse.query({ query, format: 'JSONEachRow' }),
    clickhouse.query({ query: countQuery, format: 'JSONEachRow' }),
  ]);

  const rows = (await result.json()) as any[];
  const countRows = (await countResult.json()) as any[];

  const washTxCount = countRows[0]?.wash_count || 0;
  const realTxCount = countRows[0]?.real_count || 0;

  if (rows.length === 0) {
    return {
      wallet: w,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      positionCount: 0,
      washTxCount,
      realTxCount,
    };
  }

  // Get condition IDs for resolution/mark price lookup
  const conditionIds = [...new Set(rows.map((r: any) => r.condition_id))];

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

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let positionCount = 0;

  for (const row of rows) {
    const bought = Number(row.bought) || 0;
    const sold = Number(row.sold) || 0;
    const buyUsdc = Number(row.buy_usdc) || 0;
    const sellUsdc = Number(row.sell_usdc) || 0;
    const netTokens = bought - sold;

    // Cap effective sell proceeds (V1 pattern)
    let effectiveSell = sellUsdc;
    if (sold > bought && sold > 0) {
      effectiveSell = sellUsdc * (bought / sold);
    }

    const resolution = resolutions.get(row.condition_id);
    const outcomeIdx = Number(row.outcome_index);
    const isResolved = resolution && resolution.length > outcomeIdx;

    if (isResolved) {
      const payoutPrice = resolution![outcomeIdx];
      const settlementValue = Math.max(netTokens, 0) * payoutPrice;
      // V1 formula: settlement + sell - cost
      realizedPnl += effectiveSell + settlementValue - buyUsdc;
    } else {
      const markPrice = markPrices.get(`${row.condition_id}_${outcomeIdx}`) || 0;
      if (netTokens > 0) {
        positionCount++;
        const currentValue = netTokens * markPrice;
        unrealizedPnl += effectiveSell + currentValue - buyUsdc;
      } else if (netTokens === 0) {
        // Closed position
        realizedPnl += effectiveSell - buyUsdc;
      }
    }
  }

  return {
    wallet: w,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
    positionCount,
    washTxCount,
    realTxCount,
  };
}
