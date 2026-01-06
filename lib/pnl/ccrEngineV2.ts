/**
 * CCR-v2: Universal Cascadian Cost-basis Realized PnL Engine
 *
 * UNIVERSAL ENGINE that works for ALL wallet types:
 * - Maker-heavy wallets
 * - Taker-heavy wallets
 * - Mixed strategies
 * - Split/merge heavy wallets
 *
 * Key difference from CCR-v1:
 * - Includes ALL CLOB trades (maker + taker), deduped by (tx_hash, trader_wallet)
 * - Includes CTF splits via tx_hash attribution as BUYS at $0.50
 * - Includes CTF merges via tx_hash attribution as SELLS at $0.50
 * - CTF redemptions attributed via tx_hash join
 *
 * The "external sells" problem is solved by including splits as token acquisitions.
 */

import { clickhouse } from '../clickhouse/client';
import {
  Position,
  emptyPosition,
  updateWithBuy,
  updateWithSell,
} from './costBasisEngineV1';

// System wallets to exclude
const SYSTEM_WALLETS = new Set([
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // CTF Exchange
  '0xc5d563a36ae78145c45a50134d48a1215220f80a', // Neg Risk Adapter
  '0x31fe24a4244c7a0f3e02bf4a85a08a1b3d2b80ec', // Neg Risk Exchange
]);

export function isSystemWallet(wallet: string): boolean {
  return SYSTEM_WALLETS.has(wallet.toLowerCase());
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface CCRv2Metrics {
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
  // Source attribution
  clob_buys: number;
  clob_sells: number;
  split_buys: number; // Tokens acquired via splits
  merge_sells: number; // Tokens disposed via merges
  redemption_tokens: number;
  // External sells (should be near-zero with proper attribution)
  external_sell_tokens: number;
  external_sell_usdc: number;
  external_sell_ratio: number;
  pnl_confidence: 'high' | 'medium' | 'low';
  // Per-position returns for scoring
  position_returns: number[];
  avg_win_pct: number;
  avg_loss_pct: number;
  breakeven_wr: number;
  edge_ratio: number;
}

// Unified event for processing
interface UnifiedEvent {
  type: 'clob' | 'split' | 'merge' | 'redemption';
  token_id: string;
  condition_id: string | null;
  outcome_index: number | null;
  side: 'buy' | 'sell';
  tokens: number;
  price: number; // Price per token
  usdc: number; // Total USDC amount
  timestamp: string;
  event_id: string;
  tx_hash: string;
}

interface TokenResolution {
  token_id: string;
  payout: number; // 0, 0.5, or 1
  is_resolved: boolean;
}

// -----------------------------------------------------------------------------
// Data Loaders
// -----------------------------------------------------------------------------

/**
 * Load ALL CLOB trades for a wallet, deduped by (tx_hash, event_id, trader_wallet).
 * Unlike CCR-v1, this includes BOTH maker AND taker trades.
 */
async function loadAllCLOBTrades(wallet: string): Promise<UnifiedEvent[]> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        any(block_number) as block_number,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      d.event_id,
      d.token_id,
      d.side,
      d.role,
      d.usdc,
      d.tokens,
      d.trade_time,
      d.block_number,
      d.tx_hash,
      m.condition_id,
      m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time, d.event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map(r => ({
    type: 'clob' as const,
    token_id: r.token_id,
    condition_id: r.condition_id,
    outcome_index: r.outcome_index != null ? Number(r.outcome_index) : null,
    side: r.side.toLowerCase() as 'buy' | 'sell',
    tokens: r.tokens,
    price: r.tokens > 0 ? r.usdc / r.tokens : 0,
    usdc: r.usdc,
    timestamp: r.trade_time,
    event_id: r.event_id,
    tx_hash: r.tx_hash,
  }));
}

/**
 * Load CTF splits attributed to wallet via tx_hash join.
 * Each split creates tokens at $0.50 cost basis (for EACH outcome).
 *
 * Optimization: First get the tx_hashes in memory, then query CTF with IN clause.
 */
