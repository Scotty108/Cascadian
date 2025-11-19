/**
 * Wallet Metrics Calculator
 *
 * Calculates P&L, ROI, win rate, Sharpe ratio, and Omega ratio for wallet positions.
 * Uses ClickHouse queries on validated Phase 1 data:
 * - trades_raw (80.1M rows)
 * - trades_with_direction (95.3M rows)
 * - market_resolutions_final (resolution data with payout vectors)
 */

import { ClickHouseClient } from '@clickhouse/client';

export interface MetricsCalculatorOptions {
  wallet: string;
  dateStart: string; // ISO date: 2022-06-01
  dateEnd: string;   // ISO date: 2025-11-10
}

export interface WalletMetrics {
  realized_pnl: number;
  unrealized_payout: number;
  roi_pct: number | null;
  win_rate: number;
  sharpe_ratio: number | null;
  omega_ratio: number | null;
  total_trades: number;
  markets_traded: number;
}

/**
 * Calculate realized P&L from trades (sum of cashflows)
 *
 * Realized P&L = sum of:
 * - For BUY trades: -USDC spent (negative for cost basis)
 * - For SELL trades: +USDC received (positive for proceeds)
 * - Net result: Positive for gains, negative for losses
 *
 * Uses trades_raw filtered by wallet and date range.
 */
export async function calculateRealizedPnL(
  ch: ClickHouseClient,
  options: MetricsCalculatorOptions
): Promise<number> {
  const query = `
    SELECT
      sum(toFloat64(cashflow_usdc)) as total_cashflow
    FROM default.trades_raw
    WHERE lower(wallet) = '${options.wallet.toLowerCase()}'
      AND block_time >= '${options.dateStart}'
      AND block_time < '${options.dateEnd}'
      AND condition_id NOT LIKE '%token_%'
  `;

  try {
    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (!data || data.length === 0) {
      return 0;
    }

    const cashflow = parseFloat(data[0]?.total_cashflow || '0');
    return isNaN(cashflow) ? 0 : cashflow;
  } catch (error: any) {
    console.error(`Error calculating realized P&L: ${error.message}`);
    return 0;
  }
}

/**
 * Calculate unrealized payout from resolved markets
 *
 * For each resolved market where wallet holds position:
 * unrealized_payout = net_shares × (payout_vector[winning_index + 1] / payout_denominator)
 *
 * Uses market_resolutions_final which contains:
 * - condition_id, winning_outcome_index, payout_numerators array, payout_denominator
 * - Joined with wallet positions to get net_shares
 */
export async function calculateUnrealizedPayout(
  ch: ClickHouseClient,
  options: MetricsCalculatorOptions
): Promise<number> {
  const query = `
    WITH wallet_positions AS (
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        outcome_index,
        SUM(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares))) as net_shares
      FROM default.trades_raw
      WHERE lower(wallet) = '${options.wallet.toLowerCase()}'
        AND block_time >= '${options.dateStart}'
        AND block_time < '${options.dateEnd}'
        AND condition_id NOT LIKE '%token_%'
      GROUP BY condition_id_norm, outcome_index
      HAVING net_shares != 0
    ),
    resolved_with_payout AS (
      SELECT
        wp.condition_id_norm,
        wp.net_shares,
        mr.winning_index,
        mr.payout_numerators,
        mr.payout_denominator,
        arrayElement(mr.payout_numerators, mr.winning_index + 1) as winning_payout
      FROM wallet_positions wp
      INNER JOIN default.market_resolutions_final mr
        ON wp.condition_id_norm = mr.condition_id_norm
      WHERE mr.payout_denominator != 0
    )
    SELECT
      sum(toFloat64(net_shares) * winning_payout / toFloat64(payout_denominator)) as total_unrealized_payout
    FROM resolved_with_payout
  `;

  try {
    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (!data || data.length === 0) {
      return 0;
    }

    const payout = parseFloat(data[0]?.total_unrealized_payout || '0');
    return isNaN(payout) ? 0 : payout;
  } catch (error: any) {
    console.error(`Error calculating unrealized payout: ${error.message}`);
    return 0;
  }
}

/**
 * Note: ROI calculation requires price column which is not available in trades_raw
 * ROI can be calculated when price data is available:
 * ROI% = (realized_pnl + unrealized_payout) / (sum of shares * price) × 100
 *
 * For now, use realized_pnl + unrealized_payout to calculate total P&L instead
 */

