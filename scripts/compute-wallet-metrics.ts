#!/usr/bin/env tsx
/**
 * Compute Wallet Metrics - Phase 2 Implementation
 *
 * PURPOSE:
 * Computes TIER 1 critical wallet metrics across 4 time windows (30d, 90d, 180d, lifetime)
 * for all ~2,839 wallets with trading activity.
 *
 * TIER 1 METRICS IMPLEMENTED:
 * - metric_2_omega_net: Gains/losses after fees (Ω ratio)
 * - metric_6_sharpe: Mean return / total volatility
 * - metric_9_net_pnl_usd: Total net P&L in USD
 * - metric_12_hit_rate: Win rate (wins / total resolved)
 * - metric_13_avg_win_usd: Average profit on wins
 * - metric_14_avg_loss_usd: Average loss on losses
 * - metric_22_resolved_bets: Count of resolved trades
 * - metric_23_track_record_days: Days from first to last trade
 * - metric_24_bets_per_week: Average bets per week
 * - metric_48_omega_lag_30s: Omega with 30s latency (placeholder)
 * - metric_49_omega_lag_2min: Omega with 2min latency (placeholder)
 * - metric_60_tail_ratio: Avg(top 10% wins) / Avg(bottom 10% losses)
 * - metric_69_ev_per_hour_capital: EV / (hours_held * capital)
 * - metric_85_performance_trend_flag: improving/declining/stable
 * - metric_88_sizing_discipline_trend: Trend in sizing volatility
 * - Resolution accuracy: From wallet_resolution_outcomes
 *
 * OUTPUT:
 * - Populates wallet_metrics_complete table
 * - 4 rows per wallet (one per time window)
 *
 * USAGE:
 * npx tsx scripts/compute-wallet-metrics.ts
 *
 * DRY_RUN MODE:
 * DRY_RUN=1 npx tsx scripts/compute-wallet-metrics.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import { waitForNoPendingMutations } from '@/lib/clickhouse/mutations'

const isDryRun = process.env.DRY_RUN === '1'
const BATCH_SIZE = 500  // Process wallets in batches

interface TimeWindow {
  name: string
  days: number | null  // null for lifetime
}

const TIME_WINDOWS: TimeWindow[] = [
  { name: '30d', days: 30 },
  { name: '90d', days: 90 },
  { name: '180d', days: 180 },
  { name: 'lifetime', days: null }
]

interface WalletMetrics {
  wallet_address: string
  window: string
  calculated_at: Date
  trades_analyzed: number
  resolved_trades: number
  track_record_days: number
  raw_data_hash: string

  // TIER 1 Metrics
  metric_2_omega_net: number | null
  metric_6_sharpe: number | null
  metric_9_net_pnl_usd: number | null
  metric_12_hit_rate: number | null
  metric_13_avg_win_usd: number | null
  metric_14_avg_loss_usd: number | null
  metric_22_resolved_bets: number
  metric_23_track_record_days: number
  metric_24_bets_per_week: number | null
  metric_48_omega_lag_30s: number | null
  metric_49_omega_lag_2min: number | null
  metric_60_tail_ratio: number | null
  metric_69_ev_per_hour_capital: number | null
  metric_85_performance_trend_flag: string | null
  metric_88_sizing_discipline_trend: number | null

  // Additional computed metrics
  resolution_accuracy: number | null
}

/**
 * Verify wallet_metrics_complete table exists
 */
async function verifyMetricsTable() {
  console.log('📋 Verifying wallet_metrics_complete table...')

  if (isDryRun) {
    console.log('   [DRY_RUN] Would verify table exists')
    return
  }

  const result = await clickhouse.query({
    query: `SELECT count() as cnt FROM system.tables WHERE name = 'wallet_metrics_complete' AND database = currentDatabase()`,
    format: 'JSONEachRow'
  })

  const rows = await result.json<{ cnt: string }>()
  const exists = parseInt(rows[0].cnt) > 0

  if (!exists) {
    throw new Error('wallet_metrics_complete table does not exist! Run migration 004 first.')
  }

  console.log('   ✅ Table exists')
}

/**
 * Get all unique wallet addresses
 */
