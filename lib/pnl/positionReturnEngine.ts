/**
 * Position Return Engine
 *
 * Calculates per-position returns for superforecaster scoring.
 * Uses tx-correlated split attribution to handle proxy splits correctly.
 *
 * Key insight: When a wallet has a SELL in the same tx_hash as a PositionSplit,
 * those tokens came from the split at $0.50 cost basis.
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface PositionReturn {
  conditionId: string;
  outcomeIndex: number;
  marketId?: string;
  entryTimestamp: string;
  exitTimestamp: string;
  entryCost: number;      // Total USDC paid for tokens
  exitValue: number;      // Total USDC received (sells + resolution)
  tokensTraded: number;   // Total tokens bought/acquired
  returnPct: number;      // (exitValue - entryCost) / entryCost * 100
  returnDecimal: number;  // (exitValue - entryCost) / entryCost
  isWin: boolean;
  source: 'clob' | 'split' | 'mixed';  // How tokens were acquired
}

export interface WalletReturns {
  wallet: string;
  positions: PositionReturn[];
  numTrades: number;
  numMarkets: number;
  numWins: number;
  numLosses: number;
  totalReturn: number;
  avgReturn: number;
}

interface RawTrade {
  event_id: string;
  token_id: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  usdc: number;
  tokens: number;
  trade_time: string;
  tx_hash: string;
}

interface SplitTxInfo {
  tx_hash: string;
  condition_id: string;
  amount: number;  // Tokens created per outcome
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const SPLIT_COST_PER_TOKEN = 0.50;

// -----------------------------------------------------------------------------
// Data Loaders
// -----------------------------------------------------------------------------

/**
 * Load all CLOB trades for wallet (maker + taker), deduped
 */
async function loadAllTrades(wallet: string): Promise<RawTrade[]> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
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
      d.usdc,
      d.tokens,
      d.trade_time,
      d.tx_hash,
      m.condition_id,
      toInt32(m.outcome_index) as outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time, d.event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as RawTrade[];
}

/**
 * Load PositionSplit events that correlate with wallet's trades via tx_hash
 */
async function loadCorrelatedSplits(wallet: string, txHashes: string[]): Promise<Map<string, SplitTxInfo[]>> {
  if (txHashes.length === 0) return new Map();

  const CHUNK_SIZE = 500;
  const splitsByTx = new Map<string, SplitTxInfo[]>();

  for (let i = 0; i < txHashes.length; i += CHUNK_SIZE) {
    const chunk = txHashes.slice(i, i + CHUNK_SIZE);
    const txList = chunk.map(t => `'${t}'`).join(',');

    const query = `
      SELECT
        lower(tx_hash) as tx_hash,
        lower(condition_id) as condition_id,
        toFloat64(amount_or_payout) / 1e6 as amount
      FROM pm_ctf_events
      WHERE event_type = 'PositionSplit'
        AND lower(tx_hash) IN (${txList})
        AND is_deleted = 0
    `;

    try {
      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = (await result.json()) as any[];

      for (const row of rows) {
        const tx = row.tx_hash;
        const splits = splitsByTx.get(tx) || [];
        splits.push({
          tx_hash: tx,
          condition_id: row.condition_id,
          amount: Number(row.amount),
        });
        splitsByTx.set(tx, splits);
      }
    } catch (e) {
      // Continue on error
      console.error('Error loading splits:', e);
    }
  }

  return splitsByTx;
}

/**
 * Load resolution data for conditions
 */
async function loadResolutions(conditionIds: string[]): Promise<Map<string, { payout0: number; payout1: number; resolvedAt: string }>> {
  if (conditionIds.length === 0) return new Map();

  const CHUNK_SIZE = 500;
  const resolutions = new Map<string, { payout0: number; payout1: number; resolvedAt: string }>();

  for (let i = 0; i < conditionIds.length; i += CHUNK_SIZE) {
    const chunk = conditionIds.slice(i, i + CHUNK_SIZE);
    const condList = chunk.map(c => `'${c.toLowerCase()}'`).join(',');

    const query = `
      SELECT
        lower(condition_id) as condition_id,
        payout_numerators,
        resolved_at
      FROM pm_condition_resolutions
      WHERE lower(condition_id) IN (${condList})
    `;

    try {
      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const rows = (await result.json()) as any[];

      for (const row of rows) {
        try {
          const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
          const total = payouts.reduce((a: number, b: number) => a + b, 0);
          resolutions.set(row.condition_id, {
            payout0: total > 0 ? payouts[0] / total : 0,
            payout1: total > 0 ? payouts[1] / total : 0,
            resolvedAt: row.resolved_at,
          });
        } catch {}
      }
    } catch (e) {
      console.error('Error loading resolutions:', e);
    }
  }

  return resolutions;
}

