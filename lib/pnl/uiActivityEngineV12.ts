/**
 * UI Activity PnL Engine V12
 *
 * ============================================================================
 * V12: UNIFIED TRADE STREAM (CLOB + CTF Events)
 * Session: 2025-12-02
 * ============================================================================
 *
 * KEY INSIGHT: For Omega/Sortino/Sharpe/Win Rate, we need TRADE-LEVEL returns,
 * not just position-level PnL. This means we must track every trade that
 * affects position and cost basis.
 *
 * V12 Trade Sources:
 * - CLOB trades (order book) - pm_trader_events_v3
 * - CTF PositionSplit as synthetic BUY at $0.50 (split $1 -> 1 YES + 1 NO)
 * - CTF PositionsMerge as synthetic SELL (close both sides)
 * - CTF PayoutRedemption as SELL at payout price
 * - FPMM trades (older AMM mechanism)
 *
 * ACCURACY ANALYSIS (2025-12-02):
 * ================================
 * - For PURE CLOB traders: ~3-5% error vs UI (PASS)
 *   Example: Active Trader wallet -$10.34M vs expected -$10M (3.4% error)
 *
 * - For NegRisk traders: DOES NOT WORK accurately
 *   Example: Theo wallet -$7,564 vs expected +$12,299 (161% error)
 *
 * ROOT CAUSE for NegRisk discrepancy:
 * 1. NegRisk conversions (via vw_negrisk_conversions) are SEPARATE transactions
 *    from CLOB trades - they occur in different tx_hashes
 * 2. Simply adding NegRisk as extra buys causes double-counting of positions
 * 3. The CLOB data alone doesn't capture the true cost basis for NegRisk markets
 * 4. We need Polymarket's pre-calculated avg_price from their API or GoldSky's
 *    polymarket_user_positions dataset to accurately handle NegRisk traders
 *
 * RECOMMENDATION:
 * - Use V12 for wallets that primarily trade via CLOB
 * - For wallets using NegRisk markets, use pm_api_positions data instead
 * - Consider implementing a hybrid engine that uses API data where available
 *
 * This engine gives us trade-level granularity needed for all derived metrics.
 */

import { clickhouse } from '../clickhouse/client';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface WalletMetricsV12 {
  wallet: string;

  // Core PnL
  realized_pnl: number;
  total_gain: number;
  total_loss: number;

  // Volume
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;

  // Counts
  buys_count: number;
  sells_count: number;
  outcomes_traded: number;

  // Trade breakdown by source
  clob_trades: number;
  ctf_splits: number;
  ctf_merges: number;
  ctf_redemptions: number;
  fpmm_trades: number;
  negrisk_trades: number;

  // Position detail for debugging
  positions: PositionSummary[];

  // Trade returns for Omega/Sharpe/Sortino
  trade_returns: TradeReturn[];
}

export interface PositionSummary {
  condition_id: string;
  outcome_index: number;
  amount: number;
  avgPrice: number;
  realized_pnl: number;
  trade_count: number;
}

export interface TradeReturn {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  source: 'clob' | 'ctf_split' | 'ctf_merge' | 'ctf_redemption' | 'fpmm' | 'negrisk' | 'resolution';
  pnl: number;
  return_pct: number;
  cost_basis: number; // For ROI calculation
}

interface UnifiedTrade {
  condition_id: string;
  outcome_index: number;
  trade_time: string;
  side: 'buy' | 'sell';
  qty_tokens: number;
  price: number;
  usdc_notional: number;
  source: 'clob' | 'ctf_split' | 'ctf_merge' | 'ctf_redemption' | 'fpmm' | 'negrisk';
}

interface PositionState {
  amount: number;
  avgPrice: number;
  totalBought: number;
  totalCostBasis: number; // For ROI
  realized_pnl: number;
  trade_count: number;
}

// -----------------------------------------------------------------------------
// Price Rounding
// -----------------------------------------------------------------------------

function roundToCents(price: number): number {
  return Math.round(price * 100) / 100;
}

// -----------------------------------------------------------------------------
// Data Loading - CLOB Trades
// -----------------------------------------------------------------------------

