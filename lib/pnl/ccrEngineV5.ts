/**
 * CCR-v5: Transaction-Aware Unified PnL Engine
 *
 * =============================================================================
 * THE KEY INSIGHT
 * =============================================================================
 *
 * Bundled split+sell transactions via PM Exchange API work like this:
 *
 * 1. User wants to bet on YES outcome
 * 2. Proxy splits $X USDC → X YES + X NO tokens
 * 3. In same transaction:
 *    - User buys YES tokens from proxy (recorded as maker buy)
 *    - Proxy sells NO tokens to market makers (recorded as taker sell under USER's wallet)
 * 4. User ends up with:
 *    - Cash out: buy_usdc
 *    - Cash in: sell_usdc (from NO sale)
 *    - Tokens: YES tokens only (NO tokens were synthetic - never really held)
 *
 * The sell of opposite outcome is SYNTHETIC - user never owned those tokens.
 * They were created by split and immediately sold in one atomic operation.
 *
 * =============================================================================
 * THE ALGORITHM
 * =============================================================================
 *
 * 1. Load all trades for wallet
 * 2. Identify bundled transactions (same tx_hash has proxy split)
 * 3. For bundled transactions:
 *    - Net cash = buy_usdc - sell_usdc
 *    - Net tokens = only the outcome you bought (ignore synthetic sells)
 *    - Cost basis = net_cash / net_tokens
 * 4. For non-bundled transactions:
 *    - Process normally with cost basis tracking
 * 5. Calculate realized PnL on sells and resolutions
 *
 * =============================================================================
 */

import { clickhouse } from '../clickhouse/client';

const DEBUG = false;

// =============================================================================
// Types
// =============================================================================

interface RawTrade {
  event_id: string;
  tx_hash: string;
  role: 'maker' | 'taker';
  side: 'buy' | 'sell';
  usdc: number;
  tokens: number;
  token_id: string;
  condition_id: string | null;
  outcome_index: number | null;
  block_number: number;
  trade_time: string;
}

interface TokenResolution {
  condition_id: string;
  winning_index: number;
  resolved: true;
}

interface Position {
  token_id: string;
  condition_id: string | null;
  outcome_index: number | null;
  tokens: number;
  cost_basis: number; // Average cost per token
  total_cost: number;
}

export interface CCRv5Metrics {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  positions_count: number;
  resolved_count: number;
  unresolved_count: number;
  total_trades: number;
  maker_trades: number;
  taker_trades: number;
  bundled_tx_count: number;
  volume_traded: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  pnl_confidence: 'high' | 'medium' | 'low';
}

// =============================================================================
// Data Loading
// =============================================================================

const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
];

async function loadAllTrades(wallet: string): Promise<RawTrade[]> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        lower(concat('0x', hex(transaction_hash))) as tx_hash,
        any(role) as role,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(token_id) as token_id,
        any(block_number) as block_number,
        any(trade_time) as trade_time
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${wallet.toLowerCase()}'
       
      GROUP BY event_id, transaction_hash
    )
    SELECT
      d.event_id,
      d.tx_hash,
      d.role,
      d.side,
      d.usdc,
      d.tokens,
      d.token_id,
      m.condition_id,
      m.outcome_index,
      d.block_number,
      d.trade_time
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.block_number, d.event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as RawTrade[];
}

interface BundledTxInfo {
  txHash: string;
  splitAmount: number; // USDC amount used in proxy split
}

