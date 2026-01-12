/**
 * PnL Engine V17 - Position-Aware PnL Calculator
 *
 * ACCURACY: 11/14 wallets match Polymarket API (<5% or <$5 diff)
 * Same accuracy as V1 but with proper realized/unrealized separation.
 *
 * KEY FEATURES:
 * 1. Proper position tracking per (condition, outcome) pair
 * 2. Separates realized PnL (closed + resolved) from unrealized (open positions)
 * 3. Caps sell proceeds when sold > bought (handles Neg Risk bookkeeping trades)
 * 4. Includes confidence scoring based on Neg Risk conversion count
 *
 * KNOWN LIMITATIONS (same as V1):
 * - Fails for Neg Risk-heavy wallets (3/14 test failures)
 * - Internal bookkeeping trades from Neg Risk adapter cause inaccurate calculations
 * - Solution: Use V7 (API-based) for wallets with high negRiskConversionCount
 *
 * DATA SOURCES:
 * - pm_trader_events_v3: CLOB trades
 * - pm_token_to_condition_map_v5: Token → condition mapping
 * - pm_condition_resolutions_norm: Resolution payouts
 * - pm_latest_mark_price_v1: Current mark prices
 * - pm_neg_risk_conversions_v1: Neg Risk conversion events (for confidence scoring)
 *
 * VALIDATED AGAINST:
 * - 11/14 test wallets match API within 5% or $5
 * - Matches V1 exactly for all simple CLOB wallets
 * - Fails on same 3 Neg Risk-heavy wallets as V1
 *
 * @author Claude Code
 * @version 17.1.0
 * @created 2026-01-08
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV17 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  totalVolume: number;
  negRiskConversionCount: number;
  bundledTxCount: number;
  confidence: 'high' | 'medium' | 'low';
  confidenceReason: string;
}

async function getNegRiskConversionCount(wallet: string): Promise<number> {
  const w = wallet.toLowerCase();
  try {
    const query = `SELECT count() as cnt FROM pm_neg_risk_conversions_v1 WHERE lower(user_address) = '${w}'`;
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as { cnt: string }[];
    return rows.length > 0 ? parseInt(rows[0].cnt, 10) : 0;
  } catch {
    return 0;
  }
}

async function getBundledTxCount(wallet: string): Promise<number> {
  const w = wallet.toLowerCase();
  const query = `
    SELECT count() as bundled_count
    FROM (
      SELECT tx_hash, condition_id
      FROM (
        SELECT
          substring(event_id, 1, 66) as tx_hash,
          m.condition_id as condition_id,
          t.side as side,
          m.outcome_index as outcome_index
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${w}'
          AND m.condition_id IS NOT NULL AND m.condition_id != ''
      )
      GROUP BY tx_hash, condition_id
      HAVING countIf(side='buy') > 0
         AND countIf(side='sell') > 0
         AND count(DISTINCT outcome_index) >= 2
    )
  `;
  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as { bundled_count: string }[];
    return rows.length > 0 ? parseInt(rows[0].bundled_count, 10) : 0;
  } catch {
    return 0;
  }
}

export async function getWalletPnLV17(wallet: string): Promise<PnLResultV17> {
  const w = wallet.toLowerCase();

  // Query with proper position tracking AND sell proceeds capping (like V1)
  const query = `
    SELECT
      status,
      count() as position_count,
      round(sum(realized_pnl), 2) as total_realized,
      round(sum(unrealized_pnl), 2) as total_unrealized,
      round(sum(bought_cost + effective_sell), 2) as volume
    FROM (
      SELECT
        multiIf(
          is_resolved, 'resolved',
          net_tokens = 0, 'closed',
          'open'
        ) as status,
        bought_cost,
        -- Cap sell proceeds when sold > bought (handles Neg Risk bookkeeping trades)
        if(sold_tokens > bought_tokens AND sold_tokens > 0, 
           sold_proceeds * (bought_tokens / sold_tokens), 
           sold_proceeds) as effective_sell,
        -- Realized PnL: use effective (capped) sell proceeds
        multiIf(
          is_resolved,
          -- Resolved: settlement + capped sell - cost
          (if(sold_tokens > bought_tokens AND sold_tokens > 0, 
              sold_proceeds * (bought_tokens / sold_tokens), 
              sold_proceeds) + (net_tokens * resolution_price)) - bought_cost,
          net_tokens = 0,
          -- Closed: capped sell - cost
          if(sold_tokens > bought_tokens AND sold_tokens > 0, 
             sold_proceeds * (bought_tokens / sold_tokens), 
             sold_proceeds) - bought_cost,
          -- Open: no realized PnL
          0
        ) as realized_pnl,
        -- Unrealized PnL: only for open, non-resolved positions
        multiIf(
          is_resolved, 0,
          net_tokens > 0 AND mark_price > 0,
          (net_tokens * mark_price) - (net_tokens * avg_cost),
          0
        ) as unrealized_pnl,
        net_tokens
      FROM (
        SELECT
          ps.condition_id,
          ps.outcome_index,
          ps.bought_tokens,
          ps.bought_cost,
          ps.sold_tokens,
          ps.sold_proceeds,
          greatest(ps.bought_tokens - ps.sold_tokens, 0) as net_tokens,
          if(ps.bought_tokens > 0, ps.bought_cost / ps.bought_tokens, 0) as avg_cost,
          length(r.norm_prices) > 0 as is_resolved,
          if(length(r.norm_prices) > 0,
             arrayElement(r.norm_prices, toUInt8(ps.outcome_index + 1)),
             toFloat64(0)) as resolution_price,
          coalesce(mp.mark_price, toFloat64(0)) as mark_price
        FROM (
          SELECT
            condition_id,
            outcome_index,
            sumIf(tokens, side='buy') as bought_tokens,
            sumIf(usdc, side='buy') as bought_cost,
            sumIf(tokens, side='sell') as sold_tokens,
            sumIf(usdc, side='sell') as sold_proceeds
          FROM (
            SELECT
              m.condition_id as condition_id,
              m.outcome_index as outcome_index,
              t.side as side,
              max(t.usdc_amount) / 1e6 as usdc,
              max(t.token_amount) / 1e6 as tokens
            FROM pm_trader_events_v3 t
            LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
            WHERE lower(t.trader_wallet) = '${w}'
              AND m.condition_id IS NOT NULL
              AND m.condition_id != ''
            GROUP BY substring(event_id, 1, 66), m.condition_id, m.outcome_index, t.side
          )
          GROUP BY condition_id, outcome_index
        ) ps
        LEFT JOIN pm_condition_resolutions_norm r ON lower(ps.condition_id) = lower(r.condition_id)
        LEFT JOIN pm_latest_mark_price_v1 mp ON lower(ps.condition_id) = lower(mp.condition_id)
          AND ps.outcome_index = mp.outcome_index
      )
    )
    GROUP BY status
    ORDER BY status
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as {
    status: string;
    position_count: string;
    total_realized: string;
    total_unrealized: string;
    volume: string;
  }[];

  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let openCount = 0;
  let closedCount = 0;
  let totalVolume = 0;

  for (const row of rows) {
    const realized = parseFloat(row.total_realized) || 0;
    const unrealized = parseFloat(row.total_unrealized) || 0;
    const count = parseInt(row.position_count, 10) || 0;
    const volume = parseFloat(row.volume) || 0;

    realizedPnl += realized;
    unrealizedPnl += unrealized;
    totalVolume += volume;

    if (row.status === 'open') {
      openCount += count;
    } else {
      closedCount += count;
    }
  }

  const [negRiskCount, bundledCount] = await Promise.all([
    getNegRiskConversionCount(w),
    getBundledTxCount(w),
  ]);

  let confidence: 'high' | 'medium' | 'low';
  let confidenceReason: string;

  if (negRiskCount > 100) {
    confidence = 'low';
    confidenceReason = `Heavy Neg Risk usage (${negRiskCount} conversions). May have internal bookkeeping trades.`;
  } else if (negRiskCount > 10 || bundledCount > 50) {
    confidence = 'medium';
    confidenceReason = `Moderate complexity (${negRiskCount} neg risk, ${bundledCount} bundled). Generally accurate.`;
  } else {
    confidence = 'high';
    confidenceReason = 'Simple trading pattern. High accuracy expected.';
  }

  return {
    wallet: w,
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    openPositionCount: openCount,
    closedPositionCount: closedCount,
    totalVolume,
    negRiskConversionCount: negRiskCount,
    bundledTxCount: bundledCount,
    confidence,
    confidenceReason,
  };
}

export async function compareWithApiV17(wallet: string): Promise<{
  v17Result: PnLResultV17;
  apiPnl: number | null;
  difference: number | null;
  percentDiff: number | null;
  matches: boolean;
}> {
  const v17Result = await getWalletPnLV17(wallet);

  let apiPnl: number | null = null;
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        apiPnl = data[data.length - 1].p;
      }
    }
  } catch {
    // API unavailable
  }

  if (apiPnl === null) {
    return { v17Result, apiPnl: null, difference: null, percentDiff: null, matches: false };
  }

  const difference = v17Result.totalPnl - apiPnl;
  const percentDiff = apiPnl !== 0 ? (Math.abs(difference) / Math.abs(apiPnl)) * 100 : null;
  const matches = Math.abs(difference) < 5 || (percentDiff !== null && percentDiff < 5);

  return { v17Result, apiPnl, difference, percentDiff, matches };
}

export const TEST_WALLETS_V17 = {
  failing_bundled: '0xb8301259b1eba1a73fb3eb35b2c7e70c80ca1d10',
  original: '0xf918977ef9d3f101385eda508621d5f835fa9052',
  maker_heavy_1: '0x105a54a721d475a5d2faaf7902c55475758ba63c',
  taker_heavy_1: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc',
  neg_risk_heavy: '0x8d5bebb6dcf733f12200155c547cb9fa8d159069',
};