/**
 * Stub: ROI calculation (not implemented - requires price data)
 * Returns null as price data is not available in trades_raw
 */
export async function calculateROI(
  ch: ClickHouseClient,
  options: MetricsCalculatorOptions
): Promise<number | null> {
  return null;
}

/**
 * Calculate win rate
 *
 * win_rate = count(markets with positive P&L) / count(all resolved markets)
 * Range: [0, 1]
 *
 * Positive P&L = market payout exceeded cost basis
 */
export async function calculateWinRate(
  ch: ClickHouseClient,
  options: MetricsCalculatorOptions
): Promise<number> {
  const query = `
    WITH position_analysis AS (
      SELECT
        lower(replaceAll(tr.condition_id, '0x', '')) as condition_id_norm,
        tr.outcome_index,
        SUM(if(tr.trade_direction = 'BUY', toFloat64(tr.shares), -toFloat64(tr.shares))) as net_shares,
        SUM(toFloat64(tr.cashflow_usdc)) as total_cashflow,
        mr.winning_index,
        mr.payout_numerators,
        mr.payout_denominator
      FROM default.trades_raw tr
      LEFT JOIN default.market_resolutions_final mr
        ON lower(replaceAll(tr.condition_id, '0x', '')) = mr.condition_id_norm
      WHERE lower(tr.wallet) = '${options.wallet.toLowerCase()}'
        AND tr.block_time >= '${options.dateStart}'
        AND tr.block_time < '${options.dateEnd}'
        AND tr.condition_id NOT LIKE '%token_%'
      GROUP BY condition_id_norm, tr.outcome_index, mr.winning_index, mr.payout_numerators, mr.payout_denominator
    ),
    market_pnl AS (
      SELECT
        total_cashflow + if(net_shares != 0 AND winning_index IS NOT NULL,
          toFloat64(net_shares) * arrayElement(payout_numerators, winning_index + 1) / toFloat64(payout_denominator),
          0) as total_pnl
      FROM position_analysis
      WHERE winning_index IS NOT NULL
    )
    SELECT
      sum(if(total_pnl > 0, 1, 0)) as win_count,
      count() as total_markets
    FROM market_pnl
  `;

  try {
    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (!data || data.length === 0) {
      return 0;
    }

    const winCount = parseInt(data[0]?.win_count || '0');
    const totalMarkets = parseInt(data[0]?.total_markets || '1');

    const winRate = totalMarkets === 0 ? 0 : winCount / totalMarkets;
    return Math.max(0, Math.min(1, winRate)); // Clamp to [0, 1]
  } catch (error: any) {
    console.error(`Error calculating win rate: ${error.message}`);
    return 0;
  }
}

/**
 * Calculate Sharpe ratio
 *
 * Sharpe = (mean(daily_pnl)) / stddev(daily_pnl) × sqrt(252)
 *
 * Approximation: Group trades by day, calculate daily P&L, then:
 * - mean_daily_pnl = average daily P&L
 * - volatility = standard deviation of daily P&L
 * - Sharpe = (mean / volatility) × sqrt(252)  [252 = trading days in year]
 *
 * Returns NULL if insufficient data or zero volatility
 */
export async function calculateSharpeRatio(
  ch: ClickHouseClient,
  options: MetricsCalculatorOptions
): Promise<number | null> {
  const query = `
    WITH daily_pnl AS (
      SELECT
        toDate(block_time) as trading_date,
        sum(cashflow_usdc) as daily_cashflow
      FROM default.trades_raw
      WHERE lower(wallet) = '${options.wallet.toLowerCase()}'
        AND block_time >= '${options.dateStart}'
        AND block_time < '${options.dateEnd}'
        AND condition_id NOT LIKE '%token_%'
      GROUP BY trading_date
    ),
    stats AS (
      SELECT
        avg(daily_cashflow) as mean_daily_pnl,
        stddevPop(daily_cashflow) as volatility,
        count() as day_count
      FROM daily_pnl
    )
    SELECT
      CASE
        WHEN volatility = 0 OR volatility IS NULL THEN NULL
        WHEN day_count < 2 THEN NULL
        ELSE (mean_daily_pnl / volatility) * sqrt(252)
      END as sharpe_ratio
    FROM stats
  `;

  try {
    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (!data || data.length === 0 || data[0]?.sharpe_ratio === null) {
      return null;
    }

    const sharpe = parseFloat(data[0]?.sharpe_ratio || 'null');
    return isNaN(sharpe) ? null : sharpe;
  } catch (error: any) {
    console.error(`Error calculating Sharpe ratio: ${error.message}`);
    return null;
  }
}