async function getClobTrades(wallet: string): Promise<UnifiedTrade[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.trade_time,
      fills.side,
      fills.qty_tokens,
      fills.price,
      fills.usdc_notional
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_notional,
        CASE WHEN any(token_amount) > 0
          THEN any(usdc_amount) / any(token_amount)
          ELSE 0
        END as price
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    trade_time: r.trade_time,
    side: r.side as 'buy' | 'sell',
    qty_tokens: Number(r.qty_tokens),
    price: Number(r.price),
    usdc_notional: Number(r.usdc_notional),
    source: 'clob' as const,
  }));
}

// -----------------------------------------------------------------------------
// Data Loading - CTF Events (Splits, Merges, Redemptions)
// -----------------------------------------------------------------------------

async function getCtfEvents(wallet: string): Promise<UnifiedTrade[]> {
  const query = `
    SELECT
      event_type,
      condition_id,
      amount_or_payout,
      event_timestamp
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND is_deleted = 0
      AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const trades: UnifiedTrade[] = [];

  for (const r of rows) {
    const amount = Number(r.amount_or_payout) / 1e6; // Convert from micro-units

    if (r.event_type === 'PositionSplit') {
      // Split: User deposits USDC, receives YES + NO tokens
      // Treat as BUY for BOTH outcomes at $0.50 each
      // (Since 1 USDC = 1 YES + 1 NO)
      for (const outcomeIndex of [0, 1]) {
        trades.push({
          condition_id: r.condition_id,
          outcome_index: outcomeIndex,
          trade_time: r.event_timestamp,
          side: 'buy',
          qty_tokens: amount, // Same amount for each outcome
          price: 0.5, // Effective price per token
          usdc_notional: amount * 0.5, // Half the USDC for each side
          source: 'ctf_split',
        });
      }
    } else if (r.event_type === 'PositionsMerge') {
      // Merge: User returns YES + NO tokens, receives USDC
      // Treat as SELL for BOTH outcomes at $0.50 each
      for (const outcomeIndex of [0, 1]) {
        trades.push({
          condition_id: r.condition_id,
          outcome_index: outcomeIndex,
          trade_time: r.event_timestamp,
          side: 'sell',
          qty_tokens: amount,
          price: 0.5, // Effective price per token
          usdc_notional: amount * 0.5,
          source: 'ctf_merge',
        });
      }
    } else if (r.event_type === 'PayoutRedemption') {
      // Redemption: User cashes out winning tokens at payout price
      // Need to get payout from resolution to know which outcome
      // For now, treat as sell at $1.00 for winning outcome
      // TODO: Look up actual payout from pm_condition_resolutions
      trades.push({
        condition_id: r.condition_id,
        outcome_index: 0, // Assume outcome 0 for now - needs resolution lookup
        trade_time: r.event_timestamp,
        side: 'sell',
        qty_tokens: amount, // Payout amount
        price: 1.0, // Winner pays $1
        usdc_notional: amount,
        source: 'ctf_redemption',
      });
    }
  }

  return trades;
}

// -----------------------------------------------------------------------------
// Data Loading - FPMM Trades (older AMM)
// -----------------------------------------------------------------------------

async function getFpmmTrades(wallet: string): Promise<UnifiedTrade[]> {
  // Check if table exists and has the right schema
  try {
    const query = `
      SELECT
        condition_id,
        outcome_index,
        trade_time,
        side,
        outcome_tokens / 1000000.0 as qty_tokens,
        collateral_amount / 1000000.0 as usdc_notional,
        CASE WHEN outcome_tokens > 0
          THEN collateral_amount / outcome_tokens
          ELSE 0
        END as price
      FROM pm_fpmm_trades
      WHERE lower(trader_wallet) = lower('${wallet}')
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    return rows.map((r) => ({
      condition_id: r.condition_id,
      outcome_index: Number(r.outcome_index),
      trade_time: r.trade_time,
      side: r.side as 'buy' | 'sell',
      qty_tokens: Number(r.qty_tokens),
      price: Number(r.price),
      usdc_notional: Number(r.usdc_notional),
      source: 'fpmm' as const,
    }));
  } catch {
    // Table might not exist or have different schema
    return [];
  }
}

// -----------------------------------------------------------------------------
// Core Algorithm
// -----------------------------------------------------------------------------

