/**
 * CLOB Wallet Metrics Calculator
 *
 * Comprehensive wallet intelligence metrics for CLOB-only wallets.
 * Calculates metrics organized by family:
 * - Activity: positions, fills, active days
 * - Performance: PnL, win rate, expectancy
 * - Volume: cost, proceeds, position sizing
 * - Risk: drawdown, volatility, Sharpe/Sortino
 * - Distribution: percentiles, skewness, kurtosis
 *
 * Works for all wallet types: maker-heavy, taker-heavy, and mixed.
 */

import { clickhouse } from '../clickhouse/client';

// =============================================================================
// INTERFACES
// =============================================================================

export interface ActivityMetrics {
  positions_total: number;
  fills_total: number;
  active_days: number;
  wallet_age_days: number;
  positions_per_active_day: number;
}

export interface PerformanceMetrics {
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  wins: number;
  losses: number;
  breakeven: number;
  win_rate: number;
  roi_mean: number;
  roi_median: number;
  avg_win_roi: number;
  avg_loss_roi: number;
  payoff_ratio: number;
  expectancy: number;
  profit_factor: number;
  total_win_pnl: number;
  total_loss_pnl: number;
}

export interface VolumeMetrics {
  total_cost_usd: number;
  total_proceeds_usd: number;
  avg_position_cost_usd: number;
  median_position_cost_usd: number;
  p90_position_cost_usd: number;
  max_position_cost_usd: number;
}

export interface RiskMetrics {
  volatility_roi: number;
  downside_deviation_roi: number;
  sharpe_proxy: number;
  sortino_proxy: number;
  max_drawdown_usd: number;
  max_drawdown_pct: number;
  var_95_roi: number;
  cvar_95_roi: number;
}

export interface DistributionMetrics {
  roi_p05: number;
  roi_p50: number;
  roi_p95: number;
  skewness_roi: number;
  kurtosis_roi: number;
  max_win_roi: number;
  max_loss_roi: number;
}

export interface TimingMetrics {
  median_hold_minutes: number;
  avg_hold_minutes: number;
  p90_hold_minutes: number;
  pct_held_to_resolve: number;
  avg_time_to_resolve_at_entry_hours: number;
}

export interface EdgeMetrics {
  avg_entry_price: number;
  avg_win_entry_price: number;
  avg_loss_entry_price: number;
  avg_win_entry_edge: number;  // 1 - entry_price for wins (how much edge captured)
  skill_score: number;  // Combined metric: win_rate * payoff * (1 + entry_edge)
}

export interface ConsistencyMetrics {
  position_size_cv: number;  // Coefficient of variation
  max_win_streak: number;
  max_loss_streak: number;
  roi_consistency: number;  // 1 / (1 + CV of ROIs), normalized 0-1
}

export interface FingerprintMetrics {
  maker_ratio: number;
  taker_ratio: number;
  position_concentration_hhi: number;  // Herfindahl index
  avg_positions_per_day: number;
  strategy_type: 'market_maker' | 'swing_trader' | 'scalper' | 'position_trader' | 'unknown';
}

export interface PositionDetail {
  token_id: string;
  condition_id: string | null;
  outcome_index: number;
  cost_usd: number;
  proceeds_usd: number;
  tokens_bought: number;
  tokens_sold: number;
  tokens_remaining: number;
  payout_share: number;
  is_resolved: boolean;
  pnl: number;
  roi: number;
  result: 'win' | 'loss' | 'breakeven' | 'open';
  // Timing fields
  first_trade_ts: Date | null;
  last_trade_ts: Date | null;
  resolution_ts: Date | null;
  hold_minutes: number;
  held_to_resolve: boolean;
}

export interface ClobWalletMetrics {
  wallet: string;
  wallet_type: 'maker-heavy' | 'taker-heavy' | 'mixed';
  pnl_method: 'position-based' | 'maker-spread';
  taker_sell_ratio: number;

  activity: ActivityMetrics;
  performance: PerformanceMetrics;
  volume: VolumeMetrics;
  risk: RiskMetrics;
  distribution: DistributionMetrics;
  timing: TimingMetrics;
  edge: EdgeMetrics;
  consistency: ConsistencyMetrics;
  fingerprint: FingerprintMetrics;

