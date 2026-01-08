/**
 * @deprecated Use pnlEngineV1.ts instead - this engine has been superseded.
 *
 * CCR-v1: Cascadian Cost-basis Realized PnL Engine (DEPRECATED)
 *
 * SUPERSEDED BY: lib/pnl/pnlEngineV1.ts (Jan 2026)
 * - pnlEngineV1 achieves EXACT match with Polymarket UI across all wallet types
 * - This CCR engine had accuracy issues with mixed maker/taker wallets
 *
 * Historical notes:
 * - Implemented Polymarket subgraph-style cost basis accounting
 * - Weighted average cost basis on buys
 * - Sell capping at tracked inventory (position protection)
 * - Realized PnL only from resolved markets
 * - CLOB-only (no ERC1155 transfers)
 *
 * Data source: pm_trader_events_v3 (with GROUP BY event_id dedup)
 * Resolution: pm_condition_resolutions + pm_token_to_condition_map_v5
 */

import { clickhouse } from '../clickhouse/client';
import {
  Position,
  emptyPosition,
  updateWithBuy,
  updateWithSell,
} from './costBasisEngineV1';

// Debug logging - set CCR_DEBUG=1 to enable
const DEBUG = process.env.CCR_DEBUG === '1';

// -----------------------------------------------------------------------------
// System Contract Addresses (excluded from leaderboard)
// -----------------------------------------------------------------------------

// These are Polymarket system contracts, not user wallets
// See: https://github.com/Polymarket/polymarket-subgraph/blob/main/common/constants.template.ts
const SYSTEM_WALLETS = new Set([
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // CTF Exchange
  '0xc5d563a36ae78145c45a50134d48a1215220f80a', // Neg Risk Adapter
  '0x31fe24a4244c7a0f3e02bf4a85a08a1b3d2b80ec', // Neg Risk Exchange
]);

// Proxy contracts that execute CTF events on behalf of users
// We match tx_hash between CLOB and CTF events to attribute these to user wallets
const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // Exchange Proxy
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296', // CTF Exchange
  '0xc5d563a36ae78145c45a50134d48a1215220f80a', // Neg Risk Adapter
];

/**
 * Check if a wallet is a system contract that should be excluded
 */
export function isSystemWallet(wallet: string): boolean {
  return SYSTEM_WALLETS.has(wallet.toLowerCase());
}

/**
 * Check if a wallet is eligible for the CLOB-based leaderboard
 *
 * KEY DISTINCTION:
 * - CTF events (PayoutRedemption, PositionSplit, PositionsMerge) = OK
 *   These are on-chain settlement mechanics with known prices:
 *   - Redemption: payout = $1.00 or $0.00
 *   - Split: cost basis = $0.50 per token
 *   - Merge: sale price = $0.50 per token
 *
 * - ERC1155 transfers = NOT OK
 *   External token transfers have unknown cost basis, breaking PnL accuracy.
 *
 * Requirements: No ERC1155 transfers (CTF events are allowed)
 */
