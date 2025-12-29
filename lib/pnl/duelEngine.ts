/**
 * ============================================================================
 * DUEL ENGINE - Dual PnL Metrics
 * ============================================================================
 *
 * Outputs both economic and cash-based realized PnL metrics.
 *
 * METRICS:
 * 1. realized_economic (V17 style): trade_cashflow + synthetic_redemptions
 *    - Shows true trading skill/value
 *    - Counts resolved positions at resolution price even if not redeemed
 *
 * 2. realized_cash: trade_cashflow + explicit_redemptions
 *    - Shows actual cash realized
 *    - Only counts on-chain CTF PayoutRedemption events
 *
 * DECOMPOSITION (always included):
 * - resolved_trade_cashflow: sell - buy for resolved markets
 * - unresolved_trade_cashflow: sell - buy for unresolved markets
 * - synthetic_redemptions: final_shares × resolution_price (resolved)
 * - explicit_redemptions: actual CTF PayoutRedemption events
 *
 * USAGE:
 * - For "who is good at trading" → use realized_economic
 * - For "who cashed out" → use realized_cash
 * - For debugging → use decomposition fields
 */

import { clickhouse } from '../clickhouse/client';
import { createV17Engine, WalletMetricsV17 } from './uiActivityEngineV17';
import { checkClobOnly, getClobOnlyFromTable, ClobOnlyCheckResult } from './walletClassifier';

// ============================================================================
// Types
// ============================================================================

export interface DataCoverage {
  // Totals
  total_trades: number;
  total_usdc: number;

  // Mapped (have condition_id mapping)
  mapped_trades: number;
  mapped_usdc: number;
  trade_coverage_pct: number;
  usdc_coverage_pct: number;

  // Unmapped (no condition_id mapping - dropped from PnL)
  unmapped_trades: number;
  unmapped_usdc: number;
  unmapped_net_cashflow: number; // signed: what PnL is missing

  // Rankability tiers
  // Tier A: usdc >= 99.5% AND trades >= 98% (full confidence)
  // Tier B: usdc >= 98.5% AND trades >= 95% (good, with badge)
  // Tier C: below thresholds (not rankable)
  rankability_tier: 'A' | 'B' | 'C';
  is_high_coverage: boolean; // Tier A or B
}

// Unmapped cashflow gate thresholds
const UNMAPPED_CASHFLOW_ABS_THRESHOLD = 200; // $200 absolute max
const UNMAPPED_CASHFLOW_PCT_THRESHOLD = 0.25; // 0.25% of mapped volume

export interface DuelMetrics {
  wallet: string;

  // Primary metrics (DUEL)
  realized_economic: number; // V17 style: cashflow + synthetic
  realized_cash: number; // Cash style: cashflow + explicit redemptions
  unrealized: number; // From unresolved positions

  // Totals
  total_economic: number; // realized_economic + unrealized
  total_cash: number; // realized_cash + unrealized

  // Decomposition
  resolved_trade_cashflow: number;
  unresolved_trade_cashflow: number;
  synthetic_redemptions: number;
  explicit_redemptions: number;

  // Delta analysis
  economic_vs_cash_delta: number; // realized_economic - realized_cash
  synthetic_vs_explicit_delta: number; // synthetic - explicit

  // Activity metrics
  positions_count: number;
  resolved_positions: number;
  unresolved_positions: number;
  markets_traded: number;
  total_volume: number;

  // Win rate (market-level, not trade-level)
  markets_won: number; // resolved markets with positive PnL
  markets_lost: number; // resolved markets with negative PnL
  market_win_rate: number; // markets_won / (markets_won + markets_lost)

  // Recency metrics (last 30 days) - from mapped CLOB trades only
  net_cashflow_30d: number; // sell - buy (NOT PnL - accumulating wallets will be negative)
  volume_30d: number;
  trades_30d: number;
  last_trade_ts: string | null;

  // Omega metrics (180-day trailing) - market-level PnL ratio
  omega_180d: number; // sum(gains) / sum(losses), capped at 100 if no losses
  sum_gains_180d: number; // sum of positive market PnLs in 180d window
  sum_losses_180d: number; // sum of abs(negative market PnLs) in 180d window
  decided_markets_180d: number; // count of resolved markets in 180d window with >= $5 cost
  wins_180d: number; // count of winning markets in 180d window
  losses_180d: number; // count of losing markets in 180d window

  // Data quality
  data_coverage: DataCoverage;

  // Unmapped cashflow gate
  unmapped_cashflow_passes_gate: boolean;