async function getAllWallets(): Promise<string[]> {
  console.log('\n📊 Fetching all wallet addresses...')

  if (isDryRun) {
    console.log('   [DRY_RUN] Would fetch wallets')
    return []
  }

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet_address
      FROM trades_raw
      WHERE market_id != ''
      ORDER BY wallet_address
    `,
    format: 'JSONEachRow'
  })

  const wallets = await result.json<{ wallet_address: string }>()
  console.log(`   ✅ Found ${wallets.length} wallets`)

  return wallets.map(w => w.wallet_address)
}

/**
 * Compute all TIER 1 metrics for a time window
 */
async function computeMetricsForWindow(window: TimeWindow, wallets: string[]): Promise<WalletMetrics[]> {
  console.log(`\n📊 Computing TIER 1 metrics for ${window.name}...`)

  // Build time filter
  const timeFilter = window.days
    ? `AND timestamp >= now() - INTERVAL ${window.days} DAY`
    : ''

  if (isDryRun) {
    console.log(`   [DRY_RUN] Would compute metrics with filter: ${timeFilter || 'none (lifetime)'}`)
    return []
  }

  const startTime = Date.now()
  const allMetrics: WalletMetrics[] = []

  // Process wallets in batches to avoid memory issues
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, Math.min(i + BATCH_SIZE, wallets.length))
    const walletList = batch.map(w => `'${w}'`).join(',')

    console.log(`   Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(wallets.length / BATCH_SIZE)} (wallets ${i + 1}-${Math.min(i + BATCH_SIZE, wallets.length)})...`)

    // Main metrics query
    const query = `
      SELECT
        wallet_address,
        '${window.name}' as window,
        now() as calculated_at,

        -- Metadata
        COUNT(*) as trades_analyzed,
        CAST(SUM(is_resolved) AS UInt32) as resolved_trades,
        CAST(dateDiff('day', MIN(timestamp), MAX(timestamp)) AS UInt16) as track_record_days,
        '' as raw_data_hash,

        -- metric_9: Net P&L in USD (sum of all realized P&L)
        CAST(SUM(CASE WHEN is_resolved = 1 THEN realized_pnl_usd ELSE 0 END) AS Nullable(Decimal(18, 2))) as metric_9_net_pnl_usd,

        -- metric_22: Count of resolved bets
        CAST(SUM(is_resolved) AS UInt32) as metric_22_resolved_bets,

        -- metric_23: Track record in days
        CAST(dateDiff('day', MIN(timestamp), MAX(timestamp)) AS UInt16) as metric_23_track_record_days,

        -- metric_24: Bets per week = resolved_bets / (track_record_days / 7)
        -- Use GREATEST(1, days) to avoid division by zero
        CAST(
          CASE
            WHEN dateDiff('day', MIN(timestamp), MAX(timestamp)) >= 0
            THEN SUM(is_resolved) / (GREATEST(1, dateDiff('day', MIN(timestamp), MAX(timestamp))) / 7.0)
            ELSE NULL
          END
          AS Nullable(Decimal(10, 2))
        ) as metric_24_bets_per_week,

        -- metric_2_omega_net: gains / losses after fees
        -- Omega = SUM(gains) / SUM(|losses|)
        -- Cap at 99999 to prevent overflow
        CAST(
          CASE
            WHEN SUM(CASE WHEN is_resolved = 1 AND realized_pnl_usd < 0 THEN -realized_pnl_usd ELSE 0 END) > 0
            THEN
              LEAST(99999.9999,
                SUM(CASE WHEN is_resolved = 1 AND realized_pnl_usd > 0 THEN realized_pnl_usd ELSE 0 END) /
                NULLIF(SUM(CASE WHEN is_resolved = 1 AND realized_pnl_usd < 0 THEN -realized_pnl_usd ELSE 0 END), 0)
              )
            ELSE NULL
          END
          AS Nullable(Decimal(12, 4))
        ) as metric_2_omega_net,

        -- metric_12_hit_rate: win rate = wins / total resolved
        CAST(
          CASE
            WHEN SUM(is_resolved) > 0
            THEN SUM(CASE WHEN is_resolved = 1 AND realized_pnl_usd > 0 THEN 1 ELSE 0 END) / CAST(SUM(is_resolved) AS Float64)
            ELSE NULL
          END
          AS Nullable(Decimal(5, 4))
        ) as metric_12_hit_rate,

        -- metric_13_avg_win_usd: average profit on winning trades
        CAST(
          AVG(CASE WHEN is_resolved = 1 AND realized_pnl_usd > 0 THEN realized_pnl_usd ELSE NULL END)
          AS Nullable(Decimal(18, 2))
        ) as metric_13_avg_win_usd,

        -- metric_14_avg_loss_usd: average loss on losing trades (negative value)
        CAST(
          AVG(CASE WHEN is_resolved = 1 AND realized_pnl_usd < 0 THEN realized_pnl_usd ELSE NULL END)
          AS Nullable(Decimal(18, 2))
        ) as metric_14_avg_loss_usd,

        -- metric_6_sharpe: Mean return / stddev of returns
        -- Cap at 99999 to prevent overflow
        CAST(
          CASE
            WHEN stddevPop(CASE WHEN is_resolved = 1 THEN realized_pnl_usd ELSE NULL END) > 0
            THEN
              LEAST(99999.9999,
                AVG(CASE WHEN is_resolved = 1 THEN realized_pnl_usd ELSE NULL END) /
                NULLIF(stddevPop(CASE WHEN is_resolved = 1 THEN realized_pnl_usd ELSE NULL END), 0)
              )
            ELSE NULL
          END
          AS Nullable(Decimal(12, 4))
        ) as metric_6_sharpe,

        -- metric_69_ev_per_hour_capital: EV / (hours_held * capital)
        -- Simplified: average P&L per hour held
        CAST(
          CASE
            WHEN SUM(CASE WHEN is_resolved = 1 AND hours_held > 0 THEN hours_held ELSE 0 END) > 0
            THEN
              SUM(CASE WHEN is_resolved = 1 THEN realized_pnl_usd ELSE 0 END) /
              NULLIF(SUM(CASE WHEN is_resolved = 1 AND hours_held > 0 THEN hours_held ELSE 0 END), 0)
            ELSE NULL
          END
          AS Nullable(Decimal(18, 6))
        ) as metric_69_ev_per_hour_capital,

        -- metric_88_sizing_discipline_trend: Stddev of position sizes (lower = more disciplined)
        CAST(
          stddevPop(CASE WHEN is_resolved = 1 THEN usd_value ELSE NULL END)
          AS Nullable(Decimal(12, 6))
        ) as metric_88_sizing_discipline_trend,

        -- Placeholder for latency metrics (need price history data)
        CAST(NULL AS Nullable(Decimal(12, 4))) as metric_48_omega_lag_30s,
        CAST(NULL AS Nullable(Decimal(12, 4))) as metric_49_omega_lag_2min,

        -- Placeholder for tail ratio (computed separately)
        CAST(NULL AS Nullable(Decimal(10, 4))) as metric_60_tail_ratio,

        -- Placeholder for performance trend (computed separately)
        CAST(NULL AS Nullable(String)) as metric_85_performance_trend_flag,

        -- Placeholder for resolution accuracy (computed separately)
        CAST(NULL AS Nullable(Decimal(5, 4))) as resolution_accuracy

      FROM trades_raw
      WHERE wallet_address IN (${walletList})
        ${timeFilter}
      GROUP BY wallet_address
      HAVING resolved_trades > 0
      ORDER BY wallet_address
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })

    const batchMetrics = await result.json<WalletMetrics>()
    allMetrics.push(...batchMetrics)
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`   ✅ Computed base metrics for ${allMetrics.length} wallets in ${duration}s`)

  // Now enrich with additional computed metrics
  if (allMetrics.length > 0) {
    await enrichTailRatios(allMetrics, window, timeFilter)
    await enrichResolutionAccuracy(allMetrics, window)
    await enrichPerformanceTrend(allMetrics, window, timeFilter)
  }

  return allMetrics
}

