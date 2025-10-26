import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

/**
 * ============================================================================
 * TIER 1 METRICS CALCULATOR
 * ============================================================================
 *
 * Calculates the 8 most critical metrics from enriched trades in ClickHouse.
 * Populates wallet_metrics_complete table for 4 time windows:
 *   - 30d, 90d, 180d, lifetime
 *
 * TIER 1 METRICS (8 total):
 * 1. metric_1_omega_gross   - Gains/losses before fees
 * 2. metric_2_omega_net     - Gains/losses after fees (PRIMARY ranking metric)
 * 3. metric_9_net_pnl_usd   - Total profit/loss in USD
 * 4. metric_12_hit_rate     - Win rate (0.0 to 1.0)
 * 5. metric_13_avg_win_usd  - Average winning trade size
 * 6. metric_14_avg_loss_usd - Average losing trade size
 * 7. metric_15_ev_per_bet_mean - Expected value per trade
 * 8. metric_22_resolved_bets - Count of resolved positions
 *
 * Data Source: trades_raw table (after enrichment with pnl_net, pnl_gross, outcome)
 * ============================================================================
 */

type TimeWindow = '30d' | '90d' | '180d' | 'lifetime'

interface Tier1Metrics {
  wallet_address: string
  window: TimeWindow
  metric_1_omega_gross: number | null
  metric_2_omega_net: number | null
  metric_9_net_pnl_usd: number
  metric_12_hit_rate: number
  metric_13_avg_win_usd: number | null
  metric_14_avg_loss_usd: number | null
  metric_15_ev_per_bet_mean: number
  metric_22_resolved_bets: number
  calculated_at: Date
  trades_analyzed: number
  resolved_trades: number
}

interface BatchProgress {
  window: TimeWindow
  totalWallets: number
  processedWallets: number
  startTime: number
}

// Window filters for SQL queries
const WINDOW_FILTERS: Record<TimeWindow, string> = {
  '30d': 'timestamp >= now() - INTERVAL 30 DAY',
  '90d': 'timestamp >= now() - INTERVAL 90 DAY',
  '180d': 'timestamp >= now() - INTERVAL 180 DAY',
  'lifetime': '1=1', // No time filter
}

// Window enum values for ClickHouse Enum8
const WINDOW_ENUM: Record<TimeWindow, number> = {
  '30d': 1,
  '90d': 2,
  '180d': 3,
  'lifetime': 4,
}

/**
 * Calculate Tier 1 metrics for a specific time window
 */