/**
 * Calculate Omega ratio
 *
 * Omega = sum(positive PnL) / abs(sum(negative PnL))
 *
 * Threshold τ = 0 (no minimum threshold, just split at zero)
 * - Gains: daily P&L > 0
 * - Losses: daily P&L < 0
 * - Breakeven days: ignored
 *
 * Returns NULL if no gains, no losses, or division by zero
 * Range: [0, ∞)
 */
export async function calculateOmegaRatio(
  ch: ClickHouseClient,
  options: MetricsCalculatorOptions
): Promise<number | null> {
  const query = `
    WITH daily_pnl AS (
      SELECT
        toDate(block_time) as trading_date,
        sum(cashflow_usdc) as daily_cashflow
      FROM default.trades_raw
      WHERE lower(wallet) = '${options.wallet.toLowerCase()}'
        AND block_time >= '${options.dateStart}'
        AND block_time < '${options.dateEnd}'
        AND condition_id NOT LIKE '%token_%'
      GROUP BY trading_date
    ),
    gains_losses AS (
      SELECT
        sum(if(daily_cashflow > 0, daily_cashflow, 0)) as total_gains,
        sum(if(daily_cashflow < 0, abs(daily_cashflow), 0)) as total_losses
      FROM daily_pnl
    )
    SELECT
      CASE
        WHEN total_losses = 0 OR total_losses IS NULL THEN NULL
        WHEN total_gains = 0 THEN 0
        ELSE total_gains / total_losses
      END as omega_ratio
    FROM gains_losses
  `;

  try {
    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (!data || data.length === 0 || data[0]?.omega_ratio === null) {
      return null;
    }

    const omega = parseFloat(data[0]?.omega_ratio || 'null');
    return isNaN(omega) ? null : omega;
  } catch (error: any) {
    console.error(`Error calculating Omega ratio: ${error.message}`);
    return null;
  }
}

/**
 * Get basic activity metrics
 *
 * - total_trades: count of unique trades
 * - markets_traded: count of unique markets
 */
export async function getActivityMetrics(
  ch: ClickHouseClient,
  options: MetricsCalculatorOptions
): Promise<{ total_trades: number; markets_traded: number }> {
  const query = `
    SELECT
      count() as total_trades,
      COUNT(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets_traded
    FROM default.trades_raw
    WHERE lower(wallet) = '${options.wallet.toLowerCase()}'
      AND block_time >= '${options.dateStart}'
      AND block_time < '${options.dateEnd}'
      AND condition_id NOT LIKE '%token_%'
  `;

  try {
    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (!data || data.length === 0) {
      return { total_trades: 0, markets_traded: 0 };
    }

    return {
      total_trades: parseInt(data[0]?.total_trades as string || '0'),
      markets_traded: parseInt(data[0]?.markets_traded as string || '0')
    };
  } catch (error: any) {
    console.error(`Error getting activity metrics: ${error.message}`);
    return { total_trades: 0, markets_traded: 0 };
  }
}

/**
 * Calculate all wallet metrics in one pass
 *
 * Returns complete WalletMetrics object with all fields populated
 */
export async function calculateAllMetrics(
  ch: ClickHouseClient,
  options: MetricsCalculatorOptions
): Promise<WalletMetrics> {
  const [
    realized_pnl,
    unrealized_payout,
    roi_pct,
    win_rate,
    sharpe_ratio,
    omega_ratio,
    { total_trades, markets_traded }
  ] = await Promise.all([
    calculateRealizedPnL(ch, options),
    calculateUnrealizedPayout(ch, options),
    calculateROI(ch, options),
    calculateWinRate(ch, options),
    calculateSharpeRatio(ch, options),
    calculateOmegaRatio(ch, options),
    getActivityMetrics(ch, options)
  ]);

  return {
    realized_pnl,
    unrealized_payout,
    roi_pct,
    win_rate,
    sharpe_ratio,
    omega_ratio,
    total_trades,
    markets_traded
  };
}
