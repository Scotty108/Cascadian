/**
 * @deprecated EXPERIMENTAL - DO NOT USE IN PRODUCTION
 * Use pnlEngineV7.ts (API-based) instead
 *
 * PnL Engine V9 - CLOB-only with Split Exclusion
 *
 * Key insight from V1-V8 debugging:
 * - Wallets using CTF splits have CLOB trades that are "internal bookkeeping"
 * - These trades happen in the same tx_hash as the split and often cancel out
 * - Including them inflates costs/proceeds incorrectly
 *
 * V9 Strategy:
 * - Use CLOB trades for tx_hashes WITHOUT CTF splits (pure CLOB trades)
 * - For tx_hashes WITH CTF splits, use CTF split/merge at $0.50 instead
 * - This separates "real" CLOB trades from "internal" split trades
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV9 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
  clobTradeCount: number;
  splitTradeCount: number;
}

export async function getWalletPnLV9(wallet: string): Promise<PnLResultV9> {
  const w = wallet.toLowerCase();

  // Single query that:
  // 1. Finds all tx_hashes linked to CTF splits
  // 2. Uses CLOB trades ONLY for non-split tx_hashes
  // 3. Uses CTF split/merge events for split tx_hashes (at $0.50)
  const query = `
    WITH
    -- User's ERC1155 tx_hashes (to link to CTF events)
    user_txs AS (
      SELECT DISTINCT lower(tx_hash) as tx_hash
      FROM pm_erc1155_transfers
      WHERE lower(to_address) = '${w}' AND is_deleted = 0
    ),

    -- Tx_hashes that contain CTF splits (these have problematic CLOB data)
    split_txs AS (
      SELECT DISTINCT lower(tx_hash) as tx_hash
      FROM pm_ctf_events
      WHERE event_type = 'PositionSplit'
        AND is_deleted = 0
        AND lower(tx_hash) IN (SELECT tx_hash FROM user_txs)
    ),

    -- CLOB trades NOT in split tx_hashes (pure CLOB trades)
    pure_clob_events AS (
      SELECT
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side = 'buy' as is_buy,
        max(t.token_amount) / 1e6 as amount,
        CASE WHEN max(t.token_amount) > 0
             THEN (max(t.usdc_amount) / 1e6) / (max(t.token_amount) / 1e6)
             ELSE 0
        END as price
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
        AND lower(substring(t.event_id, 1, 66)) NOT IN (SELECT tx_hash FROM split_txs)
      GROUP BY substring(t.event_id, 1, 66), m.condition_id, m.outcome_index, t.side
    ),

    -- CTF splits: Create positions at $0.50 for BOTH outcomes
    split_events AS (
      SELECT
        lower(c.condition_id) as condition_id,
        0 as outcome_index,
        1 as is_buy,
        toFloat64OrZero(c.amount_or_payout) / 1e6 as amount,
        0.50 as price
      FROM pm_ctf_events c
      WHERE c.event_type = 'PositionSplit'
        AND c.is_deleted = 0
        AND lower(c.tx_hash) IN (SELECT tx_hash FROM user_txs)
      UNION ALL
      SELECT
        lower(c.condition_id) as condition_id,
        1 as outcome_index,
        1 as is_buy,
        toFloat64OrZero(c.amount_or_payout) / 1e6 as amount,
        0.50 as price
      FROM pm_ctf_events c
      WHERE c.event_type = 'PositionSplit'
        AND c.is_deleted = 0
        AND lower(c.tx_hash) IN (SELECT tx_hash FROM user_txs)
    ),

    -- CTF merges: Sell positions at $0.50 for BOTH outcomes
    merge_events AS (
      SELECT
        lower(c.condition_id) as condition_id,
        0 as outcome_index,
        0 as is_buy,
        toFloat64OrZero(c.amount_or_payout) / 1e6 as amount,
        0.50 as price
      FROM pm_ctf_events c
      WHERE c.event_type = 'PositionsMerge'
        AND c.is_deleted = 0
        AND lower(c.tx_hash) IN (SELECT tx_hash FROM user_txs)
      UNION ALL
      SELECT
        lower(c.condition_id) as condition_id,
        1 as outcome_index,
        0 as is_buy,
        toFloat64OrZero(c.amount_or_payout) / 1e6 as amount,
        0.50 as price
      FROM pm_ctf_events c
      WHERE c.event_type = 'PositionsMerge'
        AND c.is_deleted = 0
        AND lower(c.tx_hash) IN (SELECT tx_hash FROM user_txs)
    ),

    -- All events combined (NO clob_in_splits - they're redundant with split events)
    all_events AS (
      SELECT condition_id, outcome_index, is_buy, amount, price, 0 as is_split
      FROM pure_clob_events
      UNION ALL
      SELECT condition_id, outcome_index, is_buy, amount, price, 1 as is_split
      FROM split_events
      UNION ALL
      SELECT condition_id, outcome_index, is_buy, amount, price, 1 as is_split
      FROM merge_events
    )

    SELECT
      condition_id,
      outcome_index,
      sumIf(amount, is_buy = 1) as total_bought,
      sumIf(amount, is_buy = 0) as total_sold,
      sumIf(amount * price, is_buy = 1) as total_cost,
      sumIf(amount * price, is_buy = 0) as total_proceeds,
      countIf(is_split = 0) as clob_count,
      countIf(is_split = 1) as split_count
    FROM all_events
    GROUP BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let positionCount = 0;
  let clobTradeCount = 0;
  let splitTradeCount = 0;

  // Get mark prices and resolutions
  const conditionIds = [...new Set(rows.map((r: any) => r.condition_id))];

  if (conditionIds.length === 0) {
    return {
      wallet: w,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      positionCount: 0,
      clobTradeCount: 0,
      splitTradeCount: 0,
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

  // Calculate PnL per outcome using weighted average cost basis
  for (const row of rows) {
    const bought = Number(row.total_bought) || 0;
    const sold = Number(row.total_sold) || 0;
    const cost = Number(row.total_cost) || 0;
    const proceeds = Number(row.total_proceeds) || 0;
    clobTradeCount += Number(row.clob_count) || 0;
    splitTradeCount += Number(row.split_count) || 0;

    const avgPrice = bought > 0 ? cost / bought : 0;
    const netTokens = Math.max(bought - sold, 0);

    // Cap sells to what was bought
    const effectiveSold = Math.min(sold, bought);
    const effectiveProceeds = sold > 0 ? proceeds * (effectiveSold / sold) : 0;

    // Check for resolution
    const resolution = resolutions.get(row.condition_id);
    const outcomeIdx = Number(row.outcome_index);

    let settlementValue = 0;
    let isResolved = false;

    if (resolution && resolution.length > outcomeIdx) {
      isResolved = true;
      const payoutPrice = resolution[outcomeIdx];
      settlementValue = netTokens * payoutPrice;
    }

    // Realized PnL from sales
    const realizedFromSales = effectiveProceeds - effectiveSold * avgPrice;

    // Realized PnL from settlement (if resolved)
    const realizedFromSettlement = isResolved ? settlementValue - netTokens * avgPrice : 0;

    realizedPnl += realizedFromSales + realizedFromSettlement;

    // Unrealized PnL (only for unresolved positions with tokens remaining)
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
    clobTradeCount,
    splitTradeCount,
  };
}
