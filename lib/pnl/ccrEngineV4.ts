/**
 * CCR-v4: Unified PnL Engine
 *
 * =============================================================================
 * GOAL: Single engine that works for ALL wallet types
 * =============================================================================
 *
 * Strategy: Extend CCR-v1 to use ALL trades (maker + taker) instead of maker-only
 *
 * Key insight from CCR-v1:
 * - For bundled split+sell transactions: Remove the BUY leg (tokens from split)
 * - For synthetic split via CLOB (buy YES + sell NO): Remove the SELL leg (no source)
 * - This paired-outcome normalization prevents double-counting
 *
 * Data sources:
 * 1. pm_trader_events_v3: All CLOB trades (maker + taker)
 * 2. pm_ctf_events: Direct CTF events (attributed to wallet)
 * 3. pm_condition_resolutions: Market resolution outcomes
 *
 * Note: Proxy-attributed CTF events are NOT included because:
 * - They duplicate information already in CLOB trades
 * - CCR-v1 maker-only works because maker trades have clean cost basis
 * - Including taker trades without proxy splits may cause "external sells"
 * - But these external sells are handled by assuming $0.50 cost basis
 */

import { clickhouse } from '../clickhouse/client';
import {
  Position,
  emptyPosition,
  updateWithBuy,
  updateWithSell,
} from './costBasisEngineV1';

const DEBUG = process.env.CCR_DEBUG === '1';

// =============================================================================
// Types
// =============================================================================

export interface CCRv4Metrics {
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
  pnl_confidence: 'high' | 'medium' | 'low';
  external_sell_tokens: number;
  external_sell_usdc: number;
  external_sell_adjustment: number;
  maker_trades: number;
  taker_trades: number;
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
  role: string;
  condition_id: string | null;
  outcome_index: number | null;
}

interface RawCTFEvent {
  event_type: string;
  condition_id: string;
  amount: number;
  tx_hash: string;
}

interface TokenResolution {
  token_id: string;
  payout: number;
  is_resolved: boolean;
}

// =============================================================================
// Data Loaders
// =============================================================================

async function loadAllTrades(wallet: string): Promise<RawTrade[]> {
  // Load ALL trades (maker + taker) with deduplication
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
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash,
        any(role) as role
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${wallet.toLowerCase()}'
       
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
      d.role,
      m.condition_id,
      m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.block_number, d.event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as RawTrade[];
}

async function loadSplitTxHashes(wallet: string): Promise<Set<string>> {
  // Get all tx_hashes from wallet's CLOB trades
  const txQuery = `
    SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v3
    WHERE trader_wallet = '${wallet.toLowerCase()}'
     
  `;
  const txResult = await clickhouse.query({ query: txQuery, format: 'JSONEachRow' });
  const txHashes = (await txResult.json() as any[]).map(r => r.tx_hash);

  if (txHashes.length === 0) return new Set();

  // Find which tx_hashes have proxy splits
  const proxyContracts = [
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
    '0xc5d563a36ae78145c45a50134d48a1215220f80a',
  ];
  const proxyList = proxyContracts.map(p => `'${p}'`).join(',');

  const splitTxHashes = new Set<string>();
  const BATCH_SIZE = 500;

  for (let i = 0; i < txHashes.length; i += BATCH_SIZE) {
    const batch = txHashes.slice(i, i + BATCH_SIZE);
    const txList = batch.map(h => `'${h}'`).join(',');

    const splitQuery = `
      SELECT DISTINCT tx_hash
      FROM pm_ctf_events
      WHERE tx_hash IN (${txList})
        AND (user_address = '${wallet.toLowerCase()}' OR user_address IN (${proxyList}))
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
    `;

    const splitResult = await clickhouse.query({ query: splitQuery, format: 'JSONEachRow' });
    const splits = (await splitResult.json()) as any[];

    for (const s of splits) {
      if (s.tx_hash) {
        splitTxHashes.add(s.tx_hash.toLowerCase());
      }
    }
  }

  return splitTxHashes;
}

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
        } catch { }
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

// =============================================================================
// Paired-Outcome Normalization (from CCR-v1)
// =============================================================================

