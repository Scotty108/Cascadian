/**
 * PnL Engine V27 - Cash Flow Based Calculation
 *
 * Simplified approach: PnL = cash_in + current_value - cash_out
 * - cash_out: Total USDC spent buying tokens
 * - cash_in: Total USDC received from selling tokens
 * - current_value: Open position tokens * (resolution_price or mark_price)
 *
 * @author Claude Code
 * @version 27.0.0
 * @created 2026-01-09
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV27 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  cashIn: number;
  cashOut: number;
  currentValue: number;
  source: 'local_cashflow';
  confidence: 'high';
}

interface AggregatedPosition {
  conditionId: string;
  outcomeIndex: number;
  bought: number;
  sold: number;
  buyCost: number;
  sellProceeds: number;
  netTokens: number;
}

async function getAggregatedPositions(wallet: string): Promise<AggregatedPosition[]> {
  const w = wallet.toLowerCase();

  const query = `
    WITH deduped AS (
      SELECT
        substring(t.event_id, 1, 66) as tx_hash,
        m.condition_id,
        m.outcome_index,
        t.side,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
      GROUP BY tx_hash, m.condition_id, m.outcome_index, t.side
    )
    SELECT
      condition_id,
      outcome_index,
      sumIf(tokens, side = 'buy') as bought,
      sumIf(tokens, side = 'sell') as sold,
      sumIf(usdc, side = 'buy') as buy_cost,
      sumIf(usdc, side = 'sell') as sell_proceeds,
      greatest(sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell'), 0) as net_tokens
    FROM deduped
    GROUP BY condition_id, outcome_index
    HAVING bought > 0 OR sold > 0
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    return rows.map(r => ({
      conditionId: r.condition_id,
      outcomeIndex: Number(r.outcome_index),
      bought: Number(r.bought),
      sold: Number(r.sold),
      buyCost: Number(r.buy_cost),
      sellProceeds: Number(r.sell_proceeds),
      netTokens: Number(r.net_tokens),
    }));
  } catch (e) {
    console.error('Query error:', e);
    return [];
  }
}

async function getResolutionPrices(conditionIds: string[]): Promise<Map<string, number[]>> {
  if (conditionIds.length === 0) return new Map();

  const idList = conditionIds.map(id => "'" + id.toLowerCase() + "'").join(',');
  const query = `
    SELECT lower(condition_id) as condition_id, norm_prices
    FROM pm_condition_resolutions_norm
    WHERE lower(condition_id) IN (${idList}) AND length(norm_prices) > 0
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as { condition_id: string; norm_prices: number[] }[];
    const map = new Map<string, number[]>();
    for (const row of rows) {
      map.set(row.condition_id, row.norm_prices);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function getMarkPrices(positions: Array<{conditionId: string; outcomeIndex: number}>): Promise<Map<string, number>> {
  if (positions.length === 0) return new Map();

  const conditions = positions.map(p =>
    "(lower(condition_id) = '" + p.conditionId.toLowerCase() + "' AND outcome_index = " + p.outcomeIndex + ")"
  ).join(' OR ');

  const query = `
    SELECT lower(condition_id) as condition_id, outcome_index, mark_price
    FROM pm_latest_mark_price_v1
    WHERE (${conditions}) AND mark_price IS NOT NULL
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.condition_id + '_' + row.outcome_index, Number(row.mark_price));
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function getWalletPnLV27(wallet: string): Promise<PnLResultV27> {
  const w = wallet.toLowerCase();

  const positions = await getAggregatedPositions(w);

  let cashOut = 0;
  let cashIn = 0;

  for (const pos of positions) {
    cashOut += pos.buyCost;
    cashIn += pos.sellProceeds;
  }

  const conditionIds = [...new Set(positions.map(p => p.conditionId.toLowerCase()))];
  const resolutionPrices = await getResolutionPrices(conditionIds);

  const openPositions = positions.filter(p => p.netTokens > 0.001);
  const unresolvedPositions = openPositions.filter(p => {
    const prices = resolutionPrices.get(p.conditionId.toLowerCase());
    return !prices || prices.length <= p.outcomeIndex;
  });

  const markPrices = await getMarkPrices(unresolvedPositions.map(p => ({
    conditionId: p.conditionId,
    outcomeIndex: p.outcomeIndex,
  })));

  let currentValue = 0;
  let openCount = 0;
  let closedCount = 0;

  for (const pos of openPositions) {
    const cid = pos.conditionId.toLowerCase();
    const prices = resolutionPrices.get(cid);

    if (prices && prices.length > pos.outcomeIndex) {
      const resolutionPrice = prices[pos.outcomeIndex];
      currentValue += pos.netTokens * resolutionPrice;
      closedCount++;
    } else {
      openCount++;
      const markKey = cid + '_' + pos.outcomeIndex;
      const markPrice = markPrices.get(markKey);
      if (markPrice !== undefined && markPrice > 0) {
        currentValue += pos.netTokens * markPrice;
      }
    }
  }

  const fullyClosedCount = positions.filter(p => p.netTokens <= 0.001 && p.bought > 0).length;
  closedCount += fullyClosedCount;

  const totalPnl = cashIn + currentValue - cashOut;

  let realizedPnl = 0;
  for (const pos of positions) {
    if (pos.sold > 0 && pos.bought > 0) {
      const avgBuyPrice = pos.buyCost / pos.bought;
      const soldTokens = Math.min(pos.sold, pos.bought);
      realizedPnl += pos.sellProceeds * (soldTokens / pos.sold) - avgBuyPrice * soldTokens;
    }
  }

  const unrealizedPnl = totalPnl - realizedPnl;

  return {
    wallet: w,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    openPositionCount: openCount,
    closedPositionCount: closedCount,
    cashIn,
    cashOut,
    currentValue,
    source: 'local_cashflow',
    confidence: 'high',
  };
}

const currentUrl = import.meta.url;
const scriptPath = 'file://' + process.argv[1];
if (currentUrl === scriptPath) {
  const wallet = process.argv[2];
  if (!wallet) {
    console.log('Usage: npx tsx lib/pnl/pnlEngineV27.ts <wallet>');
    process.exit(1);
  }
  getWalletPnLV27(wallet)
    .then(r => console.log('V27 Result:', JSON.stringify(r, null, 2)))
    .catch(e => console.error('Error:', e));
}