async function calculateTier1Metrics(window: TimeWindow): Promise<Tier1Metrics[]> {
  console.log(`\n📊 Calculating Tier 1 metrics for ${window} window...`)

  const windowFilter = WINDOW_FILTERS[window]
  const startTime = Date.now()

  try {
    // Query ClickHouse for aggregated metrics per wallet
    const query = `
      SELECT
        wallet_address,

        -- Metric 1: Omega Gross (gains/losses before fees)
        sumIf(pnl_gross, pnl_gross > 0) / nullIf(sumIf(abs(pnl_gross), pnl_gross <= 0), 0) as metric_1_omega_gross,

        -- Metric 2: Omega Net (PRIMARY ranking metric - gains/losses after fees)
        sumIf(pnl_net, pnl_net > 0) / nullIf(sumIf(abs(pnl_net), pnl_net <= 0), 0) as metric_2_omega_net,

        -- Metric 9: Net PnL (total profit/loss)
        sum(pnl_net) as metric_9_net_pnl_usd,

        -- Metric 12: Hit Rate (win rate)
        countIf(pnl_net > 0) / nullIf(count(*), 0) as metric_12_hit_rate,

        -- Metric 13: Average Win Size
        avgIf(pnl_net, pnl_net > 0) as metric_13_avg_win_usd,

        -- Metric 14: Average Loss Size (absolute value)
        avgIf(abs(pnl_net), pnl_net <= 0) as metric_14_avg_loss_usd,

        -- Metric 15: Expected Value per Bet
        avg(pnl_net) as metric_15_ev_per_bet_mean,

        -- Metric 22: Resolved Bets Count
        count(*) as metric_22_resolved_bets,

        -- Additional tracking fields
        count(*) as trades_analyzed,
        count(*) as resolved_trades,

        -- Timestamp
        now() as calculated_at

      FROM trades_raw
      WHERE is_closed = true
        AND outcome IS NOT NULL
        AND ${windowFilter}
      GROUP BY wallet_address
      HAVING metric_22_resolved_bets >= 5  -- Minimum 5 trades for statistical significance
      ORDER BY metric_2_omega_net DESC
    `

    console.log(`   🔍 Executing query for ${window} window...`)
    console.log(`   📋 Filter: ${windowFilter}`)

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const metrics = (await result.json()) as Array<{
      wallet_address: string
      metric_1_omega_gross: number | null
      metric_2_omega_net: number | null
      metric_9_net_pnl_usd: number
      metric_12_hit_rate: number
      metric_13_avg_win_usd: number | null
      metric_14_avg_loss_usd: number | null
      metric_15_ev_per_bet_mean: number
      metric_22_resolved_bets: number
      trades_analyzed: number
      resolved_trades: number
      calculated_at: string
    }>

    console.log(`   ✅ Calculated metrics for ${metrics.length} wallets`)

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`   ⏱️  Query completed in ${duration}s`)

    // Transform to Tier1Metrics format
    return metrics.map((m) => ({
      wallet_address: m.wallet_address,
      window,
      metric_1_omega_gross: m.metric_1_omega_gross,
      metric_2_omega_net: m.metric_2_omega_net,
      metric_9_net_pnl_usd: m.metric_9_net_pnl_usd,
      metric_12_hit_rate: m.metric_12_hit_rate,
      metric_13_avg_win_usd: m.metric_13_avg_win_usd,
      metric_14_avg_loss_usd: m.metric_14_avg_loss_usd,
      metric_15_ev_per_bet_mean: m.metric_15_ev_per_bet_mean,
      metric_22_resolved_bets: m.metric_22_resolved_bets,
      calculated_at: new Date(m.calculated_at),
      trades_analyzed: m.trades_analyzed,
      resolved_trades: m.resolved_trades,
    }))
  } catch (error) {
    console.error(`   ❌ Error calculating metrics for ${window}:`, error)
    throw error
  }
}

/**
 * Insert metrics into wallet_metrics_complete table in batches
 */