  // Classification
  clob_only_check: ClobOnlyCheckResult;
  is_rankable: boolean; // CLOB-only + sufficient activity + high coverage + passes unmapped gate
}

// ============================================================================
// Data Coverage Check
// ============================================================================

async function getDataCoverage(wallet: string): Promise<DataCoverage> {
  // Single query that computes both mapped and unmapped stats using SEMI/ANTI joins
  // Uses abs(usdc_amount) for volume, signed usdc for net cashflow
  // V17.1 FIX: Use canonical fills view (dedupes maker/taker rows)
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        token_id,
        abs(toFloat64(usdc_amount)) / 1000000.0 AS usdc_abs,
        toFloat64(usdc_amount) / 1000000.0 AS usdc_signed,
        side
      FROM pm_trader_fills_canonical_v1
      WHERE trader_wallet = '${wallet.toLowerCase()}'
    ),
    mapped AS (
      SELECT
        count() AS mapped_trades,
        sum(d.usdc_abs) AS mapped_usdc_abs
      FROM deduped d
      LEFT SEMI JOIN pm_token_to_condition_map_v5 m
        ON d.token_id = m.token_id_dec
    ),
    unmapped AS (
      SELECT
        count() AS unmapped_trades,
        sum(d.usdc_abs) AS unmapped_usdc_abs,
        sum(CASE WHEN d.side = 'sell' THEN d.usdc_signed ELSE -d.usdc_signed END) AS unmapped_cashflow
      FROM deduped d
      LEFT ANTI JOIN pm_token_to_condition_map_v5 m
        ON d.token_id = m.token_id_dec
    ),
    totals AS (
      SELECT count() AS total_trades, sum(usdc_abs) AS total_usdc_abs
      FROM deduped
    )
    SELECT
      totals.total_trades,
      totals.total_usdc_abs,
      mapped.mapped_trades,
      mapped.mapped_usdc_abs,
      unmapped.unmapped_trades,
      unmapped.unmapped_usdc_abs,
      unmapped.unmapped_cashflow
    FROM totals, mapped, unmapped
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const row = ((await result.json()) as any[])[0] || {};

  const totalTrades = Number(row.total_trades) || 0;
  const totalUsdc = Number(row.total_usdc_abs) || 0;
  const mappedTrades = Number(row.mapped_trades) || 0;
  const mappedUsdc = Number(row.mapped_usdc_abs) || 0;
  const unmappedTrades = Number(row.unmapped_trades) || 0;
  const unmappedUsdc = Number(row.unmapped_usdc_abs) || 0;
  const unmappedCashflow = Number(row.unmapped_cashflow) || 0;

  const tradeCoverage = totalTrades > 0 ? (mappedTrades / totalTrades) * 100 : 100;
  const usdcCoverage = totalUsdc > 0 ? (mappedUsdc / totalUsdc) * 100 : 100;

  // Consistency checks - warn if numbers don't add up
  const tradeSum = mappedTrades + unmappedTrades;
  const usdcSum = mappedUsdc + unmappedUsdc;
  const tradeEpsilon = Math.abs(tradeSum - totalTrades);
  const usdcEpsilon = Math.abs(usdcSum - totalUsdc);

  if (tradeEpsilon > 0) {
    console.warn(`[DataCoverage] Trade count mismatch: ${mappedTrades} + ${unmappedTrades} = ${tradeSum} != ${totalTrades}`);
  }
  if (usdcEpsilon > 0.01) {
    console.warn(`[DataCoverage] USDC sum mismatch: ${mappedUsdc} + ${unmappedUsdc} = ${usdcSum} != ${totalUsdc} (diff: ${usdcEpsilon})`);
  }

  // Determine rankability tier based on USDC coverage (primary) and trade coverage (secondary)
  // Tier A: usdc >= 99.5% AND trades >= 98% (full confidence)
  // Tier B: usdc >= 98.5% AND trades >= 95% (good, with badge)
  // Tier C: below thresholds (not rankable)
  let rankabilityTier: 'A' | 'B' | 'C' = 'C';
  if (usdcCoverage >= 99.5 && tradeCoverage >= 98) {
    rankabilityTier = 'A';
  } else if (usdcCoverage >= 98.5 && tradeCoverage >= 95) {
    rankabilityTier = 'B';
  }

  return {
    total_trades: totalTrades,
    total_usdc: totalUsdc,
    mapped_trades: mappedTrades,
    mapped_usdc: mappedUsdc,
    trade_coverage_pct: tradeCoverage,
    usdc_coverage_pct: usdcCoverage,
    unmapped_trades: unmappedTrades,
    unmapped_usdc: unmappedUsdc,
    unmapped_net_cashflow: unmappedCashflow,
    rankability_tier: rankabilityTier,
    is_high_coverage: rankabilityTier === 'A' || rankabilityTier === 'B',
  };
}

