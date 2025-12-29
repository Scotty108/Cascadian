/**
 * Normalize Synthetic CLOB Pairs Transform
 *
 * Detects "Buy one outcome + Sell opposite outcome" patterns in CLOB trades
 * and creates SYNTHETIC_COST_ADJUSTMENT events to correct the cost basis.
 *
 * Background:
 * When a trader does "Buy YES + Sell NO" in the same transaction, this is
 * economically equivalent to a split ($1 → 1 YES + 1 NO) followed by selling NO.
 * The Polymarket CLOB allows this atomically, but the V11 engine ignores the
 * NO sell (no prior NO position) which understates the true cost of holding YES.
 *
 * This transform:
 * 1. Groups CLOB events by txHash
 * 2. For each transaction, finds paired buys/sells on different tokens in same market
 * 3. Creates SYNTHETIC_COST_ADJUSTMENT events that reduce the avgPrice of the
 *    retained position by the USDC received from the phantom sell
 *
 * @see polymarketSubgraphEngine.ts for SYNTHETIC_COST_ADJUSTMENT handling
 */

import { clickhouse } from '../clickhouse/client';
import { PolymarketPnlEvent, COLLATERAL_SCALE } from './polymarketSubgraphEngine';

/**
 * Token mapping row from pm_token_to_condition_map_v5
 */
interface TokenMappingRow {
  condition_id: string;
  token_id_dec: string;
  outcome_index: number;
}

/**
 * Stats about synthetic pair detection for logging
 */
export interface SyntheticPairStats {
  totalTransactions: number;
  transactionsWithPairs: number;
  syntheticEventsCreated: number;
  totalUsdcAdjusted: bigint;
}

/**
 * Build a reverse mapping from token_id (decimal string) to condition_id
 *
 * @param tokenIds - Set of token IDs (as decimal strings or bigints) to look up
 * @returns Map of token_id (string) → { condition_id, outcome_index }
 */