async function loadBundledTxData(wallet: string): Promise<Map<string, BundledTxInfo>> {
  // Get all tx_hashes from wallet's CLOB trades
  const txQuery = `
    SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v3
    WHERE trader_wallet = '${wallet.toLowerCase()}'
     
  `;
  const txResult = await clickhouse.query({ query: txQuery, format: 'JSONEachRow' });
  const txHashes = (await txResult.json() as any[]).map(r => r.tx_hash);

  if (txHashes.length === 0) return new Map();

  // Find which tx_hashes have proxy splits and get split amounts
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');
  const bundledTxData = new Map<string, BundledTxInfo>();
  const BATCH_SIZE = 500;

  for (let i = 0; i < txHashes.length; i += BATCH_SIZE) {
    const batch = txHashes.slice(i, i + BATCH_SIZE);
    const txList = batch.map(h => `'${h}'`).join(',');

    // Get split amounts per tx
    const splitQuery = `
      SELECT
        lower(tx_hash) as tx_hash,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_amount
      FROM pm_ctf_events
      WHERE lower(tx_hash) IN (${txList})
        AND lower(user_address) IN (${proxyList})
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
      GROUP BY tx_hash
    `;

    const splitResult = await clickhouse.query({ query: splitQuery, format: 'JSONEachRow' });
    const splits = (await splitResult.json()) as any[];

    for (const s of splits) {
      if (s.tx_hash) {
        bundledTxData.set(s.tx_hash.toLowerCase(), {
          txHash: s.tx_hash.toLowerCase(),
          splitAmount: +s.split_amount || 0,
        });
      }
    }
  }

  return bundledTxData;
}

async function loadResolutionsForTokens(tokenIds: string[]): Promise<Map<string, TokenResolution>> {
  if (tokenIds.length === 0) return new Map();

  const CHUNK_SIZE = 500;
  const resolutions = new Map<string, TokenResolution>();

  for (let i = 0; i < tokenIds.length; i += CHUNK_SIZE) {
    const chunk = tokenIds.slice(i, i + CHUNK_SIZE);
    const tokenList = chunk.map(t => `'${t}'`).join(',');

    // payout_numerators is JSON like "[1,0]" - winning outcome has payout 1
    // We need to find the index with payout 1
    const query = `
      SELECT
        m.token_id_dec as token_id,
        m.condition_id,
        m.outcome_index,
        r.payout_numerators
      FROM pm_token_to_condition_map_v5 m
      INNER JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE m.token_id_dec IN (${tokenList})
        AND r.is_deleted = 0
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    for (const row of rows) {
      // Parse payout_numerators to determine winner
      try {
        const payouts = JSON.parse(row.payout_numerators);
        const winningIndex = payouts.indexOf(1);

        resolutions.set(row.token_id, {
          condition_id: row.condition_id,
          winning_index: winningIndex >= 0 ? winningIndex : 0,
          resolved: true,
        });
      } catch {
        // Skip if can't parse
      }
    }
  }

  return resolutions;
}

async function loadMidPricesForTokens(tokenIds: string[]): Promise<Map<string, number>> {
  if (tokenIds.length === 0) return new Map();

  const CHUNK_SIZE = 500;
  const prices = new Map<string, number>();

  for (let i = 0; i < tokenIds.length; i += CHUNK_SIZE) {
    const chunk = tokenIds.slice(i, i + CHUNK_SIZE);
    const tokenList = chunk.map(t => `'${t}'`).join(',');

    // Join via token_to_condition map to get prices by condition_id + outcome_index
    const query = `
      SELECT
        m.token_id_dec as token_id,
        p.mark_price
      FROM pm_token_to_condition_map_v5 m
      INNER JOIN pm_latest_mark_price_v1 p
        ON m.condition_id = p.condition_id
        AND m.outcome_index = p.outcome_index
      WHERE m.token_id_dec IN (${tokenList})
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    for (const row of rows) {
      if (row.mark_price !== null) {
        prices.set(row.token_id, Number(row.mark_price));
      }
    }
  }

  return prices;
}

// =============================================================================
// Transaction Processing
// =============================================================================

interface TransactionGroup {
  tx_hash: string;
  is_bundled: boolean;
  split_amount: number; // USDC amount from proxy split (0 if not bundled)
  trades: RawTrade[];
}

