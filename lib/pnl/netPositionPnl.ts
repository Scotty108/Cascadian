/**
 * Net Position P&L Engine
 *
 * Instead of inferring splits during each trade, we calculate split need
 * based on the FINAL net position per condition.
 *
 * Logic:
 * - For each condition, calculate net tokens bought and sold per outcome
 * - The split need is the max deficit across outcomes
 * - This captures tokens that must have come from splits
 *
 * Formula:
 *   Realized P&L = Sells + Redemptions - Buys - SplitCost
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface NetPositionResult {
  wallet: string;
  buys: number;
  sells: number;
  redemptions: number;
  merges: number;
  splitCost: number;
  realizedPnl: number;
  trades: number;
  mappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
  conditionsTraded: number;
}

const CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function computeNetPositionPnl(wallet: string): Promise<NetPositionResult> {
  const w = wallet.toLowerCase();

  // 1) Load CLOB trades with aggregation per token
  const tradesQ = `
    SELECT
      token_id,
      sumIf(usdc_amount, side = 'buy')/1e6 as buy_usdc,
      sumIf(usdc_amount, side = 'sell')/1e6 as sell_usdc,
      sumIf(token_amount, side = 'buy')/1e6 as buy_tokens,
      sumIf(token_amount, side = 'sell')/1e6 as sell_tokens,
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

  const tokenIds = trades.map((t) => t.token_id);
  const tradeCount = trades.reduce((sum, t) => sum + Number(t.trade_count), 0);

  if (tokenIds.length === 0) {
    return {
      wallet: w,
      buys: 0,
      sells: 0,
      redemptions: 0,
      merges: 0,
      splitCost: 0,
      realizedPnl: 0,
      trades: 0,
      mappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
      conditionsTraded: 0,
    };
  }

  // 2) Load CTF events
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
    event_type: 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption';
    condition_id: string;
    total_amount: number;
  }>;

  // Sum CTF events
  let redemptions = 0;
  let merges = 0;
  let explicitSplits = 0;
  for (const e of ctfEvents) {
    if (e.event_type === 'PayoutRedemption') redemptions += e.total_amount;
    else if (e.event_type === 'PositionsMerge') merges += e.total_amount;
    else if (e.event_type === 'PositionSplit') explicitSplits += e.total_amount;
  }

  // 3) Token -> condition mapping
  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  const tokenChunks = chunk(tokenIds, CHUNK_SIZE);
  for (const c of tokenChunks) {
    // Check both main table and patch
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

  const mappedTokens = tokenToCondition.size;
  const totalTokens = tokenIds.length;
  const mappingCoveragePct = totalTokens > 0 ? mappedTokens / totalTokens : 0;

  // 4) Aggregate by condition
  // For each condition, track net tokens per outcome
  const conditionData = new Map<
    string,
    Map<number, { bought: number; sold: number; tokenId: string }>
  >();

  let totalBuys = 0;
  let totalSells = 0;

  for (const trade of trades) {
    totalBuys += trade.buy_usdc;
    totalSells += trade.sell_usdc;

    const mapping = tokenToCondition.get(trade.token_id);
    if (!mapping) continue;

    const outcomes = conditionData.get(mapping.conditionId) || new Map();
    const existing = outcomes.get(mapping.outcomeIndex) || { bought: 0, sold: 0, tokenId: trade.token_id };
    existing.bought += trade.buy_tokens;
    existing.sold += trade.sell_tokens;
    existing.tokenId = trade.token_id;
    outcomes.set(mapping.outcomeIndex, existing);
    conditionData.set(mapping.conditionId, outcomes);
  }

  // 5) Calculate split cost per condition
  // Use SUM of deficits across outcomes (closer to UI for some wallets)
  let implicitSplitCost = 0;

  for (const [conditionId, outcomes] of conditionData.entries()) {
    let sumDeficit = 0;
    for (const [, data] of outcomes) {
      const deficit = Math.max(0, data.sold - data.bought);
      sumDeficit += deficit;
    }
    // For binary markets, divide by 2 to avoid double-counting
    // (selling both outcomes still only requires one split)
    const outcomeCount = outcomes.size;
    if (outcomeCount === 2 && sumDeficit > 0) {
      // Take average of deficits for binary markets
      implicitSplitCost += sumDeficit / 2;
    } else {
      implicitSplitCost += sumDeficit;
    }
  }

  // Total split cost = explicit + implicit
  const splitCost = explicitSplits + implicitSplitCost;

  // 6) Realized P&L (no held value)
  const realizedPnl = totalSells + redemptions + merges - totalBuys - splitCost;

  return {
    wallet: w,
    buys: totalBuys,
    sells: totalSells,
    redemptions,
    merges,
    splitCost,
    realizedPnl,
    trades: tradeCount,
    mappedTokens,
    totalTokens,
    mappingCoveragePct,
    conditionsTraded: conditionData.size,
  };
}