function calculatePnLUnified(trades: UnifiedTrade[]): {
  realized_pnl: number;
  total_gain: number;
  total_loss: number;
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;
  buys_count: number;
  sells_count: number;
  outcomes_traded: number;
  clob_trades: number;
  ctf_splits: number;
  ctf_merges: number;
  ctf_redemptions: number;
  fpmm_trades: number;
  negrisk_trades: number;
  positions: PositionSummary[];
  trade_returns: TradeReturn[];
} {
  // Sort by time
  trades.sort((a, b) => a.trade_time.localeCompare(b.trade_time));

  const states = new Map<string, PositionState>();
  const getKey = (cid: string, idx: number) => `${cid.toLowerCase()}_${idx}`;

  let volume_traded = 0;
  let volume_buys = 0;
  let volume_sells = 0;
  let buys_count = 0;
  let sells_count = 0;
  let clob_trades = 0;
  let ctf_splits = 0;
  let ctf_merges = 0;
  let ctf_redemptions = 0;
  let fpmm_trades = 0;
  let negrisk_trades = 0;

  const trade_returns: TradeReturn[] = [];

  for (const trade of trades) {
    const key = getKey(trade.condition_id, trade.outcome_index);

    if (!states.has(key)) {
      states.set(key, {
        amount: 0,
        avgPrice: 0,
        totalBought: 0,
        totalCostBasis: 0,
        realized_pnl: 0,
        trade_count: 0,
      });
    }

    const state = states.get(key)!;
    state.trade_count++;

    // Track source counts
    switch (trade.source) {
      case 'clob':
        clob_trades++;
        break;
      case 'ctf_split':
        ctf_splits++;
        break;
      case 'ctf_merge':
        ctf_merges++;
        break;
      case 'ctf_redemption':
        ctf_redemptions++;
        break;
      case 'fpmm':
        fpmm_trades++;
        break;
      case 'negrisk':
        negrisk_trades++;
        break;
    }

    // Round price to cents
    const price = roundToCents(trade.price);

    if (trade.side === 'buy') {
      buys_count++;
      volume_buys += trade.usdc_notional;
      volume_traded += trade.usdc_notional;

      if (trade.qty_tokens > 0) {
        const numerator = state.avgPrice * state.amount + price * trade.qty_tokens;
        const denominator = state.amount + trade.qty_tokens;
        state.avgPrice = numerator / denominator;
        state.amount += trade.qty_tokens;
        state.totalBought += trade.qty_tokens;
        state.totalCostBasis += trade.usdc_notional;
      }
    } else if (trade.side === 'sell') {
      sells_count++;
      volume_sells += trade.usdc_notional;
      volume_traded += trade.usdc_notional;

      // Cap at tracked position
      const adjustedAmount = Math.min(trade.qty_tokens, state.amount);

      if (adjustedAmount > 0 && state.avgPrice > 0) {
        const deltaPnL = adjustedAmount * (price - state.avgPrice);
        state.realized_pnl += deltaPnL;
        state.amount -= adjustedAmount;

        // Track trade return for Omega/Sortino/Sharpe
        const return_pct = (price - state.avgPrice) / state.avgPrice;
        const cost_basis = adjustedAmount * state.avgPrice;

        trade_returns.push({
          condition_id: trade.condition_id,
          outcome_index: trade.outcome_index,
          trade_time: trade.trade_time,
          source: trade.source,
          pnl: deltaPnL,
          return_pct,
          cost_basis,
        });
      }
    }
  }

  // Aggregate results
  let realized_pnl = 0;
  let total_gain = 0;
  let total_loss = 0;
  const positions: PositionSummary[] = [];

  for (const [key, state] of states.entries()) {
    realized_pnl += state.realized_pnl;
    if (state.realized_pnl > 0) {
      total_gain += state.realized_pnl;
    } else {
      total_loss += state.realized_pnl;
    }

    const [conditionId, outcomeIndexStr] = key.split('_');
    positions.push({
      condition_id: conditionId,
      outcome_index: parseInt(outcomeIndexStr, 10),
      amount: state.amount,
      avgPrice: state.avgPrice,
      realized_pnl: state.realized_pnl,
      trade_count: state.trade_count,
    });
  }

  return {
    realized_pnl,
    total_gain,
    total_loss,
    volume_traded,
    volume_buys,
    volume_sells,
    buys_count,
    sells_count,
    outcomes_traded: states.size,
    clob_trades,
    ctf_splits,
    ctf_merges,
    ctf_redemptions,
    fpmm_trades,
    negrisk_trades,
    positions,
    trade_returns,
  };
}