export async function isLeaderboardEligible(wallet: string): Promise<{
  eligible: boolean;
  ctfEvents: number;
  erc1155Transfers: number;
  reason?: string;
}> {
  // CTF events are informational only - they don't disqualify a wallet
  // Note: CTF events are often attributed to proxy contracts, not end-user wallets
  const ctfQuery = `
    SELECT count() as cnt
    FROM pm_ctf_events
    WHERE user_address = '${wallet.toLowerCase()}'
      AND is_deleted = 0
  `;
  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = (await ctfResult.json()) as { cnt: string }[];
  const ctfEvents = Number(ctfRows[0]?.cnt || 0);

  // ERC1155 transfers DISQUALIFY a wallet - unknown cost basis
  // Only count transfers where the wallet received tokens (to_address)
  // Sending tokens is fine - we track the original buy via CLOB
  const ercQuery = `
    SELECT count() as cnt
    FROM pm_erc1155_transfers
    WHERE to_address = '${wallet.toLowerCase()}'
  `;
  const ercResult = await clickhouse.query({ query: ercQuery, format: 'JSONEachRow' });
  const ercRows = (await ercResult.json()) as { cnt: string }[];
  const erc1155Transfers = Number(ercRows[0]?.cnt || 0);

  const eligible = erc1155Transfers === 0;

  return {
    eligible,
    ctfEvents,
    erc1155Transfers,
    reason: eligible ? undefined : `Wallet received ${erc1155Transfers} ERC1155 transfers (unknown cost basis)`,
  };
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface CCRMetrics {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  positions_count: number;
  resolved_count: number;
  unresolved_count: number;
  total_trades: number;
  volume_traded: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  external_sell_tokens: number; // Tokens sold without prior tracked buys
  external_sell_usdc: number; // USDC received for external sells
  external_sell_adjustment: number; // Implied loss assuming $1.00 cost basis (from splits)
  external_sell_ratio: number; // Ratio of external sells to total sells (0-1)
  pnl_confidence: 'high' | 'medium' | 'low'; // Data quality indicator
  // CTF attribution fields (new)
  ctf_split_tokens: number; // Tokens created via PositionSplit
  ctf_merge_tokens: number; // Tokens destroyed via PositionsMerge
  ctf_redemption_tokens: number; // Tokens redeemed via PayoutRedemption
  ctf_split_correction: number; // PnL correction for split cost basis ($0.50 vs $1.00)
  ctf_redemption_proceeds: number; // Value received from redemptions
  // Equal-weight copyability metrics (NEW)
  avg_win_pct: number; // Average % gain on winning positions
  avg_loss_pct: number; // Average % loss on losing positions (as positive number)
  breakeven_wr: number; // Required win rate to break even at equal weight
  edge_ratio: number; // actual_win_rate / breakeven_wr (>1.0 = profitable at equal weight)
  // Per-position returns for Score = μ × M calculation
  position_returns: number[]; // Array of R_i = positionPnl / costBasis (decimal, e.g., 0.12 = +12%)
}

interface CTFData {
  splitTokens: number;
  mergeTokens: number;
  redemptionTokens: number;
}

interface RawTrade {
  event_id: string;
  token_id: string;
  side: string;
  usdc: number;
  tokens: number;
  trade_time: string;
  block_number: number;
  tx_hash: string;
  condition_id: string | null;
  outcome_index: number | null;
}

interface RawCTFEvent {
  event_type: string;
  condition_id: string;
  amount: number; // In tokens (already divided by 1e6)
  event_timestamp: string;
  block_number: number;
  tx_hash: string;
}

// Unified event for processing (CLOB trade or CTF event)
interface UnifiedEvent {
  type: 'clob' | 'ctf_split' | 'ctf_merge' | 'ctf_redemption';
  token_id: string;
  side: 'buy' | 'sell';
  amount: number; // tokens
  price: number; // price per token
  timestamp: string; // For sorting - use timestamp, not block_number (different chains)
  event_id: string;
  tx_hash: string;
}

interface TokenResolution {
  token_id: string;
  payout: number; // 0, 0.5, or 1
  is_resolved: boolean;
  has_metadata: boolean; // true if found in token map, false if defaulted
}

// -----------------------------------------------------------------------------
// Data Loaders
// -----------------------------------------------------------------------------

interface RawTradeWithRole extends RawTrade {
  role: string;
}

async function loadTradesForWallet(wallet: string): Promise<RawTrade[]> {
  // Load MAKER trades only (for now) with condition/outcome info
  //
  // DEDUP STRATEGY:
  // - Each event_id is unique to one wallet's participation (ends in -m or -t)
  // - GROUP BY event_id handles backfill duplicates (same event stored twice)
  //
  // WHY MAKER-ONLY?
  // Including all trades + proxy CTF attribution causes double-counting issues.
  // The proxy-executed splits create inventory that overlaps with CLOB trades
  // in the same transaction. Until we fix the normalization logic, maker-only
  // gives ~1% accuracy vs Polymarket UI.
  //
  // TODO: Fix all-trades + proxy CTF to avoid double-counting:
  // - When a split + CLOB sell happen in same tx, we see both the split (buy)
  //   and the CLOB sell, which is correct
  // - But paired-outcome normalization may be removing wrong legs
  // - Need to trace through specific examples to find the bug
  //
  // Order by block_number to process events chronologically.
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        any(block_number) as block_number,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${wallet.toLowerCase()}'
        AND role = 'maker'
      GROUP BY event_id
    )
    SELECT
      d.event_id,
      d.token_id,
      d.side,
      d.usdc,
      d.tokens,
      d.trade_time,
      d.block_number,
      d.tx_hash,
      m.condition_id,
      m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.block_number, d.event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as RawTrade[];
}

