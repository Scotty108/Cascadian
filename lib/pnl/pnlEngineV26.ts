/**
 * PnL Engine V26 - Split Pattern Detection
 *
 * Detects bundled split patterns (buy+sell in same tx for same condition)
 * and adjusts cost basis to account for sell proceeds offset.
 *
 * Key insight: When user splits, they pay $X for X of each outcome, then
 * sell one outcome for $Y. Remaining outcome's cost basis = $X - $Y
 *
 * @author Claude Code
 * @version 26.0.0
 * @created 2026-01-09
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV26 {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositionCount: number;
  closedPositionCount: number;
  splitPatternCount: number;
  source: 'local_split_aware';
  confidence: 'high';
}

interface Position {
  conditionId: string;
  outcomeIndex: number;
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

async function getAggregatedPnL(wallet: string): Promise<{
  positions: Map<string, Position>;
  splitPatterns: number;
}> {
  const w = wallet.toLowerCase();

  // V1's approach: aggregate per (condition, outcome) with bundled tx awareness
  // Key formula: net_tokens = bought - sold, cost = buy_cost - effective_sell_proceeds
  const query = `
    WITH deduped_trades AS (
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
    ),
    -- Detect split patterns: same tx has both buy and sell for same condition
    split_detection AS (
      SELECT
        condition_id,
        tx_hash,
        countIf(side='buy') as buys,
        countIf(side='sell') as sells,
        count(DISTINCT outcome_index) as outcomes
      FROM deduped_trades
      GROUP BY condition_id, tx_hash
      HAVING buys > 0 AND sells > 0 AND outcomes >= 2
    ),
    outcome_totals AS (
      SELECT
        condition_id,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds
      FROM deduped_trades
      GROUP BY condition_id, outcome_index
    )
    SELECT
      condition_id,
      outcome_index,
      bought,
      sold,
      buy_cost,
      sell_proceeds,
      -- Net tokens held
      greatest(bought - sold, 0) as net_tokens,
      -- Effective sell (capped to what was bought)
      CASE WHEN sold > bought AND sold > 0
           THEN sell_proceeds * (bought / sold)
           ELSE sell_proceeds
      END as effective_sell,
      -- Check if this condition had split patterns
      (SELECT count() FROM split_detection WHERE split_detection.condition_id = outcome_totals.condition_id) as split_count
    FROM outcome_totals
    WHERE bought > 0 OR sold > 0
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];

    const positions = new Map<string, Position>();
    let totalSplitPatterns = 0;

    // Group by condition to handle split cost allocation
    const byCondition = new Map<string, any[]>();
    for (const r of rows) {
      const cid = r.condition_id.toLowerCase();
      if (!byCondition.has(cid)) byCondition.set(cid, []);
      byCondition.get(cid)!.push(r);
      totalSplitPatterns = Math.max(totalSplitPatterns, Number(r.split_count));
    }

    // Process each condition
    for (const [conditionId, outcomes] of byCondition) {
      const hasSplits = outcomes.some(o => Number(o.split_count) > 0);

      if (hasSplits && outcomes.length >= 2) {
        // Split pattern detected - distribute sell proceeds as cost offset
        // Total sell proceeds from all outcomes offset the buy costs
        let totalBuyCost = 0;
        let totalSellProceeds = 0;
        let totalNetTokens = 0;

        for (const o of outcomes) {
          totalBuyCost += Number(o.buy_cost);
          totalSellProceeds += Number(o.effective_sell);
          totalNetTokens += Number(o.net_tokens);
        }

        // Adjusted cost = buy_cost - sell_proceeds (from other outcomes)
        const adjustedTotalCost = totalBuyCost - totalSellProceeds;

        for (const o of outcomes) {
          const netTokens = Number(o.net_tokens);
          if (netTokens < 0.001) continue;

          const posKey = conditionId + '_' + o.outcome_index;
          
          // Distribute adjusted cost proportionally by net tokens
          const share = netTokens / totalNetTokens;
          const adjustedCost = adjustedTotalCost * share;
          const avgPrice = netTokens > 0 ? adjustedCost / netTokens : 0;

          positions.set(posKey, {
            conditionId: o.condition_id,
            outcomeIndex: Number(o.outcome_index),
            amount: netTokens,
            avgPrice: avgPrice,
            realizedPnl: 0, // Realized is captured in cost adjustment
          });
        }
      } else {
        // No split pattern - use standard V1 formula
        for (const o of outcomes) {
          const netTokens = Number(o.net_tokens);
          const effectiveSell = Number(o.effective_sell);
          const buyCost = Number(o.buy_cost);
          const bought = Number(o.bought);

          // Realized PnL from sells
          let realizedPnl = 0;
          if (effectiveSell > 0 && bought > 0) {
            const avgBuyPrice = buyCost / bought;
            const sold = Math.min(Number(o.sold), bought);
            const avgSellPrice = effectiveSell / sold;
            realizedPnl = sold * (avgSellPrice - avgBuyPrice);
          }

          if (netTokens < 0.001 && Math.abs(realizedPnl) < 0.001) continue;

          const posKey = conditionId + '_' + o.outcome_index;
          const avgPrice = bought > 0 ? buyCost / bought : 0;

          positions.set(posKey, {
            conditionId: o.condition_id,
            outcomeIndex: Number(o.outcome_index),
            amount: netTokens,
            avgPrice: avgPrice,
            realizedPnl: realizedPnl,
          });
        }
      }
    }

    return { positions, splitPatterns: totalSplitPatterns };
  } catch (e) {
    console.error('Query error:', e);
    return { positions: new Map(), splitPatterns: 0 };
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

export async function getWalletPnLV26(wallet: string): Promise<PnLResultV26> {
  const w = wallet.toLowerCase();

  // Step 1: Get aggregated positions with split awareness
  const { positions, splitPatterns } = await getAggregatedPnL(w);

  // Step 2: Calculate realized PnL
  let realizedPnl = 0;
  for (const pos of positions.values()) {
    realizedPnl += pos.realizedPnl;
  }

  // Step 3: Get open positions
  const openPositions = Array.from(positions.values()).filter(p => p.amount > 0.001);
  const conditionIds = new Set<string>();
  for (const pos of positions.values()) {
    conditionIds.add(pos.conditionId.toLowerCase());
  }

  // Step 4: Get resolution prices
  const resolutionPrices = await getResolutionPrices(Array.from(conditionIds));

  // Step 5: Calculate unrealized PnL
  let unrealizedPnl = 0;
  let openCount = 0;
  let closedCount = positions.size - openPositions.length;

  // Find unresolved positions
  const unresolvedPositions: Array<{conditionId: string; outcomeIndex: number}> = [];
  for (const pos of openPositions) {
    const prices = resolutionPrices.get(pos.conditionId.toLowerCase());
    if (!prices || prices.length <= pos.outcomeIndex) {
      unresolvedPositions.push({ conditionId: pos.conditionId, outcomeIndex: pos.outcomeIndex });
    }
  }

  const markPrices = await getMarkPrices(unresolvedPositions);

  for (const pos of openPositions) {
    const costBasis = pos.amount * pos.avgPrice;

    // Check if resolved
    const prices = resolutionPrices.get(pos.conditionId.toLowerCase());
    if (prices && prices.length > pos.outcomeIndex) {
      const resolutionPrice = prices[pos.outcomeIndex];
      unrealizedPnl += pos.amount * resolutionPrice - costBasis;
      closedCount++;
      continue;
    }

    // Use mark price for unresolved
    openCount++;
    const markKey = pos.conditionId.toLowerCase() + '_' + pos.outcomeIndex;
    const markPrice = markPrices.get(markKey);
    if (markPrice !== undefined && markPrice > 0) {
      unrealizedPnl += pos.amount * markPrice - costBasis;
    } else {
      unrealizedPnl -= costBasis;
    }
  }

  return {
    wallet: w,
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    openPositionCount: openCount,
    closedPositionCount: closedCount,
    splitPatternCount: splitPatterns,
    source: 'local_split_aware',
    confidence: 'high',
  };
}

const currentUrl = import.meta.url;
const scriptPath = 'file://' + process.argv[1];
if (currentUrl === scriptPath) {
  const wallet = process.argv[2];
  if (!wallet) {
    console.log('Usage: npx tsx lib/pnl/pnlEngineV26.ts <wallet>');
    process.exit(1);
  }
  getWalletPnLV26(wallet)
    .then(r => console.log('V26 Result:', JSON.stringify(r, null, 2)))
    .catch(e => console.error('Error:', e));
}