// -----------------------------------------------------------------------------
// Resolution Cache
// -----------------------------------------------------------------------------

interface ResolutionInfo {
  condition_id: string;
  payout_numerators: number[];
}

let globalResolutionCache: Map<string, ResolutionInfo> | null = null;

async function loadAllResolutions(): Promise<Map<string, ResolutionInfo>> {
  if (globalResolutionCache) return globalResolutionCache;

  console.log('[V12] Loading all resolutions into cache...');
  const start = Date.now();

  const result = await clickhouse.query({
    query: `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const cache = new Map<string, ResolutionInfo>();

  for (const r of rows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    cache.set(r.condition_id.toLowerCase(), {
      condition_id: r.condition_id,
      payout_numerators: payouts,
    });
  }

  const elapsed = Date.now() - start;
  console.log(`[V12] Loaded ${cache.size} resolutions in ${elapsed}ms`);

  globalResolutionCache = cache;
  return cache;
}

// -----------------------------------------------------------------------------
// V12 Engine Class
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Data Loading - NegRisk Conversions
// -----------------------------------------------------------------------------

async function getNegRiskConversions(wallet: string): Promise<UnifiedTrade[]> {
  // vw_negrisk_conversions has token acquisitions via NegRisk Exchange
  // These are essentially "buys" at cost_basis_per_share (typically $0.50)
  try {
    const query = `
      SELECT
        token_id_hex,
        shares,
        cost_basis_per_share,
        block_timestamp
      FROM vw_negrisk_conversions
      WHERE lower(wallet) = lower('${wallet}')
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];

    // We need to map token_id_hex to condition_id
    // token_id_hex format: 0x... (with prefix)
    // For now, treat as BUY at cost_basis_per_share
    // Note: We can't determine outcome_index without token map lookup
    return rows.map((r) => ({
      // Strip 0x prefix if present for token_id
      condition_id: r.token_id_hex.replace(/^0x/, '').toLowerCase(),
      outcome_index: -1, // Unknown without token map lookup - will need resolution later
      trade_time: r.block_timestamp,
      side: 'buy' as const,
      qty_tokens: Number(r.shares),
      price: Number(r.cost_basis_per_share),
      usdc_notional: Number(r.shares) * Number(r.cost_basis_per_share),
      source: 'negrisk' as const,
    }));
  } catch {
    return [];
  }
}

// -----------------------------------------------------------------------------
// Lookup token_id_hex to condition_id mapping
// -----------------------------------------------------------------------------

