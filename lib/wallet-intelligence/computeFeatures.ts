/**
 * Wallet Features Computation
 * Computes the full fingerprint metrics from positions
 */

import type { Position, WalletFeatures } from './types';
import {
  mean,
  median,
  percentile,
  stdDev,
  hhiFromCounts,
  topShare,
  maxDrawdown,
  varAtPercentile,
  cvarAtPercentile,
  sortinoRatio,
  payoffRatio,
  expectancy,
  clv,
  clvWinRate,
  brierScore,
  logLoss,
  sharpness,
} from './utils';

/**
 * Compute wallet features from positions
 * @param wallet - wallet address
 * @param positions - all positions for this wallet (pre-filtered by window if needed)
 * @param windowDays - null for lifetime, or 7/30/90/180
 */
export function computeWalletFeatures(
  wallet: string,
  positions: Position[],
  windowDays: number | null = null
): WalletFeatures {
  const now = new Date();

  if (!positions.length) {
    return emptyFeatures(wallet, windowDays, now);
  }

  // Basic stats
  const totalPositions = positions.length;
  const firstPosition = positions.reduce((min, p) =>
    p.ts_open < min.ts_open ? p : min, positions[0]);
  const lastPosition = positions.reduce((max, p) =>
    p.ts_open > max.ts_open ? p : max, positions[0]);

  const walletAgeDays = (now.getTime() - firstPosition.ts_open.getTime()) / (1000 * 60 * 60 * 24);
  const activeDays = new Set(positions.map(p =>
    p.ts_open.toISOString().slice(0, 10))).size;

  // === Time Horizon ===
  const holdMinutes = positions.map(p => p.hold_minutes);
  const pctHeldToResolve = positions.filter(p => p.ts_close === null).length / totalPositions;
  const timeToResolveAtEntry = positions.map(p =>
    (p.ts_resolve.getTime() - p.ts_open.getTime()) / (1000 * 60 * 60));

  // === Edge Type (CLV) ===
  const clv1h = positions
    .filter(p => p.p_close_1h !== null)
    .map(p => clv(p.avg_entry_price_side, p.p_close_1h!));
  const clv4h = positions
    .filter(p => p.p_close_4h !== null)
    .map(p => clv(p.avg_entry_price_side, p.p_close_4h!));
  const clv24h = positions
    .filter(p => p.p_close_24h !== null)
    .map(p => clv(p.avg_entry_price_side, p.p_close_24h!));
  const clv72h = positions
    .filter(p => p.p_close_72h !== null)
    .map(p => clv(p.avg_entry_price_side, p.p_close_72h!));

  // === Payoff Shape ===
  const rois = positions.map(p => p.roi);
  const wins = positions.filter(p => p.pnl_usd > 0);
  const losses = positions.filter(p => p.pnl_usd <= 0);
  const winRate = wins.length / totalPositions;
  const avgWinRoi = wins.length ? mean(wins.map(p => p.roi)) : 0;
  const avgLossRoi = losses.length ? mean(losses.map(p => p.roi)) : 0;

  // === Risk Discipline ===
  const pnlPoints = positions.map(p => ({
    t: (p.ts_close || p.ts_resolve).getTime(),
    pnlUsd: p.pnl_usd,
  }));
  const { maxDdUsd, maxDdPct } = maxDrawdown(pnlPoints);
  const totalPnl = positions.reduce((sum, p) => sum + p.pnl_usd, 0);

  // === Focus Profile ===
  const categoryGroups = groupBy(positions, p => p.category);
  const eventGroups = groupBy(positions, p => p.event_id);
  const marketGroups = groupBy(positions, p => p.condition_id);

  const categoryCounts = Object.values(categoryGroups).map(g => g.length);
  const eventCounts = Object.values(eventGroups).map(g => g.length);
  const marketCounts = Object.values(marketGroups).map(g => g.length);

  // Size concentration
  const costs = positions.map(p => p.entry_cost_usd);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  const costShares = costs.map(c => c / totalCost);
  const sizeHhi = costShares.reduce((sum, s) => sum + s * s, 0);

  // Conviction: top decile share
  const sortedCosts = [...costs].sort((a, b) => b - a);
  const topDecileCount = Math.max(1, Math.ceil(sortedCosts.length * 0.1));
  const topDecileSum = sortedCosts.slice(0, topDecileCount).reduce((a, b) => a + b, 0);
  const convictionTopDecileShare = topDecileSum / totalCost;

  // === Forecasting Quality ===
  const brierScores = positions.map(p =>
    brierScore(p.avg_entry_price_side, p.outcome_side));
  const logLosses = positions.map(p =>
    logLoss(p.avg_entry_price_side, p.outcome_side));
  const entryPrices = positions.map(p => p.avg_entry_price_side);

  // === Volume & Sizing ===
  const totalProceeds = positions.reduce((sum, p) => sum + p.exit_proceeds_usd, 0);

  return {
    wallet,
    window_days: windowDays,
    computed_at: now,

    // Identity & Activity
    wallet_age_days: walletAgeDays,
    positions_total: totalPositions,
    fills_total: 0, // Would need fills data
    active_days: activeDays,
    positions_per_active_day: totalPositions / activeDays,

    // Time Horizon
    hold_minutes_median: median(holdMinutes),
    hold_minutes_p10: percentile(holdMinutes, 10),
    hold_minutes_p50: percentile(holdMinutes, 50),
    hold_minutes_p90: percentile(holdMinutes, 90),
    pct_held_to_resolve: pctHeldToResolve,
    avg_time_to_resolve_at_entry_hours: mean(timeToResolveAtEntry),

    // Edge Type (CLV)
    avg_clv_1h: mean(clv1h),
    avg_clv_4h: mean(clv4h),
    avg_clv_24h: mean(clv24h),
    avg_clv_72h: mean(clv72h),
    clv_win_rate_24h: clvWinRate(clv24h),
    short_vs_long_edge: mean(clv4h) - mean(clv24h),

    // Payoff Shape
    win_rate: winRate,
    avg_win_roi: avgWinRoi,
    avg_loss_roi: avgLossRoi,
    payoff_ratio: payoffRatio(avgWinRoi, avgLossRoi),
    roi_p05: percentile(rois, 5),
    roi_p50: percentile(rois, 50),
    roi_p95: percentile(rois, 95),
    tail_ratio: Math.abs(percentile(rois, 5)) > 0
      ? percentile(rois, 95) / Math.abs(percentile(rois, 5))
      : 0,

    // Risk Discipline
    total_pnl_usd: totalPnl,
    max_drawdown_usd: maxDdUsd,
    max_drawdown_pct: maxDdPct,
    max_loss_roi: Math.min(...rois),
    var_95_roi: varAtPercentile(rois, 5),
    cvar_95_roi: cvarAtPercentile(rois, 5),
    sortino_proxy: sortinoRatio(rois),

    // Focus Profile
    unique_categories: Object.keys(categoryGroups).length,
    unique_events: Object.keys(eventGroups).length,
    unique_markets: Object.keys(marketGroups).length,
    category_hhi: hhiFromCounts(categoryCounts),
    event_hhi: hhiFromCounts(eventCounts),
    market_hhi: hhiFromCounts(marketCounts),
    top_category_share: topShare(categoryCounts),
    top_event_share: topShare(eventCounts),
    top_market_share: topShare(marketCounts),
    size_hhi: sizeHhi,
    conviction_top_decile_share: convictionTopDecileShare,

    // Forecasting Quality
    brier_score: mean(brierScores),
    log_loss: mean(logLosses),
    sharpness: sharpness(entryPrices),

    // Volume & Sizing
    total_cost_usd: totalCost,
    total_proceeds_usd: totalProceeds,
    avg_position_cost_usd: mean(costs),
    median_position_cost_usd: median(costs),
    p90_position_cost_usd: percentile(costs, 90),
  };
}