/**
 * Compute tail ratios separately (requires percentile calculation)
 */
async function enrichTailRatios(metrics: WalletMetrics[], window: TimeWindow, timeFilter: string) {
  console.log(`   📊 Computing tail ratios for ${window.name}...`)

  if (isDryRun) {
    return
  }

  const startTime = Date.now()

  try {
    // Get wallets list
    const walletList = metrics.map(m => `'${m.wallet_address}'`).join(',')

    // Compute tail ratios using window functions
    const query = `
      WITH
        wallet_trades AS (
          SELECT
            wallet_address,
            realized_pnl_usd,
            row_number() OVER (PARTITION BY wallet_address ORDER BY realized_pnl_usd DESC) as win_rank,
            row_number() OVER (PARTITION BY wallet_address ORDER BY realized_pnl_usd ASC) as loss_rank,
            count() OVER (PARTITION BY wallet_address) as total_trades
          FROM trades_raw
          WHERE is_resolved = 1
            AND wallet_address IN (${walletList})
            ${timeFilter}
        ),
        top_10_wins AS (
          SELECT
            wallet_address,
            AVG(realized_pnl_usd) as avg_top_win
          FROM wallet_trades
          WHERE realized_pnl_usd > 0
            AND win_rank <= GREATEST(1, CAST(total_trades * 0.1 AS UInt32))
          GROUP BY wallet_address
        ),
        bottom_10_losses AS (
          SELECT
            wallet_address,
            AVG(realized_pnl_usd) as avg_bottom_loss
          FROM wallet_trades
          WHERE realized_pnl_usd < 0
            AND loss_rank <= GREATEST(1, CAST(total_trades * 0.1 AS UInt32))
          GROUP BY wallet_address
        )
      SELECT
        w.wallet_address,
        CAST(
          LEAST(9999.9999, w.avg_top_win / NULLIF(ABS(l.avg_bottom_loss), 0))
          AS Decimal(10, 4)
        ) as tail_ratio
      FROM top_10_wins w
      INNER JOIN bottom_10_losses l ON w.wallet_address = l.wallet_address
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })

    const tailRatios = await result.json<{ wallet_address: string, tail_ratio: number }>()
    const tailRatioMap = new Map(tailRatios.map(t => [t.wallet_address, t.tail_ratio]))

    for (const metric of metrics) {
      const tailRatio = tailRatioMap.get(metric.wallet_address)
      if (tailRatio !== undefined) {
        metric.metric_60_tail_ratio = tailRatio
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`   ✅ Computed ${tailRatios.length} tail ratios in ${duration}s`)
  } catch (error) {
    console.log(`   ⚠️  Failed to compute tail ratios: ${error}`)
  }
}

/**
 * Enrich with resolution accuracy from wallet_resolution_outcomes
 */
async function enrichResolutionAccuracy(metrics: WalletMetrics[], window: TimeWindow) {
  console.log(`   📊 Computing resolution accuracy for ${window.name}...`)

  if (isDryRun) {
    return
  }

  const startTime = Date.now()

  try {
    const walletList = metrics.map(m => `'${m.wallet_address}'`).join(',')

    // Build time filter for resolution outcomes
    const timeFilter = window.days
      ? `AND resolved_at >= now() - INTERVAL ${window.days} DAY`
      : ''

    const query = `
      SELECT
        wallet_address,
        CAST(AVG(won) * 100 AS Decimal(5, 4)) as accuracy_pct
      FROM wallet_resolution_outcomes
      WHERE wallet_address IN (${walletList})
        ${timeFilter}
      GROUP BY wallet_address
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })

    const accuracies = await result.json<{ wallet_address: string, accuracy_pct: number }>()
    const accuracyMap = new Map(accuracies.map(a => [a.wallet_address, a.accuracy_pct]))

    for (const metric of metrics) {
      const accuracy = accuracyMap.get(metric.wallet_address)
      if (accuracy !== undefined) {
        metric.resolution_accuracy = accuracy
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`   ✅ Computed ${accuracies.length} resolution accuracies in ${duration}s`)
  } catch (error) {
    console.log(`   ⚠️  Failed to compute resolution accuracy: ${error}`)
  }
}