// ============================================================================
// Explicit Redemptions Loader
// ============================================================================

async function getExplicitRedemptions(wallet: string): Promise<number> {
  const query = `
    SELECT sum(toFloat64OrNull(amount_or_payout) / 1000000.0) as total
    FROM pm_ctf_events
    WHERE user_address = '${wallet.toLowerCase()}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return Number(rows[0]?.total) || 0;
}

// ============================================================================
// Recency Metrics (30-day window) - MAPPED TRADES ONLY
// ============================================================================

interface RecencyMetrics {
  net_cashflow_30d: number; // sell - buy (NOT PnL)
  volume_30d: number;
  trades_30d: number;
  last_trade_ts: string | null;
}

async function getRecencyMetrics(wallet: string): Promise<RecencyMetrics> {
  // Get 30-day metrics and last trade timestamp
  // IMPORTANT: Uses SEMI JOIN to only count mapped trades (same basis as coverage/PnL)
  // V17.1 FIX: Use canonical fills view (dedupes maker/taker rows)
  const query = `
    WITH fills AS (
      SELECT
        f.token_id,
        f.side,
        abs(toFloat64(f.usdc_amount)) / 1000000.0 as usdc_abs,
        toFloat64(f.usdc_amount) / 1000000.0 as usdc_signed,
        f.trade_time
      FROM pm_trader_fills_canonical_v1 f
      WHERE f.trader_wallet = '${wallet.toLowerCase()}'
    ),
    mapped AS (
      SELECT f.*
      FROM fills f
      LEFT SEMI JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    )
    SELECT
      sum(CASE WHEN trade_time >= now() - INTERVAL 30 DAY
          THEN (CASE WHEN side = 'sell' THEN usdc_signed ELSE -usdc_signed END)
          ELSE 0 END) as net_cashflow_30d,
      sum(CASE WHEN trade_time >= now() - INTERVAL 30 DAY THEN usdc_abs ELSE 0 END) as volume_30d,
      countIf(trade_time >= now() - INTERVAL 30 DAY) as trades_30d,
      max(trade_time) as last_trade_ts
    FROM mapped
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const row = ((await result.json()) as any[])[0] || {};

  return {
    net_cashflow_30d: Number(row.net_cashflow_30d) || 0,
    volume_30d: Number(row.volume_30d) || 0,
    trades_30d: Number(row.trades_30d) || 0,
    last_trade_ts: row.last_trade_ts || null,
  };
}

// ============================================================================
// V17 Decomposition with Win Rate (aggregated by condition_id)
// ============================================================================

interface V17Decomposition {
  resolved_trade_cashflow: number;
  unresolved_trade_cashflow: number;
  synthetic_redemptions: number;
  resolved_count: number;
  unresolved_count: number;
  // Market win rate (condition-level, NOT outcome-level)
  markets_won: number;
  markets_lost: number;
  market_win_rate: number;
  // Omega metrics (180-day trailing)
  omega_180d: number;
  sum_gains_180d: number;
  sum_losses_180d: number;
  decided_markets_180d: number;
  wins_180d: number;
  losses_180d: number;
}