async function loadSplitsForWallet(wallet: string, walletTxHashes?: string[]): Promise<UnifiedEvent[]> {
  try {
    // If not provided, fetch tx_hashes first
    let txHashes = walletTxHashes;
    if (!txHashes) {
      const txQuery = `
        SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
      `;
      const txResult = await clickhouse.query({ query: txQuery, format: 'JSONEachRow' });
      const txRows = (await txResult.json()) as { tx_hash: string }[];
      txHashes = txRows.map(r => r.tx_hash);
    }

    if (txHashes.length === 0) return [];

    // Process in chunks to avoid query size limits
    const CHUNK_SIZE = 1000;
    const allSplits: UnifiedEvent[] = [];

    for (let i = 0; i < txHashes.length; i += CHUNK_SIZE) {
      const chunk = txHashes.slice(i, i + CHUNK_SIZE);
      const txList = chunk.map(t => `'${t}'`).join(',');

      const query = `
        SELECT
          ctf.condition_id,
          ctf.tx_hash,
          ctf.event_timestamp,
          toFloat64OrZero(ctf.amount_or_payout) / 1e6 as tokens,
          ctf.id as event_id,
          m.token_id_dec as token_id,
          m.outcome_index
        FROM pm_ctf_events ctf
        LEFT JOIN pm_token_to_condition_map_v5 m ON lower(ctf.condition_id) = lower(m.condition_id)
        WHERE ctf.event_type = 'PositionSplit'
          AND ctf.is_deleted = 0
          AND ctf.tx_hash IN (${txList})
      `;

      const result = await clickhouse.query({
        query,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 60 }
      });
      const rows = (await result.json()) as any[];

      // A split creates tokens for EACH outcome
      for (const r of rows) {
        allSplits.push({
          type: 'split' as const,
          token_id: r.token_id || `split_${r.condition_id}_${r.outcome_index}`,
          condition_id: r.condition_id,
          outcome_index: r.outcome_index != null ? Number(r.outcome_index) : null,
          side: 'buy' as const,
          tokens: r.tokens,
          price: 0.50,
          usdc: r.tokens * 0.50,
          timestamp: r.event_timestamp,
          event_id: r.event_id,
          tx_hash: r.tx_hash,
        });
      }
    }

    return allSplits;
  } catch (e) {
    console.error('[CCR-v2] Error loading splits:', e);
    return [];
  }
}

/**
 * Load CTF merges attributed to wallet via tx_hash join.
 * Each merge destroys tokens at $0.50 value (for EACH outcome).
 *
 * Optimization: First get the tx_hashes in memory, then query CTF with IN clause.
 */
async function loadMergesForWallet(wallet: string, walletTxHashes?: string[]): Promise<UnifiedEvent[]> {
  try {
    // If not provided, fetch tx_hashes first
    let txHashes = walletTxHashes;
    if (!txHashes) {
      const txQuery = `
        SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
      `;
      const txResult = await clickhouse.query({ query: txQuery, format: 'JSONEachRow' });
      const txRows = (await txResult.json()) as { tx_hash: string }[];
      txHashes = txRows.map(r => r.tx_hash);
    }

    if (txHashes.length === 0) return [];

    // Process in chunks
    const CHUNK_SIZE = 1000;
    const allMerges: UnifiedEvent[] = [];

    for (let i = 0; i < txHashes.length; i += CHUNK_SIZE) {
      const chunk = txHashes.slice(i, i + CHUNK_SIZE);
      const txList = chunk.map(t => `'${t}'`).join(',');

      const query = `
        SELECT
          ctf.condition_id,
          ctf.tx_hash,
          ctf.event_timestamp,
          toFloat64OrZero(ctf.amount_or_payout) / 1e6 as tokens,
          ctf.id as event_id,
          m.token_id_dec as token_id,
          m.outcome_index
        FROM pm_ctf_events ctf
        LEFT JOIN pm_token_to_condition_map_v5 m ON lower(ctf.condition_id) = lower(m.condition_id)
        WHERE ctf.event_type = 'PositionsMerge'
          AND ctf.is_deleted = 0
          AND ctf.tx_hash IN (${txList})
      `;

      const result = await clickhouse.query({
        query,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 60 }
      });
      const rows = (await result.json()) as any[];

      for (const r of rows) {
        allMerges.push({
          type: 'merge' as const,
          token_id: r.token_id || `merge_${r.condition_id}_${r.outcome_index}`,
          condition_id: r.condition_id,
          outcome_index: r.outcome_index != null ? Number(r.outcome_index) : null,
          side: 'sell' as const,
          tokens: r.tokens,
          price: 0.50,
          usdc: r.tokens * 0.50,
          timestamp: r.event_timestamp,
          event_id: r.event_id,
          tx_hash: r.tx_hash,
        });
      }
    }

    return allMerges;
  } catch (e) {
    console.error('[CCR-v2] Error loading merges:', e);
    return [];
  }
}

/**
 * Load CTF redemptions for wallet.
 * Redemptions are payouts at resolution - tokens converted to USDC based on winning outcome.
 */