// -----------------------------------------------------------------------------
// Position Tracking
// -----------------------------------------------------------------------------

interface PositionState {
  conditionId: string;
  outcomeIndex: number;
  amount: number;         // Current token balance
  costBasis: number;      // Total cost paid
  avgPrice: number;       // Weighted average price
  totalBought: number;    // Total tokens acquired
  totalSold: number;      // Total tokens sold
  sellProceeds: number;   // USDC received from sells
  firstTradeTime: string;
  lastTradeTime: string;
  fromSplits: number;     // Tokens attributed to splits
  fromClob: number;       // Tokens from CLOB buys
}

// Track by market (condition) combining both outcomes
interface MarketPosition {
  conditionId: string;
  usdcSpent: number;      // Total USDC paid (CLOB buys + splits)
  usdcReceived: number;   // Total USDC received (sells + resolutions)
  tokensYes: number;      // Net YES tokens held
  tokensNo: number;       // Net NO tokens held
  firstTradeTime: string;
  lastTradeTime: string;
  numTrades: number;
}

function emptyPositionState(conditionId: string, outcomeIndex: number): PositionState {
  return {
    conditionId,
    outcomeIndex,
    amount: 0,
    costBasis: 0,
    avgPrice: 0,
    totalBought: 0,
    totalSold: 0,
    sellProceeds: 0,
    firstTradeTime: '',
    lastTradeTime: '',
    fromSplits: 0,
    fromClob: 0,
  };
}

// -----------------------------------------------------------------------------
// Main Engine
// -----------------------------------------------------------------------------