function emptyFeatures(wallet: string, windowDays: number | null, now: Date): WalletFeatures {
  return {
    wallet,
    window_days: windowDays,
    computed_at: now,
    wallet_age_days: 0,
    positions_total: 0,
    fills_total: 0,
    active_days: 0,
    positions_per_active_day: 0,
    hold_minutes_median: 0,
    hold_minutes_p10: 0,
    hold_minutes_p50: 0,
    hold_minutes_p90: 0,
    pct_held_to_resolve: 0,
    avg_time_to_resolve_at_entry_hours: 0,
    avg_clv_1h: 0,
    avg_clv_4h: 0,
    avg_clv_24h: 0,
    avg_clv_72h: 0,
    clv_win_rate_24h: 0,
    short_vs_long_edge: 0,
    win_rate: 0,
    avg_win_roi: 0,
    avg_loss_roi: 0,
    payoff_ratio: 0,
    roi_p05: 0,
    roi_p50: 0,
    roi_p95: 0,
    tail_ratio: 0,
    total_pnl_usd: 0,
    max_drawdown_usd: 0,
    max_drawdown_pct: 0,
    max_loss_roi: 0,
    var_95_roi: 0,
    cvar_95_roi: 0,
    sortino_proxy: 0,
    unique_categories: 0,
    unique_events: 0,
    unique_markets: 0,
    category_hhi: 0,
    event_hhi: 0,
    market_hhi: 0,
    top_category_share: 0,
    top_event_share: 0,
    top_market_share: 0,
    size_hhi: 0,
    conviction_top_decile_share: 0,
    brier_score: 0,
    log_loss: 0,
    sharpness: 0,
    total_cost_usd: 0,
    total_proceeds_usd: 0,
    avg_position_cost_usd: 0,
    median_position_cost_usd: 0,
    p90_position_cost_usd: 0,
  };
}

function groupBy<T, K extends string>(arr: T[], fn: (item: T) => K): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  for (const item of arr) {
    const key = fn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}