/**
 * Remove phantom legs from paired-outcome trades (synthetic splits via CLOB).
 *
 * Pattern: buy YES + sell NO in same tx, same condition, prices sum to ~$1.00
 *
 * For split transactions (has CTF event): Remove BUY leg (tokens from split)
 * For non-split transactions: Remove SELL leg (no source inventory)
 */
function normalizePairedOutcomeTrades(trades: RawTrade[], ctfTxHashes: Set<string>): RawTrade[] {
  const normalized: RawTrade[] = [];
  const phantomIndices = new Set<number>();

  // Group trades by tx_hash + condition_id
  const groups = new Map<string, { index: number; trade: RawTrade }[]>();

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (!t.condition_id || !t.tx_hash) continue;
    const key = `${t.tx_hash}|${t.condition_id}`;
    const list = groups.get(key) || [];
    list.push({ index: i, trade: t });
    groups.set(key, list);
  }

  // Find paired trades
  for (const [, group] of groups) {
    if (group.length < 2) continue;

    const txHash = group[0].trade.tx_hash;
    const hasCTF = txHash && ctfTxHashes.has(txHash.toLowerCase());

    for (let i = 0; i < group.length; i++) {
      if (phantomIndices.has(group[i].index)) continue;

      for (let j = i + 1; j < group.length; j++) {
        if (phantomIndices.has(group[j].index)) continue;

        const t1 = group[i].trade;
        const t2 = group[j].trade;

        // Must be opposite outcomes
        if (t1.outcome_index === t2.outcome_index) continue;
        if (t1.outcome_index === null || t2.outcome_index === null) continue;

        // Must be opposite sides
        if (t1.side === t2.side) continue;

        // Token amounts must match within 1%
        const amountDiff = Math.abs(t1.tokens - t2.tokens);
        const avgAmount = (t1.tokens + t2.tokens) / 2;
        if (avgAmount > 0 && amountDiff / avgAmount > 0.01) continue;

        // Prices should sum to ~$1.00 (within 5%)
        const price1 = t1.tokens > 0 ? t1.usdc / t1.tokens : 0;
        const price2 = t2.tokens > 0 ? t2.usdc / t2.tokens : 0;
        const priceSum = price1 + price2;
        if (Math.abs(priceSum - 1.0) > 0.05) continue;

        // Found a paired trade!
        if (hasCTF) {
          // Split transaction: Remove BUY leg
          const buyIndex = t1.side === 'buy' ? group[i].index : group[j].index;
          phantomIndices.add(buyIndex);
        } else {
          // Synthetic split: Remove SELL leg
          const sellIndex = t1.side === 'sell' ? group[i].index : group[j].index;
          phantomIndices.add(sellIndex);
        }
      }
    }
  }

  // Build normalized list
  for (let i = 0; i < trades.length; i++) {
    if (!phantomIndices.has(i)) {
      normalized.push(trades[i]);
    }
  }

  return normalized;
}

// =============================================================================
// Main Engine
// =============================================================================