function decomposeV17(v17: WalletMetricsV17): V17Decomposition {
  let resolved_trade_cashflow = 0;
  let unresolved_trade_cashflow = 0;
  let synthetic_redemptions = 0;
  let resolved_count = 0;
  let unresolved_count = 0;

  // Aggregate PnL by condition_id (market-level) for win rate AND Omega
  // Map: condition_id -> { pnl, totalCost, isResolved, resolvedAt }
  const marketAgg = new Map<
    string,
    { pnl: number; totalCost: number; isResolved: boolean; resolvedAt: Date | null }
  >();

  for (const pos of v17.positions) {
    if (pos.is_resolved && pos.resolution_price !== null) {
      resolved_trade_cashflow += pos.trade_cash_flow;
      synthetic_redemptions += pos.final_shares * pos.resolution_price;
      resolved_count++;

      // Aggregate by condition_id for win rate and Omega
      const positionPnl = pos.trade_cash_flow + pos.final_shares * pos.resolution_price;
      const positionCost = Math.abs(pos.trade_cash_flow);
      const resolvedAt = pos.resolved_at ? new Date(pos.resolved_at) : null;

      const existing = marketAgg.get(pos.condition_id);
      if (existing) {
        existing.pnl += positionPnl;
        existing.totalCost += positionCost;
        // Keep the latest resolved_at if we have multiple outcomes
        if (resolvedAt && (!existing.resolvedAt || resolvedAt > existing.resolvedAt)) {
          existing.resolvedAt = resolvedAt;
        }
      } else {
        marketAgg.set(pos.condition_id, {
          pnl: positionPnl,
          totalCost: positionCost,
          isResolved: true,
          resolvedAt,
        });
      }
    } else {
      unresolved_trade_cashflow += pos.trade_cash_flow;
      unresolved_count++;
    }
  }

  // Count wins/losses at the condition (market) level (all-time)
  let markets_won = 0;
  let markets_lost = 0;

  // Omega metrics (180-day trailing window)
  const now = new Date();
  const cutoff180d = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  let sum_gains_180d = 0;
  let sum_losses_180d = 0;
  let decided_markets_180d = 0;
  let wins_180d = 0;
  let losses_180d = 0;

  for (const [, agg] of marketAgg) {
    // De minimis threshold: $5 total cost basis at the market level
    if (agg.totalCost >= 5 && agg.isResolved) {
      // All-time win rate
      if (agg.pnl > 0) {
        markets_won++;
      } else if (agg.pnl < 0) {
        markets_lost++;
      }

      // 180-day Omega window
      if (agg.resolvedAt && agg.resolvedAt >= cutoff180d) {
        decided_markets_180d++;
        if (agg.pnl > 0) {
          sum_gains_180d += agg.pnl;
          wins_180d++;
        } else if (agg.pnl < 0) {
          sum_losses_180d += Math.abs(agg.pnl);
          losses_180d++;
        }
        // pnl == 0 counts as decided but neither win nor loss
      }
    }
  }

  const totalDecided = markets_won + markets_lost;
  const market_win_rate = totalDecided > 0 ? markets_won / totalDecided : 0;

  // Omega calculation: sum(gains) / sum(losses)
  // IMPORTANT: Only meaningful when decided_markets_180d >= 20
  // Otherwise 1-2 lucky wins produce misleading "Omega gods"
  const MIN_DECIDED_FOR_OMEGA = 20;
  let omega_180d = 0;

  if (decided_markets_180d >= MIN_DECIDED_FOR_OMEGA) {
    if (sum_losses_180d > 0) {
      omega_180d = sum_gains_180d / sum_losses_180d;
    } else if (sum_gains_180d > 0) {
      omega_180d = 100; // Cap: no losses means infinite Omega, cap at 100
    }
    // If both gains and losses are 0, omega stays at 0
  }
  // If decided_markets_180d < 20, omega_180d stays at 0 (insufficient sample)

  return {
    resolved_trade_cashflow,
    unresolved_trade_cashflow,
    synthetic_redemptions,
    resolved_count,
    unresolved_count,
    markets_won,
    markets_lost,
    market_win_rate,
    omega_180d,
    sum_gains_180d,
    sum_losses_180d,
    decided_markets_180d,
    wins_180d,
    losses_180d,
  };
}

// ============================================================================
// DUEL Engine
// ============================================================================

class DuelEngine {
  private v17Engine = createV17Engine();