export async function computePositionReturns(wallet: string): Promise<WalletReturns> {
  // Step 1: Load all trades
  const trades = await loadAllTrades(wallet);

  if (trades.length === 0) {
    return {
      wallet,
      positions: [],
      numTrades: 0,
      numMarkets: 0,
      numWins: 0,
      numLosses: 0,
      totalReturn: 0,
      avgReturn: 0,
    };
  }

  console.log(`[PositionReturn] Loaded ${trades.length} trades for ${wallet.slice(0, 10)}...`);

  // Step 2: Get unique tx_hashes to check for correlated splits
  const txHashes = [...new Set(trades.map(t => t.tx_hash).filter(Boolean))];
  const splitsByTx = await loadCorrelatedSplits(wallet, txHashes);

  console.log(`[PositionReturn] Found ${splitsByTx.size} transactions with correlated splits`);

  // Step 3: Process trades with split-aware cost basis
  const positions = new Map<string, PositionState>();

  for (const trade of trades) {
    if (!trade.condition_id) continue;

    const key = `${trade.condition_id.toLowerCase()}_${trade.outcome_index}`;
    let pos = positions.get(key) || emptyPositionState(trade.condition_id.toLowerCase(), trade.outcome_index);

    // Track timestamps
    if (!pos.firstTradeTime) pos.firstTradeTime = trade.trade_time;
    pos.lastTradeTime = trade.trade_time;

    // Check if this tx has a correlated split
    const correlatedSplits = splitsByTx.get(trade.tx_hash) || [];
    const hasSplit = correlatedSplits.some(s =>
      s.condition_id.toLowerCase() === trade.condition_id.toLowerCase()
    );

    if (trade.side === 'buy') {
      // Normal CLOB buy - use trade price as cost basis
      const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;
      const newCost = pos.costBasis + trade.usdc;
      const newAmount = pos.amount + trade.tokens;
      pos.avgPrice = newAmount > 0 ? newCost / newAmount : 0;
      pos.costBasis = newCost;
      pos.amount = newAmount;
      pos.totalBought += trade.tokens;
      pos.fromClob += trade.tokens;
    } else {
      // SELL
      if (hasSplit && pos.amount < trade.tokens) {
        // Selling more than we have + split in same tx
        // The extra tokens came from the split at $0.50
        const fromInventory = Math.max(0, pos.amount);
        const fromSplit = trade.tokens - fromInventory;

        if (fromInventory > 0) {
          // Sell from existing inventory
          const inventoryCost = fromInventory * pos.avgPrice;
          const inventoryValue = (fromInventory / trade.tokens) * trade.usdc;
          pos.sellProceeds += inventoryValue;
          pos.costBasis -= inventoryCost;
          pos.amount = 0;
        }

        if (fromSplit > 0) {
          // Tokens from split - cost basis = $0.50
          const splitCost = fromSplit * SPLIT_COST_PER_TOKEN;
          const splitValue = (fromSplit / trade.tokens) * trade.usdc;

          // For the return calculation, we need to track this properly
          // The split created tokens at $0.50, we sold them at trade price
          pos.costBasis += splitCost;  // Add split cost
          pos.sellProceeds += splitValue;
          pos.costBasis -= splitCost;  // Remove it as we sold

          pos.totalBought += fromSplit;
          pos.fromSplits += fromSplit;
        }

        pos.totalSold += trade.tokens;
      } else {
        // Normal sell from inventory
        const sellTokens = Math.min(trade.tokens, pos.amount);
        const externalTokens = trade.tokens - sellTokens;

        if (sellTokens > 0) {
          const sellCost = sellTokens * pos.avgPrice;
          const sellValue = (sellTokens / trade.tokens) * trade.usdc;
          pos.sellProceeds += sellValue;
          pos.costBasis -= sellCost;
          pos.amount -= sellTokens;
        }

        if (externalTokens > 0) {
          // Tokens with unknown source - assume split cost
          const extCost = externalTokens * SPLIT_COST_PER_TOKEN;
          const extValue = (externalTokens / trade.tokens) * trade.usdc;
          pos.sellProceeds += extValue;
          // Cost basis was $0.50, proceeds were extValue
          pos.totalBought += externalTokens;
          pos.fromSplits += externalTokens;
        }

        pos.totalSold += trade.tokens;
      }
    }

    positions.set(key, pos);
  }

  // Step 4: Load resolutions
  const conditionIds = [...new Set([...positions.values()].map(p => p.conditionId))];
  const resolutions = await loadResolutions(conditionIds);

  console.log(`[PositionReturn] ${resolutions.size}/${conditionIds.length} conditions resolved`);

  // Step 5: Calculate returns for closed positions
  const positionReturns: PositionReturn[] = [];

  for (const pos of positions.values()) {
    const resolution = resolutions.get(pos.conditionId);

    if (!resolution) {
      // Unresolved - skip for now (or could value at current market price)
      continue;
    }

    // Get payout for this outcome
    const payout = pos.outcomeIndex === 0 ? resolution.payout0 : resolution.payout1;

    // Calculate total entry cost and exit value
    // Entry cost = total spent acquiring tokens
    // For tokens from splits: $0.50 each
    // For tokens from CLOB: actual purchase price
    const splitCost = pos.fromSplits * SPLIT_COST_PER_TOKEN;
    const clobCost = pos.totalBought > pos.fromSplits
      ? (pos.totalBought - pos.fromSplits) * (pos.avgPrice || SPLIT_COST_PER_TOKEN)
      : 0;
    const totalEntryCost = splitCost + clobCost;

    // Exit value = sells + remaining tokens at resolution
    const settlementValue = pos.amount * payout;
    const totalExitValue = pos.sellProceeds + settlementValue;

    if (totalEntryCost <= 0) continue; // Can't calculate return without entry

    const returnDecimal = (totalExitValue - totalEntryCost) / totalEntryCost;
    const returnPct = returnDecimal * 100;

    // Determine source
    let source: 'clob' | 'split' | 'mixed' = 'clob';
    if (pos.fromSplits > 0 && pos.fromClob > 0) source = 'mixed';
    else if (pos.fromSplits > 0) source = 'split';

    positionReturns.push({
      conditionId: pos.conditionId,
      outcomeIndex: pos.outcomeIndex,
      entryTimestamp: pos.firstTradeTime,
      exitTimestamp: resolution.resolvedAt || pos.lastTradeTime,
      entryCost: totalEntryCost,
      exitValue: totalExitValue,
      tokensTraded: pos.totalBought,
      returnPct,
      returnDecimal,
      isWin: returnDecimal > 0,
      source,
    });
  }

  // Step 6: Calculate summary stats
  const numWins = positionReturns.filter(p => p.isWin).length;
  const numLosses = positionReturns.filter(p => !p.isWin).length;
  const totalReturn = positionReturns.reduce((sum, p) => sum + p.returnDecimal, 0);
  const avgReturn = positionReturns.length > 0 ? totalReturn / positionReturns.length : 0;

  return {
    wallet,
    positions: positionReturns,
    numTrades: trades.length,
    numMarkets: conditionIds.length,
    numWins,
    numLosses,
    totalReturn,
    avgReturn,
  };
}