async function insertMetricsBatch(metrics: Tier1Metrics[], batchSize = 1000): Promise<void> {
  if (metrics.length === 0) {
    console.log('   ⚠️  No metrics to insert')
    return
  }

  console.log(`\n💾 Inserting ${metrics.length} metric records into wallet_metrics_complete...`)

  const totalBatches = Math.ceil(metrics.length / batchSize)
  let insertedCount = 0

  for (let i = 0; i < metrics.length; i += batchSize) {
    const batch = metrics.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1

    try {
      console.log(
        `   📦 Batch ${batchNum}/${totalBatches}: Inserting ${batch.length} records...`
      )

      // Prepare data for ClickHouse insert
      const values = batch.map((m) => ({
        wallet_address: m.wallet_address,
        window: WINDOW_ENUM[m.window],
        calculated_at: Math.floor(m.calculated_at.getTime() / 1000),
        trades_analyzed: m.trades_analyzed,
        resolved_trades: m.resolved_trades,
        track_record_days: 0, // Will be calculated in Phase 2
        raw_data_hash: '', // Will be implemented for cache invalidation

        // Tier 1 metrics
        metric_1_omega_gross: m.metric_1_omega_gross,
        metric_2_omega_net: m.metric_2_omega_net,
        metric_9_net_pnl_usd: m.metric_9_net_pnl_usd,
        metric_12_hit_rate: m.metric_12_hit_rate,
        metric_13_avg_win_usd: m.metric_13_avg_win_usd,
        metric_14_avg_loss_usd: m.metric_14_avg_loss_usd,
        metric_15_ev_per_bet_mean: m.metric_15_ev_per_bet_mean,
        metric_22_resolved_bets: m.metric_22_resolved_bets,

        // Placeholder null values for other metrics (to be calculated in later phases)
        metric_3_gain_to_pain: null,
        metric_4_profit_factor: null,
        metric_5_sortino: null,
        metric_6_sharpe: null,
        metric_7_martin: null,
        metric_8_calmar: null,
        metric_10_net_pnl_pct: null,
        metric_11_cagr: null,
        metric_16_ev_per_bet_median: null,
        metric_17_max_drawdown: null,
        metric_18_avg_drawdown: null,
        metric_19_time_in_drawdown_pct: null,
        metric_20_ulcer_index: null,
        metric_21_drawdown_recovery_days: null,
        metric_23_track_record_days: 0,
        metric_24_bets_per_week: null,
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
        metric_48_omega_lag_30s: null,
        metric_49_omega_lag_2min: null,
        metric_50_omega_lag_5min: null,
        metric_51_clv_lag_30s: null,
        metric_52_clv_lag_2min: null,
        metric_53_clv_lag_5min: null,
        metric_54_edge_half_life_hours: null,
        metric_55_latency_penalty_index: null,
        metric_56_omega_momentum_30d: null,
        metric_57_omega_momentum_90d: null,
        metric_58_pnl_trend_30d: null,
        metric_59_pnl_acceleration: null,
        metric_60_tail_ratio: null,
        metric_61_skewness: null,
        metric_62_kurtosis: null,
        metric_63_kelly_utilization_pct: null,
        metric_64_risk_of_ruin_approx: null,
        metric_65_return_on_capital: null,
        metric_66_capital_turnover: null,
        metric_67_news_shock_ev_5min: null,
        metric_68_crowd_orthogonality: null,
        metric_69_ev_per_hour_capital: null,
        metric_70_gross_to_net_ratio: null,
        metric_71_fee_per_bet: null,
        metric_72_fee_burden_pct: null,
        metric_73_slippage_per_bet: null,
        metric_74_longest_win_streak: 0,
        metric_75_longest_loss_streak: 0,
        metric_76_current_streak_length: 0,
        metric_77_streak_consistency: null,
        metric_78_weekday_vs_weekend_roi: null,
        metric_79_integrity_deposit_pnl: null,
        metric_80_avg_time_to_resolution_days: null,
        metric_81_early_vs_late_roi: null,
        metric_82_clv_momentum_30d: null,
        metric_83_ev_hr_momentum_30d: null,
        metric_84_drawdown_trend_60d: null,
        metric_85_performance_trend_flag: 3, // 'stable' by default
        metric_86_hot_hand_z_score: null,
        metric_87_bet_frequency_variance: null,
        metric_88_sizing_discipline_trend: null,
        metric_89_clv_by_category_json: '',
        metric_90_omega_lag_by_category_json: '',
        metric_91_calibration_by_category_json: '',
        metric_92_ev_hr_by_category_json: '',
        metric_93_news_reaction_time_median_sec: null,
        metric_94_event_archetype_edge_json: '',
        metric_95_spread_capture_ratio: null,
        metric_96_adverse_selection_cost: null,
        metric_97_price_impact_per_k: null,
        metric_98_yes_no_bias_pct: null,
        metric_99_liquidity_access_skill: null,
        metric_100_news_latency_distribution_json: '',
        metric_101_alpha_source_timing_pct: null,
        metric_102_edge_source_decomp_json: '',
      }))

      await clickhouse.insert({
        table: 'wallet_metrics_complete',
        values,
        format: 'JSONEachRow',
      })

      insertedCount += batch.length
      console.log(`   ✅ Batch ${batchNum}/${totalBatches} inserted successfully`)
    } catch (error) {
      console.error(`   ❌ Error inserting batch ${batchNum}:`, error)
      throw error
    }
  }

  console.log(`   ✅ Total inserted: ${insertedCount} records`)
}

/**
 * Validate inserted data
 */