/**
 * Determine performance trend (improving/declining/stable)
 */
async function enrichPerformanceTrend(metrics: WalletMetrics[], window: TimeWindow, timeFilter: string) {
  console.log(`   📊 Computing performance trends for ${window.name}...`)

  if (isDryRun) {
    return
  }

  // Only compute trends for 90d and lifetime windows (need enough data)
  if (window.name === '30d') {
    return
  }

  const startTime = Date.now()

  try {
    const walletList = metrics.map(m => `'${m.wallet_address}'`).join(',')

    // Split into two periods and compare omega ratios
    const splitDays = window.days ? Math.floor(window.days / 2) : 90

    const query = `
      WITH
        first_half AS (
          SELECT
            wallet_address,
            SUM(CASE WHEN realized_pnl_usd > 0 THEN realized_pnl_usd ELSE 0 END) /
              NULLIF(SUM(CASE WHEN realized_pnl_usd < 0 THEN -realized_pnl_usd ELSE 0 END), 0) as omega_first
          FROM trades_raw
          WHERE is_resolved = 1
            AND wallet_address IN (${walletList})
            ${window.days ? `AND timestamp >= now() - INTERVAL ${window.days} DAY AND timestamp < now() - INTERVAL ${splitDays} DAY` : `AND timestamp < (SELECT MAX(timestamp) FROM trades_raw) - INTERVAL ${splitDays} DAY`}
          GROUP BY wallet_address
        ),
        second_half AS (
          SELECT
            wallet_address,
            SUM(CASE WHEN realized_pnl_usd > 0 THEN realized_pnl_usd ELSE 0 END) /
              NULLIF(SUM(CASE WHEN realized_pnl_usd < 0 THEN -realized_pnl_usd ELSE 0 END), 0) as omega_second
          FROM trades_raw
          WHERE is_resolved = 1
            AND wallet_address IN (${walletList})
            ${window.days ? `AND timestamp >= now() - INTERVAL ${splitDays} DAY` : `AND timestamp >= (SELECT MAX(timestamp) FROM trades_raw) - INTERVAL ${splitDays} DAY`}
          GROUP BY wallet_address
        )
      SELECT
        f.wallet_address,
        CASE
          WHEN s.omega_second IS NULL OR f.omega_first IS NULL THEN 'stable'
          WHEN s.omega_second > f.omega_first * 1.2 THEN 'improving'
          WHEN s.omega_second < f.omega_first * 0.8 THEN 'declining'
          ELSE 'stable'
        END as trend
      FROM first_half f
      LEFT JOIN second_half s ON f.wallet_address = s.wallet_address
      UNION ALL
      SELECT
        s.wallet_address,
        CASE
          WHEN s.omega_second IS NULL OR f.omega_first IS NULL THEN 'stable'
          WHEN s.omega_second > f.omega_first * 1.2 THEN 'improving'
          WHEN s.omega_second < f.omega_first * 0.8 THEN 'declining'
          ELSE 'stable'
        END as trend
      FROM second_half s
      LEFT JOIN first_half f ON s.wallet_address = f.wallet_address
      WHERE f.wallet_address IS NULL
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })

    const trends = await result.json<{ wallet_address: string, trend: string }>()
    const trendMap = new Map(trends.map(t => [t.wallet_address, t.trend]))

    for (const metric of metrics) {
      const trend = trendMap.get(metric.wallet_address) || 'stable'
      metric.metric_85_performance_trend_flag = trend
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`   ✅ Computed ${trends.length} performance trends in ${duration}s`)
  } catch (error) {
    console.log(`   ⚠️  Failed to compute performance trends: ${error}`)
  }
}

/**
 * Insert computed metrics into wallet_metrics_complete
 */
async function insertMetrics(window: TimeWindow, metrics: WalletMetrics[]) {
  console.log(`\n💾 Inserting ${metrics.length} metric rows for ${window.name}...`)

  if (isDryRun) {
    console.log('   [DRY_RUN] Would insert metrics')
    if (metrics.length > 0) {
      console.log('   Sample metric (first wallet):')
      console.log(JSON.stringify(metrics[0], null, 2))
    }
    return
  }

  if (metrics.length === 0) {
    console.log('   ⚠️  No metrics to insert')
    return
  }

  // Transform metrics to match table schema (all 102 columns, most NULL)
  const rows = metrics.map(m => ({
    wallet_address: m.wallet_address,
    window: m.window,
    calculated_at: m.calculated_at,
    trades_analyzed: m.trades_analyzed,
    resolved_trades: m.resolved_trades,
    track_record_days: m.track_record_days,
    raw_data_hash: m.raw_data_hash,

    // TIER 1 metrics (implemented)
    metric_1_omega_gross: null,
    metric_2_omega_net: m.metric_2_omega_net,
    metric_3_gain_to_pain: null,
    metric_4_profit_factor: null,
    metric_5_sortino: null,
    metric_6_sharpe: m.metric_6_sharpe,
    metric_7_martin: null,
    metric_8_calmar: null,
    metric_9_net_pnl_usd: m.metric_9_net_pnl_usd,
    metric_10_net_pnl_pct: null,
    metric_11_cagr: null,
    metric_12_hit_rate: m.metric_12_hit_rate,
    metric_13_avg_win_usd: m.metric_13_avg_win_usd,
    metric_14_avg_loss_usd: m.metric_14_avg_loss_usd,
    metric_15_ev_per_bet_mean: null,
    metric_16_ev_per_bet_median: null,
    metric_17_max_drawdown: null,
    metric_18_avg_drawdown: null,
    metric_19_time_in_drawdown_pct: null,
    metric_20_ulcer_index: null,
    metric_21_drawdown_recovery_days: null,
    metric_22_resolved_bets: m.metric_22_resolved_bets,
    metric_23_track_record_days: m.metric_23_track_record_days,
    metric_24_bets_per_week: m.metric_24_bets_per_week,

    // Metrics 25-47: NULL (TIER 2-3)
    metric_25_brier_score: null,
    metric_26_log_score: null,
    metric_27_calibration_slope: null,
    metric_28_calibration_intercept: null,
    metric_29_calibration_error: null,
    metric_30_clv_mean: null,
    metric_31_clv_median: null,
    metric_32_clv_positive_pct: null,
    metric_33_orderbook_participation_pct: null,
    metric_34_maker_taker_ratio: null,
    metric_35_var_95: null,
    metric_36_downside_deviation: null,
    metric_37_cvar_95: null,
    metric_38_max_single_trade_loss_pct: null,
    metric_39_avg_holding_period_hours: null,
    metric_40_median_holding_period_hours: null,
    metric_41_category_mix_json: '',
    metric_42_category_hhi: null,
    metric_43_concentration_hhi: null,
    metric_44_stake_sizing_volatility: null,
    metric_45_avg_stake_pct: null,
    metric_46_max_stake_pct: null,
    metric_47_min_stake_pct: null,

    // Latency metrics (TIER 1 - placeholders for now)
    metric_48_omega_lag_30s: m.metric_48_omega_lag_30s,
    metric_49_omega_lag_2min: m.metric_49_omega_lag_2min,
    metric_50_omega_lag_5min: null,
    metric_51_clv_lag_30s: null,
    metric_52_clv_lag_2min: null,
    metric_53_clv_lag_5min: null,
    metric_54_edge_half_life_hours: null,
    metric_55_latency_penalty_index: null,

    // Momentum metrics
    metric_56_omega_momentum_30d: null,
    metric_57_omega_momentum_90d: null,
    metric_58_pnl_trend_30d: null,
    metric_59_pnl_acceleration: null,

    // Return distribution (TIER 1)
    metric_60_tail_ratio: m.metric_60_tail_ratio,
    metric_61_skewness: null,
    metric_62_kurtosis: null,

    // Kelly & sizing
    metric_63_kelly_utilization_pct: null,
    metric_64_risk_of_ruin_approx: null,

    // Capital efficiency (TIER 1)
    metric_65_return_on_capital: null,
    metric_66_capital_turnover: null,
    metric_67_news_shock_ev_5min: null,
    metric_68_crowd_orthogonality: null,
    metric_69_ev_per_hour_capital: m.metric_69_ev_per_hour_capital,

    // Cost analysis
    metric_70_gross_to_net_ratio: null,
    metric_71_fee_per_bet: null,
    metric_72_fee_burden_pct: null,
    metric_73_slippage_per_bet: null,

    // Streaks
    metric_74_longest_win_streak: null,
    metric_75_longest_loss_streak: null,
    metric_76_current_streak_length: null,
    metric_77_streak_consistency: null,

    // Time patterns
    metric_78_weekday_vs_weekend_roi: null,
    metric_79_integrity_deposit_pnl: null,
    metric_80_avg_time_to_resolution_days: null,
    metric_81_early_vs_late_roi: null,

    // Recent momentum (TIER 1)
    metric_82_clv_momentum_30d: null,
    metric_83_ev_hr_momentum_30d: null,
    metric_84_drawdown_trend_60d: null,
    metric_85_performance_trend_flag: m.metric_85_performance_trend_flag,
    metric_86_hot_hand_z_score: null,

    // Discipline (TIER 1)
    metric_87_bet_frequency_variance: null,
    metric_88_sizing_discipline_trend: m.metric_88_sizing_discipline_trend,

    // Per-category JSON
    metric_89_clv_by_category_json: '',
    metric_90_omega_lag_by_category_json: '',
    metric_91_calibration_by_category_json: '',
    metric_92_ev_hr_by_category_json: '',

    // Market microstructure (TIER 3)
    metric_93_news_reaction_time_median_sec: null,
    metric_94_event_archetype_edge_json: '',
    metric_95_spread_capture_ratio: null,
    metric_96_adverse_selection_cost: null,
    metric_97_price_impact_per_k: null,
    metric_98_yes_no_bias_pct: null,
    metric_99_liquidity_access_skill: null,
    metric_100_news_latency_distribution_json: '',
    metric_101_alpha_source_timing_pct: null,
    metric_102_edge_source_decomp_json: ''
  }))

  const startTime = Date.now()

  // Insert in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length))

    await clickhouse.insert({
      table: 'wallet_metrics_complete',
      values: batch,
      format: 'JSONEachRow'
    })

    console.log(`   Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)}`)
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`   ✅ Inserted ${rows.length} rows in ${duration}s`)
}

/**
 * Generate summary report
 */
async function generateReport() {
  console.log('\n📊 GENERATING SUMMARY REPORT...\n')

  if (isDryRun) {
    console.log('[DRY_RUN] Would generate report')
    return
  }

  // Top 10 wallets by Omega ratio (lifetime)
  const topOmega = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        metric_2_omega_net as omega,
        metric_9_net_pnl_usd as pnl,
        metric_12_hit_rate as win_rate,
        metric_22_resolved_bets as trades,
        metric_60_tail_ratio as tail_ratio,
        metric_6_sharpe as sharpe
      FROM wallet_metrics_complete
      WHERE window = 'lifetime'
        AND metric_2_omega_net IS NOT NULL
        AND metric_22_resolved_bets >= 10
      ORDER BY metric_2_omega_net DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })

  const topWallets = await topOmega.json<any>()

  console.log('═'.repeat(90))
  console.log('TOP 10 WALLETS BY OMEGA RATIO (Lifetime)')
  console.log('═'.repeat(90))
  console.log('Wallet Address                               Omega    P&L       Win%   Trades  Sharpe   Tail')
  console.log('─'.repeat(90))

  for (const w of topWallets) {
    const addr = w.wallet_address.slice(0, 42).padEnd(42)
    const omega = (w.omega || 0).toFixed(2).padStart(7)
    const pnl = `$${(w.pnl || 0).toFixed(0)}`.padStart(9)
    const winRate = `${((w.win_rate || 0) * 100).toFixed(1)}%`.padStart(6)
    const trades = String(w.trades || 0).padStart(6)
    const sharpe = (w.sharpe || 0).toFixed(2).padStart(7)
    const tail = (w.tail_ratio || 0).toFixed(2).padStart(6)
    console.log(`${addr} ${omega} ${pnl} ${winRate} ${trades} ${sharpe} ${tail}`)
  }

  // Overall statistics
  const stats = await clickhouse.query({
    query: `
      SELECT
        window,
        count() as wallet_count,
        avg(metric_2_omega_net) as avg_omega,
        avg(metric_9_net_pnl_usd) as avg_pnl,
        avg(metric_12_hit_rate) as avg_win_rate,
        avg(metric_22_resolved_bets) as avg_trades
      FROM wallet_metrics_complete
      WHERE metric_2_omega_net IS NOT NULL
      GROUP BY window
      ORDER BY
        CASE window
          WHEN '30d' THEN 1
          WHEN '90d' THEN 2
          WHEN '180d' THEN 3
          WHEN 'lifetime' THEN 4
        END
    `,
    format: 'JSONEachRow'
  })

  const windowStats = await stats.json<any>()

  console.log('\n═'.repeat(80))
  console.log('AVERAGE METRICS BY TIME WINDOW')
  console.log('═'.repeat(80))
  console.log('Window    Wallets  Avg Omega  Avg P&L   Avg Win%  Avg Trades')
  console.log('─'.repeat(80))

  for (const s of windowStats) {
    const window = s.window.padEnd(9)
    const wallets = String(s.wallet_count).padStart(7)
    const omega = (s.avg_omega || 0).toFixed(2).padStart(10)
    const pnl = `$${(s.avg_pnl || 0).toFixed(0)}`.padStart(9)
    const winRate = `${((s.avg_win_rate || 0) * 100).toFixed(1)}%`.padStart(9)
    const trades = (s.avg_trades || 0).toFixed(0).padStart(11)
    console.log(`${window} ${wallets} ${omega} ${pnl} ${winRate} ${trades}`)
  }

  console.log('═'.repeat(80))
}

/**
 * Main execution
 */
export async function main() {
  const startTime = Date.now()

  console.log('═'.repeat(80))
  console.log('       COMPUTE WALLET METRICS - PHASE 2 (TIER 1)')
  console.log('═'.repeat(80))

  if (isDryRun) {
    console.log('   ⚠️  DRY_RUN MODE - No changes will be made\n')
  } else {
    console.log('')
  }

  // Verify table exists
  await verifyMetricsTable()

  // Wait for any pending mutations before starting
  if (!isDryRun) {
    console.log('\n⏳ Waiting for pending mutations...')
    await waitForNoPendingMutations({ verbose: true })
  }

  // Get all wallets
  const wallets = await getAllWallets()

  let totalMetricsInserted = 0

  // Process each time window
  for (const window of TIME_WINDOWS) {
    console.log(`\n${'═'.repeat(80)}`)
    console.log(`PROCESSING WINDOW: ${window.name}`)
    console.log('═'.repeat(80))

    // Compute all metrics for this window
    const metrics = await computeMetricsForWindow(window, wallets)

    // Insert into table
    await insertMetrics(window, metrics)

    if (metrics.length > 0) {
      totalMetricsInserted += metrics.length
    }
  }

  // Generate report
  await generateReport()

  // Final summary
  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  console.log('\n' + '═'.repeat(80))
  console.log('✅ WALLET METRICS COMPUTATION COMPLETE!')
  console.log('═'.repeat(80))
  console.log(`   Total time: ${totalDuration} minutes`)
  console.log(`   Unique wallets: ${wallets.length}`)
  console.log(`   Total metric rows: ${totalMetricsInserted}`)
  console.log(`   Time windows: ${TIME_WINDOWS.map(w => w.name).join(', ')}`)
  console.log('\n   TIER 1 Metrics Implemented:')
  console.log('   ✅ metric_2_omega_net: Gains/losses ratio')
  console.log('   ✅ metric_6_sharpe: Risk-adjusted returns')
  console.log('   ✅ metric_9_net_pnl_usd: Total P&L')
  console.log('   ✅ metric_12_hit_rate: Win rate')
  console.log('   ✅ metric_13_avg_win_usd: Average win')
  console.log('   ✅ metric_14_avg_loss_usd: Average loss')
  console.log('   ✅ metric_22_resolved_bets: Trade count')
  console.log('   ✅ metric_23_track_record_days: Activity period')
  console.log('   ✅ metric_24_bets_per_week: Activity rate')
  console.log('   ✅ metric_60_tail_ratio: Win/loss distribution')
  console.log('   ✅ metric_69_ev_per_hour_capital: Capital efficiency')
  console.log('   ✅ metric_85_performance_trend_flag: Performance trend')
  console.log('   ✅ metric_88_sizing_discipline_trend: Sizing consistency')
  console.log('   ✅ Resolution accuracy: Prediction correctness')
  console.log('═'.repeat(80))

  if (isDryRun) {
    console.log('\nThis was a DRY_RUN. To execute for real:')
    console.log('   npx tsx scripts/compute-wallet-metrics.ts\n')
  } else {
    console.log('\n📊 Next steps:')
    console.log('   1. Query top wallets: SELECT * FROM wallet_metrics_complete WHERE window = \'lifetime\' ORDER BY metric_2_omega_net DESC LIMIT 10')
    console.log('   2. Build leaderboard UI using these metrics')
    console.log('   3. Implement TIER 2 metrics (calibration, CLV, etc.)\n')
  }
}

// Auto-execute when run directly
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })
}