async function loadRedemptionsForWallet(wallet: string): Promise<UnifiedEvent[]> {
  // First try direct user_address match, then tx_hash join
  const query = `
    WITH direct_redemptions AS (
      SELECT
        ctf.condition_id,
        ctf.tx_hash,
        ctf.event_timestamp,
        toFloat64OrZero(ctf.amount_or_payout) / 1e6 as tokens,
        ctf.id as event_id
      FROM pm_ctf_events ctf
      WHERE lower(ctf.user_address) = lower('${wallet}')
        AND ctf.event_type = 'PayoutRedemption'
        AND ctf.is_deleted = 0
    )
    SELECT
      d.condition_id,
      d.tx_hash,
      d.event_timestamp,
      d.tokens,
      d.event_id,
      m.token_id_dec as token_id,
      m.outcome_index
    FROM direct_redemptions d
    LEFT JOIN pm_token_to_condition_map_v5 m ON lower(d.condition_id) = lower(m.condition_id)
  `;

  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 60 }
    });
    const rows = (await result.json()) as any[];

    return rows.map(r => ({
      type: 'redemption' as const,
      token_id: r.token_id || `redemption_${r.condition_id}_${r.outcome_index}`,
      condition_id: r.condition_id,
      outcome_index: r.outcome_index != null ? Number(r.outcome_index) : null,
      side: 'sell' as const, // Redemption = disposing tokens for payout
      tokens: r.tokens,
      price: 1.00, // Winning redemption gets $1.00 per token (losing gets $0)
      usdc: r.tokens, // Will be adjusted based on actual payout
      timestamp: r.event_timestamp,
      event_id: r.event_id,
      tx_hash: r.tx_hash,
    }));
  } catch (e) {
    console.error('[CCR-v2] Error loading redemptions:', e);
    return [];
  }
}

/**
 * Load resolutions for tokens
 */
async function loadResolutionsForTokens(tokenIds: string[]): Promise<Map<string, TokenResolution>> {
  if (tokenIds.length === 0) return new Map();

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
      let payout = 0.5;
      let isResolved = false;

      if (row.payout_numerators) {
        try {
          const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
          const outcomeIndex = Number(row.outcome_index);
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
      });
    }
  }

  // Default unresolved for missing tokens
  for (const tokenId of tokenIds) {
    if (!resolutions.has(tokenId)) {
      resolutions.set(tokenId, {
        token_id: tokenId,
        payout: 0.5,
        is_resolved: false,
      });
    }
  }

  return resolutions;
}

// -----------------------------------------------------------------------------
// Main Engine
// -----------------------------------------------------------------------------

