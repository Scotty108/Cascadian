/**
 * ============================================================================
 * POLYMARKET-ACCURATE PNL ENGINE V2
 * ============================================================================
 *
 * This engine replicates Polymarket's official PnL calculation algorithm
 * as documented in their pnl-subgraph:
 * https://github.com/Polymarket/polymarket-subgraph/tree/f5a074a5a3b7622185971c5f18aec342bcbe96a6/pnl-subgraph
 *
 * KEY FEATURES:
 * 1. Uses WEIGHTED AVERAGE cost basis (not FIFO)
 * 2. Includes ALL trades (maker + taker) via pm_trader_events_dedup_v2_tbl
 * 3. Handles PayoutRedemption at $1/token for winning outcomes
 * 4. Caps sell amounts at tracked position balance (clamp)
 * 5. Proper deduplication via GROUP BY event_id
 *
 * DATA SOURCES:
 * - pm_trader_events_dedup_v2_tbl (OrderFilled - CLOB trades)
 * - pm_ctf_events (PayoutRedemption)
 * - pm_token_to_condition_map_current (token → condition mapping)
 * - pm_condition_resolutions (resolution payouts)
 *
 * VALIDATION:
 * - V2: Tested on cozyfnf wallet: -6% delta from UI
 * - V3: Auto-settles resolved positions to realized PnL
 * - V4: Includes PositionSplit and PositionsMerge events
 * - V5: Mark-to-market unrealized PnL using last traded price
 * - V6: Uses pm_ctf_split_merge_expanded table, abs() for sign handling
 *
 * CREATED: 2025-12-17
 * UPDATED: 2025-12-17
 * VERSION: 6.0
 * ============================================================================
 */

import { getClickHouseClient } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface PositionState {
  tokenId: string;
  conditionId?: string;
  outcomeIndex?: number;
  amount: number;      // Current token balance (scaled to normal units)
  avgPrice: number;    // Weighted average cost (0-1 range)
  realizedPnl: number; // Cumulative realized PnL in USDC
  totalBought: number; // Total tokens ever bought
}

