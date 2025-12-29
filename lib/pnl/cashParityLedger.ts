/**
 * Cash Parity Ledger P&L Engine
 *
 * A principled, sequential ledger approach for calculating economic P&L.
 * No heuristic caps, no wallet-pattern overrides.
 *
 * Algorithm:
 * 1. Process trades in chronological order
 * 2. Maintain per-token inventory
 * 3. When a SELL exceeds inventory, infer an implicit split of exactly the deficit
 * 4. Splits create tokens for ALL outcomes in that condition
 * 5. Redemptions consume inventory; if insufficient, infer split first
 *
 * Formula:
 *   P&L = Sells + Redemptions + Merges - Buys - SplitCost + HeldValue
 *
 * This gives economic "cash parity" - what the wallet actually made/lost.
 * This is NOT designed to match UI (which uses avg cost basis).
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface CashParityResult {
  wallet: string;
  buys: number;
  sells: number;
  redemptions: number;
  merges: number;
  splitCost: number;
  heldValue: number;
  realizedPnl: number;
  trades: number;
  mappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
  implicitSplits: number;
  explicitSplits: number;
  openPositions: number;
  conditionsTraded: number;
}

interface InventoryPos {
  bought: number; // Tokens from buys
  split: number; // Tokens from splits
}

const CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function computeCashParityPnl(wallet: string): Promise<CashParityResult> {
  const w = wallet.toLowerCase();

  // 1) Load all CLOB trades, ordered by time
  const tradesQ = `
    SELECT
      side,
      usdc_amount/1e6 as usdc,
      token_amount/1e6 as tokens,
      token_id,
      trade_time
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${w}'
    ORDER BY trade_time ASC
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as Array<{
    side: 'buy' | 'sell';
    usdc: number;
    tokens: number;
    token_id: string;
    trade_time: string;
  }>;

  const tradeCount = trades.length;
  const tokenIds = [...new Set(trades.map((t) => t.token_id))];

  if (tokenIds.length === 0) {
    return {
      wallet: w,
      buys: 0,
      sells: 0,
      redemptions: 0,
      merges: 0,
      splitCost: 0,
      heldValue: 0,
      realizedPnl: 0,
      trades: 0,
      mappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
      implicitSplits: 0,
      explicitSplits: 0,
      openPositions: 0,
      conditionsTraded: 0,
    };
  }

  // 2) CTF events (splits, merges, redemptions)
  const ctfQ = `
    SELECT
      event_type,
      condition_id,
      amount_or_payout,
      event_timestamp
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
      AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
      AND is_deleted = 0
    ORDER BY event_timestamp ASC
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfEvents = (await ctfR.json()) as Array<{
    event_type: 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption';
    condition_id: string;
    amount_or_payout: string | number;
    event_timestamp: string;
  }>;

  // 3) Token -> condition mapping
  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  const tokenChunks = chunk(tokenIds, CHUNK_SIZE);
  for (const c of tokenChunks) {
    const mappingQ = `
      WITH patch AS (
        SELECT token_id_dec, any(condition_id) as condition_id, any(outcome_index) as outcome_index
        FROM pm_token_to_condition_patch
        GROUP BY token_id_dec
      )
      SELECT
        ids.token_id_dec as token_id,
        COALESCE(NULLIF(p.condition_id, ''), NULLIF(g.condition_id, '')) as condition_id,
        COALESCE(if(p.condition_id != '', p.outcome_index, NULL), g.outcome_index) as outcome_index
      FROM (
        SELECT token_id_dec FROM pm_token_to_condition_map_v5
        WHERE token_id_dec IN ({tokenIds:Array(String)})
        UNION ALL
        SELECT token_id_dec FROM pm_token_to_condition_patch
        WHERE token_id_dec IN ({tokenIds:Array(String)})
      ) ids
      LEFT JOIN pm_token_to_condition_map_v5 g ON ids.token_id_dec = g.token_id_dec
      LEFT JOIN patch p ON ids.token_id_dec = p.token_id_dec
      WHERE COALESCE(NULLIF(p.condition_id, ''), NULLIF(g.condition_id, '')) != ''
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
      tokenToCondition.set(row.token_id, {
        conditionId: row.condition_id,
        outcomeIndex: Number(row.outcome_index),
      });
    }
  }

  const mappedTokens = tokenToCondition.size;
  const totalTokens = tokenIds.length;
  const mappingCoveragePct = totalTokens > 0 ? mappedTokens / totalTokens : 0;

  // 4) Condition -> outcomes mapping (for split token creation)
  const conditionIds = new Set<string>();
  for (const m of tokenToCondition.values()) conditionIds.add(m.conditionId);
  for (const e of ctfEvents) conditionIds.add(e.condition_id);
  const conditionIdList = [...conditionIds];

  const outcomeMap = new Map<string, Map<number, string>>();
  if (conditionIdList.length > 0) {
    const conditionChunks = chunk(conditionIdList, CHUNK_SIZE);
    for (const c of conditionChunks) {
      const outcomeQ = `
        WITH patch AS (
          SELECT condition_id, outcome_index, any(token_id_dec) as token_id
          FROM pm_token_to_condition_patch
          WHERE condition_id IN ({conditionIds:Array(String)})
          GROUP BY condition_id, outcome_index
        ),
        gamma AS (
          SELECT condition_id, outcome_index, any(token_id_dec) as token_id
          FROM pm_token_to_condition_map_v5
          WHERE condition_id IN ({conditionIds:Array(String)})
          GROUP BY condition_id, outcome_index
        )
        SELECT
          COALESCE(p.condition_id, g.condition_id) as condition_id,
          COALESCE(p.outcome_index, g.outcome_index) as outcome_index,
          COALESCE(NULLIF(p.token_id, ''), g.token_id) as token_id
        FROM gamma g
        FULL OUTER JOIN patch p ON g.condition_id = p.condition_id AND g.outcome_index = p.outcome_index
        WHERE COALESCE(NULLIF(p.token_id, ''), g.token_id) != ''
      `;
      const outcomeR = await clickhouse.query({
        query: outcomeQ,
        query_params: { conditionIds: c },
        format: 'JSONEachRow',
      });
      const rows = (await outcomeR.json()) as Array<{
        condition_id: string;
        outcome_index: number;
        token_id: string;
      }>;
      for (const row of rows) {
        const outcomes = outcomeMap.get(row.condition_id) || new Map<number, string>();
        outcomes.set(Number(row.outcome_index), row.token_id);
        outcomeMap.set(row.condition_id, outcomes);
      }
    }
  }

  // 5) Resolution prices
  const resMap = new Map<string, Map<number, number>>();
  if (conditionIdList.length > 0) {
    const resQ = `
      SELECT condition_id, outcome_index, resolved_price
      FROM vw_pm_resolution_prices
      WHERE condition_id IN ({conditionIds:Array(String)})
    `;
    const resR = await clickhouse.query({
      query: resQ,
      query_params: { conditionIds: conditionIdList },
      format: 'JSONEachRow',
    });
    const resRows = (await resR.json()) as Array<{
      condition_id: string;
      outcome_index: number;
      resolved_price: number;
    }>;
    for (const row of resRows) {
      const m = resMap.get(row.condition_id) || new Map<number, number>();
      m.set(Number(row.outcome_index), Number(row.resolved_price));
      resMap.set(row.condition_id, m);
    }
  }

  // 6) Sequential ledger
  const inventory = new Map<string, InventoryPos>();
  const getPos = (tokenId: string): InventoryPos => {
    const p = inventory.get(tokenId);
    if (p) return p;
    const newPos = { bought: 0, split: 0 };
    inventory.set(tokenId, newPos);
    return newPos;
  };

  let buys = 0;
  let sells = 0;
  let redemptions = 0;
  let merges = 0;
  let splitCost = 0;
  let implicitSplits = 0;
  let explicitSplits = 0;

  const inferSplit = (conditionId: string, amount: number) => {
    if (amount <= 0) return;
    const outcomes = outcomeMap.get(conditionId);
    if (!outcomes) return;
    // Splits create tokens for ALL outcomes
    for (const tokenId of outcomes.values()) {
      const pos = getPos(tokenId);
      pos.split += amount;
    }
    splitCost += amount;
    implicitSplits += amount;
  };

  // 6a) Process CLOB trades in order
  for (const trade of trades) {
    const mapping = tokenToCondition.get(trade.token_id);
    if (!mapping) continue;

    const pos = getPos(trade.token_id);

    if (trade.side === 'buy') {
      pos.bought += trade.tokens;
      buys += trade.usdc;
    } else {
      // SELL: check if we have enough inventory
      const available = pos.bought + pos.split;
      const deficit = Math.max(0, trade.tokens - available);

      // If deficit, infer an implicit split of exactly the deficit
      if (deficit > 0) {
        inferSplit(mapping.conditionId, deficit);
      }

      // Consume inventory (bought first, then split)
      let remaining = trade.tokens;
      if (pos.bought > 0) {
        const use = Math.min(pos.bought, remaining);
        pos.bought -= use;
        remaining -= use;
      }
      if (remaining > 0 && pos.split > 0) {
        const use = Math.min(pos.split, remaining);
        pos.split -= use;
        remaining -= use;
      }
      // Any remaining goes to "short" (negative bought)
      if (remaining > 0) {
        pos.bought -= remaining;
      }

      sells += trade.usdc;
    }
  }

  // 6b) Process CTF events (explicit splits, merges, redemptions)
  for (const e of ctfEvents) {
    const amount = Number(e.amount_or_payout || 0) / 1e6;
    if (amount <= 0) continue;

    const outcomes = outcomeMap.get(e.condition_id);

    if (e.event_type === 'PositionSplit') {
      // Explicit split: creates tokens for all outcomes
      if (outcomes) {
        for (const tokenId of outcomes.values()) {
          const pos = getPos(tokenId);
          pos.split += amount;
        }
      }
      splitCost += amount;
      explicitSplits += amount;
    } else if (e.event_type === 'PositionsMerge') {
      // Merge: consumes all outcomes, returns USDC
      if (outcomes) {
        for (const tokenId of outcomes.values()) {
          const pos = getPos(tokenId);
          const available = pos.bought + pos.split;
          const use = Math.min(available, amount);
          // Consume split first (preserve bought for tracking)
          const useSplit = Math.min(pos.split, use);
          pos.split -= useSplit;
          const useBought = use - useSplit;
          if (useBought > 0) pos.bought -= useBought;
        }
      }
      merges += amount;
    } else if (e.event_type === 'PayoutRedemption') {
      // Redemption: find winning outcome, consume inventory, receive USDC
      const prices = resMap.get(e.condition_id);
      if (!prices) continue;

      // Find winner (highest resolution price)
      let winnerIdx: number | null = null;
      let winnerPrice = 0;
      for (const [idx, price] of prices.entries()) {
        if (price > winnerPrice) {
          winnerPrice = price;
          winnerIdx = idx;
        }
      }
      if (winnerIdx === null || winnerPrice <= 0) continue;

      const winnerTokenId = outcomes?.get(winnerIdx);
      if (!winnerTokenId) continue;

      const tokenAmount = amount / winnerPrice;
      const pos = getPos(winnerTokenId);
      const available = pos.bought + pos.split;

      // If insufficient inventory, infer split first
      if (tokenAmount > available) {
        inferSplit(e.condition_id, tokenAmount - available);
      }

      // Consume inventory
      let remaining = tokenAmount;
      if (pos.bought > 0) {
        const use = Math.min(pos.bought, remaining);
        pos.bought -= use;
        remaining -= use;
      }
      if (remaining > 0 && pos.split > 0) {
        const use = Math.min(pos.split, remaining);
        pos.split -= use;
        remaining -= use;
      }

      redemptions += amount;
    }
  }

  // 7) Held value (remaining inventory at resolution prices)
  let heldValue = 0;
  let openPositions = 0;
  for (const [tokenId, pos] of inventory.entries()) {
    const net = pos.bought + pos.split;
    if (net <= 0) continue;

    const mapping = tokenToCondition.get(tokenId);
    if (!mapping) continue;

    const price = resMap.get(mapping.conditionId)?.get(mapping.outcomeIndex);
    if (price === undefined || price === null) {
      openPositions += 1;
      continue;
    }
    heldValue += net * price;
  }

  const realizedPnl = sells + redemptions + merges - buys - splitCost + heldValue;

  return {
    wallet: w,
    buys,
    sells,
    redemptions,
    merges,
    splitCost,
    heldValue,
    realizedPnl,
    trades: tradeCount,
    mappedTokens,
    totalTokens,
    mappingCoveragePct,
    implicitSplits,
    explicitSplits,
    openPositions,
    conditionsTraded: conditionIds.size,
  };
}