async function validateMetrics(window: TimeWindow): Promise<void> {
  console.log(`\n🔍 Validating metrics for ${window} window...`)

  try {
    // Count records
    const countQuery = `
      SELECT count(*) as total
      FROM wallet_metrics_complete
      WHERE window = ${WINDOW_ENUM[window]}
    `

    const countResult = await clickhouse.query({
      query: countQuery,
      format: 'JSONEachRow',
    })

    const countData = (await countResult.json()) as Array<{ total: number }>
    const totalRecords = countData[0]?.total || 0

    console.log(`   📊 Total records: ${totalRecords.toLocaleString()}`)

    // Get sample statistics
    const statsQuery = `
      SELECT
        quantile(0.5)(metric_2_omega_net) as median_omega,
        quantile(0.9)(metric_2_omega_net) as p90_omega,
        quantile(0.95)(metric_2_omega_net) as p95_omega,
        max(metric_2_omega_net) as max_omega,
        avg(metric_12_hit_rate) as avg_hit_rate,
        avg(metric_22_resolved_bets) as avg_resolved_bets,
        sum(metric_9_net_pnl_usd) as total_pnl
      FROM wallet_metrics_complete
      WHERE window = ${WINDOW_ENUM[window]}
    `

    const statsResult = await clickhouse.query({
      query: statsQuery,
      format: 'JSONEachRow',
    })

    const stats = (await statsResult.json()) as Array<{
      median_omega: number
      p90_omega: number
      p95_omega: number
      max_omega: number
      avg_hit_rate: number
      avg_resolved_bets: number
      total_pnl: number
    }>

    if (stats[0]) {
      console.log(`\n   📈 Statistics:`)
      console.log(`      Median Omega: ${stats[0].median_omega?.toFixed(2) || 'N/A'}`)
      console.log(`      P90 Omega: ${stats[0].p90_omega?.toFixed(2) || 'N/A'}`)
      console.log(`      P95 Omega: ${stats[0].p95_omega?.toFixed(2) || 'N/A'}`)
      console.log(`      Max Omega: ${stats[0].max_omega?.toFixed(2) || 'N/A'}`)
      console.log(`      Avg Hit Rate: ${(stats[0].avg_hit_rate * 100)?.toFixed(2) || 'N/A'}%`)
      console.log(
        `      Avg Resolved Bets: ${stats[0].avg_resolved_bets?.toFixed(0) || 'N/A'}`
      )
      console.log(
        `      Total PnL: $${stats[0].total_pnl?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || 'N/A'}`
      )
    }

    console.log(`\n   ✅ Validation complete for ${window}`)
  } catch (error) {
    console.error(`   ❌ Validation failed for ${window}:`, error)
    throw error
  }
}

/**
 * Get top performers for a window
 */
