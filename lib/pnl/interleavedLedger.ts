/**
 * Interleaved Ledger P&L Engine
 *
 * Processes CLOB trades and CTF events in strict chronological order.
 * This fixes the bug where processing trades before CTF events causes
 * incorrect inventory tracking.
 *
 * Formula:
 *   Realized P&L = Sells + Redemptions - Buys - SplitCost
 *   (No held value - only counts actual cash flows)
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface InterleavedLedgerResult {
  wallet: string;
  buys: number;
  sells: number;
  redemptions: number;
  merges: number;
  splitCost: number;
  realizedPnl: number;
  trades: number;
  ctfEvents: number;
  mappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
}

interface LedgerEvent {
  type: 'trade' | 'ctf';
  timestamp: string;
  // Trade fields
  side?: 'buy' | 'sell';
  usdc?: number;
  tokens?: number;
  tokenId?: string;
  // CTF fields
  eventType?: 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption';
  conditionId?: string;
  amount?: number;
}

interface TokenInventory {
  bought: number;
  split: number;
}

const CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function computeInterleavedPnl(wallet: string): Promise<InterleavedLedgerResult> {
  const w = wallet.toLowerCase();

  // 1) Load CLOB trades
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

  // 2) Load CTF events
  const ctfQ = `
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
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
      ctfEvents: 0,
      mappedTokens: 0,
      totalTokens: 0,
      mappingCoveragePct: 0,
    };
  }

  // 3) Token -> condition mapping (check both main table and patch)
  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  const tokenChunks = chunk(tokenIds, CHUNK_SIZE);
  for (const c of tokenChunks) {
    // Try main table first
    const mainQ = `
      SELECT token_id_dec as token_id, condition_id, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN ({tokenIds:Array(String)})
    `;
    const mainR = await clickhouse.query({
      query: mainQ,
      query_params: { tokenIds: c },
      format: 'JSONEachRow',
    });
    const mainMapped = (await mainR.json()) as Array<{
      token_id: string;
      condition_id: string;
      outcome_index: number;
    }>;
    for (const row of mainMapped) {
      if (row.condition_id) {
        tokenToCondition.set(row.token_id, {
          conditionId: row.condition_id,
          outcomeIndex: Number(row.outcome_index),
        });
      }
    }

    // Then check patch table for any missing
    const unmapped = c.filter((id) => !tokenToCondition.has(id));
    if (unmapped.length > 0) {
      const patchQ = `
        SELECT token_id_dec as token_id, condition_id, outcome_index
        FROM pm_token_to_condition_patch
        WHERE token_id_dec IN ({tokenIds:Array(String)})
      `;
      const patchR = await clickhouse.query({
        query: patchQ,
        query_params: { tokenIds: unmapped },
        format: 'JSONEachRow',
      });
      const patchMapped = (await patchR.json()) as Array<{
        token_id: string;
        condition_id: string;
        outcome_index: number;
      }>;
      for (const row of patchMapped) {
        if (row.condition_id) {
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

  // 4) Condition -> outcomes mapping
  const conditionIds = new Set<string>();
  for (const m of tokenToCondition.values()) conditionIds.add(m.conditionId);
  for (const e of ctfEvents) conditionIds.add(e.condition_id);
  const conditionIdList = [...conditionIds];

  const outcomeMap = new Map<string, Map<number, string>>();
  if (conditionIdList.length > 0) {
    const conditionChunks = chunk(conditionIdList, CHUNK_SIZE);
    for (const c of conditionChunks) {
      // Check both tables
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
        const outcomes = outcomeMap.get(row.condition_id) || new Map<number, string>();
        outcomes.set(Number(row.outcome_index), row.token_id);
        outcomeMap.set(row.condition_id, outcomes);
      }
    }
  }

  // 5) Resolution prices (for redemption calculations)
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

  // 6) Merge events into chronological order
  const events: LedgerEvent[] = [];

  for (const trade of trades) {
    events.push({
      type: 'trade',
      timestamp: trade.ts,
      side: trade.side,
      usdc: trade.usdc,
      tokens: trade.tokens,
      tokenId: trade.token_id,
    });
  }

  for (const ctf of ctfEvents) {
    events.push({
      type: 'ctf',
      timestamp: ctf.ts,
      eventType: ctf.event_type,
      conditionId: ctf.condition_id,
      amount: ctf.amount,
    });
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // 7) Process events in order
  const inventory = new Map<string, TokenInventory>();
  const getPos = (tokenId: string): TokenInventory => {
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

  const inferSplit = (conditionId: string, amount: number) => {
    if (amount <= 0) return;
    const outcomes = outcomeMap.get(conditionId);
    if (!outcomes) return;
    for (const tokenId of outcomes.values()) {
      const pos = getPos(tokenId);
      pos.split += amount;
    }
    splitCost += amount;
  };

  for (const event of events) {
    if (event.type === 'trade') {
      const mapping = tokenToCondition.get(event.tokenId!);
      if (!mapping) continue;

      const pos = getPos(event.tokenId!);

      if (event.side === 'buy') {
        pos.bought += event.tokens!;
        buys += event.usdc!;
      } else {
        // SELL: check if we have enough inventory
        const available = pos.bought + pos.split;
        const deficit = Math.max(0, event.tokens! - available);

        if (deficit > 0) {
          inferSplit(mapping.conditionId, deficit);
        }

        // Consume inventory
        let remaining = event.tokens!;
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
        if (remaining > 0) {
          pos.bought -= remaining; // Go negative
        }

        sells += event.usdc!;
      }
    } else if (event.type === 'ctf') {
      const amount = event.amount || 0;
      if (amount <= 0) continue;

      const outcomes = outcomeMap.get(event.conditionId!);

      if (event.eventType === 'PositionSplit') {
        // Explicit split: creates tokens for all outcomes
        if (outcomes) {
          for (const tokenId of outcomes.values()) {
            const pos = getPos(tokenId);
            pos.split += amount;
          }
        }
        splitCost += amount;
      } else if (event.eventType === 'PositionsMerge') {
        // Merge: consumes all outcomes, returns USDC
        if (outcomes) {
          for (const tokenId of outcomes.values()) {
            const pos = getPos(tokenId);
            const use = Math.min(pos.bought + pos.split, amount);
            if (pos.split >= use) {
              pos.split -= use;
            } else {
              const useBought = use - pos.split;
              pos.split = 0;
              pos.bought -= useBought;
            }
          }
        }
        merges += amount;
      } else if (event.eventType === 'PayoutRedemption') {
        // Redemption: find winning outcome, consume tokens
        const prices = resMap.get(event.conditionId!);
        if (!prices) {
          redemptions += amount;
          continue;
        }

        // Find winner
        let winnerIdx: number | null = null;
        let winnerPrice = 0;
        for (const [idx, price] of prices.entries()) {
          if (price > winnerPrice) {
            winnerPrice = price;
            winnerIdx = idx;
          }
        }

        if (winnerIdx !== null && winnerPrice > 0 && outcomes) {
          const winnerTokenId = outcomes.get(winnerIdx);
          if (winnerTokenId) {
            const tokenAmount = amount / winnerPrice;
            const pos = getPos(winnerTokenId);
            const available = pos.bought + pos.split;

            // Only infer split if we truly don't have the tokens
            // (might have gotten them from earlier trades/splits)
            if (tokenAmount > available) {
              inferSplit(event.conditionId!, tokenAmount - available);
            }

            // Consume inventory
            let remaining = tokenAmount;
            const posFresh = getPos(winnerTokenId);
            if (posFresh.bought > 0) {
              const use = Math.min(posFresh.bought, remaining);
              posFresh.bought -= use;
              remaining -= use;
            }
            if (remaining > 0 && posFresh.split > 0) {
              const use = Math.min(posFresh.split, remaining);
              posFresh.split -= use;
            }
          }
        }

        redemptions += amount;
      }
    }
  }

  // Realized P&L (no held value - just actual cash flows)
  const realizedPnl = sells + redemptions + merges - buys - splitCost;

  return {
    wallet: w,
    buys,
    sells,
    redemptions,
    merges,
    splitCost,
    realizedPnl,
    trades: tradeCount,
    ctfEvents: ctfEventCount,
    mappedTokens,
    totalTokens,
    mappingCoveragePct,
  };
}