export async function computeCCRv2(wallet: string): Promise<CCRv2Metrics> {
  if (isSystemWallet(wallet)) {
    throw new Error(`${wallet} is a system contract, not eligible`);
  }

  console.log(`[CCR-v2] Loading data for ${wallet.slice(0, 10)}...`);

  // First, load CLOB trades and extract tx_hashes for CTF attribution
  const clobTrades = await loadAllCLOBTrades(wallet);
  const walletTxHashes = [...new Set(clobTrades.map(t => t.tx_hash))];
  console.log(`[CCR-v2] CLOB=${clobTrades.length}, unique tx_hashes=${walletTxHashes.length}`);

  // Load CTF events in parallel, sharing tx_hashes
  const [splits, merges, redemptions] = await Promise.all([
    loadSplitsForWallet(wallet, walletTxHashes),
    loadMergesForWallet(wallet, walletTxHashes),
    loadRedemptionsForWallet(wallet),
  ]);

  console.log(`[CCR-v2] Loaded: CLOB=${clobTrades.length}, Splits=${splits.length}, Merges=${merges.length}, Redemptions=${redemptions.length}`);

  // Combine all events and sort by timestamp
  const allEvents: UnifiedEvent[] = [
    ...clobTrades,
    ...splits,
    ...merges,
    ...redemptions,
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (allEvents.length === 0) {
    throw new Error(`No events found for wallet ${wallet}`);
  }

  // Get unique token IDs for resolution lookup
  const tokenIds = [...new Set(allEvents.map(e => e.token_id).filter(t => !t.startsWith('split_') && !t.startsWith('merge_') && !t.startsWith('redemption_')))];
  const resolutions = await loadResolutionsForTokens(tokenIds);

  // Process events with cost-basis accounting
  const positions = new Map<string, Position>();
  let totalVolume = 0;
  let clobBuys = 0;
  let clobSells = 0;
  let splitBuys = 0;
  let mergeSells = 0;
  let redemptionTokens = 0;
  let externalSellTokens = 0;
  let externalSellUsdc = 0;

  for (const event of allEvents) {
    const pos = positions.get(event.token_id) || emptyPosition(wallet, event.token_id);

    if (event.side === 'buy') {
      // Acquiring tokens
      const newPos = updateWithBuy(pos, event.tokens, event.price);
      positions.set(event.token_id, newPos);
      totalVolume += event.usdc;

      if (event.type === 'clob') clobBuys += event.tokens;
      if (event.type === 'split') splitBuys += event.tokens;
    } else {
      // Disposing tokens
      if (pos.amount > 0) {
        const tokensToSell = Math.min(event.tokens, pos.amount);
        const externalTokens = event.tokens - tokensToSell;

        if (tokensToSell > 0) {
          const sellResult = updateWithSell(pos, tokensToSell, event.price);
          positions.set(event.token_id, sellResult.position);
        }

        if (externalTokens > 0) {
          externalSellTokens += externalTokens;
          externalSellUsdc += externalTokens * event.price;
        }
      } else {
        // No position to sell from - external sell
        externalSellTokens += event.tokens;
        externalSellUsdc += event.usdc;
      }

      totalVolume += event.usdc;

      if (event.type === 'clob') clobSells += event.tokens;
      if (event.type === 'merge') mergeSells += event.tokens;
      if (event.type === 'redemption') redemptionTokens += event.tokens;
    }
  }

  // Calculate PnL from positions
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let winCount = 0;
  let lossCount = 0;
  const positionReturns: number[] = [];

  for (const [tokenId, pos] of positions.entries()) {
    const resolution = resolutions.get(tokenId);
    const isResolved = resolution?.is_resolved || false;
    const payout = resolution?.payout ?? 0.5;

    if (isResolved && pos.amount > 0) {
      // Compute final realized PnL for resolved positions
      const finalValue = pos.amount * payout;
      const positionPnl = pos.realizedPnl + finalValue - (pos.amount * pos.avgPrice);
      realizedPnl += positionPnl;
      resolvedCount++;

      // Track win/loss
      if (positionPnl > 0) winCount++;
      if (positionPnl < 0) lossCount++;

      // Calculate return percentage for scoring
      // Use current amount as proxy for total bought (approximation)
      const totalCost = pos.amount * pos.avgPrice;
      if (totalCost > 0) {
        const returnPct = positionPnl / totalCost;
        positionReturns.push(returnPct);
      }
    } else if (isResolved && pos.amount === 0) {
      // Position fully closed before resolution
      realizedPnl += pos.realizedPnl;
      resolvedCount++;

      if (pos.realizedPnl > 0) winCount++;
      if (pos.realizedPnl < 0) lossCount++;

      // Can't calculate return % without tracking total bought shares
      // Skip position_returns for fully closed positions
    } else {
      // Unresolved position
      const midValue = pos.amount * 0.5; // Mark-to-market at 50%
      unrealizedPnl += pos.realizedPnl + midValue - (pos.amount * pos.avgPrice);
      unresolvedCount++;
    }
  }

  // Calculate equal-weight metrics
  const wins = positionReturns.filter(r => r > 0);
  const losses = positionReturns.filter(r => r < 0);
  const avgWinPct = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
  const breakevenWr = avgWinPct + avgLossPct > 0 ? avgLossPct / (avgWinPct + avgLossPct) : 0.5;
  const actualWinRate = positionReturns.length > 0 ? wins.length / positionReturns.length : 0;
  const edgeRatio = breakevenWr > 0 ? actualWinRate / breakevenWr : 1;

  // Calculate external sell ratio
  const totalSells = clobSells + mergeSells + redemptionTokens;
  const externalSellRatio = totalSells > 0 ? externalSellTokens / totalSells : 0;

  // Determine confidence based on external sell ratio
  let pnlConfidence: 'high' | 'medium' | 'low' = 'high';
  if (externalSellRatio > 0.20) pnlConfidence = 'low';
  else if (externalSellRatio > 0.05) pnlConfidence = 'medium';

  return {
    wallet,
    realized_pnl: realizedPnl,
    unrealized_pnl: unrealizedPnl,
    total_pnl: realizedPnl + unrealizedPnl,
    positions_count: positions.size,
    resolved_count: resolvedCount,
    unresolved_count: unresolvedCount,
    total_trades: allEvents.length,
    volume_traded: totalVolume,
    win_count: winCount,
    loss_count: lossCount,
    win_rate: resolvedCount > 0 ? winCount / resolvedCount : 0,
    clob_buys: clobBuys,
    clob_sells: clobSells,
    split_buys: splitBuys,
    merge_sells: mergeSells,
    redemption_tokens: redemptionTokens,
    external_sell_tokens: externalSellTokens,
    external_sell_usdc: externalSellUsdc,
    external_sell_ratio: externalSellRatio,
    pnl_confidence: pnlConfidence,
    position_returns: positionReturns,
    avg_win_pct: avgWinPct,
    avg_loss_pct: avgLossPct,
    breakeven_wr: breakevenWr,
    edge_ratio: edgeRatio,
  };
}