// -----------------------------------------------------------------------------
// Market-Level Position Returns (combines paired outcomes from splits)
// -----------------------------------------------------------------------------

function emptyMarketPosition(conditionId: string): MarketPosition {
  return {
    conditionId,
    usdcSpent: 0,
    usdcReceived: 0,
    tokensYes: 0,
    tokensNo: 0,
    firstTradeTime: '',
    lastTradeTime: '',
    numTrades: 0,
  };
}

export async function computeMarketReturns(wallet: string): Promise<WalletReturns> {
  // Step 1: Load all trades
  const trades = await loadAllTrades(wallet);

  if (trades.length === 0) {
    return {
      wallet,
      positions: [],
      numTrades: 0,
      numMarkets: 0,
      numWins: 0,
      numLosses: 0,
      totalReturn: 0,
      avgReturn: 0,
    };
  }

  console.log(`[MarketReturn] Loaded ${trades.length} trades for ${wallet.slice(0, 10)}...`);

  // Step 2: Get correlated splits
  const txHashes = [...new Set(trades.map(t => t.tx_hash).filter(Boolean))];
  const splitsByTx = await loadCorrelatedSplits(wallet, txHashes);
  console.log(`[MarketReturn] Found ${splitsByTx.size} transactions with correlated splits`);

  // Step 3: Process trades into market-level positions
  const markets = new Map<string, MarketPosition>();

  for (const trade of trades) {
    if (!trade.condition_id) continue;

    const conditionId = trade.condition_id.toLowerCase();
    let mkt = markets.get(conditionId) || emptyMarketPosition(conditionId);

    // Track timestamps
    if (!mkt.firstTradeTime) mkt.firstTradeTime = trade.trade_time;
    mkt.lastTradeTime = trade.trade_time;
    mkt.numTrades++;

    // Check for correlated split
    const correlatedSplits = splitsByTx.get(trade.tx_hash) || [];
    const matchingSplit = correlatedSplits.find(s =>
      s.condition_id.toLowerCase() === conditionId
    );

    if (trade.side === 'buy') {
      // CLOB buy - spend USDC, get tokens
      mkt.usdcSpent += trade.usdc;
      if (trade.outcome_index === 0) {
        mkt.tokensYes += trade.tokens;
      } else {
        mkt.tokensNo += trade.tokens;
      }
    } else {
      // SELL
      if (matchingSplit) {
        // Sell correlated with split - the split created BOTH outcomes
        //
        // Split economics:
        // - Pay $X USDC → Get X YES + X NO tokens
        // - Each token costs $0.50
        // - Total cost = 2 × tokens × $0.50 = tokens × $1.00
        //
        // When selling one side from a split:
        // - Add FULL split cost (both outcomes)
        // - Add sale proceeds
        // - Track held tokens from the other side

        const fullSplitCost = trade.tokens * 1.00; // Cost for BOTH YES and NO
        mkt.usdcSpent += fullSplitCost;
        mkt.usdcReceived += trade.usdc;

        // The split also created the OTHER outcome - track those tokens
        if (trade.outcome_index === 0) {
          // Sold YES from split, still holding NO from split
          mkt.tokensNo += trade.tokens;
        } else {
          // Sold NO from split, still holding YES from split
          mkt.tokensYes += trade.tokens;
        }
      } else {
        // Normal sell (from inventory)
        mkt.usdcReceived += trade.usdc;
        if (trade.outcome_index === 0) {
          mkt.tokensYes -= trade.tokens;
        } else {
          mkt.tokensNo -= trade.tokens;
        }
      }
    }

    markets.set(conditionId, mkt);
  }

  // Step 4: Load resolutions
  const conditionIds = [...markets.keys()];
  const resolutions = await loadResolutions(conditionIds);
  console.log(`[MarketReturn] ${resolutions.size}/${conditionIds.length} conditions resolved`);

  // Step 5: Calculate market-level returns
  const positionReturns: PositionReturn[] = [];

  for (const [conditionId, mkt] of markets) {
    const resolution = resolutions.get(conditionId);

    if (!resolution) {
      // Unresolved - skip
      continue;
    }

    // Settlement value for remaining tokens
    const yesValue = Math.max(0, mkt.tokensYes) * resolution.payout0;
    const noValue = Math.max(0, mkt.tokensNo) * resolution.payout1;
    const settlementValue = yesValue + noValue;

    const totalExitValue = mkt.usdcReceived + settlementValue;
    const totalEntryCost = mkt.usdcSpent;

    if (totalEntryCost <= 0) continue;

    const returnDecimal = (totalExitValue - totalEntryCost) / totalEntryCost;
    const returnPct = returnDecimal * 100;

    positionReturns.push({
      conditionId,
      outcomeIndex: -1, // Market-level, not outcome-specific
      entryTimestamp: mkt.firstTradeTime,
      exitTimestamp: resolution.resolvedAt || mkt.lastTradeTime,
      entryCost: totalEntryCost,
      exitValue: totalExitValue,
      tokensTraded: mkt.numTrades,
      returnPct,
      returnDecimal,
      isWin: returnDecimal > 0,
      source: 'mixed',
    });
  }

  // Step 6: Summary stats
  const numWins = positionReturns.filter(p => p.isWin).length;
  const numLosses = positionReturns.filter(p => !p.isWin).length;
  const totalReturn = positionReturns.reduce((sum, p) => sum + p.returnDecimal, 0);
  const avgReturn = positionReturns.length > 0 ? totalReturn / positionReturns.length : 0;

  return {
    wallet,
    positions: positionReturns,
    numTrades: trades.length,
    numMarkets: conditionIds.length,
    numWins,
    numLosses,
    totalReturn,
    avgReturn,
  };
}

