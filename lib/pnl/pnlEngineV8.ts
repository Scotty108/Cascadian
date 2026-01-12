/**
 * PnL Engine V8 - V6 Methodology + Proxy Trade Detection
 *
 * Combines the best of V5 and V6:
 * - V6's weighted average cost basis per position
 * - V6's splits/merges at $0.50
 * - V5's proxy trade detection via tx_hash linking
 *
 * Key insight: CLOB trades can happen under:
 * 1. User's direct wallet
 * 2. Proxy addresses (in same tx_hash as user's ERC1155 receipts)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV8 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
  eventCount: number;
  userEvents: number;
  proxyEvents: number;
}

export async function getWalletPnLV8(wallet: string): Promise<PnLResultV8> {
  const w = wallet.toLowerCase();

  // Combined query: User trades + Proxy trades + CTF events (splits/merges at $0.50)
  const query = `
    WITH
    -- User's tx_hashes from ERC1155 transfers (to link proxy trades)
    user_txs AS (
      SELECT DISTINCT lower(tx_hash) as tx_hash
      FROM pm_erc1155_transfers
      WHERE lower(to_address) = '${w}' AND is_deleted = 0
    ),

    -- User's direct CLOB trades (MAX-based deduplication for maker/taker duplicates)
    user_clob_events AS (
      SELECT
        any(t.trade_time) as ts,
        m.condition_id,
        m.outcome_index,
        t.side = 'buy' as is_buy,
        max(t.token_amount) / 1e6 as amount,
        CASE WHEN max(t.token_amount) > 0 THEN (max(t.usdc_amount) / 1e6) / (max(t.token_amount) / 1e6) ELSE 0 END as price,
        0 as is_proxy
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY substring(t.event_id, 1, 66), m.condition_id, m.outcome_index, t.side
    ),

    -- Proxy CLOB trades (in same tx_hash as user's ERC1155 receipts)
    proxy_clob_events AS (
      SELECT
        any(t.trade_time) as ts,
        m.condition_id,
        m.outcome_index,
        t.side = 'buy' as is_buy,
        max(t.token_amount) / 1e6 as amount,
        CASE WHEN max(t.token_amount) > 0 THEN (max(t.usdc_amount) / 1e6) / (max(t.token_amount) / 1e6) ELSE 0 END as price,
        1 as is_proxy
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(substring(t.event_id, 1, 66)) IN (SELECT tx_hash FROM user_txs)
        AND lower(t.trader_wallet) != '${w}'
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY substring(t.event_id, 1, 66), m.condition_id, m.outcome_index, t.side
    ),

    -- CTF splits linked to user (creates positions at $0.50 for BOTH outcomes)
    split_events AS (
      SELECT
        c.event_timestamp as ts,
        lower(c.condition_id) as condition_id,
        0 as outcome_index,
        1 as is_buy,
        toFloat64OrZero(c.amount_or_payout) / 1e6 as amount,
        0.50 as price,
        0 as is_proxy
      FROM pm_ctf_events c
      WHERE lower(c.tx_hash) IN (SELECT tx_hash FROM user_txs)
        AND c.event_type = 'PositionSplit'
        AND c.is_deleted = 0
      UNION ALL
      SELECT
        c.event_timestamp as ts,
        lower(c.condition_id) as condition_id,
        1 as outcome_index,
        1 as is_buy,
        toFloat64OrZero(c.amount_or_payout) / 1e6 as amount,
        0.50 as price,
        0 as is_proxy
      FROM pm_ctf_events c
      WHERE lower(c.tx_hash) IN (SELECT tx_hash FROM user_txs)
        AND c.event_type = 'PositionSplit'
        AND c.is_deleted = 0
    ),

    -- CTF merges linked to user (sells positions at $0.50 for BOTH outcomes)
    merge_events AS (
      SELECT
        c.event_timestamp as ts,
        lower(c.condition_id) as condition_id,
        0 as outcome_index,
        0 as is_buy,
        toFloat64OrZero(c.amount_or_payout) / 1e6 as amount,
        0.50 as price,
        0 as is_proxy
      FROM pm_ctf_events c
      WHERE lower(c.tx_hash) IN (SELECT tx_hash FROM user_txs)
        AND c.event_type = 'PositionsMerge'
        AND c.is_deleted = 0
      UNION ALL
      SELECT
        c.event_timestamp as ts,
        lower(c.condition_id) as condition_id,
        1 as outcome_index,
        0 as is_buy,
        toFloat64OrZero(c.amount_or_payout) / 1e6 as amount,
        0.50 as price,
        0 as is_proxy
      FROM pm_ctf_events c
      WHERE lower(c.tx_hash) IN (SELECT tx_hash FROM user_txs)
        AND c.event_type = 'PositionsMerge'
        AND c.is_deleted = 0
    ),

    -- All events combined
    all_events AS (
      SELECT * FROM user_clob_events
      UNION ALL SELECT * FROM proxy_clob_events
      UNION ALL SELECT * FROM split_events
      UNION ALL SELECT * FROM merge_events
    )

    SELECT
      condition_id,
      outcome_index,
      sumIf(amount, is_buy = 1) as total_bought,
      sumIf(amount, is_buy = 0) as total_sold,
      sumIf(amount * price, is_buy = 1) as total_cost,
      sumIf(amount * price, is_buy = 0) as total_proceeds,
      count() as event_count,
      countIf(is_proxy = 0) as user_events,
      countIf(is_proxy = 1) as proxy_events
    FROM all_events
    GROUP BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let positionCount = 0;
  let eventCount = 0;
  let userEvents = 0;
  let proxyEvents = 0;

  // Get mark prices and resolutions for all conditions
  const conditionIds = [...new Set(rows.map((r: any) => r.condition_id))];

  if (conditionIds.length === 0) {
    return { wallet: w, realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0, positionCount: 0, eventCount: 0, userEvents: 0, proxyEvents: 0 };
  }

  const priceQuery = `
    SELECT lower(condition_id) as condition_id, outcome_index, mark_price
    FROM pm_latest_mark_price_v1
    WHERE lower(condition_id) IN (${conditionIds.map(c => `'${c}'`).join(',')})
  `;

  const resQuery = `
    SELECT lower(condition_id) as condition_id, norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) IN (${conditionIds.map(c => `'${c}'`).join(',')})
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
    eventCount += Number(row.event_count) || 0;
    userEvents += Number(row.user_events) || 0;
    proxyEvents += Number(row.proxy_events) || 0;

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
    const realizedFromSales = effectiveProceeds - (effectiveSold * avgPrice);

    // Realized PnL from settlement (if resolved)
    const realizedFromSettlement = isResolved ? (settlementValue - (netTokens * avgPrice)) : 0;

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
    eventCount,
    userEvents,
    proxyEvents,
  };
}