async function loadResolutionsForTokens(tokenIds: string[]): Promise<Map<string, TokenResolution>> {
  if (tokenIds.length === 0) return new Map();

  // Batch lookup in chunks to avoid query size limits
  const CHUNK_SIZE = 500;
  const resolutions = new Map<string, TokenResolution>();

  for (let i = 0; i < tokenIds.length; i += CHUNK_SIZE) {
    const chunk = tokenIds.slice(i, i + CHUNK_SIZE);
    const tokenList = chunk.map(t => `'${t}'`).join(',');

    const query = `
      WITH token_map AS (
        SELECT token_id_dec, condition_id, outcome_index
        FROM pm_token_to_condition_map_v5
        WHERE token_id_dec IN (${tokenList})
      )
      SELECT
        m.token_id_dec as token_id,
        r.payout_numerators,
        m.outcome_index
      FROM token_map m
      LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    for (const row of rows) {
      let payout = 0.5; // Default for unresolved
      let isResolved = false;

      if (row.payout_numerators) {
        try {
          const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
          const outcomeIndex = Number(row.outcome_index);

          // Match subgraph formula: payout = numerator / sum(numerators)
          // This correctly handles ties ([1,1] → 0.5 each) and weighted payouts
          const payoutDenominator = payouts.reduce((a: number, b: number) => a + b, 0);
          payout = payoutDenominator > 0 ? payouts[outcomeIndex] / payoutDenominator : 0;
          isResolved = true;
        } catch {
          // Parse error, treat as unresolved
        }
      }

      resolutions.set(row.token_id, {
        token_id: row.token_id,
        payout,
        is_resolved: isResolved,
        has_metadata: true, // Found in token map
      });
    }
  }

  // For tokens not in map, default to unresolved
  // These are from markets we haven't synced metadata for
  for (const tokenId of tokenIds) {
    if (!resolutions.has(tokenId)) {
      resolutions.set(tokenId, {
        token_id: tokenId,
        payout: 0.5,
        is_resolved: false,
        has_metadata: false, // NOT found in token map - missing metadata
      });
    }
  }

  return resolutions;
}

/**
 * Load CTF events attributed to a wallet (per-event detail).
 *
 * Currently only includes direct user_address matches.
 *
 * TODO: Add proxy attribution (tx_hash matching) once we fix the
 * double-counting issue with all-trades + proxy CTF. The problem is:
 * - Proxy-executed splits create 9M+ tokens of inventory
 * - Including those + all CLOB trades causes double-counting
 * - Need to fix normalization logic before enabling this
 */
async function loadCTFEventsForWallet(wallet: string): Promise<RawCTFEvent[]> {
  // Direct user_address match only (for now)
  // Proxy attribution via tx_hash is disabled until we fix double-counting
  const query = `
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp,
      block_number,
      tx_hash
    FROM pm_ctf_events
    WHERE user_address = '${wallet.toLowerCase()}'
      AND is_deleted = 0
    ORDER BY block_number, event_timestamp
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    return (await result.json()) as RawCTFEvent[];
  } catch {
    // On error (e.g., memory), return empty
    return [];
  }
}

/**
 * Get token_ids for a condition_id (both outcomes)
 */
async function getTokenIdsForConditions(conditionIds: string[]): Promise<Map<string, { token_id_0: string; token_id_1: string }>> {
  if (conditionIds.length === 0) return new Map();

  const CHUNK_SIZE = 500;
  const result = new Map<string, { token_id_0: string; token_id_1: string }>();

  for (let i = 0; i < conditionIds.length; i += CHUNK_SIZE) {
    const chunk = conditionIds.slice(i, i + CHUNK_SIZE);
    const conditionList = chunk.map(c => `'${c.toLowerCase()}'`).join(',');

    const query = `
      SELECT
        lower(condition_id) as condition_id,
        token_id_dec,
        outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE lower(condition_id) IN (${conditionList})
    `;

    const qr = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await qr.json()) as { condition_id: string; token_id_dec: string; outcome_index: number }[];

    // Group by condition_id
    const grouped = new Map<string, { token_id_0?: string; token_id_1?: string }>();
    for (const row of rows) {
      const entry = grouped.get(row.condition_id) || {};
      if (row.outcome_index === 0) entry.token_id_0 = row.token_id_dec;
      else if (row.outcome_index === 1) entry.token_id_1 = row.token_id_dec;
      grouped.set(row.condition_id, entry);
    }

    for (const [cid, tokens] of grouped) {
      if (tokens.token_id_0 && tokens.token_id_1) {
        result.set(cid, { token_id_0: tokens.token_id_0, token_id_1: tokens.token_id_1 });
      }
    }
  }

  return result;
}

/**
 * Aggregate CTF data for metrics (used in output)
 */
function aggregateCTFData(events: RawCTFEvent[]): CTFData {
  let splitTokens = 0;
  let mergeTokens = 0;
  let redemptionTokens = 0;

  for (const e of events) {
    switch (e.event_type) {
      case 'PositionSplit':
        splitTokens += e.amount;
        break;
      case 'PositionsMerge':
        mergeTokens += e.amount;
        break;
      case 'PayoutRedemption':
        redemptionTokens += e.amount;
        break;
    }
  }

  return { splitTokens, mergeTokens, redemptionTokens };
}

// -----------------------------------------------------------------------------
// Paired-Outcome Normalization
// -----------------------------------------------------------------------------

/**
 * Removes phantom legs from paired-outcome trades (synthetic splits/merges via CLOB).
 *
 * When a wallet does "buy YES + sell NO" atomically:
 * - Same transaction (tx_hash)
 * - Same condition_id
 * - Opposite outcomes (0 vs 1)
 * - Matching token amounts (within 1% tolerance)
 * - Prices sum to ~$1.00 (within 5% tolerance)
 *
 * The "sell" leg of a paired trade is a phantom - drop it.
 * This aligns with Polymarket UI's ledger calculation.
 *
 * EXCEPTION: If the transaction has a CTF event (PositionSplit), the sell is REAL
 * (selling tokens created by the split), not a phantom. Skip normalization for those.
 */