async function showTopPerformers(window: TimeWindow, limit = 10): Promise<void> {
  console.log(`\n🏆 Top ${limit} Performers (${window} window):`)

  try {
    const query = `
      SELECT
        wallet_address,
        metric_2_omega_net,
        metric_9_net_pnl_usd,
        metric_12_hit_rate,
        metric_22_resolved_bets
      FROM wallet_metrics_complete
      WHERE window = ${WINDOW_ENUM[window]}
      ORDER BY metric_2_omega_net DESC
      LIMIT ${limit}
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const performers = (await result.json()) as Array<{
      wallet_address: string
      metric_2_omega_net: number
      metric_9_net_pnl_usd: number
      metric_12_hit_rate: number
      metric_22_resolved_bets: number
    }>

    if (performers.length === 0) {
      console.log('   No data found')
      return
    }

    console.log('\n   Rank | Wallet (last 8) | Omega | Net PnL | Hit Rate | Bets')
    console.log('   ' + '-'.repeat(70))

    performers.forEach((p, idx) => {
      const walletShort = p.wallet_address.slice(-8)
      const omega = p.metric_2_omega_net?.toFixed(2) || 'N/A'
      const pnl = p.metric_9_net_pnl_usd?.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
      const hitRate = ((p.metric_12_hit_rate || 0) * 100).toFixed(1)
      const bets = p.metric_22_resolved_bets

      console.log(
        `   ${(idx + 1).toString().padStart(4)} | ${walletShort} | ${omega.padStart(6)} | $${pnl.padStart(8)} | ${hitRate.padStart(5)}% | ${bets.toString().padStart(4)}`
      )
    })

    console.log()
  } catch (error) {
    console.error(`   ❌ Error fetching top performers:`, error)
  }
}

/**
 * Check if trades_raw has enriched data
 */
async function checkDataReadiness(): Promise<boolean> {
  console.log('🔍 Checking data readiness...\n')

  try {
    // Check if trades_raw has data
    const countQuery = `
      SELECT count(*) as total,
             countIf(outcome IS NOT NULL) as enriched,
             countIf(pnl_net != 0) as has_pnl
      FROM trades_raw
    `

    const result = await clickhouse.query({
      query: countQuery,
      format: 'JSONEachRow',
    })

    const data = (await result.json()) as Array<{
      total: number
      enriched: number
      has_pnl: number
    }>

    const stats = data[0]

    console.log(`   Total trades: ${stats.total.toLocaleString()}`)
    console.log(`   Enriched trades (outcome set): ${stats.enriched.toLocaleString()}`)
    console.log(`   Trades with PnL: ${stats.has_pnl.toLocaleString()}`)

    if (stats.total === 0) {
      console.log(`\n   ❌ No trades found in trades_raw table`)
      console.log(`   💡 Run sync script first to populate trades`)
      return false
    }

    if (stats.enriched === 0) {
      console.log(`\n   ⚠️  No enriched trades found`)
      console.log(`   💡 Run enrichment script to add outcome and PnL data`)
      return false
    }

    const enrichmentRate = (stats.enriched / stats.total) * 100
    console.log(`   Enrichment rate: ${enrichmentRate.toFixed(1)}%`)

    if (enrichmentRate < 50) {
      console.log(`\n   ⚠️  Low enrichment rate (${enrichmentRate.toFixed(1)}%)`)
      console.log(`   💡 Consider running enrichment script for better coverage`)
    }

    console.log(`\n   ✅ Data is ready for metrics calculation\n`)
    return true
  } catch (error) {
    console.error(`\n   ❌ Error checking data readiness:`, error)
    return false
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('          TIER 1 METRICS CALCULATOR')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('Calculating 8 critical metrics from enriched trades')
  console.log('Output: wallet_metrics_complete table')
  console.log('═══════════════════════════════════════════════════════════\n')

  const startTime = Date.now()

  try {
    // Step 1: Check data readiness
    const isReady = await checkDataReadiness()
    if (!isReady) {
      console.log('❌ Cannot proceed - data not ready\n')
      process.exit(1)
    }

    // Step 2: Parse command line arguments
    const args = process.argv.slice(2)
    const windows: TimeWindow[] = args.length > 0 ? (args as TimeWindow[]) : ['30d', '90d', '180d', 'lifetime']

    // Validate windows
    for (const window of windows) {
      if (!WINDOW_FILTERS[window]) {
        console.log(`❌ Invalid window: ${window}`)
        console.log(`Valid windows: 30d, 90d, 180d, lifetime\n`)
        process.exit(1)
      }
    }

    console.log(`📋 Processing ${windows.length} time window(s): ${windows.join(', ')}\n`)

    // Step 3: Calculate and insert metrics for each window
    let totalWallets = 0
    let totalRecords = 0

    for (const window of windows) {
      console.log(`\n${'═'.repeat(60)}`)
      console.log(`Processing: ${window.toUpperCase()} WINDOW`)
      console.log('═'.repeat(60))

      // Calculate metrics
      const metrics = await calculateTier1Metrics(window)
      totalWallets += metrics.length
      totalRecords += metrics.length

      // Insert into database
      await insertMetricsBatch(metrics, 1000)

      // Validate
      await validateMetrics(window)

      // Show top performers
      await showTopPerformers(window, 10)

      console.log(`\n✅ ${window} window complete`)
    }

    // Step 4: Final summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log('\n' + '═'.repeat(60))
    console.log('                    SUMMARY')
    console.log('═'.repeat(60))
    console.log(`\n   ✅ Calculation complete!`)
    console.log(`   📊 Total unique wallets: ${totalWallets.toLocaleString()}`)
    console.log(`   💾 Total records inserted: ${totalRecords.toLocaleString()}`)
    console.log(`   ⏱️  Total time: ${duration}s`)
    console.log(`   📅 Timestamp: ${new Date().toISOString()}`)

    console.log('\n   📋 Next Steps:')
    console.log('      1. Query metrics: SELECT * FROM wallet_metrics_complete WHERE window = 1 LIMIT 10')
    console.log('      2. Top performers: SELECT * FROM wallet_metrics_complete WHERE window = 1 ORDER BY metric_2_omega_net DESC LIMIT 50')
    console.log('      3. Calculate Tier 2 metrics: npx tsx scripts/calculate-tier2-metrics.ts')

    console.log('\n' + '═'.repeat(60))
    console.log()
  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  }
}

// Run if executed directly
if (require.main === module) {
  main()
}

export { calculateTier1Metrics, insertMetricsBatch, validateMetrics }