function groupTradesByTransaction(trades: RawTrade[], bundledTxData: Map<string, BundledTxInfo>): TransactionGroup[] {
  const txMap = new Map<string, RawTrade[]>();

  for (const trade of trades) {
    const existing = txMap.get(trade.tx_hash) || [];
    existing.push(trade);
    txMap.set(trade.tx_hash, existing);
  }

  const groups: TransactionGroup[] = [];
  for (const [tx_hash, txTrades] of txMap) {
    const bundledInfo = bundledTxData.get(tx_hash.toLowerCase());
    groups.push({
      tx_hash,
      is_bundled: !!bundledInfo,
      split_amount: bundledInfo?.splitAmount || 0,
      trades: txTrades,
    });
  }

  // Sort by first trade's block number
  groups.sort((a, b) => a.trades[0].block_number - b.trades[0].block_number);

  return groups;
}

interface ProcessedTrade {
  token_id: string;
  condition_id: string | null;
  outcome_index: number | null;
  side: 'buy' | 'sell';
  tokens: number;
  usdc: number;
  cost_basis_override?: number; // For bundled trades
}

function processTransaction(group: TransactionGroup): ProcessedTrade[] {
  if (!group.is_bundled) {
    // Non-bundled: only use MAKER trades
    // Taker trades outside bundled txs are either:
    // 1. Taker sells of split inventory (no tracked cost basis)
    // 2. Taker buys that could be legitimate
    // By using maker-only, we get clean trades with proper inventory
    return group.trades
      .filter(t => t.role === 'maker')
      .map(t => ({
        token_id: t.token_id,
        condition_id: t.condition_id,
        outcome_index: t.outcome_index,
        side: t.side,
        tokens: t.tokens,
        usdc: t.usdc,
      }));
  }

  // Bundled transaction: calculate net positions per token
  // Group by token_id
  const tokenGroups = new Map<string, { buys: RawTrade[]; sells: RawTrade[] }>();

  for (const trade of group.trades) {
    const existing = tokenGroups.get(trade.token_id) || { buys: [], sells: [] };
    if (trade.side === 'buy') {
      existing.buys.push(trade);
    } else {
      existing.sells.push(trade);
    }
    tokenGroups.set(trade.token_id, existing);
  }

  const processed: ProcessedTrade[] = [];

  // For bundled transactions, we need to determine which token is the "real" position
  // The real position is the one with net positive tokens (buys > sells)
  // The synthetic position is where sells > buys (created by split and immediately sold)

  // Calculate total buy/sell USDC across all tokens in this transaction
  let totalBuyUsdc = 0;
  let totalSellUsdc = 0;
  let realToken: { token_id: string; tokens: number; condition_id: string | null; outcome_index: number | null } | null = null;

  for (const [token_id, trades] of tokenGroups) {
    const buyTokens = trades.buys.reduce((sum, t) => sum + t.tokens, 0);
    const sellTokens = trades.sells.reduce((sum, t) => sum + t.tokens, 0);
    const buyUsdc = trades.buys.reduce((sum, t) => sum + t.usdc, 0);
    const sellUsdc = trades.sells.reduce((sum, t) => sum + t.usdc, 0);

    totalBuyUsdc += buyUsdc;
    totalSellUsdc += sellUsdc;

    const netTokens = buyTokens - sellTokens;

    if (netTokens > 0) {
      // This is the real position
      const firstTrade = trades.buys[0] || trades.sells[0];
      realToken = {
        token_id,
        tokens: netTokens,
        condition_id: firstTrade.condition_id,
        outcome_index: firstTrade.outcome_index,
      };
    }
  }

  if (realToken) {
    // Calculate net cost using CLOB data: buyUsdc - sellUsdc
    // This works because:
    // - buyUsdc captures the cost of tokens acquired via CLOB
    // - sellUsdc captures proceeds from selling the opposite outcome (from splits)
    // The net is the true cost of holding the realToken position
    const netCost = totalBuyUsdc - totalSellUsdc;
    const costBasis = netCost / realToken.tokens;

    if (DEBUG) {
      console.log(`[Bundled TX] ${group.tx_hash.slice(0, 10)}...`);
      console.log(`  Buy USDC: $${totalBuyUsdc.toFixed(2)}, Sell USDC: $${totalSellUsdc.toFixed(2)}`);
      console.log(`  Net cost: $${netCost.toFixed(2)} for ${realToken.tokens.toFixed(2)} tokens`);
      console.log(`  Cost basis: $${costBasis.toFixed(4)}`);
    }

    // Return a single synthetic "buy" with the net cost basis
    processed.push({
      token_id: realToken.token_id,
      condition_id: realToken.condition_id,
      outcome_index: realToken.outcome_index,
      side: 'buy',
      tokens: realToken.tokens,
      usdc: netCost,
      cost_basis_override: costBasis,
    });
  } else {
    // No net position - might be pure sells or balanced
    // Process as individual trades
    for (const trade of group.trades) {
      processed.push({
        token_id: trade.token_id,
        condition_id: trade.condition_id,
        outcome_index: trade.outcome_index,
        side: trade.side,
        tokens: trade.tokens,
        usdc: trade.usdc,
      });
    }
  }

  return processed;
}