function normalizePairedOutcomeTrades(trades: RawTrade[], ctfTxHashes: Set<string>): RawTrade[] {
  const normalized: RawTrade[] = [];
  const phantomIndices = new Set<number>();

  // Group trades by tx_hash + condition_id (more precise than timestamp)
  const groups = new Map<string, { index: number; trade: RawTrade }[]>();

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (!t.condition_id || !t.tx_hash) {
      // No condition mapping or tx_hash - can't pair, keep it
      continue;
    }
    const key = `${t.tx_hash}|${t.condition_id}`;
    const list = groups.get(key) || [];
    list.push({ index: i, trade: t });
    groups.set(key, list);
  }

  // Find paired trades within each group
  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Check if this transaction has CTF events
    const txHash = group[0].trade.tx_hash;
    const hasCTF = txHash && ctfTxHashes.has(txHash.toLowerCase());

    // Look for buy+sell pairs on opposite outcomes
    for (let i = 0; i < group.length; i++) {
      if (phantomIndices.has(group[i].index)) continue;

      for (let j = i + 1; j < group.length; j++) {
        if (phantomIndices.has(group[j].index)) continue;

        const t1 = group[i].trade;
        const t2 = group[j].trade;

        // Must be opposite outcomes
        if (t1.outcome_index === t2.outcome_index) continue;
        if (t1.outcome_index === null || t2.outcome_index === null) continue;

        // Must be opposite sides (one buy, one sell)
        if (t1.side === t2.side) continue;

        // Token amounts must match within 1% tolerance
        const amountDiff = Math.abs(t1.tokens - t2.tokens);
        const avgAmount = (t1.tokens + t2.tokens) / 2;
        if (avgAmount > 0 && amountDiff / avgAmount > 0.01) continue;

        // Prices should sum to ~$1.00 (within 5% tolerance)
        const price1 = t1.tokens > 0 ? t1.usdc / t1.tokens : 0;
        const price2 = t2.tokens > 0 ? t2.usdc / t2.tokens : 0;
        const priceSum = price1 + price2;
        if (Math.abs(priceSum - 1.0) > 0.05) continue;

        // Found a paired trade!
        // For CTF split transactions: Remove the BUY leg (tokens come from split, not CLOB buy)
        // For non-CTF transactions: Remove the SELL leg (no source inventory for the sell)
        if (hasCTF) {
          const buyIndex = t1.side === 'buy' ? group[i].index : group[j].index;
          phantomIndices.add(buyIndex);
        } else {
          const sellIndex = t1.side === 'sell' ? group[i].index : group[j].index;
          phantomIndices.add(sellIndex);
        }
      }
    }
  }

  // Build normalized list excluding phantoms
  for (let i = 0; i < trades.length; i++) {
    if (!phantomIndices.has(i)) {
      normalized.push(trades[i]);
    }
  }

  return normalized;
}

// -----------------------------------------------------------------------------
// CCR-v1 Engine
// -----------------------------------------------------------------------------

// Constants for CTF event pricing (per Polymarket subgraph)
const FIFTY_CENTS = 0.50; // Split/Merge price per token

