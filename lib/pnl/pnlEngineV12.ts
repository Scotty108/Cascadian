/**
 * @deprecated EXPERIMENTAL - DO NOT USE IN PRODUCTION
 * Use pnlEngineV7.ts (API-based) instead
 *
 * PnL Engine V12 - Simple Direct Formula
 *
 * DISCOVERY: Complex bundling logic was wrong. The simple formula works:
 * PnL = (net_tokens × payout_price) - buy_usdc + sell_usdc
 *
 * This is equivalent to:
 * settlement_value - total_buy_cost + total_sell_proceeds
 *
 * For spot_5: This formula gives $0.41 vs API $-0.09 (close!)
 * V6 gave $-4.20, V11 gave $2859 (both wrong)
 *
 * V12 Strategy: Just use the simple formula per condition/outcome
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV12 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
  resolvedPositions: number;
}

export async function getWalletPnLV12(wallet: string): Promise<PnLResultV12> {
  const w = wallet.toLowerCase();

  // Simple aggregation per condition/outcome
  const query = `
    WITH
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
    )
    SELECT
      condition_id,
      outcome_index,
      sumIf(tokens, side = 'buy') as bought,
      sumIf(tokens, side = 'sell') as sold,
      sumIf(usdc, side = 'buy') as buy_usdc,
      sumIf(usdc, side = 'sell') as sell_usdc
    FROM clob_events
    GROUP BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const conditionIds = [...new Set(rows.map((r: any) => r.condition_id))];

  if (conditionIds.length === 0) {
    return {
      wallet: w,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      positionCount: 0,
      resolvedPositions: 0,
    };
  }

  // Get resolutions and mark prices
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
  let resolvedPositions = 0;

  for (const row of rows) {
    const bought = Number(row.bought) || 0;
    const sold = Number(row.sold) || 0;
    const buyUsdc = Number(row.buy_usdc) || 0;
    const sellUsdc = Number(row.sell_usdc) || 0;
    const netTokens = bought - sold;

    const resolution = resolutions.get(row.condition_id);
    const outcomeIdx = Number(row.outcome_index);
    const isResolved = resolution && resolution.length > outcomeIdx;

    if (isResolved) {
      resolvedPositions++;
      const payoutPrice = resolution![outcomeIdx];
      const settlementValue = netTokens * payoutPrice;
      // Simple formula: settlement - cost + proceeds
      realizedPnl += settlementValue - buyUsdc + sellUsdc;
    } else {
      // Unrealized: use mark price for current value
      if (netTokens !== 0) {
        positionCount++;
        const markPrice = markPrices.get(`${row.condition_id}_${outcomeIdx}`) || 0;
        const currentValue = netTokens * markPrice;
        unrealizedPnl += currentValue - buyUsdc + sellUsdc;
      }
    }
  }

  return {
    wallet: w,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    totalPnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
    positionCount,
    resolvedPositions,
  };
}