async function buildTokenToConditionMap(
  tokenIds: Set<string>
): Promise<Map<string, { conditionId: string; outcomeIndex: number }>> {
  if (tokenIds.size === 0) return new Map();

  const tokenIdArray = Array.from(tokenIds);
  const mapping = new Map<string, { conditionId: string; outcomeIndex: number }>();

  // Query pm_token_to_condition_map_v5 for these token IDs
  // Chunk to avoid query size limits
  const CHUNK_SIZE = 500;
  for (let i = 0; i < tokenIdArray.length; i += CHUNK_SIZE) {
    const chunk = tokenIdArray.slice(i, i + CHUNK_SIZE);

    const query = `
      SELECT condition_id, token_id_dec, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN ({tokenIds:Array(String)})
    `;

    const result = await clickhouse.query({
      query,
      query_params: { tokenIds: chunk },
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as TokenMappingRow[];

    for (const row of rows) {
      mapping.set(row.token_id_dec, {
        conditionId: row.condition_id,
        outcomeIndex: row.outcome_index,
      });
    }
  }

  return mapping;
}

/**
 * Detect and create synthetic cost adjustment events for CLOB pairs
 *
 * Algorithm:
 * 1. Group events by txHash
 * 2. For each transaction with multiple CLOB events:
 *    a. Build token → condition mapping
 *    b. Find BUY events and SELL events
 *    c. For each SELL where the token has no prior BUY (phantom sell):
 *       - Check if there's a BUY on a different token in the same condition
 *       - If so, create SYNTHETIC_COST_ADJUSTMENT for the BUY's token
 *       - The adjustment amount = USDC received from the phantom sell
 * 3. Return original events plus synthetic adjustment events
 *
 * @param events - Original events from event loader
 * @returns Events with synthetic cost adjustments inserted
 */
export async function normalizeSyntheticClobPairs(
  events: PolymarketPnlEvent[]
): Promise<{ events: PolymarketPnlEvent[]; stats: SyntheticPairStats }> {
  const stats: SyntheticPairStats = {
    totalTransactions: 0,
    transactionsWithPairs: 0,
    syntheticEventsCreated: 0,
    totalUsdcAdjusted: 0n,
  };

  // Separate CLOB events from others
  const clobEvents = events.filter(
    (e) => e.eventType === 'ORDER_MATCHED_BUY' || e.eventType === 'ORDER_MATCHED_SELL'
  );
  const otherEvents = events.filter(
    (e) => e.eventType !== 'ORDER_MATCHED_BUY' && e.eventType !== 'ORDER_MATCHED_SELL'
  );

  if (clobEvents.length === 0) {
    return { events, stats };
  }

  // Collect all unique token IDs
  const allTokenIds = new Set<string>();
  for (const e of clobEvents) {
    allTokenIds.add(e.tokenId.toString());
  }

  // Build token → condition mapping
  const tokenToCondition = await buildTokenToConditionMap(allTokenIds);

  // Group CLOB events by txHash
  const eventsByTx = new Map<string, PolymarketPnlEvent[]>();
  for (const e of clobEvents) {
    const existing = eventsByTx.get(e.txHash) || [];
    existing.push(e);
    eventsByTx.set(e.txHash, existing);
  }

  stats.totalTransactions = eventsByTx.size;

  // Process each transaction
  const syntheticEvents: PolymarketPnlEvent[] = [];

  for (const [txHash, txEvents] of eventsByTx.entries()) {
    // Skip transactions with only one event
    if (txEvents.length < 2) continue;

    // Separate into buys and sells
    const buys = txEvents.filter((e) => e.eventType === 'ORDER_MATCHED_BUY');
    const sells = txEvents.filter((e) => e.eventType === 'ORDER_MATCHED_SELL');

    if (buys.length === 0 || sells.length === 0) continue;

    // Build a map of condition_id → buys for this transaction
    const conditionToBuys = new Map<string, PolymarketPnlEvent[]>();
    for (const buy of buys) {
      const mapping = tokenToCondition.get(buy.tokenId.toString());
      if (!mapping) continue;
      const existing = conditionToBuys.get(mapping.conditionId) || [];
      existing.push(buy);
      conditionToBuys.set(mapping.conditionId, existing);
    }

    // For each sell, check if it's a phantom sell paired with a buy on same condition
    let txHasPairs = false;
    for (const sell of sells) {
      const sellMapping = tokenToCondition.get(sell.tokenId.toString());
      if (!sellMapping) continue;

      // Check if there are buys on the same condition (different outcome)
      const sameCndBuys = conditionToBuys.get(sellMapping.conditionId);
      if (!sameCndBuys || sameCndBuys.length === 0) continue;

      // Filter to buys on DIFFERENT tokens (same condition, different outcome)
      const pairedBuys = sameCndBuys.filter(
        (b) => b.tokenId.toString() !== sell.tokenId.toString()
      );

      if (pairedBuys.length === 0) continue;

      // This is a phantom sell! Create adjustment event(s) for the paired buy(s)
      txHasPairs = true;

      // The USDC from this phantom sell should reduce the cost basis of the paired buy
      // For simplicity, apply the full credit to the first paired buy
      // (More sophisticated: distribute proportionally by amount)
      const sellUsdc = sell.usdcAmountRaw ?? 0n;

      if (sellUsdc > 0n) {
        const targetBuy = pairedBuys[0];

        const syntheticEvent: PolymarketPnlEvent = {
          wallet: targetBuy.wallet,
          tokenId: targetBuy.tokenId,
          eventType: 'SYNTHETIC_COST_ADJUSTMENT',
          price: 0n, // Not used for this event type
          amount: 0n, // Not adding tokens
          blockNumber: targetBuy.blockNumber,
          logIndex: targetBuy.logIndex + 1n, // Place right after the buy
          txHash: txHash,
          timestamp: targetBuy.timestamp,
          usdcAmountRaw: sellUsdc, // The credit to reduce cost basis
        };

        syntheticEvents.push(syntheticEvent);
        stats.syntheticEventsCreated++;
        stats.totalUsdcAdjusted += sellUsdc;
      }
    }

    if (txHasPairs) {
      stats.transactionsWithPairs++;
    }
  }

  // Combine all events
  const allEvents = [...clobEvents, ...otherEvents, ...syntheticEvents];

  return { events: allEvents, stats };
}

/**
 * Check if a wallet uses synthetic CLOB pairs (for diagnostics)
 *
 * Returns count of transactions that have the buy-one-sell-other pattern.
 */
export async function countSyntheticPairTransactions(
  events: PolymarketPnlEvent[]
): Promise<number> {
  const { stats } = await normalizeSyntheticClobPairs(events);
  return stats.transactionsWithPairs;
}