export async function computeCCRv1(wallet: string): Promise<CCRMetrics> {
  // Check for system wallets (contracts, not users)
  if (isSystemWallet(wallet)) {
    throw new Error(`Wallet ${wallet} is a system contract, not a user wallet`);
  }

  // Step 1: Load all trades and CTF events in parallel
  const [rawTrades, rawCTFEvents] = await Promise.all([
    loadTradesForWallet(wallet),
    loadCTFEventsForWallet(wallet),
  ]);

  // Get aggregated CTF data for metrics output
  const ctfData = aggregateCTFData(rawCTFEvents);

  if (rawTrades.length === 0 && rawCTFEvents.length === 0) {
    return {
      wallet,
      realized_pnl: 0,
      unrealized_pnl: 0,
      total_pnl: 0,
      positions_count: 0,
      resolved_count: 0,
      unresolved_count: 0,
      total_trades: 0,
      volume_traded: 0,
      win_count: 0,
      loss_count: 0,
      win_rate: 0,
      external_sell_tokens: 0,
      external_sell_usdc: 0,
      external_sell_adjustment: 0,
      external_sell_ratio: 0,
      pnl_confidence: 'high',
      ctf_split_tokens: 0,
      ctf_merge_tokens: 0,
      ctf_redemption_tokens: 0,
      ctf_split_correction: 0,
      ctf_redemption_proceeds: 0,
      avg_win_pct: 0,
      avg_loss_pct: 0,
      breakeven_wr: 0,
      edge_ratio: 0,
      position_returns: [],
    };
  }

  // Step 2: Build set of tx_hashes that have PositionSplit events
  // These transactions have real inventory from splits, so sells are NOT phantoms.
  // IMPORTANT: Only splits create the "buy YES + sell NO" artifact. Merges/redemptions don't.
  const ctfSplitTxHashes = new Set<string>();
  for (const ctfEvent of rawCTFEvents) {
    if (ctfEvent.tx_hash && ctfEvent.event_type === 'PositionSplit') {
      ctfSplitTxHashes.add(ctfEvent.tx_hash.toLowerCase());
    }
  }

  // Step 3: Normalize paired-outcome trades
  // For split transactions: remove BUY leg (tokens come from split, not CLOB buy)
  // For non-split transactions: remove SELL leg (synthetic split, no real tokens)
  const normalizedTrades = normalizePairedOutcomeTrades(rawTrades, ctfSplitTxHashes);

  const phantomsRemoved = rawTrades.length - normalizedTrades.length;
  if (phantomsRemoved > 0) {
    if (DEBUG) console.log(`[CCR-v1 DEBUG] Removed ${phantomsRemoved} phantom trades (Split tx_hashes: ${ctfSplitTxHashes.size})`);
  } else {
    if (DEBUG) console.log(`[CCR-v1 DEBUG] No normalization applied (using ${rawTrades.length} raw trades)`);
  }

  // Step 4: Get condition_ids from CTF events and map to token_ids
  const ctfConditionIds = [...new Set(rawCTFEvents.map(e => e.condition_id.toLowerCase()))];
  const conditionToTokens = await getTokenIdsForConditions(ctfConditionIds);

  // DEBUG: Log CTF processing stats
  if (DEBUG) console.log(`[CCR-v1 DEBUG] CTF events: ${rawCTFEvents.length}, Conditions: ${ctfConditionIds.length}, Mapped: ${conditionToTokens.size}`);

  // Step 4: Get unique token IDs from both CLOB and CTF events
  const tokenIdsFromCLOB = normalizedTrades.map(t => t.token_id);
  const tokenIdsFromCTF: string[] = [];
  for (const cid of ctfConditionIds) {
    const tokens = conditionToTokens.get(cid);
    if (tokens) {
      tokenIdsFromCTF.push(tokens.token_id_0, tokens.token_id_1);
    }
  }
  const allTokenIds = [...new Set([...tokenIdsFromCLOB, ...tokenIdsFromCTF])];

  // Step 5: Load resolutions for all tokens
  const resolutions = await loadResolutionsForTokens(allTokenIds);

  // Step 6: Convert CLOB trades to unified events
  const unifiedEvents: UnifiedEvent[] = [];

  for (const trade of normalizedTrades) {
    const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;
    unifiedEvents.push({
      type: 'clob',
      token_id: trade.token_id,
      side: trade.side === 'buy' ? 'buy' : 'sell',
      amount: trade.tokens,
      price,
      timestamp: trade.trade_time, // Use timestamp for sorting
      event_id: trade.event_id,
      tx_hash: trade.tx_hash,
    });
  }

  // Step 7: Convert CTF events to unified events
  // Per Polymarket subgraph:
  // - Split: BUY at $0.50 for BOTH outcomes
  // - Merge: SELL at $0.50 for BOTH outcomes
  // - Redemption: SELL at payout price (winner=$1, loser=$0)
  for (const ctfEvent of rawCTFEvents) {
    const tokens = conditionToTokens.get(ctfEvent.condition_id.toLowerCase());
    if (!tokens) continue; // Skip if we can't map to token_ids

    const amount = ctfEvent.amount; // Already tokens (divided by 1e6)

    switch (ctfEvent.event_type) {
      case 'PositionSplit':
        // Split creates tokens for BOTH outcomes at $0.50 each
        unifiedEvents.push({
          type: 'ctf_split',
          token_id: tokens.token_id_0,
          side: 'buy',
          amount,
          price: FIFTY_CENTS,
          timestamp: ctfEvent.event_timestamp,
          event_id: `split_0_${ctfEvent.tx_hash}`,
          tx_hash: ctfEvent.tx_hash,
        });
        unifiedEvents.push({
          type: 'ctf_split',
          token_id: tokens.token_id_1,
          side: 'buy',
          amount,
          price: FIFTY_CENTS,
          timestamp: ctfEvent.event_timestamp,
          event_id: `split_1_${ctfEvent.tx_hash}`,
          tx_hash: ctfEvent.tx_hash,
        });
        break;

      case 'PositionsMerge':
        // Merge destroys tokens for BOTH outcomes at $0.50 each
        unifiedEvents.push({
          type: 'ctf_merge',
          token_id: tokens.token_id_0,
          side: 'sell',
          amount,
          price: FIFTY_CENTS,
          timestamp: ctfEvent.event_timestamp,
          event_id: `merge_0_${ctfEvent.tx_hash}`,
          tx_hash: ctfEvent.tx_hash,
        });
        unifiedEvents.push({
          type: 'ctf_merge',
          token_id: tokens.token_id_1,
          side: 'sell',
          amount,
          price: FIFTY_CENTS,
          timestamp: ctfEvent.event_timestamp,
          event_id: `merge_1_${ctfEvent.tx_hash}`,
          tx_hash: ctfEvent.tx_hash,
        });
        break;

      case 'PayoutRedemption':
        // Redemption redeems the winner at $1.00 (or fraction if tie)
        // Need to determine which outcome was the winner
        // For now, add redemption for both outcomes - only one will have inventory
        const payout0 = resolutions.get(tokens.token_id_0)?.payout ?? 0.5;
        const payout1 = resolutions.get(tokens.token_id_1)?.payout ?? 0.5;

        // Only add redemption for the winning outcome (payout > 0)
        if (payout0 > 0) {
          unifiedEvents.push({
            type: 'ctf_redemption',
            token_id: tokens.token_id_0,
            side: 'sell',
            amount,
            price: payout0, // Usually 1.0 for winner
            timestamp: ctfEvent.event_timestamp,
            event_id: `redemption_0_${ctfEvent.tx_hash}`,
            tx_hash: ctfEvent.tx_hash,
          });
        }
        if (payout1 > 0) {
          unifiedEvents.push({
            type: 'ctf_redemption',
            token_id: tokens.token_id_1,
            side: 'sell',
            amount,
            price: payout1, // Usually 1.0 for winner
            timestamp: ctfEvent.event_timestamp,
            event_id: `redemption_1_${ctfEvent.tx_hash}`,
            tx_hash: ctfEvent.tx_hash,
          });
        }
        break;
    }
  }

  // DEBUG: Log unified event counts
  if (DEBUG) {
    const clobCount = unifiedEvents.filter(e => e.type === 'clob').length;
    const splitCount = unifiedEvents.filter(e => e.type === 'ctf_split').length;
    const mergeCount = unifiedEvents.filter(e => e.type === 'ctf_merge').length;
    const redemptionCount = unifiedEvents.filter(e => e.type === 'ctf_redemption').length;
    console.log(`[CCR-v1 DEBUG] Unified events: CLOB=${clobCount}, Split=${splitCount}, Merge=${mergeCount}, Redemption=${redemptionCount}`);
  }

  // Step 8: Sort unified events by timestamp with direction rank
  // Key insight: When timestamps collide (same second), inventory-creating events
  // MUST come before inventory-destroying events, even across different transactions.
  // This prevents temporary negative inventory from causing false "external sells".

  // Helper: Parse timestamp to milliseconds
  function tsMs(ts: string): number {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : 0;
  }

  // Helper: Direction rank - inventory creators before destroyers
  function sortRank(e: UnifiedEvent): number {
    // Lower comes first
    if (e.type === 'ctf_split') return 0; // Creates inventory (both outcomes)
    if (e.type === 'clob' && e.side === 'buy') return 1; // Creates inventory
    if (e.type === 'clob' && e.side === 'sell') return 2; // Destroys inventory
    if (e.type === 'ctf_merge') return 3; // Destroys inventory (both outcomes)
    if (e.type === 'ctf_redemption') return 4; // Destroys inventory (winner only)
    return 9;
  }

  unifiedEvents.sort((a, b) => {
    // Primary: sort by numeric timestamp
    const ta = tsMs(a.timestamp);
    const tb = tsMs(b.timestamp);
    if (ta !== tb) return ta - tb;

    // Secondary: inventory-creating before inventory-destroying (critical!)
    const ra = sortRank(a);
    const rb = sortRank(b);
    if (ra !== rb) return ra - rb;

    // Tertiary: keep same-tx events together
    const txc = a.tx_hash.localeCompare(b.tx_hash);
    if (txc !== 0) return txc;

    // Quaternary: stable sort by event_id
    return a.event_id.localeCompare(b.event_id);
  });

  // Step 9: Process all events through cost basis engine
  const positions = new Map<string, Position>();
  let totalExternalSellTokens = 0;
  let totalExternalSellUsdc = 0;
  let totalSellTokens = 0;
  let volumeTraded = 0;

  // Track total buy cost per token for percentage return calculation
  const totalBuyCost = new Map<string, number>();

  // Track external sells by event type for debugging
  const externalByType = { clob: 0, ctf_merge: 0, ctf_redemption: 0 };
  let externalSellsDiagnosed = 0;

  // Keep track of events per token for diagnosis
  const eventHistory = new Map<string, UnifiedEvent[]>();

  for (const event of unifiedEvents) {
    const tokenId = event.token_id;
    let position = positions.get(tokenId) || emptyPosition(wallet, tokenId);

    // Track event history for diagnosis
    const history = eventHistory.get(tokenId) || [];
    history.push(event);
    eventHistory.set(tokenId, history);

    // Track volume for CLOB trades only
    if (event.type === 'clob') {
      volumeTraded += Math.abs(event.amount * event.price);
    }

    if (event.side === 'buy') {
      position = updateWithBuy(position, event.amount, event.price);
      // Track total buy cost for percentage return calculation
      const currentCost = totalBuyCost.get(tokenId) || 0;
      totalBuyCost.set(tokenId, currentCost + event.amount * event.price);
    } else {
      const inventoryBefore = position.amount;
      totalSellTokens += event.amount;
      const { position: newPos, result } = updateWithSell(position, event.amount, event.price);
      position = newPos;
      totalExternalSellTokens += result.externalSell;
      totalExternalSellUsdc += result.externalSellValue;

      // Track external sells by type
      if (result.externalSell > 0.01) {
        if (event.type === 'clob') externalByType.clob += result.externalSell;
        else if (event.type === 'ctf_merge') externalByType.ctf_merge += result.externalSell;
        else if (event.type === 'ctf_redemption') externalByType.ctf_redemption += result.externalSell;

        // Diagnose first 3 external sells (only in debug mode)
        if (DEBUG && externalSellsDiagnosed < 3) {
          console.log(`\n[DIAG] External sell #${externalSellsDiagnosed + 1}: ${event.type} ${event.amount.toFixed(2)} tokens (had: ${inventoryBefore.toFixed(2)})`);
          console.log(`  Token: ...${tokenId.slice(-20)}, TX: ...${event.tx_hash.slice(-8)}`);
          console.log(`  History for this token (${history.length} events):`);
          for (const h of history.slice(-10)) {
            console.log(`    ${h.timestamp} | ${h.type.padEnd(15)} | ${h.side.padEnd(4)} | ${h.amount.toFixed(2)}`);
          }
          externalSellsDiagnosed++;
        }
      }
    }

    positions.set(tokenId, position);
  }

  // Debug: log external sells by type
  if (DEBUG && totalExternalSellTokens > 0.01) {
    console.log(`[CCR-v1 DEBUG] External sells by type: CLOB=${externalByType.clob.toFixed(2)}, Merge=${externalByType.ctf_merge.toFixed(2)}, Redemption=${externalByType.ctf_redemption.toFixed(2)}`);
  }

  // External sell adjustment: for tokens sold without ANY tracked source (CLOB or CTF)
  // These are truly untracked - assume $1.00 cost (synthetic split via some unknown path)
  const externalSellAdjustment = totalExternalSellUsdc - (totalExternalSellTokens * 1.00);

  // Note: With proper CTF integration, we no longer need ctfSplitCorrection or ctfRedemptionProceeds
  // Those are now handled in the unified event stream as proper buys/sells
  const ctfSplitCorrection = 0;
  const ctfRedemptionProceeds = 0;

  // Step 6: Calculate final PnL
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const [tokenId, position] of positions) {
    const resolution = resolutions.get(tokenId);
    const isResolved = resolution?.is_resolved ?? false;
    const payout = resolution?.payout ?? 0.5;

    // Realized PnL from sells (already tracked in position.realizedPnl)
    // Plus: final settlement for remaining tokens IF resolved
    //
    // Per V17/Polymarket formula: unresolved positions contribute 0 to PnL
    // Only credit/debit when market actually resolves
    // This prevents gaming by buying unresolved tokens to inflate unrealized gains

    if (isResolved) {
      // For resolved markets: realized PnL from sells + settlement value of remaining tokens
      const settlementPnl = position.amount * (payout - position.avgPrice);
      const positionPnl = position.realizedPnl + settlementPnl;
      realizedPnl += positionPnl;
      resolvedCount++;

      if (positionPnl > 0) winCount++;
      else if (positionPnl < 0) lossCount++;
    } else {
      // For unresolved markets:
      // - Realized PnL from actual sells (already completed trades)
      // - Unrealized PnL only for tokens with known metadata (not missing data)
      realizedPnl += position.realizedPnl;

      // Only calculate unrealized if we have the token in our metadata
      // Tokens not in the map are from markets we haven't synced
      // and calculating unrealized on them produces inaccurate results
      const resolution = resolutions.get(tokenId);

      if (resolution?.has_metadata && position.amount > 0.01) {
        // Calculate unrealized PnL for open positions with known metadata
        // Mark price = 0.5 (neutral valuation, matches Polymarket subgraph approach)
        // TODO: Could fetch live market prices for more accurate valuation
        const markPrice = 0.5;
        const unrealizedForPosition = position.amount * (markPrice - position.avgPrice);
        unrealizedPnl += unrealizedForPosition;
      }

      unresolvedCount++;
    }
  }

  const resolvedPositions = winCount + lossCount;
  const winRate = resolvedPositions > 0 ? winCount / resolvedPositions : 0;

  // Step 7: Calculate position-level percentage metrics for equal-weight copyability
  // This helps identify wallets that would be profitable when copying with equal position sizes
  const positionPnLs: { costBasis: number; pnl: number; pnlPct: number }[] = [];

  for (const [tokenId, position] of positions) {
    const resolution = resolutions.get(tokenId);
    if (resolution?.is_resolved) {
      const costBasis = totalBuyCost.get(tokenId) || 0;
      if (costBasis > 0) {
        const payout = resolution.payout ?? 0;
        const settlementPnl = position.amount * (payout - position.avgPrice);
        const positionPnl = position.realizedPnl + settlementPnl;
        const pnlPct = (positionPnl / costBasis) * 100;
        positionPnLs.push({ costBasis, pnl: positionPnl, pnlPct });
      }
    }
  }

  // Calculate average win % and average loss % for equal-weight analysis
  const winPositions = positionPnLs.filter(p => p.pnl > 0);
  const lossPositions = positionPnLs.filter(p => p.pnl < 0);

  const avgWinPct = winPositions.length > 0
    ? winPositions.reduce((sum, p) => sum + p.pnlPct, 0) / winPositions.length
    : 0;
  const avgLossPct = lossPositions.length > 0
    ? Math.abs(lossPositions.reduce((sum, p) => sum + p.pnlPct, 0) / lossPositions.length)
    : 0;

  // Breakeven win rate = avg_loss / (avg_win + avg_loss)
  // This is the win rate needed to break even when betting equal amounts
  const breakevenWr = avgWinPct + avgLossPct > 0
    ? avgLossPct / (avgWinPct + avgLossPct)
    : 0;

  // Edge ratio = actual_win_rate / breakeven_win_rate
  // > 1.0 means profitable at equal position sizing
  // Higher is better - indicates consistent edge across positions
  const edgeRatio = breakevenWr > 0 ? winRate / breakevenWr : 0;

  // Apply external sell adjustment and CTF corrections to realized PnL
  // 1. externalSellAdjustment: base adjustment assuming $1.00 cost
  // 2. ctfSplitCorrection: correct cost basis for CTF splits ($0.50 vs $1.00)
  // 3. ctfRedemptionProceeds: add value from redemptions
  const adjustedRealizedPnl = realizedPnl + externalSellAdjustment + ctfSplitCorrection + ctfRedemptionProceeds;

  // Calculate external sell ratio as data quality indicator
  const externalSellRatio = totalSellTokens > 0
    ? totalExternalSellTokens / totalSellTokens
    : 0;

  // Determine PnL confidence based on data coverage
  //
  // With proper CTF integration, external sells should be minimal
  // (only from truly untracked sources like ERC1155 transfers)
  //
  // We use external_sell_ratio as the primary confidence indicator
  const potentialError = totalExternalSellTokens * 0.50; // max error per untracked token
  const totalPnl = adjustedRealizedPnl + unrealizedPnl;

  let pnlConfidence: 'high' | 'medium' | 'low';

  // With CTF attribution, most wallets should now be HIGH confidence
  if (potentialError < 50) {
    pnlConfidence = 'high';
  } else if (potentialError < 500) {
    pnlConfidence = Math.abs(totalPnl) > 1000 ? 'high' : 'medium';
  } else {
    const errorRatio = Math.abs(totalPnl) > 0.01
      ? potentialError / Math.abs(totalPnl)
      : 1.0;

    if (errorRatio < 0.25) {
      pnlConfidence = 'high';
    } else if (errorRatio < 0.50) {
      pnlConfidence = 'medium';
    } else {
      pnlConfidence = 'low';
    }
  }

  return {
    wallet,
    realized_pnl: Math.round(adjustedRealizedPnl * 100) / 100,
    unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
    total_pnl: Math.round((adjustedRealizedPnl + unrealizedPnl) * 100) / 100,
    positions_count: positions.size,
    resolved_count: resolvedCount,
    unresolved_count: unresolvedCount,
    total_trades: normalizedTrades.length,
    volume_traded: Math.round(volumeTraded * 100) / 100,
    win_count: winCount,
    loss_count: lossCount,
    win_rate: Math.round(winRate * 1000) / 1000,
    external_sell_tokens: Math.round(totalExternalSellTokens * 100) / 100,
    external_sell_usdc: Math.round(totalExternalSellUsdc * 100) / 100,
    external_sell_adjustment: Math.round(externalSellAdjustment * 100) / 100,
    external_sell_ratio: Math.round(externalSellRatio * 1000) / 1000,
    pnl_confidence: pnlConfidence,
    // CTF attribution fields
    ctf_split_tokens: Math.round(ctfData.splitTokens * 100) / 100,
    ctf_merge_tokens: Math.round(ctfData.mergeTokens * 100) / 100,
    ctf_redemption_tokens: Math.round(ctfData.redemptionTokens * 100) / 100,
    ctf_split_correction: Math.round(ctfSplitCorrection * 100) / 100,
    ctf_redemption_proceeds: Math.round(ctfRedemptionProceeds * 100) / 100,
    // Equal-weight copyability metrics
    avg_win_pct: Math.round(avgWinPct * 100) / 100,
    avg_loss_pct: Math.round(avgLossPct * 100) / 100,
    breakeven_wr: Math.round(breakevenWr * 1000) / 1000,
    edge_ratio: Math.round(edgeRatio * 1000) / 1000,
    // Per-position returns for Score = μ × M calculation
    position_returns: positionPnLs.map(p => Math.round((p.pnlPct / 100) * 10000) / 10000),
  };
}

// -----------------------------------------------------------------------------
// Factory (matches V20 pattern)
// -----------------------------------------------------------------------------

class CCRv1Engine {
  async compute(wallet: string): Promise<CCRMetrics> {
    return computeCCRv1(wallet);
  }
}

export function createCCRv1Engine(): CCRv1Engine {
  return new CCRv1Engine();
}