  // Raw position data for detailed analysis
  positions: PositionDetail[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const squareDiffs = arr.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

function skewness(arr: number[]): number {
  if (arr.length < 3) return 0;
  const avg = mean(arr);
  const std = stdDev(arr);
  if (std === 0) return 0;
  const n = arr.length;
  const m3 = arr.reduce((sum, v) => sum + Math.pow(v - avg, 3), 0) / n;
  return m3 / Math.pow(std, 3);
}

function kurtosis(arr: number[]): number {
  if (arr.length < 4) return 0;
  const avg = mean(arr);
  const std = stdDev(arr);
  if (std === 0) return 0;
  const n = arr.length;
  const m4 = arr.reduce((sum, v) => sum + Math.pow(v - avg, 4), 0) / n;
  return m4 / Math.pow(std, 4) - 3; // excess kurtosis
}

function downsideDeviation(arr: number[]): number {
  const negatives = arr.filter(v => v < 0);
  if (negatives.length === 0) return 0;
  const squaredNegatives = negatives.map(v => v * v);
  return Math.sqrt(mean(squaredNegatives));
}

function maxDrawdown(pnlSeries: number[]): { usd: number; pct: number } {
  if (pnlSeries.length === 0) return { usd: 0, pct: 0 };

  let peak = 0;
  let maxDd = 0;
  let maxDdPct = 0;
  let cumPnl = 0;

  for (const pnl of pnlSeries) {
    cumPnl += pnl;
    if (cumPnl > peak) {
      peak = cumPnl;
    }
    const dd = peak - cumPnl;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = peak !== 0 ? dd / Math.abs(peak) : 0;
    }
  }

  return { usd: maxDd, pct: maxDdPct };
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

export async function computeClobWalletMetrics(
  wallet: string,
  minCostFilter: number = 1
): Promise<ClobWalletMetrics> {
  const walletLower = wallet.toLowerCase();

  // Step 1: Get wallet type detection signal and activity stats
  const walletTypeQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(role) as role,
        any(toFloat64(usdc_amount)) / 1e6 as usdc,
        any(toFloat64(token_amount)) / 1e6 as tokens,
        any(trade_time) as trade_time
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${walletLower}'
       
      GROUP BY event_id
    )
    SELECT
      count() as fills_total,
      countDistinct(toDate(trade_time)) as active_days,
      dateDiff('day', min(trade_time), max(trade_time)) as wallet_age_days,
      sumIf(usdc, side = 'buy') as total_buy_usdc,
      sumIf(usdc, side = 'sell') as total_sell_usdc,
      sumIf(usdc, side = 'buy' AND role = 'maker') as maker_buy_usdc,
      sumIf(usdc, side = 'sell' AND role = 'maker') as maker_sell_usdc,
      sumIf(tokens, side = 'buy') as total_buy_tokens,
      sumIf(tokens, side = 'sell' AND role = 'taker') as taker_sell_tokens,
      countIf(role = 'maker') as maker_trades,
      countIf(role = 'taker') as taker_trades
    FROM deduped
  `;

  const walletTypeResult = await clickhouse.query({ query: walletTypeQuery, format: 'JSONEachRow' });
  const walletStats = (await walletTypeResult.json() as any[])[0] || {};

  // Calculate taker_sell_ratio to determine wallet type
  const totalBuyTokens = walletStats.total_buy_tokens || 0;
  const takerSellTokens = walletStats.taker_sell_tokens || 0;
  const takerSellRatio = takerSellTokens / (totalBuyTokens + 1);
  const useMakerSpread = takerSellRatio > 1.0;

  // Determine wallet type
  let walletType: 'maker-heavy' | 'taker-heavy' | 'mixed';
  if (takerSellRatio > 1.0) {
    walletType = 'maker-heavy';
  } else if (takerSellRatio < 0.5) {
    walletType = 'taker-heavy';
  } else {
    walletType = 'mixed';
  }

  // Step 2: Get payout redemptions for maker-spread formula
  const payoutQuery = `
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as payout_usdc
    FROM pm_ctf_events
    WHERE user_address = '${walletLower}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;

  const payoutResult = await clickhouse.query({ query: payoutQuery, format: 'JSONEachRow' });
  const payoutData = (await payoutResult.json() as any[])[0] || {};
  const payoutUsdc = payoutData.payout_usdc || 0;

  // Step 3: Get all positions with resolution data and timestamps
  const positionQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(toFloat64(usdc_amount)) / 1e6 as usdc,
        any(toFloat64(token_amount)) / 1e6 as tokens,
        any(trade_time) as trade_time
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${walletLower}'
       
      GROUP BY event_id
    ),
    positions AS (
      SELECT
        d.token_id,
        m.condition_id,
        m.outcome_index,
        sumIf(d.usdc, d.side = 'buy') as cost_usd,
        sumIf(d.usdc, d.side = 'sell') as proceeds_usd,
        sumIf(d.tokens, d.side = 'buy') as tokens_bought,
        sumIf(d.tokens, d.side = 'sell') as tokens_sold,
        min(d.trade_time) as first_trade_ts,
        max(d.trade_time) as last_trade_ts
      FROM deduped d
      LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
      GROUP BY d.token_id, m.condition_id, m.outcome_index
      HAVING cost_usd > ${minCostFilter}
    )
    SELECT
      p.token_id,
      p.condition_id,
      p.outcome_index,
      p.cost_usd,
      p.proceeds_usd,
      p.tokens_bought,
      p.tokens_sold,
      p.tokens_bought - p.tokens_sold as tokens_remaining,
      p.first_trade_ts,
      p.last_trade_ts,
      r.payout_numerators,
      r.resolved_at as resolution_ts,
      if(r.condition_id IS NOT NULL, 1, 0) as is_resolved
    FROM positions p
    LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
    ORDER BY p.cost_usd DESC
  `;

  const positionResult = await clickhouse.query({ query: positionQuery, format: 'JSONEachRow' });
  const rawPositions = await positionResult.json() as any[];

  // Process positions and calculate metrics
  const positions: PositionDetail[] = [];
  const roiValues: number[] = [];
  const winRois: number[] = [];
  const lossRois: number[] = [];
  const pnlSeries: number[] = [];
  const costValues: number[] = [];
  const holdTimes: number[] = [];  // in minutes
  const timeToResolveAtEntry: number[] = [];  // in hours
  const entryPrices: number[] = [];  // cost / tokens_bought
  const winEntryPrices: number[] = [];
  const lossEntryPrices: number[] = [];
  const resultSequence: ('win' | 'loss')[] = [];  // for streak calculation

  let wins = 0, losses = 0, breakeven = 0, open = 0;
  let totalPnl = 0, realizedPnl = 0, unrealizedPnl = 0;
  let winPnl = 0, lossPnl = 0;
  let totalCost = 0, totalProceeds = 0;
  let heldToResolveCount = 0;

  for (const p of rawPositions) {
    const cost = +p.cost_usd || 0;
    const proceeds = +p.proceeds_usd || 0;
    const remaining = +p.tokens_remaining || 0;
    const isResolved = p.is_resolved === 1;
    const outcomeIdx = p.outcome_index ?? 0;

    // Parse timestamps
    const firstTradeTs = p.first_trade_ts ? new Date(p.first_trade_ts) : null;
    const lastTradeTs = p.last_trade_ts ? new Date(p.last_trade_ts) : null;
    const resolutionTs = p.resolution_ts ? new Date(p.resolution_ts) : null;

    // Calculate hold time (time from first trade to last trade or resolution)
    let holdMinutes = 0;
    let heldToResolve = false;

    if (firstTradeTs && isResolved) {
      // If resolved, use resolution time as end if tokens were held to resolution
      if (resolutionTs && remaining > 0) {
        // Held tokens to resolution
        holdMinutes = (resolutionTs.getTime() - firstTradeTs.getTime()) / (1000 * 60);
        heldToResolve = true;
        heldToResolveCount++;
      } else if (lastTradeTs) {
        // Sold before resolution
        holdMinutes = (lastTradeTs.getTime() - firstTradeTs.getTime()) / (1000 * 60);
      }
      if (holdMinutes > 0) {
        holdTimes.push(holdMinutes);
      }

      // Time to resolve at entry
      if (resolutionTs && firstTradeTs) {
        const hoursToResolve = (resolutionTs.getTime() - firstTradeTs.getTime()) / (1000 * 60 * 60);
        if (hoursToResolve > 0) {
          timeToResolveAtEntry.push(hoursToResolve);
        }
      }
    }

    // Parse payout
    let payoutShare = 0;
    if (isResolved && p.payout_numerators) {
      try {
        const payouts = JSON.parse(p.payout_numerators);
        payoutShare = payouts[outcomeIdx] || 0;
      } catch {
        // Invalid payout format
      }
    }

    totalCost += cost;
    totalProceeds += proceeds;
    costValues.push(cost);

    // Calculate PnL
    let pnl: number;
    let result: 'win' | 'loss' | 'breakeven' | 'open';

    if (!isResolved) {
      pnl = proceeds - cost;
      unrealizedPnl += pnl;
      result = 'open';
      open++;
    } else {
      pnl = proceeds + (remaining * payoutShare) - cost;
      realizedPnl += pnl;
      pnlSeries.push(pnl);

      const roi = cost > 0 ? pnl / cost : 0;
      roiValues.push(roi);

      // Track entry price for edge metrics (entry_price = cost / tokens_bought)
      const tokensBought = +p.tokens_bought || 0;
      const entryPrice = tokensBought > 0 ? cost / tokensBought : 0;
      if (entryPrice > 0 && entryPrice <= 1) {
        entryPrices.push(entryPrice);
      }

      if (pnl > 0.01) {
        result = 'win';
        wins++;
        winPnl += pnl;
        winRois.push(roi);
        resultSequence.push('win');
        if (entryPrice > 0 && entryPrice <= 1) {
          winEntryPrices.push(entryPrice);
        }
      } else if (pnl < -0.01) {
        result = 'loss';
        losses++;
        lossPnl += pnl;
        lossRois.push(roi);
        resultSequence.push('loss');
        if (entryPrice > 0 && entryPrice <= 1) {
          lossEntryPrices.push(entryPrice);
        }
      } else {
        result = 'breakeven';
        breakeven++;
      }
    }

    totalPnl += pnl;

    positions.push({
      token_id: p.token_id,
      condition_id: p.condition_id,
      outcome_index: outcomeIdx,
      cost_usd: cost,
      proceeds_usd: proceeds,
      tokens_bought: +p.tokens_bought || 0,
      tokens_sold: +p.tokens_sold || 0,
      tokens_remaining: remaining,
      payout_share: payoutShare,
      is_resolved: isResolved,
      pnl,
      roi: cost > 0 ? pnl / cost : 0,
      result,
      first_trade_ts: firstTradeTs,
      last_trade_ts: lastTradeTs,
      resolution_ts: resolutionTs,
      hold_minutes: holdMinutes,
      held_to_resolve: heldToResolve,
    });
  }

  // Calculate derived metrics
  const resolved = wins + losses + breakeven;
  const winRate = resolved > 0 ? wins / resolved : 0;
  const avgWinRoi = winRois.length > 0 ? mean(winRois) : 0;
  const avgLossRoi = lossRois.length > 0 ? mean(lossRois) : 0;
  const payoffRatio = avgLossRoi !== 0 ? Math.abs(avgWinRoi / avgLossRoi) : 0;
  const expectancy = winRate * avgWinRoi + (1 - winRate) * avgLossRoi;
  const profitFactor = lossPnl !== 0 ? Math.abs(winPnl / lossPnl) : (winPnl > 0 ? Infinity : 0);

  // Use correct PnL formula based on wallet type
  let finalTotalPnl: number;
  let pnlMethod: 'position-based' | 'maker-spread';

  if (useMakerSpread) {
    finalTotalPnl = (walletStats.maker_sell_usdc || 0) - (walletStats.maker_buy_usdc || 0) + payoutUsdc;
    pnlMethod = 'maker-spread';
  } else {
    finalTotalPnl = totalPnl;
    pnlMethod = 'position-based';
  }

  // Activity metrics
  const fillsTotal = walletStats.fills_total || 0;
  const activeDays = walletStats.active_days || 0;
  const walletAgeDays = Math.max(walletStats.wallet_age_days || 0, 1);

  // Volume metrics
  const avgPositionCost = positions.length > 0 ? totalCost / positions.length : 0;
  const medianPositionCost = percentile(costValues, 50);
  const p90PositionCost = percentile(costValues, 90);
  const maxPositionCost = costValues.length > 0 ? Math.max(...costValues) : 0;

  // Risk metrics
  const volatilityRoi = stdDev(roiValues);
  const downsideDeviationRoi = downsideDeviation(roiValues);
  const sharpeProxy = volatilityRoi !== 0 ? mean(roiValues) / volatilityRoi : 0;
  const sortinoProxy = downsideDeviationRoi !== 0 ? mean(roiValues) / downsideDeviationRoi : 0;
  const dd = maxDrawdown(pnlSeries);
  const var95 = percentile(roiValues, 5);
  const roisBelowVar = roiValues.filter(r => r <= var95);
  const cvar95 = roisBelowVar.length > 0 ? mean(roisBelowVar) : var95;

  // Distribution metrics
  const roiP05 = percentile(roiValues, 5);
  const roiP50 = percentile(roiValues, 50);
  const roiP95 = percentile(roiValues, 95);
  const skewnessRoi = skewness(roiValues);
  const kurtosisRoi = kurtosis(roiValues);
  const maxWinRoi = winRois.length > 0 ? Math.max(...winRois) : 0;
  const maxLossRoi = lossRois.length > 0 ? Math.min(...lossRois) : 0;

  // Timing metrics
  const medianHoldMinutes = percentile(holdTimes, 50);
  const avgHoldMinutes = holdTimes.length > 0 ? mean(holdTimes) : 0;
  const p90HoldMinutes = percentile(holdTimes, 90);
  const pctHeldToResolve = resolved > 0 ? heldToResolveCount / resolved : 0;
  const avgTimeToResolveAtEntryHours = timeToResolveAtEntry.length > 0 ? mean(timeToResolveAtEntry) : 0;

  // Edge metrics (Phase 6)
  const avgEntryPrice = entryPrices.length > 0 ? mean(entryPrices) : 0;
  const avgWinEntryPrice = winEntryPrices.length > 0 ? mean(winEntryPrices) : 0;
  const avgLossEntryPrice = lossEntryPrices.length > 0 ? mean(lossEntryPrices) : 0;
  // Entry edge for wins: bought at avgWinEntryPrice, resolved at 1, so edge = 1 - entry
  const avgWinEntryEdge = avgWinEntryPrice > 0 ? 1 - avgWinEntryPrice : 0;
  // Skill score: win_rate × payoff_ratio × (1 + entry_edge)
  const skillScore = winRate * payoffRatio * (1 + avgWinEntryEdge);

  // Consistency metrics (Phase 7)
  // Position size coefficient of variation
  const positionSizeCv = costValues.length > 1 ? stdDev(costValues) / (mean(costValues) + 0.01) : 0;

  // Calculate win/loss streaks
  let maxWinStreak = 0, maxLossStreak = 0;
  let currentWinStreak = 0, currentLossStreak = 0;
  for (const r of resultSequence) {
    if (r === 'win') {
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    } else {
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
    }
  }

  // ROI consistency: inverse of CV, normalized 0-1
  const roiCv = roiValues.length > 1 ? stdDev(roiValues) / (Math.abs(mean(roiValues)) + 0.01) : 0;
  const roiConsistency = 1 / (1 + roiCv);

  // Fingerprint metrics (Phase 8)
  const makerTrades = walletStats.maker_trades || 0;
  const takerTrades = walletStats.taker_trades || 0;
  const totalTrades = makerTrades + takerTrades;
  const makerRatio = totalTrades > 0 ? makerTrades / totalTrades : 0;
  const takerRatioFp = totalTrades > 0 ? takerTrades / totalTrades : 0;

  // Herfindahl-Hirschman Index for position concentration
  // HHI = sum of squared market shares
  let positionHhi = 0;
  if (positions.length > 0 && totalCost > 0) {
    for (const p of positions) {
      const share = p.cost_usd / totalCost;
      positionHhi += share * share;
    }
  }

  // Average positions per day
  const avgPositionsPerDay = walletAgeDays > 0 ? positions.length / walletAgeDays : 0;

  // Determine strategy type
  let strategyType: 'market_maker' | 'swing_trader' | 'scalper' | 'position_trader' | 'unknown' = 'unknown';
  if (makerRatio > 0.7) {
    strategyType = 'market_maker';
  } else if (avgPositionsPerDay > 5) {
    strategyType = 'scalper';
  } else if (avgHoldMinutes > 60 * 24 * 7) { // > 1 week
    strategyType = 'position_trader';
  } else if (avgHoldMinutes > 60 * 24) { // > 1 day
    strategyType = 'swing_trader';
  }

  return {
    wallet: walletLower,
    wallet_type: walletType,
    pnl_method: pnlMethod,
    taker_sell_ratio: takerSellRatio,

    activity: {
      positions_total: positions.length,
      fills_total: fillsTotal,
      active_days: activeDays,
      wallet_age_days: walletAgeDays,
      positions_per_active_day: activeDays > 0 ? positions.length / activeDays : 0,
    },

    performance: {
      total_pnl: finalTotalPnl,
      realized_pnl: realizedPnl,
      unrealized_pnl: unrealizedPnl,
      wins,
      losses,
      breakeven,
      win_rate: winRate,
      roi_mean: mean(roiValues),
      roi_median: roiP50,
      avg_win_roi: avgWinRoi,
      avg_loss_roi: avgLossRoi,
      payoff_ratio: payoffRatio,
      expectancy,
      profit_factor: Number.isFinite(profitFactor) ? profitFactor : 0,
      total_win_pnl: winPnl,
      total_loss_pnl: lossPnl,
    },

    volume: {
      total_cost_usd: totalCost,
      total_proceeds_usd: totalProceeds,
      avg_position_cost_usd: avgPositionCost,
      median_position_cost_usd: medianPositionCost,
      p90_position_cost_usd: p90PositionCost,
      max_position_cost_usd: maxPositionCost,
    },

    risk: {
      volatility_roi: volatilityRoi,
      downside_deviation_roi: downsideDeviationRoi,
      sharpe_proxy: sharpeProxy,
      sortino_proxy: sortinoProxy,
      max_drawdown_usd: dd.usd,
      max_drawdown_pct: dd.pct,
      var_95_roi: var95,
      cvar_95_roi: cvar95,
    },

    distribution: {
      roi_p05: roiP05,
      roi_p50: roiP50,
      roi_p95: roiP95,
      skewness_roi: skewnessRoi,
      kurtosis_roi: kurtosisRoi,
      max_win_roi: maxWinRoi,
      max_loss_roi: maxLossRoi,
    },

    timing: {
      median_hold_minutes: medianHoldMinutes,
      avg_hold_minutes: avgHoldMinutes,
      p90_hold_minutes: p90HoldMinutes,
      pct_held_to_resolve: pctHeldToResolve,
      avg_time_to_resolve_at_entry_hours: avgTimeToResolveAtEntryHours,
    },

    edge: {
      avg_entry_price: avgEntryPrice,
      avg_win_entry_price: avgWinEntryPrice,
      avg_loss_entry_price: avgLossEntryPrice,
      avg_win_entry_edge: avgWinEntryEdge,
      skill_score: skillScore,
    },

    consistency: {
      position_size_cv: positionSizeCv,
      max_win_streak: maxWinStreak,
      max_loss_streak: maxLossStreak,
      roi_consistency: roiConsistency,
    },

    fingerprint: {
      maker_ratio: makerRatio,
      taker_ratio: takerRatioFp,
      position_concentration_hhi: positionHhi,
      avg_positions_per_day: avgPositionsPerDay,
      strategy_type: strategyType,
    },

    positions,
  };
}
