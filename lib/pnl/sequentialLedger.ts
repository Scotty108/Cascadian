/**
 * Sequential Ledger P&L Engine
 *
 * Deterministic, no-heuristics engine for economic parity P&L.
 * Based on Codex's "once and for all" plan.
 *
 * Core Rules:
 * 1. Process fills chronologically
 * 2. Maintain per-token inventory
 * 3. When inventory goes negative, IMMEDIATELY infer split for that condition
 * 4. Split mints BOTH outcomes of the condition
 * 5. Redemptions convert payout to tokens, then consume inventory
 *
 * Formula:
 *   P&L = CashIn - CashOut - SplitCost + SettlementValue
 *
 * Where:
 *   CashIn = Sells + Redemptions + Merges
 *   CashOut = Buys
 *   SplitCost = Sum of all inferred splits
 *   SettlementValue = HeldTokens × ResolutionPrice (for resolved markets)
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface SequentialLedgerResult {
  wallet: string;
  buys: number;
  sells: number;
  redemptions: number;
  merges: number;
  splitCost: number;
  heldValue: number;
  realizedPnl: number;
  totalPnl: number;
  trades: number;
  ctfEvents: number;
  mappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
  splitsInferred: number;
  conditionsTraded: number;
}

interface LedgerEvent {
  timestamp: string;
  type: 'buy' | 'sell' | 'split' | 'merge' | 'redeem';
  tokenId?: string;
  conditionId?: string;
  tokens: number;
  usdc: number;
}

const CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function computeSequentialLedgerPnl(wallet: string): Promise<SequentialLedgerResult> {
  const w = wallet.toLowerCase();

  // 1) Load all CLOB trades ordered by time
  const tradesQ = `
    SELECT
      side,
      usdc_amount/1e6 as usdc,
      token_amount/1e6 as tokens,
      token_id,
      trade_time as ts
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
    ts: string;
  }>;

  // 2) Load CTF events ordered by time
  const ctfQ = `
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout)/1e6 as amount,
      event_timestamp as ts
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
    amount: number;
    ts: string;
  }>;

  const tradeCount = trades.length;
  const ctfEventCount = ctfEvents.length;
  const tokenIds = [...new Set(trades.map((t) => t.token_id))];

  if (tokenIds.length === 0 && ctfEvents.length === 0) {
    return {
      wallet: w,
      buys: 0,
      sells: 0,
      redemptions: 0,
      merges: 0,
      splitCost: 0,
      heldValue: 0,
      realizedPnl: 0,
      totalPnl: 0,
      trades: 0,
      ctfEvents: 0,
      mappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
      splitsInferred: 0,
      conditionsTraded: 0,
    };
  }

  // 3) Token -> condition mapping (check both tables)
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

  const mappedTokens = tokenToCondition.size;
  const totalTokens = tokenIds.length;
  const mappingCoveragePct = totalTokens > 0 ? mappedTokens / totalTokens : 0;

  // 4) Condition -> all outcomes mapping (for split minting)
  const conditionIds = new Set<string>();
  for (const m of tokenToCondition.values()) conditionIds.add(m.conditionId);
  for (const e of ctfEvents) conditionIds.add(e.condition_id);
  const conditionIdList = [...conditionIds];

  const conditionOutcomes = new Map<string, Map<number, string>>();
  if (conditionIdList.length > 0) {
    const conditionChunks = chunk(conditionIdList, CHUNK_SIZE);
    for (const c of conditionChunks) {
      const outcomeQ = `
        SELECT condition_id, outcome_index, token_id_dec as token_id
        FROM pm_token_to_condition_map_v5
        WHERE condition_id IN ({conditionIds:Array(String)})
        UNION ALL
        SELECT condition_id, outcome_index, token_id_dec as token_id
        FROM pm_token_to_condition_patch
        WHERE condition_id IN ({conditionIds:Array(String)})
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
        if (!row.condition_id || !row.token_id) continue;
        const outcomes = conditionOutcomes.get(row.condition_id) || new Map();
        outcomes.set(Number(row.outcome_index), row.token_id);
        conditionOutcomes.set(row.condition_id, outcomes);
      }
    }
  }

  // 5) Resolution prices
  const resolutionPrices = new Map<string, Map<number, number>>();
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
      const m = resolutionPrices.get(row.condition_id) || new Map();
      m.set(Number(row.outcome_index), Number(row.resolved_price));
      resolutionPrices.set(row.condition_id, m);
    }
  }

  // 6) Merge all events into chronological order
  const events: LedgerEvent[] = [];

  for (const trade of trades) {
    const mapping = tokenToCondition.get(trade.token_id);
    events.push({
      timestamp: trade.ts,
      type: trade.side,
      tokenId: trade.token_id,
      conditionId: mapping?.conditionId,
      tokens: trade.tokens,
      usdc: trade.usdc,
    });
  }

  for (const ctf of ctfEvents) {
    if (ctf.event_type === 'PositionSplit') {
      events.push({
        timestamp: ctf.ts,
        type: 'split',
        conditionId: ctf.condition_id,
        tokens: ctf.amount,
        usdc: ctf.amount,
      });
    } else if (ctf.event_type === 'PositionsMerge') {
      events.push({
        timestamp: ctf.ts,
        type: 'merge',
        conditionId: ctf.condition_id,
        tokens: ctf.amount,
        usdc: ctf.amount,
      });
    } else if (ctf.event_type === 'PayoutRedemption') {
      events.push({
        timestamp: ctf.ts,
        type: 'redeem',
        conditionId: ctf.condition_id,
        tokens: 0, // Will be calculated from USDC / price
        usdc: ctf.amount,
      });
    }
  }

  // Sort by timestamp, then by type (buys before sells to avoid false deficits)
  const typeOrder: Record<string, number> = {
    split: 0, // Explicit splits first (they add inventory)
    buy: 1,   // Buys second (they add inventory)
    merge: 2, // Merges third
    sell: 3,  // Sells fourth (they consume inventory)
    redeem: 4, // Redemptions last (they consume inventory)
  };
  events.sort((a, b) => {
    const timeCompare = a.timestamp.localeCompare(b.timestamp);
    if (timeCompare !== 0) return timeCompare;
    return (typeOrder[a.type] || 5) - (typeOrder[b.type] || 5);
  });

  // 7) Process events sequentially
  const inventory = new Map<string, number>(); // tokenId -> inventory
  let buys = 0;
  let sells = 0;
  let redemptions = 0;
  let merges = 0;
  let splitCost = 0;
  let splitsInferred = 0;

  const getInventory = (tokenId: string): number => inventory.get(tokenId) || 0;
  const setInventory = (tokenId: string, amount: number) => inventory.set(tokenId, amount);

  // Helper: infer split when inventory goes negative
  const inferSplitIfNeeded = (tokenId: string, conditionId: string | undefined) => {
    const currentInventory = getInventory(tokenId);
    if (currentInventory >= 0) return;

    // Inventory is negative - need to infer a split
    const deficit = -currentInventory;

    if (!conditionId) {
      // Can't infer split without condition - just zero out
      setInventory(tokenId, 0);
      return;
    }

    const outcomes = conditionOutcomes.get(conditionId);
    if (!outcomes) {
      setInventory(tokenId, 0);
      return;
    }

    // Split mints BOTH outcomes
    for (const [, outcomeTokenId] of outcomes) {
      const current = getInventory(outcomeTokenId);
      setInventory(outcomeTokenId, current + deficit);
    }

    // Record split cost
    splitCost += deficit;
    splitsInferred++;
  };

  for (const event of events) {
    if (event.type === 'buy') {
      // Buy: add to inventory, cash outflow
      if (event.tokenId) {
        const current = getInventory(event.tokenId);
        setInventory(event.tokenId, current + event.tokens);
      }
      buys += event.usdc;
    } else if (event.type === 'sell') {
      // Sell: reduce inventory, cash inflow
      if (event.tokenId) {
        const current = getInventory(event.tokenId);
        setInventory(event.tokenId, current - event.tokens);

        // Check if inventory went negative
        inferSplitIfNeeded(event.tokenId, event.conditionId);
      }
      sells += event.usdc;
    } else if (event.type === 'split') {
      // Explicit split: adds tokens to all outcomes, costs USDC
      if (event.conditionId) {
        const outcomes = conditionOutcomes.get(event.conditionId);
        if (outcomes) {
          for (const [, tokenId] of outcomes) {
            const current = getInventory(tokenId);
            setInventory(tokenId, current + event.tokens);
          }
        }
      }
      splitCost += event.usdc;
    } else if (event.type === 'merge') {
      // Merge: removes tokens from all outcomes, returns USDC
      if (event.conditionId) {
        const outcomes = conditionOutcomes.get(event.conditionId);
        if (outcomes) {
          for (const [, tokenId] of outcomes) {
            const current = getInventory(tokenId);
            setInventory(tokenId, current - event.tokens);
            // Merges can also trigger split inference if inventory goes negative
            inferSplitIfNeeded(tokenId, event.conditionId);
          }
        }
      }
      merges += event.usdc;
    } else if (event.type === 'redeem') {
      // Redemption: convert USDC payout to tokens, then consume
      if (event.conditionId) {
        const prices = resolutionPrices.get(event.conditionId);
        if (prices) {
          // Find winning outcome (highest price)
          let winnerIdx: number | null = null;
          let winnerPrice = 0;
          for (const [idx, price] of prices.entries()) {
            if (price > winnerPrice) {
              winnerPrice = price;
              winnerIdx = idx;
            }
          }

          if (winnerIdx !== null && winnerPrice > 0) {
            const outcomes = conditionOutcomes.get(event.conditionId);
            const winnerTokenId = outcomes?.get(winnerIdx);

            if (winnerTokenId) {
              // Convert USDC to tokens
              const redeemedTokens = event.usdc / winnerPrice;

              // Reduce inventory
              const current = getInventory(winnerTokenId);
              setInventory(winnerTokenId, current - redeemedTokens);

              // Check if inventory went negative
              inferSplitIfNeeded(winnerTokenId, event.conditionId);
            }
          }
        }
      }
      redemptions += event.usdc;
    }
  }

  // 8) Calculate held value (remaining inventory at resolution prices)
  let heldValue = 0;
  for (const [tokenId, inv] of inventory.entries()) {
    if (inv <= 0) continue;

    const mapping = tokenToCondition.get(tokenId);
    if (!mapping) continue;

    const price = resolutionPrices.get(mapping.conditionId)?.get(mapping.outcomeIndex);
    if (price !== undefined && price !== null) {
      heldValue += inv * price;
    }
  }

  // 9) Calculate P&L
  // Realized P&L = CashIn - CashOut - SplitCost (excludes unredeemed tokens)
  const realizedPnl = sells + redemptions + merges - buys - splitCost;

  // Total P&L = Realized + HeldValue
  const totalPnl = realizedPnl + heldValue;

  return {
    wallet: w,
    buys,
    sells,
    redemptions,
    merges,
    splitCost,
    heldValue,
    realizedPnl,
    totalPnl,
    trades: tradeCount,
    ctfEvents: ctfEventCount,
    mappedTokens,
    totalTokens,
    mappingCoveragePct,
    splitsInferred,
    conditionsTraded: conditionIds.size,
  };
}