export async function computeCCRv4(wallet: string): Promise<CCRv4Metrics> {
  // Load trades first
  const rawTrades = await loadAllTrades(wallet);

  if (rawTrades.length === 0) {
    return emptyMetrics(wallet);
  }

  // Load split tx_hashes (includes proxy-attributed splits)
  const ctfSplitTxHashes = await loadSplitTxHashes(wallet);

  if (DEBUG) {
    console.log(`[CCR-v4] Found ${ctfSplitTxHashes.size} transactions with splits`);
  }

  // Normalize paired-outcome trades
  const normalizedTrades = normalizePairedOutcomeTrades(rawTrades, ctfSplitTxHashes);

  if (DEBUG) {
    console.log(`[CCR-v4] Raw trades: ${rawTrades.length}, Normalized: ${normalizedTrades.length}, Removed: ${rawTrades.length - normalizedTrades.length}`);
  }

  // Count maker vs taker
  const makerTrades = normalizedTrades.filter(t => t.role === 'maker').length;
  const takerTrades = normalizedTrades.filter(t => t.role === 'taker').length;

  // Get all unique token IDs
  const tokenIds = [...new Set(normalizedTrades.map(t => t.token_id))];
  const resolutions = await loadResolutionsForTokens(tokenIds);

  // Process trades with cost basis engine
  const positions = new Map<string, Position>();
  let volumeTraded = 0;
  let totalExternalSellTokens = 0;
  let totalExternalSellUsdc = 0;

  // Sort by timestamp, buys before sells
  const sortedTrades = [...normalizedTrades].sort((a, b) => {
    const timeA = new Date(a.trade_time).getTime();
    const timeB = new Date(b.trade_time).getTime();
    if (timeA !== timeB) return timeA - timeB;
    if (a.side !== b.side) {
      return a.side === 'buy' ? -1 : 1;
    }
    return a.event_id.localeCompare(b.event_id);
  });

  for (const trade of sortedTrades) {
    if (!trade.token_id) continue;

    const tokenId = trade.token_id;
    let position = positions.get(tokenId) || emptyPosition(wallet, tokenId);

    volumeTraded += trade.usdc;

    if (trade.side === 'buy') {
      const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;
      position = updateWithBuy(position, trade.tokens, price);
    } else {
      const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;
      const { position: newPos, result } = updateWithSell(position, trade.tokens, price);
      position = newPos;
      totalExternalSellTokens += result.externalSell;
      totalExternalSellUsdc += result.externalSellValue;
    }

    positions.set(tokenId, position);
  }

  // External sell adjustment: assume $0.50 cost basis (split price)
  const externalSellAdjustment = totalExternalSellUsdc - (totalExternalSellTokens * 0.50);

  // Calculate PnL
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

    if (isResolved) {
      const settlementPnl = position.amount * (payout - position.avgPrice);
      const positionPnl = position.realizedPnl + settlementPnl;
      realizedPnl += positionPnl;
      resolvedCount++;
      if (positionPnl > 0.01) winCount++;
      else if (positionPnl < -0.01) lossCount++;
    } else {
      realizedPnl += position.realizedPnl;
      if (position.amount > 0.01) {
        const markPrice = 0.5;
        const unrealizedForPosition = position.amount * (markPrice - position.avgPrice);
        unrealizedPnl += unrealizedForPosition;
      }
      unresolvedCount++;
    }
  }

  // Apply external sell adjustment
  const adjustedRealizedPnl = realizedPnl + externalSellAdjustment;
  const totalPnl = adjustedRealizedPnl + unrealizedPnl;

  const resolvedPositions = winCount + lossCount;
  const winRate = resolvedPositions > 0 ? winCount / resolvedPositions : 0;

  // Confidence based on external sell ratio
  const totalSellTokens = sortedTrades.filter(t => t.side === 'sell').reduce((sum, t) => sum + t.tokens, 0);
  const externalRatio = totalSellTokens > 0 ? totalExternalSellTokens / totalSellTokens : 0;
  let pnlConfidence: 'high' | 'medium' | 'low';
  if (externalRatio < 0.05) pnlConfidence = 'high';
  else if (externalRatio < 0.15) pnlConfidence = 'medium';
  else pnlConfidence = 'low';

  return {
    wallet,
    realized_pnl: Math.round(adjustedRealizedPnl * 100) / 100,
    unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
    total_pnl: Math.round(totalPnl * 100) / 100,
    positions_count: positions.size,
    resolved_count: resolvedCount,
    unresolved_count: unresolvedCount,
    total_trades: normalizedTrades.length,
    volume_traded: Math.round(volumeTraded * 100) / 100,
    win_count: winCount,
    loss_count: lossCount,
    win_rate: Math.round(winRate * 1000) / 1000,
    pnl_confidence: pnlConfidence,
    external_sell_tokens: Math.round(totalExternalSellTokens * 100) / 100,
    external_sell_usdc: Math.round(totalExternalSellUsdc * 100) / 100,
    external_sell_adjustment: Math.round(externalSellAdjustment * 100) / 100,
    maker_trades: makerTrades,
    taker_trades: takerTrades,
  };
}

function emptyMetrics(wallet: string): CCRv4Metrics {
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
    pnl_confidence: 'high',
    external_sell_tokens: 0,
    external_sell_usdc: 0,
    external_sell_adjustment: 0,
    maker_trades: 0,
    taker_trades: 0,
  };
}