// -----------------------------------------------------------------------------
// Superforecaster Scoring Formula
// -----------------------------------------------------------------------------

export interface WalletScore {
  wallet: string;
  score: number;
  numTrades: number;
  numMarkets: number;
  numWins: number;
  p95Plus: number;      // 95th percentile of wins
  muRaw: number;        // Raw mean return
  muCap: number;        // Capped mean return
  M: number;            // Median absolute return
  eligible: boolean;
  reason?: string;
}

/**
 * Calculate superforecaster score for a wallet
 *
 * Score = μ_cap × √M
 *
 * Where:
 * - μ_cap = mean return with wins capped at 95th percentile
 * - M = median of absolute returns
 */
export function calculateWalletScore(returns: WalletReturns): WalletScore {
  const { wallet, positions, numTrades, numMarkets, numWins } = returns;

  // Eligibility check
  if (numTrades < 15) {
    return {
      wallet,
      score: 0,
      numTrades,
      numMarkets,
      numWins,
      p95Plus: 0,
      muRaw: 0,
      muCap: 0,
      M: 0,
      eligible: false,
      reason: `Insufficient trades: ${numTrades} < 15`,
    };
  }

  if (numMarkets < 10) {
    return {
      wallet,
      score: 0,
      numTrades,
      numMarkets,
      numWins,
      p95Plus: 0,
      muRaw: 0,
      muCap: 0,
      M: 0,
      eligible: false,
      reason: `Insufficient markets: ${numMarkets} < 10`,
    };
  }

  if (positions.length === 0) {
    return {
      wallet,
      score: 0,
      numTrades,
      numMarkets,
      numWins,
      p95Plus: 0,
      muRaw: 0,
      muCap: 0,
      M: 0,
      eligible: false,
      reason: 'No resolved positions',
    };
  }

  const R_list = positions.map(p => p.returnDecimal);

  // Step 1: Compute raw mean
  const muRaw = R_list.reduce((a, b) => a + b, 0) / R_list.length;

  // Step 2: Get wins only and compute 95th percentile cap
  const wins = R_list.filter(r => r > 0).sort((a, b) => a - b);
  let p95Plus = 0;

  if (wins.length > 0) {
    // Type 7 percentile (linear interpolation)
    const idx = 0.95 * (wins.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const frac = idx - lower;
    p95Plus = wins[lower] + frac * (wins[upper] - wins[lower]);
  }

  // Step 3: Cap wins only
  const R_cap_list = R_list.map(r => {
    if (r > 0 && r > p95Plus) return p95Plus;
    return r;
  });

  // Step 4: Compute capped mean
  const muCap = R_cap_list.reduce((a, b) => a + b, 0) / R_cap_list.length;

  // Step 5: Compute median absolute return (using original returns)
  const absReturns = R_list.map(r => Math.abs(r)).sort((a, b) => a - b);
  const M = absReturns.length % 2 === 0
    ? (absReturns[absReturns.length / 2 - 1] + absReturns[absReturns.length / 2]) / 2
    : absReturns[Math.floor(absReturns.length / 2)];

  // Step 6: Calculate score
  const score = muCap * Math.sqrt(M);

  return {
    wallet,
    score,
    numTrades,
    numMarkets,
    numWins,
    p95Plus,
    muRaw,
    muCap,
    M,
    eligible: true,
  };
}