export interface TransferExposure {
  inTransfers: number;    // Count of incoming transfers
  outTransfers: number;   // Count of outgoing transfers
  inTokens: number;       // Total tokens received via transfer
  outTokens: number;      // Total tokens sent via transfer
  exposureRatio: number;  // inTokens / totalClobTokens (0-1)
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DataConfidence {
  level: ConfidenceLevel;
  score: number;           // 0-100, higher is better
  transferExposure: number;
  skippedSellsRatio: number;
  clampedTokensRatio: number;
  reasons: string[];
}

export interface ExportGrade {
  eligible: boolean;
  reasons: string[];
}

export interface WalletPnlResult {
  wallet: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  positionCount: number;
  tradeCount: number;
  splitCount: number;
  mergeCount: number;
  redemptionCount: number;
  skippedSells: number;
  clampedTokens: number;
  positions: PositionState[];
  transferExposure?: TransferExposure;
  confidence?: DataConfidence;
  exportGrade?: ExportGrade;
  metadata?: Record<string, unknown>;
}

/**
 * Hard gates for export-grade wallets.
 * These thresholds ensure reasonable accuracy vs UI.
 *
 * Rationale:
 * - CLOB-only engine can't track transfer-based inventory
 * - Skipped sells indicate sells without tracked buys (transfer source)
 * - Clamped tokens indicate position tracking errors
 * - High skipped/clamped = unreliable PnL
 *
 * Empirical calibration (2025-12-17):
 * - @cozyfnf: 326 skipped (10.3%), 28.9% clamped → -6% delta (PASS)
 * - @antman: 2765 skipped (16.9%), 26.0% clamped → +11.5% delta (MARGINAL)
 * - 0xafEe: 990 skipped (15.6%), 26.0% clamped → -10.2% delta (MARGINAL)
 *
 * Gates are calibrated to allow @cozyfnf (best accuracy) while flagging higher-risk wallets.
 */
export const EXPORT_GATES = {
  maxSkippedSells: 500,              // Absolute max skipped sells (safety cap)
  maxSkippedSellsRatio: 0.12,        // Max 12% of trades skipped (kept for reference)
  maxSkippedSellNotionalRatio: 0.20, // Max 20% of sell notional skipped (primary gate)
  maxClampedTokensRatio: 0.30,       // Max 30% of tokens clamped
  minConfidenceScore: 60,            // Must be MEDIUM-HIGH confidence
} as const;

interface TradeEvent {
  eventType: 'BUY' | 'SELL';
  tokenId: string;
  amount: number;     // Token amount
  price: number;      // Price per token (0-1)
  timestamp: Date;
  source: 'CLOB' | 'REDEMPTION' | 'SPLIT' | 'MERGE';
}

// ============================================================================
// Position Management (Polymarket Algorithm)
// ============================================================================

interface PositionUpdate {
  position: PositionState;
  skipped: boolean;
  clamped: number;
}

function updatePositionWithBuy(
  position: PositionState,
  amount: number,
  price: number
): PositionUpdate {
  if (amount <= 0) return { position, skipped: false, clamped: 0 };

  // Weighted average cost basis
  const numerator = position.avgPrice * position.amount + price * amount;
  const denominator = position.amount + amount;
  const newAvgPrice = denominator > 0 ? numerator / denominator : price;

  return {
    position: {
      ...position,
      amount: position.amount + amount,
      avgPrice: newAvgPrice,
      totalBought: position.totalBought + amount,
    },
    skipped: false,
    clamped: 0,
  };
}

function updatePositionWithSell(
  position: PositionState,
  amount: number,
  price: number
): PositionUpdate {
  // Cap at tracked position - can't sell more than we tracked as bought
  const adjustedAmount = Math.min(amount, position.amount);

  if (adjustedAmount <= 0) {
    return { position, skipped: true, clamped: amount };
  }

  const clamped = amount - adjustedAmount;

  // Realized PnL = shares × (sell price - avg cost)
  const deltaPnl = adjustedAmount * (price - position.avgPrice);

  return {
    position: {
      ...position,
      amount: position.amount - adjustedAmount,
      realizedPnl: position.realizedPnl + deltaPnl,
    },
    skipped: false,
    clamped,
  };
}

// ============================================================================
// Data Loading
// ============================================================================

async function loadClobTrades(wallet: string): Promise<TradeEvent[]> {
  const client = getClickHouseClient();

  // Load all CLOB trades from dedup table with GROUP BY for complete dedup
  // Use abs() for price calculation to handle sign conventions
  const result = await client.query({
    query: `
      SELECT
        token_id,
        side,
        abs(usdc) as usdc,
        abs(tokens) as tokens,
        abs(usdc) / nullIf(abs(tokens), 0) as price,
        trade_time
      FROM (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(toFloat64(usdc_amount)) / 1000000.0 as usdc,
          any(toFloat64(token_amount)) / 1000000.0 as tokens,
          any(trade_time) as trade_time
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY event_id
      )
      WHERE tokens != 0
      ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{
    token_id: string;
    side: string;
    usdc: number;
    tokens: number;
    price: number;
    trade_time: string;
  }>;

  return rows.map((row) => ({
    eventType: row.side === 'buy' ? 'BUY' : 'SELL',
    tokenId: row.token_id,
    amount: Math.abs(row.tokens),
    price: Math.min(1, Math.max(0, row.price)), // Clamp to 0-1
    timestamp: new Date(row.trade_time),
    source: 'CLOB' as const,
  }));
}

async function loadRedemptions(wallet: string): Promise<TradeEvent[]> {
  const client = getClickHouseClient();

  // Load PayoutRedemption events
  const result = await client.query({
    query: `
      SELECT
        condition_id,
        toFloat64(amount_or_payout) / 1000000.0 as payout,
        event_timestamp
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}')
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
      ORDER BY event_timestamp
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{
    condition_id: string;
    payout: number;
    event_timestamp: string;
  }>;

  const events: TradeEvent[] = [];

  for (const row of rows) {
    // Find the winning token_id for this condition
    const tokenQuery = await client.query({
      query: `
        SELECT m.token_id_dec, m.outcome_index, r.payout_numerators
        FROM pm_token_to_condition_map_current m
        JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
        WHERE m.condition_id = '${row.condition_id}'
      `,
      format: 'JSONEachRow',
    });

    const tokens = (await tokenQuery.json()) as Array<{
      token_id_dec: string;
      outcome_index: number;
      payout_numerators: string;
    }>;

    // Find the winning outcome (the one that gets payout)
    for (const t of tokens) {
      const payouts = JSON.parse(t.payout_numerators);
      if (payouts[t.outcome_index] > 0) {
        // This is the winning outcome - redemption sells at $1/token
        events.push({
          eventType: 'SELL',
          tokenId: t.token_id_dec,
          amount: row.payout, // payout amount = tokens redeemed for winner
          price: 1.0,         // $1 per token for winners
          timestamp: new Date(row.event_timestamp),
          source: 'REDEMPTION',
        });
      }
    }
  }

  return events;
}

/**
 * Load PositionSplit events from the expanded table
 * Split: user deposits USDC collateral to get outcome tokens
 * Uses pre-scaled data with outcome_index already mapped
 */
async function loadSplits(wallet: string): Promise<TradeEvent[]> {
  const client = getClickHouseClient();

  // Load from expanded table with pre-computed values
  const result = await client.query({
    query: `
      SELECT
        e.condition_id,
        e.outcome_index,
        e.shares_delta as amount,
        e.event_timestamp,
        m.token_id_dec as token_id
      FROM pm_ctf_split_merge_expanded e
      JOIN pm_token_to_condition_map_current m
        ON e.condition_id = m.condition_id
        AND e.outcome_index = m.outcome_index
      WHERE lower(e.wallet) = lower('${wallet}')
        AND e.event_type = 'PositionSplit'
      ORDER BY e.event_timestamp
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{
    condition_id: string;
    outcome_index: number;
    amount: number;
    event_timestamp: string;
    token_id: string;
  }>;

  return rows.map(row => ({
    eventType: 'BUY' as const,
    tokenId: row.token_id,
    amount: row.amount, // Already scaled and positive for splits
    price: 0.5, // $0.50 effective cost (since $1 collateral = 1 YES + 1 NO)
    timestamp: new Date(row.event_timestamp),
    source: 'SPLIT' as const,
  }));
}

/**
 * Load PositionsMerge events from the expanded table
 * Merge: user returns outcome tokens to get USDC collateral back
 * Uses pre-scaled data with outcome_index already mapped
 */
async function loadMerges(wallet: string): Promise<TradeEvent[]> {
  const client = getClickHouseClient();

  // Load from expanded table with pre-computed values
  const result = await client.query({
    query: `
      SELECT
        e.condition_id,
        e.outcome_index,
        abs(e.shares_delta) as amount,
        e.event_timestamp,
        m.token_id_dec as token_id
      FROM pm_ctf_split_merge_expanded e
      JOIN pm_token_to_condition_map_current m
        ON e.condition_id = m.condition_id
        AND e.outcome_index = m.outcome_index
      WHERE lower(e.wallet) = lower('${wallet}')
        AND e.event_type = 'PositionsMerge'
      ORDER BY e.event_timestamp
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{
    condition_id: string;
    outcome_index: number;
    amount: number;
    event_timestamp: string;
    token_id: string;
  }>;

  return rows.map(row => ({
    eventType: 'SELL' as const,
    tokenId: row.token_id,
    amount: row.amount, // Use abs() since shares_delta is negative for merges
    price: 0.5, // $0.50 effective value (since 1 YES + 1 NO = $1 collateral)
    timestamp: new Date(row.event_timestamp),
    source: 'MERGE' as const,
  }));
}

// Batch size for tokenId queries to avoid query size limits
const TOKEN_BATCH_SIZE = 5000;

/**
 * Split array into chunks
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Load current market prices for tokens (last traded price)
 * Batches queries to avoid query size limits
 */
async function loadCurrentPrices(tokenIds: string[]): Promise<Map<string, number>> {
  if (tokenIds.length === 0) return new Map();

  const client = getClickHouseClient();
  const map = new Map<string, number>();

  // Process in batches to avoid query size limits
  const batches = chunk(tokenIds, TOKEN_BATCH_SIZE);

  for (const batch of batches) {
    // Get last traded price for each token from deduped CLOB data
    // Use abs() to handle sign conventions properly
    const result = await client.query({
      query: `
        SELECT
          token_id,
          argMax(price, trade_time) as last_price
        FROM (
          SELECT
            token_id,
            trade_time,
            abs(toFloat64(usdc_amount)) / nullIf(abs(toFloat64(token_amount)), 0) as price
          FROM pm_trader_events_dedup_v2_tbl
          WHERE token_id IN (${batch.map(t => `'${t}'`).join(',')})
        )
        WHERE price IS NOT NULL AND price > 0 AND price <= 1
        GROUP BY token_id
      `,
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as Array<{
      token_id: string;
      last_price: number;
    }>;

    for (const row of rows) {
      // Clamp to 0-1 range
      map.set(row.token_id, Math.min(1, Math.max(0, row.last_price)));
    }
  }

  return map;
}

/**
 * Calculate data confidence score based on metrics that correlate with UI accuracy
 *
 * HIGH confidence (score 70-100): Low transfer exposure, few skipped sells
 * MEDIUM confidence (score 40-69): Moderate data quality issues
 * LOW confidence (score 0-39): High transfer exposure or many skipped sells
 *
 * Empirical basis (from golden wallet validation):
 * - @cozyfnf: 3.2% transfer, 330/3178 skipped (10.4%) → -6% delta ✅
 * - @antman: 2.3% transfer, 2788/16367 skipped (17.0%) → +11.5% delta ⚠️
 * - @amused85: 4.9% transfer, 9761/50508 skipped (19.3%) → +243% delta ❌
 */
function calculateConfidence(
  transferExposure: TransferExposure,
  skippedSells: number,
  tradeCount: number,
  clampedTokens: number,
  totalClobTokens: number
): DataConfidence {
  const skippedSellsRatio = tradeCount > 0 ? skippedSells / tradeCount : 0;
  const clampedTokensRatio = totalClobTokens > 0 ? clampedTokens / totalClobTokens : 0;
  const te = transferExposure.exposureRatio;

  const reasons: string[] = [];

  // Score calculation (each factor contributes to penalty)
  let score = 100;

  // Transfer exposure penalty (0-30 points)
  if (te > 0.10) {
    score -= 30;
    reasons.push(`High transfer exposure (${(te * 100).toFixed(1)}%)`);
  } else if (te > 0.05) {
    score -= 15;
    reasons.push(`Moderate transfer exposure (${(te * 100).toFixed(1)}%)`);
  } else if (te > 0.02) {
    score -= 5;
  }

  // Skipped sells penalty (0-40 points) - use BOTH ratio AND absolute count
  // High-volume traders can have low ratio but high absolute skipped sells
  if (skippedSellsRatio > 0.20 || skippedSells > 5000) {
    score -= 40;
    reasons.push(`Many skipped sells (${skippedSells.toLocaleString()} = ${(skippedSellsRatio * 100).toFixed(1)}%)`);
  } else if (skippedSellsRatio > 0.15 || skippedSells > 2000) {
    score -= 25;
    reasons.push(`Moderate skipped sells (${skippedSells.toLocaleString()} = ${(skippedSellsRatio * 100).toFixed(1)}%)`);
  } else if (skippedSellsRatio > 0.10 || skippedSells > 500) {
    score -= 10;
  }

  // Clamped tokens penalty (0-30 points)
  if (clampedTokensRatio > 0.50) {
    score -= 30;
    reasons.push(`High token clamping (${(clampedTokensRatio * 100).toFixed(1)}%)`);
  } else if (clampedTokensRatio > 0.25) {
    score -= 15;
    reasons.push(`Moderate token clamping (${(clampedTokensRatio * 100).toFixed(1)}%)`);
  } else if (clampedTokensRatio > 0.10) {
    score -= 5;
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));

  // Determine confidence level
  let level: ConfidenceLevel;
  if (score >= 70) {
    level = 'HIGH';
  } else if (score >= 40) {
    level = 'MEDIUM';
  } else {
    level = 'LOW';
  }

  if (reasons.length === 0) {
    reasons.push('Clean data profile');
  }

  return {
    level,
    score,
    transferExposure: te,
    skippedSellsRatio,
    clampedTokensRatio,
    reasons,
  };
}

/**
 * Calculate export grade based on hard gates.
 * Wallets passing all gates are suitable for copy-trading exports.
 */
function calculateExportGrade(
  skippedSells: number,
  clampedTokens: number,
  totalClobTokens: number,
  skippedSellNotional: number,
  totalSellNotional: number,
  confidenceScore: number
): ExportGrade {
  const reasons: string[] = [];
  let eligible = true;

  const clampedTokensRatio = totalClobTokens > 0 ? clampedTokens / totalClobTokens : 0;
  // Notional-based ratio (primary gate) - weights by USDC value, not count
  const skippedSellNotionalRatio = totalSellNotional > 0
    ? skippedSellNotional / totalSellNotional : 0;

  // Check absolute skipped sells (safety cap)
  if (skippedSells > EXPORT_GATES.maxSkippedSells) {
    eligible = false;
    reasons.push(`Skipped sells (${skippedSells}) > ${EXPORT_GATES.maxSkippedSells}`);
  }

  // Check notional-based skipped sells ratio (primary gate)
  // This is more tolerant than count-based because tiny anomalies don't weigh as heavily
  if (skippedSellNotionalRatio > EXPORT_GATES.maxSkippedSellNotionalRatio) {
    eligible = false;
    reasons.push(`Skipped sell notional (${(skippedSellNotionalRatio * 100).toFixed(1)}%) > ${EXPORT_GATES.maxSkippedSellNotionalRatio * 100}%`);
  }

  // Check clamped tokens ratio
  if (clampedTokensRatio > EXPORT_GATES.maxClampedTokensRatio) {
    eligible = false;
    reasons.push(`Clamped ratio (${(clampedTokensRatio * 100).toFixed(1)}%) > ${EXPORT_GATES.maxClampedTokensRatio * 100}%`);
  }

  // Check confidence score
  if (confidenceScore < EXPORT_GATES.minConfidenceScore) {
    eligible = false;
    reasons.push(`Confidence (${confidenceScore}) < ${EXPORT_GATES.minConfidenceScore}`);
  }

  if (eligible) {
    reasons.push('Passes all export gates');
  }

  return { eligible, reasons };
}

/**
 * Load ERC-1155 transfer exposure for a wallet
 * This helps identify wallets where PnL may be inaccurate due to
 * tokens being transferred in/out (cost basis not tracked by engine)
 */
async function loadTransferExposure(wallet: string, totalClobTokens: number): Promise<TransferExposure> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        direction,
        count() as transfer_count,
        sum(reinterpretAsUInt64(reverse(unhex(substr(value, 3))))) / 1e6 as total_tokens
      FROM (
        SELECT 'IN' as direction, value
        FROM pm_erc1155_transfers
        WHERE lower(to_address) = lower('${wallet}')
          AND lower(from_address) != lower('${wallet}')
          AND is_deleted = 0
        UNION ALL
        SELECT 'OUT' as direction, value
        FROM pm_erc1155_transfers
        WHERE lower(from_address) = lower('${wallet}')
          AND lower(to_address) != lower('${wallet}')
          AND is_deleted = 0
      )
      GROUP BY direction
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as Array<{
    direction: string;
    transfer_count: number;
    total_tokens: number;
  }>;

  const inRow = rows.find(r => r.direction === 'IN');
  const outRow = rows.find(r => r.direction === 'OUT');

  const inTokens = inRow?.total_tokens || 0;
  const outTokens = outRow?.total_tokens || 0;

  return {
    inTransfers: inRow?.transfer_count || 0,
    outTransfers: outRow?.transfer_count || 0,
    inTokens,
    outTokens,
    exposureRatio: totalClobTokens > 0 ? inTokens / totalClobTokens : 0,
  };
}

/**
 * Load position metadata (condition, outcome, resolution payouts)
 * Batches queries to avoid query size limits
 */
async function loadPositionMeta(
  tokenIds: string[]
): Promise<Map<string, { conditionId: string; outcomeIndex: number; payouts?: number[] }>> {
  if (tokenIds.length === 0) return new Map();

  const client = getClickHouseClient();
  const map = new Map<string, { conditionId: string; outcomeIndex: number; payouts?: number[] }>();

  // Process in batches to avoid query size limits
  const batches = chunk(tokenIds, TOKEN_BATCH_SIZE);

  for (const batch of batches) {
    const result = await client.query({
      query: `
        SELECT
          m.token_id_dec,
          m.condition_id,
          m.outcome_index,
          r.payout_numerators
        FROM pm_token_to_condition_map_current m
        LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
        WHERE m.token_id_dec IN (${batch.map(t => `'${t}'`).join(',')})
      `,
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as Array<{
      token_id_dec: string;
      condition_id: string;
      outcome_index: number;
      payout_numerators: string | null;
    }>;

    for (const row of rows) {
      map.set(row.token_id_dec, {
        conditionId: row.condition_id,
        outcomeIndex: row.outcome_index,
        payouts: row.payout_numerators ? JSON.parse(row.payout_numerators) : undefined,
      });
    }
  }

  return map;
}

// ============================================================================
// Main Engine
// ============================================================================

export async function computePolymarketPnl(wallet: string): Promise<WalletPnlResult> {
  // Load all events in parallel
  const [clobTrades, redemptions, splits, merges] = await Promise.all([
    loadClobTrades(wallet),
    loadRedemptions(wallet),
    loadSplits(wallet),
    loadMerges(wallet),
  ]);

  // Combine and sort by timestamp
  const allEvents = [...clobTrades, ...redemptions, ...splits, ...merges].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  // Track positions
  const positions = new Map<string, PositionState>();

  // Counters
  let tradeCount = 0;
  let redemptionCount = 0;
  let splitCount = 0;
  let mergeCount = 0;
  let skippedSells = 0;
  let clampedTokens = 0;
  let totalClobTokens = 0; // Track total CLOB volume for exposure calculation
  let skippedSellNotional = 0; // USDC value of skipped sells (notional-based gate)
  let totalSellNotional = 0;   // USDC value of all sells (notional-based gate)

  // Process events in chronological order
  for (const event of allEvents) {
    let position = positions.get(event.tokenId) || {
      tokenId: event.tokenId,
      amount: 0,
      avgPrice: 0,
      realizedPnl: 0,
      totalBought: 0,
    };

    let update: PositionUpdate;

    if (event.eventType === 'BUY') {
      update = updatePositionWithBuy(position, event.amount, event.price);
    } else {
      update = updatePositionWithSell(position, event.amount, event.price);
    }

    position = update.position;
    if (update.skipped) skippedSells++;
    if (update.clamped > 0) clampedTokens += update.clamped;

    // Track notional for sells (CLOB only) - used for notional-based export gate
    if (event.eventType === 'SELL' && event.source === 'CLOB') {
      const sellNotional = event.amount * event.price;
      totalSellNotional += sellNotional;
      if (update.skipped || update.clamped > 0) {
        // For skipped: entire sell was skipped
        // For clamped: only the clamped portion counts as problematic
        const skippedAmount = update.skipped ? event.amount : update.clamped;
        skippedSellNotional += skippedAmount * event.price;
      }
    }

    positions.set(event.tokenId, position);

    // Update counters
    if (event.source === 'CLOB') {
      tradeCount++;
      totalClobTokens += event.amount;
    } else if (event.source === 'REDEMPTION') {
      redemptionCount++;
    } else if (event.source === 'SPLIT') {
      splitCount++;
    } else if (event.source === 'MERGE') {
      mergeCount++;
    }
  }

  // ============================================================================
  // EARLY EXIT: Check export gates BEFORE expensive metadata/price queries
  // This speeds up Stage B massively by failing fast on most wallets
  // ============================================================================
  const skippedSellsRatio = tradeCount > 0 ? skippedSells / tradeCount : 0;
  const clampedTokensRatio = totalClobTokens > 0 ? clampedTokens / totalClobTokens : 0;
  // Notional-based gate (primary) - weights by USDC value, not count
  const skippedSellNotionalRatio = totalSellNotional > 0
    ? skippedSellNotional / totalSellNotional : 0;

  const earlyFailReasons: string[] = [];
  if (skippedSells > EXPORT_GATES.maxSkippedSells) {
    earlyFailReasons.push(`Skipped sells (${skippedSells}) > ${EXPORT_GATES.maxSkippedSells}`);
  }
  // Use notional-based gate instead of count-based (more tolerant of tiny anomalies)
  if (skippedSellNotionalRatio > EXPORT_GATES.maxSkippedSellNotionalRatio) {
    earlyFailReasons.push(`Skipped sell notional (${(skippedSellNotionalRatio * 100).toFixed(1)}%) > ${EXPORT_GATES.maxSkippedSellNotionalRatio * 100}%`);
  }
  if (clampedTokensRatio > EXPORT_GATES.maxClampedTokensRatio) {
    earlyFailReasons.push(`Clamped ratio (${(clampedTokensRatio * 100).toFixed(1)}%) > ${EXPORT_GATES.maxClampedTokensRatio * 100}%`);
  }

  // If any gate fails, return early without expensive queries
  if (earlyFailReasons.length > 0) {
    // Calculate basic realized PnL from positions we already have
    let totalRealizedPnl = 0;
    const positionArray: PositionState[] = [];
    for (const position of positions.values()) {
      totalRealizedPnl += position.realizedPnl;
      positionArray.push(position);
    }

    return {
      wallet: wallet.toLowerCase(),
      realizedPnl: totalRealizedPnl,
      unrealizedPnl: 0, // Skip unrealized calculation
      totalPnl: totalRealizedPnl,
      positionCount: positions.size,
      tradeCount,
      splitCount,
      mergeCount,
      redemptionCount,
      skippedSells,
      clampedTokens,
      positions: positionArray,
      // Skip expensive transfer exposure calculation
      confidence: {
        level: 'LOW' as ConfidenceLevel,
        score: 0,
        transferExposure: 0,
        skippedSellsRatio,
        clampedTokensRatio,
        reasons: ['Early exit - failed export gates'],
      },
      exportGrade: {
        eligible: false,
        reasons: earlyFailReasons,
      },
      metadata: {
        openPositions: 0,
        autoSettledPnl: 0,
        totalClobTokens,
        totalSellNotional,
        skippedSellNotional,
        skippedSellNotionalRatio,
        earlyExit: true,
      },
    };
  }

  // ============================================================================
  // FULL PATH: Wallet passed early gates, continue with expensive queries
  // ============================================================================

  // Get open positions and their metadata
  const openPositions: PositionState[] = [];
  const openTokenIds: string[] = [];

  for (const position of positions.values()) {
    if (position.amount > 0) {
      openPositions.push(position);
      openTokenIds.push(position.tokenId);
    }
  }

  // Load condition/resolution info and current prices for open positions
  const [positionMeta, currentPrices] = await Promise.all([
    loadPositionMeta(openTokenIds),
    loadCurrentPrices(openTokenIds),
  ]);

  // Calculate totals
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  let autoSettledPnl = 0; // PnL from resolved but unredeemed positions
  const positionArray: PositionState[] = [];

  for (const position of positions.values()) {
    totalRealizedPnl += position.realizedPnl;

    // Calculate PnL for open positions
    if (position.amount > 0) {
      const meta = positionMeta.get(position.tokenId);
      const costBasis = position.amount * position.avgPrice;

      if (meta?.payouts) {
        // RESOLVED MARKET: PnL is effectively realized (market settled)
        // Even without explicit redemption, the outcome is known
        const isWinner = meta.payouts[meta.outcomeIndex] > 0;
        const settlementValue = isWinner ? position.amount * 1.0 : 0;
        const settlementPnl = settlementValue - costBasis;

        // Add to auto-settled PnL (tracked separately for analysis)
        autoSettledPnl += settlementPnl;
      } else {
        // UNRESOLVED MARKET: Mark-to-market using last traded price
        // unrealized = amount * (current_price - avg_cost)
        const currentPrice = currentPrices.get(position.tokenId) || position.avgPrice;
        const unrealizedPnl = position.amount * (currentPrice - position.avgPrice);
        totalUnrealizedPnl += unrealizedPnl;
      }

      // Update position with metadata
      position.conditionId = meta?.conditionId;
      position.outcomeIndex = meta?.outcomeIndex;
    }

    positionArray.push(position);
  }

  // Add auto-settled PnL to realized (these are resolved markets without explicit redemption)
  totalRealizedPnl += autoSettledPnl;

  // Load transfer exposure to assess data quality
  const transferExposure = await loadTransferExposure(wallet, totalClobTokens);

  // Calculate confidence score
  const confidence = calculateConfidence(
    transferExposure,
    skippedSells,
    tradeCount,
    clampedTokens,
    totalClobTokens
  );

  // Calculate export grade (hard gates for copy-trading exports)
  const exportGrade = calculateExportGrade(
    skippedSells,
    clampedTokens,
    totalClobTokens,
    skippedSellNotional,
    totalSellNotional,
    confidence.score
  );

  return {
    wallet: wallet.toLowerCase(),
    realizedPnl: totalRealizedPnl,
    unrealizedPnl: totalUnrealizedPnl,
    totalPnl: totalRealizedPnl + totalUnrealizedPnl,
    positionCount: positions.size,
    tradeCount,
    splitCount,
    mergeCount,
    redemptionCount,
    skippedSells,
    clampedTokens,
    positions: positionArray,
    transferExposure,
    confidence,
    exportGrade,
    metadata: {
      openPositions: openPositions.length,
      autoSettledPnl, // PnL from resolved but unredeemed positions
      totalClobTokens,
      totalSellNotional,
      skippedSellNotional,
      skippedSellNotionalRatio: totalSellNotional > 0 ? skippedSellNotional / totalSellNotional : 0,
    },
  };
}

// ============================================================================
// Test Function
// ============================================================================

export async function testPolymarketEngine(wallet: string): Promise<void> {
  console.log(`\n=== POLYMARKET-ACCURATE ENGINE V2 TEST ===`);
  console.log(`Wallet: ${wallet}\n`);

  const result = await computePolymarketPnl(wallet);

  console.log(`Realized PnL: $${result.realizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`Unrealized PnL: $${result.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`Total PnL: $${result.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`\nEvent Counts:`);
  console.log(`  CLOB Trades: ${result.tradeCount}`);
  console.log(`  Redemptions: ${result.redemptionCount}`);
  console.log(`  Skipped Sells: ${result.skippedSells}`);
  console.log(`  Clamped Tokens: ${result.clampedTokens.toLocaleString()}`);
  console.log(`\nPositions: ${result.positionCount}`);
  console.log(`Open Positions: ${result.metadata?.openPositions}`);
}