async function lookupTokenToCondition(
  tokenIdHexes: string[]
): Promise<Map<string, { condition_id: string; outcome_index: number }>> {
  if (tokenIdHexes.length === 0) return new Map();

  // Convert hex to decimal for lookup in pm_token_to_condition_map_v3
  const decimalIds = tokenIdHexes.map((hex) => {
    const cleanHex = hex.replace(/^0x/, '');
    return BigInt('0x' + cleanHex).toString();
  });

  const inClause = decimalIds.map((d) => `'${d}'`).join(',');
  const query = `
    SELECT
      token_id_dec,
      condition_id,
      outcome_index
    FROM pm_token_to_condition_map_v3
    WHERE token_id_dec IN (${inClause})
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const mapping = new Map<string, { condition_id: string; outcome_index: number }>();

  for (const r of rows) {
    // Map back from decimal to hex (lowercase, no prefix)
    const hex = BigInt(r.token_id_dec).toString(16).padStart(64, '0').toLowerCase();
    mapping.set(hex, {
      condition_id: r.condition_id,
      outcome_index: Number(r.outcome_index),
    });
  }

  return mapping;
}

export class V12Engine {
  private resolutionCache: Map<string, ResolutionInfo> | null = null;

  async compute(wallet: string): Promise<WalletMetricsV12> {
    // Load resolution cache
    if (!this.resolutionCache) {
      this.resolutionCache = await loadAllResolutions();
    }

    // Load all trade sources
    const [clobTrades, ctfTrades, fpmmTrades, negRiskTrades] = await Promise.all([
      getClobTrades(wallet),
      getCtfEvents(wallet),
      getFpmmTrades(wallet),
      getNegRiskConversions(wallet),
    ]);

    // If we have NegRisk trades, need to look up their condition mappings
    // NegRisk conversions represent the TRUE cost basis ($0.50 per share)
    // BUT they often have a corresponding CLOB trade at a different price
    // We need to REPLACE CLOB prices with NegRisk cost basis, not ADD duplicates
    let enrichedNegRiskTrades: UnifiedTrade[] = [];
    if (negRiskTrades.length > 0) {
      const tokenHexes = negRiskTrades.map((t) => t.condition_id); // Currently holds token_id_hex
      const tokenToCondition = await lookupTokenToCondition(tokenHexes);

      enrichedNegRiskTrades = negRiskTrades
        .map((t) => {
          const mapping = tokenToCondition.get(t.condition_id);
          if (mapping) {
            return {
              ...t,
              condition_id: mapping.condition_id,
              outcome_index: mapping.outcome_index,
            };
          }
          return null;
        })
        .filter((t): t is UnifiedTrade => t !== null);
    }

    // Build a lookup for NegRisk trades by (condition, outcome, timestamp, amount)
    // If a CLOB trade matches, we'll replace its price with the NegRisk cost basis
    const negRiskLookup = new Map<string, number>();
    for (const nr of enrichedNegRiskTrades) {
      // Key format: condition_outcome_timestamp_amount (rounded)
      const key = `${nr.condition_id.toLowerCase()}_${nr.outcome_index}_${nr.trade_time}_${Math.round(nr.qty_tokens * 100)}`;
      negRiskLookup.set(key, nr.price); // Store NegRisk price ($0.50)
    }

    // Process CLOB trades, replacing prices where NegRisk match exists
    const adjustedClobTrades = clobTrades.map((clob) => {
      if (clob.side === 'buy') {
        const key = `${clob.condition_id.toLowerCase()}_${clob.outcome_index}_${clob.trade_time}_${Math.round(clob.qty_tokens * 100)}`;
        const negRiskPrice = negRiskLookup.get(key);
        if (negRiskPrice !== undefined) {
          // Replace CLOB price with NegRisk cost basis
          negRiskLookup.delete(key); // Mark as used
          return {
            ...clob,
            price: negRiskPrice,
            usdc_notional: clob.qty_tokens * negRiskPrice,
            source: 'negrisk' as const, // Mark as NegRisk-adjusted
          };
        }
      }
      return clob;
    });

    // Add any remaining NegRisk trades that didn't match CLOB (pure NegRisk acquisitions)
    const remainingNegRisk = enrichedNegRiskTrades.filter((nr) => {
      const key = `${nr.condition_id.toLowerCase()}_${nr.outcome_index}_${nr.trade_time}_${Math.round(nr.qty_tokens * 100)}`;
      return negRiskLookup.has(key);
    });

    // Combine into unified stream
    // NOTE: NegRisk conversions are excluded for now because:
    // 1. They appear to be separate transactions from CLOB trades
    // 2. But including them causes double-counting of positions
    // 3. The API (which is our ground truth) uses different logic
    // TODO: Investigate proper NegRisk integration when we have access to polymarket_user_positions
    const allTrades: UnifiedTrade[] = [
      ...clobTrades, // Use original CLOB trades, not adjusted
      ...ctfTrades,
      ...fpmmTrades,
      // NegRisk excluded: ...remainingNegRisk,
    ];

    // Calculate PnL
    const result = calculatePnLUnified(allTrades);

    // Add resolution PnL for positions with remaining amount
    let additionalPnL = 0;
    const updatedPositions = result.positions.map((pos) => {
      if (pos.amount > 0.01) {
        const resolution = this.resolutionCache?.get(pos.condition_id.toLowerCase());
        if (resolution && resolution.payout_numerators.length > pos.outcome_index) {
          const payout = resolution.payout_numerators[pos.outcome_index];
          const resolutionPnL = (payout - pos.avgPrice) * pos.amount;
          additionalPnL += resolutionPnL;

          // Add to trade returns
          if (pos.avgPrice > 0) {
            result.trade_returns.push({
              condition_id: pos.condition_id,
              outcome_index: pos.outcome_index,
              trade_time: 'resolved',
              source: 'resolution',
              pnl: resolutionPnL,
              return_pct: (payout - pos.avgPrice) / pos.avgPrice,
              cost_basis: pos.amount * pos.avgPrice,
            });
          }

          return {
            ...pos,
            realized_pnl: pos.realized_pnl + resolutionPnL,
            amount: 0,
          };
        }
      }
      return pos;
    });

    const totalPnL = result.realized_pnl + additionalPnL;

    // Recalculate gain/loss
    let total_gain = 0;
    let total_loss = 0;
    for (const pos of updatedPositions) {
      if (pos.realized_pnl > 0) {
        total_gain += pos.realized_pnl;
      } else {
        total_loss += pos.realized_pnl;
      }
    }

    return {
      wallet,
      realized_pnl: totalPnL,
      total_gain,
      total_loss,
      volume_traded: result.volume_traded,
      volume_buys: result.volume_buys,
      volume_sells: result.volume_sells,
      buys_count: result.buys_count,
      sells_count: result.sells_count,
      outcomes_traded: result.outcomes_traded,
      clob_trades: result.clob_trades,
      ctf_splits: result.ctf_splits,
      ctf_merges: result.ctf_merges,
      ctf_redemptions: result.ctf_redemptions,
      fpmm_trades: result.fpmm_trades,
      negrisk_trades: result.negrisk_trades,
      positions: updatedPositions,
      trade_returns: result.trade_returns,
    };
  }

  async computeBatch(
    wallets: string[],
    batchSize: number = 5,
    onProgress?: (completed: number, total: number) => void
  ): Promise<WalletMetricsV12[]> {
    const results: WalletMetricsV12[] = [];

    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((wallet) =>
          this.compute(wallet).catch((err) => {
            console.error(`Error for ${wallet}: ${err.message}`);
            return null;
          })
        )
      );
      results.push(...(batchResults.filter((r) => r !== null) as WalletMetricsV12[]));

      if (onProgress) {
        onProgress(Math.min(i + batchSize, wallets.length), wallets.length);
      }
    }

    return results;
  }
}

// -----------------------------------------------------------------------------
// Factory Function
// -----------------------------------------------------------------------------

export function createV12Engine(): V12Engine {
  return new V12Engine();
}

// -----------------------------------------------------------------------------
// Metric Calculations (same as V11 but with source tracking)
// -----------------------------------------------------------------------------

export function calculateOmegaRatio(trade_returns: TradeReturn[], threshold: number = 0): number {
  if (trade_returns.length === 0) return 0;

  let gains = 0;
  let losses = 0;

  for (const tr of trade_returns) {
    const excess = tr.return_pct - threshold;
    if (excess > 0) {
      gains += excess;
    } else {
      losses += Math.abs(excess);
    }
  }

  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

export function calculateSharpeRatio(trade_returns: TradeReturn[]): number {
  if (trade_returns.length < 2) return 0;

  const returns = trade_returns.map((tr) => tr.return_pct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return 0;
  return mean / std;
}

export function calculateSortinoRatio(trade_returns: TradeReturn[]): number {
  if (trade_returns.length < 2) return 0;

  const returns = trade_returns.map((tr) => tr.return_pct);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) return mean > 0 ? Infinity : 0;

  const downsideVariance =
    negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
  const downsideStd = Math.sqrt(downsideVariance);

  if (downsideStd === 0) return mean > 0 ? Infinity : 0;
  return mean / downsideStd;
}

export function calculateWinRate(trade_returns: TradeReturn[]): number {
  if (trade_returns.length === 0) return 0;
  const wins = trade_returns.filter((tr) => tr.pnl > 0).length;
  return wins / trade_returns.length;
}

export function calculateROI(trade_returns: TradeReturn[]): number {
  if (trade_returns.length === 0) return 0;

  const totalPnL = trade_returns.reduce((sum, tr) => sum + tr.pnl, 0);
  const totalCostBasis = trade_returns.reduce((sum, tr) => sum + tr.cost_basis, 0);

  if (totalCostBasis === 0) return 0;
  return totalPnL / totalCostBasis;
}

export function calculateProfitFactor(trade_returns: TradeReturn[]): number {
  const grossProfit = trade_returns.filter((tr) => tr.pnl > 0).reduce((sum, tr) => sum + tr.pnl, 0);
  const grossLoss = Math.abs(
    trade_returns.filter((tr) => tr.pnl < 0).reduce((sum, tr) => sum + tr.pnl, 0)
  );

  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}