// =============================================================================
// Position Tracking
// =============================================================================

function processTradesWithCostBasis(
  txGroups: TransactionGroup[],
  resolutions: Map<string, TokenResolution>
): {
  positions: Map<string, Position>;
  realizedPnl: number;
  winCount: number;
  lossCount: number;
  volumeTraded: number;
  bundledTxCount: number;
} {
  const positions = new Map<string, Position>();
  let realizedPnl = 0;
  let winCount = 0;
  let lossCount = 0;
  let volumeTraded = 0;
  let bundledTxCount = 0;

  for (const group of txGroups) {
    const processedTrades = processTransaction(group);

    if (group.is_bundled) {
      bundledTxCount++;
    }

    for (const trade of processedTrades) {
      volumeTraded += trade.usdc;

      if (trade.side === 'buy') {
        // Add to position
        const existing = positions.get(trade.token_id);

        if (existing) {
          // Update weighted average cost basis
          const totalCost = existing.total_cost + trade.usdc;
          const totalTokens = existing.tokens + trade.tokens;
          existing.tokens = totalTokens;
          existing.total_cost = totalCost;
          existing.cost_basis = totalCost / totalTokens;
        } else {
          // New position
          const costBasis = trade.cost_basis_override ?? (trade.usdc / trade.tokens);
          positions.set(trade.token_id, {
            token_id: trade.token_id,
            condition_id: trade.condition_id,
            outcome_index: trade.outcome_index,
            tokens: trade.tokens,
            cost_basis: costBasis,
            total_cost: trade.usdc,
          });
        }
      } else {
        // Sell - realize PnL
        const existing = positions.get(trade.token_id);

        if (existing && existing.tokens > 0) {
          const sellTokens = Math.min(trade.tokens, existing.tokens);
          const costOfSold = sellTokens * existing.cost_basis;
          const proceeds = (sellTokens / trade.tokens) * trade.usdc;
          const pnl = proceeds - costOfSold;

          realizedPnl += pnl;

          if (pnl > 0) winCount++;
          else if (pnl < 0) lossCount++;

          existing.tokens -= sellTokens;
          existing.total_cost -= costOfSold;

          if (existing.tokens <= 0.0001) {
            positions.delete(trade.token_id);
          }
        }
        // External sells (no prior position) - count as realized loss at $0.50 cost
        else if (!existing || existing.tokens === 0) {
          // This shouldn't happen often after bundled tx processing
          // But if it does, assume $0.50 cost basis (from split)
          const assumedCost = trade.tokens * 0.5;
          const pnl = trade.usdc - assumedCost;
          realizedPnl += pnl;

          if (pnl > 0) winCount++;
          else if (pnl < 0) lossCount++;
        }
      }
    }
  }

  // Process resolutions
  for (const [tokenId, position] of positions) {
    const resolution = resolutions.get(tokenId);

    if (resolution && resolution.resolved) {
      const isWinner = position.outcome_index === resolution.winning_index;
      const payout = isWinner ? position.tokens : 0;
      const pnl = payout - position.total_cost;

      realizedPnl += pnl;

      if (pnl > 0) winCount++;
      else if (pnl < 0) lossCount++;

      positions.delete(tokenId);
    }
  }

  return { positions, realizedPnl, winCount, lossCount, volumeTraded, bundledTxCount };
}