  async compute(wallet: string): Promise<DuelMetrics> {
    // Run all data fetching in parallel
    // FAST PATH: Try to get classification from pre-computed table first (avoids slow CTF/ERC1155 queries)
    const [v17, explicitRedemptions, cachedClobOnly, dataCoverage, recencyMetrics] = await Promise.all([
      this.v17Engine.compute(wallet),
      getExplicitRedemptions(wallet),
      getClobOnlyFromTable(wallet),
      getDataCoverage(wallet),
      getRecencyMetrics(wallet),
    ]);

    // If not in classification table, fall back to slow compute (rare for production flow)
    const clobOnlyCheck = cachedClobOnly || (await checkClobOnly(wallet));

    // Decompose V17 results (includes win rate calculation)
    const decomp = decomposeV17(v17);

    // Calculate DUEL metrics
    const realized_economic = v17.realized_pnl; // V17's formula
    const realized_cash = decomp.resolved_trade_cashflow + explicitRedemptions;
    const unrealized = v17.unrealized_pnl;

    // Check unmapped cashflow gate
    // Fails if abs(unmapped_net_cashflow) > $200 OR > 0.25% of mapped volume
    const absUnmapped = Math.abs(dataCoverage.unmapped_net_cashflow);
    const pctOfMapped = dataCoverage.mapped_usdc > 0
      ? (absUnmapped / dataCoverage.mapped_usdc) * 100
      : 0;
    const unmapped_cashflow_passes_gate =
      absUnmapped <= UNMAPPED_CASHFLOW_ABS_THRESHOLD &&
      pctOfMapped <= UNMAPPED_CASHFLOW_PCT_THRESHOLD;

    // Rankable requires:
    // - CLOB-only (no splits/merges, minimal ERC1155)
    // - Sufficient trades (≥10)
    // - High data coverage (Tier A or B)
    // - Passes unmapped cashflow gate
    const is_rankable =
      clobOnlyCheck.is_clob_only &&
      clobOnlyCheck.clob_trade_count >= 10 &&
      dataCoverage.is_high_coverage &&
      unmapped_cashflow_passes_gate;

    return {
      wallet,

      // Primary metrics
      realized_economic,
      realized_cash,
      unrealized,

      // Totals
      total_economic: realized_economic + unrealized,
      total_cash: realized_cash + unrealized,

      // Decomposition
      resolved_trade_cashflow: decomp.resolved_trade_cashflow,
      unresolved_trade_cashflow: decomp.unresolved_trade_cashflow,
      synthetic_redemptions: decomp.synthetic_redemptions,
      explicit_redemptions: explicitRedemptions,

      // Delta analysis
      economic_vs_cash_delta: realized_economic - realized_cash,
      synthetic_vs_explicit_delta: decomp.synthetic_redemptions - explicitRedemptions,

      // Activity metrics
      positions_count: v17.positions_count,
      resolved_positions: decomp.resolved_count,
      unresolved_positions: decomp.unresolved_count,
      markets_traded: v17.markets_traded,
      total_volume: v17.volume_traded,

      // Win rate (market-level)
      markets_won: decomp.markets_won,
      markets_lost: decomp.markets_lost,
      market_win_rate: decomp.market_win_rate,

      // Recency metrics (mapped trades only)
      net_cashflow_30d: recencyMetrics.net_cashflow_30d,
      volume_30d: recencyMetrics.volume_30d,
      trades_30d: recencyMetrics.trades_30d,
      last_trade_ts: recencyMetrics.last_trade_ts,

      // Omega metrics (180-day trailing)
      omega_180d: decomp.omega_180d,
      sum_gains_180d: decomp.sum_gains_180d,
      sum_losses_180d: decomp.sum_losses_180d,
      decided_markets_180d: decomp.decided_markets_180d,
      wins_180d: decomp.wins_180d,
      losses_180d: decomp.losses_180d,

      // Data quality
      data_coverage: dataCoverage,

      // Unmapped cashflow gate
      unmapped_cashflow_passes_gate,

      // Classification
      clob_only_check: clobOnlyCheck,
      is_rankable,
    };
  }

  /**
   * Compute DUEL metrics for multiple wallets
   */
  async computeBatch(wallets: string[]): Promise<DuelMetrics[]> {
    const results: DuelMetrics[] = [];

    for (const wallet of wallets) {
      try {
        const result = await this.compute(wallet);
        results.push(result);
      } catch (err: any) {
        console.error(`Error computing DUEL for ${wallet}:`, err.message);
      }
    }

    return results;
  }
}

export function createDuelEngine(): DuelEngine {
  return new DuelEngine();
}

// ============================================================================
// Summary Statistics
// ============================================================================

export interface DuelBatchSummary {
  total_wallets: number;
  rankable_wallets: number;
  ctf_active_wallets: number;
  avg_economic_vs_cash_delta: number;
  total_economic_pnl: number;
  total_cash_pnl: number;
}

export function summarizeDuelBatch(results: DuelMetrics[]): DuelBatchSummary {
  const rankable = results.filter((r) => r.is_rankable);
  const ctfActive = results.filter((r) => !r.clob_only_check.is_clob_only);

  const deltas = results.map((r) => r.economic_vs_cash_delta);
  const avgDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;

  return {
    total_wallets: results.length,
    rankable_wallets: rankable.length,
    ctf_active_wallets: ctfActive.length,
    avg_economic_vs_cash_delta: avgDelta,
    total_economic_pnl: results.reduce((s, r) => s + r.realized_economic, 0),
    total_cash_pnl: results.reduce((s, r) => s + r.realized_cash, 0),
  };
}
