/**
 * Net Flow P&L Engine
 *
 * Simplified deterministic approach:
 * 1. Aggregate all trades per token
 * 2. Calculate net position (bought - sold)
 * 3. For tokens with net negative position, infer the deficit came from splits
 * 4. Split cost = max deficit per condition (not per token)
 *
 * Formula:
 *   P&L = Sells + Redemptions + Merges - Buys - SplitCost
 *
 * Key insight: Only infer splits for NET deficits, not transient ones.
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface NetFlowResult {
  wallet: string;
  buys: number;
  sells: number;
  redemptions: number;
  merges: number;
  explicitSplits: number;
  inferredSplitCost: number;
  totalSplitCost: number;
  realizedPnl: number;
  trades: number;
  conditions: number;
  tokensWithDeficit: number;
}

const CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function computeNetFlowPnl(wallet: string): Promise<NetFlowResult> {
  const w = wallet.toLowerCase();

  // 1) Aggregate CLOB trades per token
  const tradesQ = `
    SELECT
      token_id,
      sum(CASE WHEN side = 'buy' THEN usdc_amount ELSE 0 END)/1e6 as buy_usdc,
      sum(CASE WHEN side = 'sell' THEN usdc_amount ELSE 0 END)/1e6 as sell_usdc,
      sum(CASE WHEN side = 'buy' THEN token_amount ELSE 0 END)/1e6 as buy_tokens,
      sum(CASE WHEN side = 'sell' THEN token_amount ELSE 0 END)/1e6 as sell_tokens,
      count() as trade_count
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${w}'
    GROUP BY token_id
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as Array<{
    token_id: string;
    buy_usdc: number;
    sell_usdc: number;
    buy_tokens: number;
    sell_tokens: number;
    trade_count: number;
  }>;

  let totalBuys = 0;
  let totalSells = 0;
  let tradeCount = 0;

  const tokenNetPosition = new Map<string, number>();

  for (const trade of trades) {
    totalBuys += trade.buy_usdc;
    totalSells += trade.sell_usdc;
    tradeCount += Number(trade.trade_count);

    // Net position = bought - sold (positive = holding, negative = deficit)
    const netTokens = trade.buy_tokens - trade.sell_tokens;
    tokenNetPosition.set(trade.token_id, netTokens);
  }

  // 2) Get CTF events (explicit splits, merges, redemptions)
  const ctfQ = `
    SELECT
      event_type,
      condition_id,
      sum(toFloat64OrZero(amount_or_payout))/1e6 as total_amount
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
      AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
      AND is_deleted = 0
    GROUP BY event_type, condition_id
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfEvents = (await ctfR.json()) as Array<{
    event_type: string;
    condition_id: string;
    total_amount: number;
  }>;

  let redemptions = 0;
  let merges = 0;
  let explicitSplits = 0;

  for (const e of ctfEvents) {
    if (e.event_type === 'PayoutRedemption') redemptions += e.total_amount;
    else if (e.event_type === 'PositionsMerge') merges += e.total_amount;
    else if (e.event_type === 'PositionSplit') explicitSplits += e.total_amount;
  }

  // 3) Map tokens to conditions
  const tokenIds = [...tokenNetPosition.keys()];
  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();

  if (tokenIds.length > 0) {
    const tokenChunks = chunk(tokenIds, CHUNK_SIZE);
    for (const c of tokenChunks) {
      const mappingQ = `
        SELECT token_id_dec as token_id, condition_id, outcome_index
        FROM pm_token_to_condition_map_v5
        WHERE token_id_dec IN ({tokenIds:Array(String)})
        UNION ALL
        SELECT token_id_dec as token_id, condition_id, outcome_index
        FROM pm_token_to_condition_patch
        WHERE token_id_dec IN ({tokenIds:Array(String)})
      `;
      const mappingR = await clickhouse.query({
        query: mappingQ,
        query_params: { tokenIds: c },
        format: 'JSONEachRow',
      });
      const mapped = (await mappingR.json()) as Array<{
        token_id: string;
        condition_id: string;
        outcome_index: number;
      }>;
      for (const row of mapped) {
        if (row.condition_id && !tokenToCondition.has(row.token_id)) {
          tokenToCondition.set(row.token_id, {
            conditionId: row.condition_id,
            outcomeIndex: Number(row.outcome_index),
          });
        }
      }
    }
  }

  // 4) Aggregate deficits by condition
  // For each condition, take the MAX deficit across all outcomes
  // This is the amount that must have been split
  const conditionDeficits = new Map<string, number>();
  let tokensWithDeficit = 0;

  for (const [tokenId, netPosition] of tokenNetPosition.entries()) {
    if (netPosition >= 0) continue; // No deficit

    tokensWithDeficit++;
    const deficit = -netPosition;

    const mapping = tokenToCondition.get(tokenId);
    if (!mapping) {
      // Can't attribute to condition - still count as split cost
      // This is conservative (may over-count if multiple unmapped tokens)
      conditionDeficits.set(`unmapped_${tokenId}`, deficit);
      continue;
    }

    // Track max deficit per condition
    const existing = conditionDeficits.get(mapping.conditionId) || 0;
    if (deficit > existing) {
      conditionDeficits.set(mapping.conditionId, deficit);
    }
  }

  // 5) Calculate inferred split cost
  // Sum of max deficits per condition
  let inferredSplitCost = 0;
  for (const deficit of conditionDeficits.values()) {
    inferredSplitCost += deficit;
  }

  // Total split cost = explicit + inferred
  // But don't double-count: if explicit splits cover the deficit, use those
  const totalSplitCost = Math.max(explicitSplits, inferredSplitCost);

  // 6) Calculate P&L
  const realizedPnl = totalSells + redemptions + merges - totalBuys - totalSplitCost;

  return {
    wallet: w,
    buys: totalBuys,
    sells: totalSells,
    redemptions,
    merges,
    explicitSplits,
    inferredSplitCost,
    totalSplitCost,
    realizedPnl,
    trades: tradeCount,
    conditions: conditionDeficits.size,
    tokensWithDeficit,
  };
}