// =============================================================================
// Main Engine
// =============================================================================

function emptyMetrics(wallet: string): CCRv5Metrics {
  return {
    wallet,
    realized_pnl: 0,
    unrealized_pnl: 0,
    total_pnl: 0,
    positions_count: 0,
    resolved_count: 0,
    unresolved_count: 0,
    total_trades: 0,
    maker_trades: 0,
    taker_trades: 0,
    bundled_tx_count: 0,
    volume_traded: 0,
    win_count: 0,
    loss_count: 0,
    win_rate: 0,
    pnl_confidence: 'high',
  };
}

export async function computeCCRv5(wallet: string): Promise<CCRv5Metrics> {
  // Load trades
  const rawTrades = await loadAllTrades(wallet);

  if (rawTrades.length === 0) {
    return emptyMetrics(wallet);
  }

  // Load bundled transaction data (including split amounts)
  const bundledTxData = await loadBundledTxData(wallet);

  if (DEBUG) {
    console.log(`[CCR-v5] Found ${bundledTxData.size} bundled transactions`);
  }

  // Group trades by transaction
  const txGroups = groupTradesByTransaction(rawTrades, bundledTxData);

  // Get unique token IDs
  const tokenIds = [...new Set(rawTrades.map(t => t.token_id))];

  // Load resolutions and prices
  const [resolutions, prices] = await Promise.all([
    loadResolutionsForTokens(tokenIds),
    loadMidPricesForTokens(tokenIds),
  ]);

  // Process trades
  const { positions, realizedPnl, winCount, lossCount, volumeTraded, bundledTxCount } =
    processTradesWithCostBasis(txGroups, resolutions);

  // Calculate unrealized PnL for remaining positions
  let unrealizedPnl = 0;
  for (const position of positions.values()) {
    const price = prices.get(position.token_id) ?? 0.5;
    const marketValue = position.tokens * price;
    unrealizedPnl += marketValue - position.total_cost;
  }

  // Count resolved/unresolved
  const resolvedCount = resolutions.size;
  const unresolvedCount = positions.size;

  // Count maker/taker trades
  const makerTrades = rawTrades.filter(t => t.role === 'maker').length;
  const takerTrades = rawTrades.filter(t => t.role === 'taker').length;

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'high';
  const unmappedTokens = rawTrades.filter(t => !t.condition_id).length;
  if (unmappedTokens > rawTrades.length * 0.1) {
    confidence = 'low';
  } else if (unmappedTokens > rawTrades.length * 0.02) {
    confidence = 'medium';
  }

  return {
    wallet,
    realized_pnl: realizedPnl,
    unrealized_pnl: unrealizedPnl,
    total_pnl: realizedPnl + unrealizedPnl,
    positions_count: positions.size,
    resolved_count: resolvedCount,
    unresolved_count: unresolvedCount,
    total_trades: rawTrades.length,
    maker_trades: makerTrades,
    taker_trades: takerTrades,
    bundled_tx_count: bundledTxCount,
    volume_traded: volumeTraded,
    win_count: winCount,
    loss_count: lossCount,
    win_rate: winCount + lossCount > 0 ? winCount / (winCount + lossCount) : 0,
    pnl_confidence: confidence,
  };
}
