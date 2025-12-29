/**
 * Two-Lane P&L Engine
 *
 * Based on Codex insight: different wallet patterns need different formulas.
 *
 * Lane 1: Net Buyers (bought > sold tokens)
 *   P&L = Sells + Redemptions - Buys
 *   (No split cost - they buy from market, not from splits)
 *
 * Lane 2: Net Sellers / Arbitrageurs (sold > bought tokens)
 *   P&L = Sells + Redemptions - Buys - SplitCost
 *   (Split cost = max deficit per condition)
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface TwoLaneResult {
  wallet: string;
  lane: 'net_buyer' | 'net_seller';
  buys: number;
  sells: number;
  redemptions: number;
  merges: number;
  splitCost: number;
  realizedPnl: number;
  trades: number;
  tokensBought: number;
  tokensSold: number;
  mappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
}

const CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function computeTwoLanePnl(wallet: string): Promise<TwoLaneResult> {
  const w = wallet.toLowerCase();

  // 1) Load CLOB trades aggregated per token
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

  // Calculate totals
  let totalBuys = 0;
  let totalSells = 0;
  let totalTokensBought = 0;
  let totalTokensSold = 0;

  for (const trade of trades) {
    totalBuys += trade.buy_usdc;
    totalSells += trade.sell_usdc;
    totalTokensBought += trade.buy_tokens;
    totalTokensSold += trade.sell_tokens;
  }

  if (tokenIds.length === 0) {
    return {
      wallet: w,
      lane: 'net_buyer',
      buys: 0,
      sells: 0,
      redemptions: 0,
      merges: 0,
      splitCost: 0,
      realizedPnl: 0,
      trades: 0,
      tokensBought: 0,
      tokensSold: 0,
      mappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
    };
  }

  // 2) Determine lane based on trading pattern
  // Arbitrageurs: sell much more than they buy (high sell/buy ratio) - they split first
  // Market makers: balanced trading (low sell/buy ratio) - they buy from market
  // Net buyers: buy more than sell - they're just buying
  const sellBuyRatio = totalBuys > 0 ? totalSells / totalBuys : (totalSells > 0 ? Infinity : 0);
  const netTokenDeficit = totalTokensSold - totalTokensBought;

  // High ratio + token deficit = arbitrageur pattern
  const isArbitragePattern = sellBuyRatio > 2 && netTokenDeficit > 0;
  const lane = isArbitragePattern ? 'net_seller' : 'net_buyer';

  // 3) Load CTF events
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

  let redemptions = 0;
  let merges = 0;
  let explicitSplits = 0;
  for (const e of ctfEvents) {
    if (e.event_type === 'PayoutRedemption') redemptions += e.total_amount;
    else if (e.event_type === 'PositionsMerge') merges += e.total_amount;
    else if (e.event_type === 'PositionSplit') explicitSplits += e.total_amount;
  }

  // 4) Calculate split cost only for net sellers
  let splitCost = 0;

  if (isArbitragePattern) {
    // Token -> condition mapping
    const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
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

    // Aggregate by condition
    const conditionData = new Map<
      string,
      Map<number, { bought: number; sold: number }>
    >();

    for (const trade of trades) {
      const mapping = tokenToCondition.get(trade.token_id);
      if (!mapping) continue;

      const outcomes = conditionData.get(mapping.conditionId) || new Map();
      const existing = outcomes.get(mapping.outcomeIndex) || { bought: 0, sold: 0 };
      existing.bought += trade.buy_tokens;
      existing.sold += trade.sell_tokens;
      outcomes.set(mapping.outcomeIndex, existing);
      conditionData.set(mapping.conditionId, outcomes);
    }

    // Max deficit per condition
    for (const [, outcomes] of conditionData.entries()) {
      let maxDeficit = 0;
      for (const [, data] of outcomes) {
        const deficit = Math.max(0, data.sold - data.bought);
        if (deficit > maxDeficit) {
          maxDeficit = deficit;
        }
      }
      splitCost += maxDeficit;
    }

    // Add explicit splits
    splitCost += explicitSplits;
  }

  // 5) Calculate P&L
  // Net buyers: no split cost
  // Net sellers: include split cost
  const realizedPnl = totalSells + redemptions + merges - totalBuys - splitCost;

  // Get mapping stats
  const tokenToCondition = new Map<string, boolean>();
  const tokenChunks = chunk(tokenIds, CHUNK_SIZE);
  for (const c of tokenChunks) {
    const mappingQ = `
      SELECT token_id_dec as token_id
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN ({tokenIds:Array(String)})
      UNION ALL
      SELECT token_id_dec as token_id
      FROM pm_token_to_condition_patch
      WHERE token_id_dec IN ({tokenIds:Array(String)})
    `;
    const mappingR = await clickhouse.query({
      query: mappingQ,
      query_params: { tokenIds: c },
      format: 'JSONEachRow',
    });
    const mapped = (await mappingR.json()) as Array<{ token_id: string }>;
    for (const row of mapped) {
      tokenToCondition.set(row.token_id, true);
    }
  }

  return {
    wallet: w,
    lane,
    buys: totalBuys,
    sells: totalSells,
    redemptions,
    merges,
    splitCost,
    realizedPnl,
    trades: tradeCount,
    tokensBought: totalTokensBought,
    tokensSold: totalTokensSold,
    mappedTokens: tokenToCondition.size,
    totalTokens: tokenIds.length,
    mappingCoveragePct: tokenIds.length > 0 ? tokenToCondition.size / tokenIds.length : 0,
  };
}
