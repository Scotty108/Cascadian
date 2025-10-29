#!/usr/bin/env tsx
/**
 * Compute Wallet Metrics by Category - Phase 2 Implementation
 *
 * PURPOSE:
 * Computes TIER 1 critical wallet metrics broken down by category (Politics, Crypto, Sports, etc.)
 * across 4 time windows (30d, 90d, 180d, lifetime) for all wallets with >= 5 trades per category.
 *
 * TIER 1 METRICS IMPLEMENTED (per category):
 * - metric_2_omega_net: Category-specific Omega ratio
 * - metric_6_sharpe: Category-specific Sharpe ratio
 * - metric_9_net_pnl_usd: Category-specific net P&L
 * - metric_12_hit_rate: Category-specific win rate
 * - metric_13_avg_win_usd: Category-specific average win
 * - metric_14_avg_loss_usd: Category-specific average loss
 * - metric_22_resolved_bets: Trades in this category
 * - metric_23_track_record_days: Days active in category
 * - metric_24_bets_per_week: Betting frequency in category
 * - metric_60_tail_ratio: Category-specific tail ratio
 * - metric_69_ev_per_hour_capital: Category-specific capital efficiency
 * - metric_85_performance_trend_flag: Category-specific trend
 * - metric_88_sizing_discipline_trend: Category-specific sizing consistency
 * - Resolution accuracy: Category-specific prediction accuracy
 *
 * CATEGORY-SPECIFIC FIELDS:
 * - trades_in_category: Total trades in this category
 * - pct_of_total_trades: % of wallet's trades in this category
 * - pct_of_total_volume: % of wallet's volume in this category
 * - is_primary_category: TRUE if most trades are in this category
 *
 * OUTPUT:
 * - Populates wallet_metrics_by_category table
 * - Multiple rows per wallet (one per category per time window)
 *
 * USAGE:
 * npx tsx scripts/compute-wallet-metrics-by-category.ts
 *
 * DRY_RUN MODE:
 * DRY_RUN=1 npx tsx scripts/compute-wallet-metrics-by-category.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import { waitForNoPendingMutations } from '@/lib/clickhouse/mutations'

const isDryRun = process.env.DRY_RUN === '1'
const BATCH_SIZE = 500  // Process wallet-category pairs in batches
const MIN_TRADES_PER_CATEGORY = 5  // Only compute metrics for categories with >= 5 trades

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

interface WalletCategoryPair {
  wallet_address: string
  category: string
  trade_count: number
}

interface WalletCategoryMetrics {
  wallet_address: string
  category: string
  window: string
  calculated_at: Date

  // Metadata
  trades_analyzed: number
  resolved_trades: number
  track_record_days: number
  raw_data_hash: string

  // Category-specific context
  trades_in_category: number
  pct_of_total_trades: number | null
  pct_of_total_volume: number | null
  is_primary_category: boolean

  // TIER 1 Metrics (same as overall, but per category)
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
  resolution_accuracy: number | null
}

/**
 * Verify wallet_metrics_by_category table exists
 */
async function verifyMetricsTable() {
  console.log('📋 Verifying wallet_metrics_by_category table...')

  if (isDryRun) {
    console.log('   [DRY_RUN] Would verify table exists')
    return
  }

  const result = await clickhouse.query({
    query: `SELECT count() as cnt FROM system.tables WHERE name = 'wallet_metrics_by_category' AND database = currentDatabase()`,
    format: 'JSONEachRow'
  })

  const rows = await result.json<{ cnt: string }>()
  const exists = parseInt(rows[0].cnt) > 0

  if (!exists) {
    throw new Error('wallet_metrics_by_category table does not exist! Run migration 013 first.')
  }

  console.log('   ✅ Table exists')
}

/**
 * Get all (wallet, category) pairs with >= MIN_TRADES_PER_CATEGORY trades
 *
 * This query joins trades_raw with events_dim via markets_dim to get categories.
 */
async function getWalletCategoryPairs(): Promise<WalletCategoryPair[]> {
  console.log(`\n📊 Finding (wallet, category) pairs with >= ${MIN_TRADES_PER_CATEGORY} trades...`)

  if (isDryRun) {
    console.log('   [DRY_RUN] Would fetch wallet-category pairs')
    return []
  }

  const result = await clickhouse.query({
    query: `
      SELECT
        t.wallet_address,
        e.canonical_category as category,
        count() as trade_count
      FROM trades_raw t
      INNER JOIN markets_dim m ON t.market_id = m.market_id
      INNER JOIN events_dim e ON m.event_id = e.event_id
      WHERE e.canonical_category != ''
        AND e.canonical_category IS NOT NULL
        AND t.is_resolved = 1
      GROUP BY t.wallet_address, e.canonical_category
      HAVING trade_count >= ${MIN_TRADES_PER_CATEGORY}
      ORDER BY t.wallet_address, e.canonical_category
    `,
    format: 'JSONEachRow'
  })

  const pairs = await result.json<WalletCategoryPair>()
  console.log(`   ✅ Found ${pairs.length} (wallet, category) pairs`)

  // Show distribution
  const categoryCount = new Map<string, number>()
  pairs.forEach(p => {
    categoryCount.set(p.category, (categoryCount.get(p.category) || 0) + 1)
  })

  console.log('\n   Category distribution:')
  Array.from(categoryCount.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      console.log(`   - ${cat}: ${count} wallets`)
    })

  return pairs
}

/**
 * Compute all TIER 1 metrics for a time window and batch of wallet-category pairs
 */
async function computeMetricsForWindow(
  window: TimeWindow,
  pairs: WalletCategoryPair[]
): Promise<WalletCategoryMetrics[]> {
  console.log(`\n📊 Computing TIER 1 metrics for ${window.name}...`)

  // Build time filter
  const timeFilter = window.days
    ? `AND t.timestamp >= now() - INTERVAL ${window.days} DAY`
    : ''

  if (isDryRun) {
    console.log(`   [DRY_RUN] Would compute metrics with filter: ${timeFilter || 'none (lifetime)'}`)
    return []
  }

  const startTime = Date.now()
  const allMetrics: WalletCategoryMetrics[] = []

  // Process pairs in batches to avoid memory issues
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, Math.min(i + BATCH_SIZE, pairs.length))

    // Build WHERE conditions for this batch
    const batchConditions = batch.map(p =>
      `(t.wallet_address = '${p.wallet_address}' AND e.canonical_category = '${p.category}')`
    ).join(' OR ')

    console.log(`   Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pairs.length / BATCH_SIZE)} (pairs ${i + 1}-${Math.min(i + BATCH_SIZE, pairs.length)})...`)

    // Main metrics query - same as wallet_metrics_complete but grouped by (wallet, category)
    const query = `
      SELECT
        t.wallet_address,
        e.canonical_category as category,
        '${window.name}' as window,
        now() as calculated_at,

        -- Metadata
        COUNT(*) as trades_analyzed,
        CAST(SUM(t.is_resolved) AS UInt32) as resolved_trades,
        CAST(dateDiff('day', MIN(t.timestamp), MAX(t.timestamp)) AS UInt16) as track_record_days,
        '' as raw_data_hash,

        -- Category context (computed separately)
        CAST(COUNT(*) AS UInt32) as trades_in_category,
        CAST(NULL AS Nullable(Decimal(5, 4))) as pct_of_total_trades,
        CAST(NULL AS Nullable(Decimal(5, 4))) as pct_of_total_volume,
        false as is_primary_category,

        -- metric_9: Net P&L in USD (sum of all realized P&L in this category)
        CAST(SUM(CASE WHEN t.is_resolved = 1 THEN t.realized_pnl_usd ELSE 0 END) AS Nullable(Decimal(18, 2))) as metric_9_net_pnl_usd,

        -- metric_22: Count of resolved bets in this category
        CAST(SUM(t.is_resolved) AS UInt32) as metric_22_resolved_bets,

        -- metric_23: Track record in days for this category
        CAST(dateDiff('day', MIN(t.timestamp), MAX(t.timestamp)) AS UInt16) as metric_23_track_record_days,

        -- metric_24: Bets per week in this category
        CAST(
          CASE
            WHEN dateDiff('day', MIN(t.timestamp), MAX(t.timestamp)) >= 0
            THEN SUM(t.is_resolved) / (GREATEST(1, dateDiff('day', MIN(t.timestamp), MAX(t.timestamp))) / 7.0)
            ELSE NULL
          END
          AS Nullable(Decimal(10, 2))
        ) as metric_24_bets_per_week,

        -- metric_2_omega_net: gains / losses after fees (category-specific)
        CAST(
          CASE
            WHEN SUM(CASE WHEN t.is_resolved = 1 AND t.realized_pnl_usd < 0 THEN -t.realized_pnl_usd ELSE 0 END) > 0
            THEN
              LEAST(99999.9999,
                SUM(CASE WHEN t.is_resolved = 1 AND t.realized_pnl_usd > 0 THEN t.realized_pnl_usd ELSE 0 END) /
                NULLIF(SUM(CASE WHEN t.is_resolved = 1 AND t.realized_pnl_usd < 0 THEN -t.realized_pnl_usd ELSE 0 END), 0)
              )
            ELSE NULL
          END
          AS Nullable(Decimal(12, 4))
        ) as metric_2_omega_net,

        -- metric_12_hit_rate: win rate in this category
        CAST(
          CASE
            WHEN SUM(t.is_resolved) > 0
            THEN SUM(CASE WHEN t.is_resolved = 1 AND t.realized_pnl_usd > 0 THEN 1 ELSE 0 END) / CAST(SUM(t.is_resolved) AS Float64)
            ELSE NULL
          END
          AS Nullable(Decimal(5, 4))
        ) as metric_12_hit_rate,

        -- metric_13_avg_win_usd: average profit on winning trades
        CAST(
          AVG(CASE WHEN t.is_resolved = 1 AND t.realized_pnl_usd > 0 THEN t.realized_pnl_usd ELSE NULL END)
          AS Nullable(Decimal(18, 2))
        ) as metric_13_avg_win_usd,

        -- metric_14_avg_loss_usd: average loss on losing trades
        CAST(
          AVG(CASE WHEN t.is_resolved = 1 AND t.realized_pnl_usd < 0 THEN t.realized_pnl_usd ELSE NULL END)
          AS Nullable(Decimal(18, 2))
        ) as metric_14_avg_loss_usd,

        -- metric_6_sharpe: Mean return / stddev of returns
        CAST(
          CASE
            WHEN stddevPop(CASE WHEN t.is_resolved = 1 THEN t.realized_pnl_usd ELSE NULL END) > 0
            THEN
              LEAST(99999.9999,
                AVG(CASE WHEN t.is_resolved = 1 THEN t.realized_pnl_usd ELSE NULL END) /
                NULLIF(stddevPop(CASE WHEN t.is_resolved = 1 THEN t.realized_pnl_usd ELSE NULL END), 0)
              )
            ELSE NULL
          END
          AS Nullable(Decimal(12, 4))
        ) as metric_6_sharpe,

        -- metric_69_ev_per_hour_capital: EV / (hours_held * capital)
        CAST(
          CASE
            WHEN SUM(CASE WHEN t.is_resolved = 1 AND t.hours_held > 0 THEN t.hours_held ELSE 0 END) > 0
            THEN
              SUM(CASE WHEN t.is_resolved = 1 THEN t.realized_pnl_usd ELSE 0 END) /
              NULLIF(SUM(CASE WHEN t.is_resolved = 1 AND t.hours_held > 0 THEN t.hours_held ELSE 0 END), 0)
            ELSE NULL
          END
          AS Nullable(Decimal(18, 6))
        ) as metric_69_ev_per_hour_capital,

        -- metric_88_sizing_discipline_trend: Stddev of position sizes
        CAST(
          stddevPop(CASE WHEN t.is_resolved = 1 THEN t.usd_value ELSE NULL END)
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

      FROM trades_raw t
      INNER JOIN markets_dim m ON t.market_id = m.market_id
      INNER JOIN events_dim e ON m.event_id = e.event_id
      WHERE (${batchConditions})
        ${timeFilter}
      GROUP BY t.wallet_address, e.canonical_category
      HAVING resolved_trades > 0
      ORDER BY t.wallet_address, e.canonical_category
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })

    const batchMetrics = await result.json<WalletCategoryMetrics>()
    allMetrics.push(...batchMetrics)
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`   ✅ Computed base metrics for ${allMetrics.length} (wallet, category) pairs in ${duration}s`)

  // Now enrich with additional computed metrics
  if (allMetrics.length > 0) {
    await enrichCategoryContext(allMetrics, window)
    await enrichTailRatios(allMetrics, window, timeFilter)
    await enrichResolutionAccuracy(allMetrics, window)
    await enrichPerformanceTrend(allMetrics, window, timeFilter)
  }

  return allMetrics
}

/**
 * Enrich with category-specific context fields
 */
async function enrichCategoryContext(metrics: WalletCategoryMetrics[], window: TimeWindow) {
  console.log(`   📊 Computing category context for ${window.name}...`)

  if (isDryRun) {
    return
  }

  const startTime = Date.now()

  try {
    // Get unique wallets
    const wallets = Array.from(new Set(metrics.map(m => m.wallet_address)))
    const walletList = wallets.map(w => `'${w}'`).join(',')

    // Build time filter
    const timeFilter = window.days
      ? `AND t.timestamp >= now() - INTERVAL ${window.days} DAY`
      : ''

    // Get total trades and volume per wallet
    const query = `
      WITH
        category_stats AS (
          SELECT
            t.wallet_address,
            e.canonical_category as category,
            COUNT(*) as category_trades,
            SUM(t.usd_value) as category_volume
          FROM trades_raw t
          INNER JOIN markets_dim m ON t.market_id = m.market_id
          INNER JOIN events_dim e ON m.event_id = e.event_id
          WHERE t.wallet_address IN (${walletList})
            AND t.is_resolved = 1
            ${timeFilter}
          GROUP BY t.wallet_address, e.canonical_category
        ),
        wallet_totals AS (
          SELECT
            wallet_address,
            SUM(category_trades) as total_trades,
            SUM(category_volume) as total_volume
          FROM category_stats
          GROUP BY wallet_address
        ),
        primary_categories AS (
          SELECT
            wallet_address,
            argMax(category, category_trades) as primary_category
          FROM category_stats
          GROUP BY wallet_address
        )
      SELECT
        cs.wallet_address,
        cs.category,
        cs.category_trades,
        cs.category_volume,
        wt.total_trades,
        wt.total_volume,
        CAST(cs.category_trades / CAST(wt.total_trades AS Float64) AS Decimal(5, 4)) as pct_of_total_trades,
        CAST(cs.category_volume / NULLIF(wt.total_volume, 0) AS Decimal(5, 4)) as pct_of_total_volume,
        CASE WHEN pc.primary_category = cs.category THEN true ELSE false END as is_primary_category
      FROM category_stats cs
      INNER JOIN wallet_totals wt ON cs.wallet_address = wt.wallet_address
      INNER JOIN primary_categories pc ON cs.wallet_address = pc.wallet_address
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })

    const contextData = await result.json<{
      wallet_address: string
      category: string
      pct_of_total_trades: number
      pct_of_total_volume: number
      is_primary_category: boolean
    }>()

    const contextMap = new Map<string, any>()
    contextData.forEach(d => {
      const key = `${d.wallet_address}::${d.category}`
      contextMap.set(key, d)
    })

    for (const metric of metrics) {
      const key = `${metric.wallet_address}::${metric.category}`
      const context = contextMap.get(key)
      if (context) {
        metric.pct_of_total_trades = context.pct_of_total_trades
        metric.pct_of_total_volume = context.pct_of_total_volume
        metric.is_primary_category = context.is_primary_category
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`   ✅ Computed category context in ${duration}s`)
  } catch (error) {
    console.log(`   ⚠️  Failed to compute category context: ${error}`)
  }
}

/**
 * Compute tail ratios separately (requires percentile calculation)
 */
async function enrichTailRatios(metrics: WalletCategoryMetrics[], window: TimeWindow, timeFilter: string) {
  console.log(`   📊 Computing tail ratios for ${window.name}...`)

  if (isDryRun) {
    return
  }

  const startTime = Date.now()

  try {
    // Build WHERE conditions for all (wallet, category) pairs
    const pairConditions = metrics.map(m =>
      `(t.wallet_address = '${m.wallet_address}' AND e.canonical_category = '${m.category}')`
    ).join(' OR ')

    // Compute tail ratios using window functions
    const query = `
      WITH
        wallet_category_trades AS (
          SELECT
            t.wallet_address,
            e.canonical_category as category,
            t.realized_pnl_usd,
            row_number() OVER (PARTITION BY t.wallet_address, e.canonical_category ORDER BY t.realized_pnl_usd DESC) as win_rank,
            row_number() OVER (PARTITION BY t.wallet_address, e.canonical_category ORDER BY t.realized_pnl_usd ASC) as loss_rank,
            count() OVER (PARTITION BY t.wallet_address, e.canonical_category) as total_trades
          FROM trades_raw t
          INNER JOIN markets_dim m ON t.market_id = m.market_id
          INNER JOIN events_dim e ON m.event_id = e.event_id
          WHERE t.is_resolved = 1
            AND (${pairConditions})
            ${timeFilter}
        ),
        top_10_wins AS (
          SELECT
            wallet_address,
            category,
            AVG(realized_pnl_usd) as avg_top_win
          FROM wallet_category_trades
          WHERE realized_pnl_usd > 0
            AND win_rank <= GREATEST(1, CAST(total_trades * 0.1 AS UInt32))
          GROUP BY wallet_address, category
        ),
        bottom_10_losses AS (
          SELECT
            wallet_address,
            category,
            AVG(realized_pnl_usd) as avg_bottom_loss
          FROM wallet_category_trades
          WHERE realized_pnl_usd < 0
            AND loss_rank <= GREATEST(1, CAST(total_trades * 0.1 AS UInt32))
          GROUP BY wallet_address, category
        )
      SELECT
        w.wallet_address,
        w.category,
        CAST(
          LEAST(9999.9999, w.avg_top_win / NULLIF(ABS(l.avg_bottom_loss), 0))
          AS Decimal(10, 4)
        ) as tail_ratio
      FROM top_10_wins w
      INNER JOIN bottom_10_losses l ON w.wallet_address = l.wallet_address AND w.category = l.category
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })

    const tailRatios = await result.json<{ wallet_address: string, category: string, tail_ratio: number }>()
    const tailRatioMap = new Map<string, number>()
    tailRatios.forEach(t => {
      const key = `${t.wallet_address}::${t.category}`
      tailRatioMap.set(key, t.tail_ratio)
    })

    for (const metric of metrics) {
      const key = `${metric.wallet_address}::${metric.category}`
      const tailRatio = tailRatioMap.get(key)
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
 * Enrich with resolution accuracy from wallet_resolution_outcomes (filtered by category)
 */
async function enrichResolutionAccuracy(metrics: WalletCategoryMetrics[], window: TimeWindow) {
  console.log(`   📊 Computing resolution accuracy for ${window.name}...`)

  if (isDryRun) {
    return
  }

  const startTime = Date.now()

  try {
    // Build WHERE conditions for all (wallet, category) pairs
    const pairConditions = metrics.map(m =>
      `(wro.wallet_address = '${m.wallet_address}' AND e.canonical_category = '${m.category}')`
    ).join(' OR ')

    // Build time filter for resolution outcomes
    const timeFilter = window.days
      ? `AND wro.resolved_at >= now() - INTERVAL ${window.days} DAY`
      : ''

    const query = `
      SELECT
        wro.wallet_address,
        e.canonical_category as category,
        CAST(AVG(wro.won) * 100 AS Decimal(5, 4)) as accuracy_pct
      FROM wallet_resolution_outcomes wro
      INNER JOIN markets_dim m ON wro.market_id = m.market_id
      INNER JOIN events_dim e ON m.event_id = e.event_id
      WHERE (${pairConditions})
        ${timeFilter}
      GROUP BY wro.wallet_address, e.canonical_category
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })

    const accuracies = await result.json<{ wallet_address: string, category: string, accuracy_pct: number }>()
    const accuracyMap = new Map<string, number>()
    accuracies.forEach(a => {
      const key = `${a.wallet_address}::${a.category}`
      accuracyMap.set(key, a.accuracy_pct)
    })

    for (const metric of metrics) {
      const key = `${metric.wallet_address}::${metric.category}`
      const accuracy = accuracyMap.get(key)
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
 * Determine performance trend (improving/declining/stable) per category
 */
async function enrichPerformanceTrend(metrics: WalletCategoryMetrics[], window: TimeWindow, timeFilter: string) {
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
    // Process in batches to avoid query size limit
    const TREND_BATCH_SIZE = 100
    const trendMap = new Map<string, string>()

    for (let i = 0; i < metrics.length; i += TREND_BATCH_SIZE) {
      const batch = metrics.slice(i, i + TREND_BATCH_SIZE)

      // Build WHERE conditions for this batch
      const pairConditions = batch.map(m =>
        `(t.wallet_address = '${m.wallet_address}' AND e.canonical_category = '${m.category}')`
      ).join(' OR ')

      // Split into two periods and compare omega ratios
      const splitDays = window.days ? Math.floor(window.days / 2) : 90

      const query = `
      WITH
        first_half AS (
          SELECT
            t.wallet_address,
            e.canonical_category as category,
            SUM(CASE WHEN t.realized_pnl_usd > 0 THEN t.realized_pnl_usd ELSE 0 END) /
              NULLIF(SUM(CASE WHEN t.realized_pnl_usd < 0 THEN -t.realized_pnl_usd ELSE 0 END), 0) as omega_first
          FROM trades_raw t
          INNER JOIN markets_dim m ON t.market_id = m.market_id
          INNER JOIN events_dim e ON m.event_id = e.event_id
          WHERE t.is_resolved = 1
            AND (${pairConditions})
            ${window.days ? `AND t.timestamp >= now() - INTERVAL ${window.days} DAY AND t.timestamp < now() - INTERVAL ${splitDays} DAY` : `AND t.timestamp < (SELECT MAX(timestamp) FROM trades_raw) - INTERVAL ${splitDays} DAY`}
          GROUP BY t.wallet_address, e.canonical_category
        ),
        second_half AS (
          SELECT
            t.wallet_address,
            e.canonical_category as category,
            SUM(CASE WHEN t.realized_pnl_usd > 0 THEN t.realized_pnl_usd ELSE 0 END) /
              NULLIF(SUM(CASE WHEN t.realized_pnl_usd < 0 THEN -t.realized_pnl_usd ELSE 0 END), 0) as omega_second
          FROM trades_raw t
          INNER JOIN markets_dim m ON t.market_id = m.market_id
          INNER JOIN events_dim e ON m.event_id = e.event_id
          WHERE t.is_resolved = 1
            AND (${pairConditions})
            ${window.days ? `AND t.timestamp >= now() - INTERVAL ${splitDays} DAY` : `AND t.timestamp >= (SELECT MAX(timestamp) FROM trades_raw) - INTERVAL ${splitDays} DAY`}
          GROUP BY t.wallet_address, e.canonical_category
        )
      SELECT
        COALESCE(f.wallet_address, s.wallet_address) as wallet_address,
        COALESCE(f.category, s.category) as category,
        CASE
          WHEN s.omega_second IS NULL OR f.omega_first IS NULL THEN 'stable'
          WHEN s.omega_second > f.omega_first * 1.2 THEN 'improving'
          WHEN s.omega_second < f.omega_first * 0.8 THEN 'declining'
          ELSE 'stable'
        END as trend
      FROM first_half f
      FULL OUTER JOIN second_half s ON f.wallet_address = s.wallet_address AND f.category = s.category
    `

      const result = await clickhouse.query({
        query,
        format: 'JSONEachRow'
      })

      const trends = await result.json<{ wallet_address: string, category: string, trend: string }>()
      trends.forEach(t => {
        const key = `${t.wallet_address}::${t.category}`
        trendMap.set(key, t.trend)
      })
    }

    // Apply trends to all metrics
    for (const metric of metrics) {
      const key = `${metric.wallet_address}::${metric.category}`
      const trend = trendMap.get(key) || 'stable'
      metric.metric_85_performance_trend_flag = trend
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`   ✅ Computed ${trendMap.size} performance trends in ${duration}s`)
  } catch (error) {
    console.log(`   ⚠️  Failed to compute performance trends: ${error}`)
  }
}

/**
 * Insert computed metrics into wallet_metrics_by_category
 */
async function insertMetrics(window: TimeWindow, metrics: WalletCategoryMetrics[]) {
  console.log(`\n💾 Inserting ${metrics.length} metric rows for ${window.name}...`)

  if (isDryRun) {
    console.log('   [DRY_RUN] Would insert metrics')
    if (metrics.length > 0) {
      console.log('   Sample metric (first wallet-category pair):')
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
    category: m.category,
    window: m.window,
    calculated_at: m.calculated_at,

    // Category context
    trades_in_category: m.trades_in_category,
    pct_of_total_trades: m.pct_of_total_trades,
    pct_of_total_volume: m.pct_of_total_volume,
    is_primary_category: m.is_primary_category,
    category_rank: null,
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

    // Per-category JSON (not used in by_category table)
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
      table: 'wallet_metrics_by_category',
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

  // Top 10 wallet-category pairs by Omega ratio (lifetime)
  const topOmega = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        category,
        metric_2_omega_net as omega,
        metric_9_net_pnl_usd as pnl,
        metric_12_hit_rate as win_rate,
        metric_22_resolved_bets as trades,
        metric_60_tail_ratio as tail_ratio,
        metric_6_sharpe as sharpe,
        pct_of_total_trades as pct_trades
      FROM wallet_metrics_by_category
      WHERE window = 'lifetime'
        AND metric_2_omega_net IS NOT NULL
        AND metric_22_resolved_bets >= 10
      ORDER BY metric_2_omega_net DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })

  const topPairs = await topOmega.json<any>()

  console.log('═'.repeat(100))
  console.log('TOP 10 WALLET-CATEGORY PAIRS BY OMEGA RATIO (Lifetime)')
  console.log('═'.repeat(100))
  console.log('Wallet Address                 Category             Omega    P&L       Win%   Trades  % Total')
  console.log('─'.repeat(100))

  for (const w of topPairs) {
    const addr = w.wallet_address.slice(0, 28).padEnd(28)
    const cat = w.category.slice(0, 18).padEnd(18)
    const omega = (w.omega || 0).toFixed(2).padStart(7)
    const pnl = `$${(w.pnl || 0).toFixed(0)}`.padStart(9)
    const winRate = `${((w.win_rate || 0) * 100).toFixed(1)}%`.padStart(6)
    const trades = String(w.trades || 0).padStart(6)
    const pctTrades = `${((w.pct_trades || 0) * 100).toFixed(1)}%`.padStart(7)
    console.log(`${addr} ${cat} ${omega} ${pnl} ${winRate} ${trades} ${pctTrades}`)
  }

  // Overall statistics by category
  const stats = await clickhouse.query({
    query: `
      SELECT
        category,
        count(DISTINCT wallet_address) as wallet_count,
        avg(metric_2_omega_net) as avg_omega,
        avg(metric_9_net_pnl_usd) as avg_pnl,
        avg(metric_12_hit_rate) as avg_win_rate,
        avg(metric_22_resolved_bets) as avg_trades
      FROM wallet_metrics_by_category
      WHERE window = 'lifetime'
        AND metric_2_omega_net IS NOT NULL
      GROUP BY category
      ORDER BY wallet_count DESC
    `,
    format: 'JSONEachRow'
  })

  const categoryStats = await stats.json<any>()

  console.log('\n═'.repeat(90))
  console.log('AVERAGE METRICS BY CATEGORY (Lifetime Window)')
  console.log('═'.repeat(90))
  console.log('Category                    Wallets  Avg Omega  Avg P&L   Avg Win%  Avg Trades')
  console.log('─'.repeat(90))

  for (const s of categoryStats) {
    const category = s.category.slice(0, 25).padEnd(25)
    const wallets = String(s.wallet_count).padStart(7)
    const omega = (s.avg_omega || 0).toFixed(2).padStart(10)
    const pnl = `$${(s.avg_pnl || 0).toFixed(0)}`.padStart(9)
    const winRate = `${((s.avg_win_rate || 0) * 100).toFixed(1)}%`.padStart(9)
    const trades = (s.avg_trades || 0).toFixed(0).padStart(11)
    console.log(`${category} ${wallets} ${omega} ${pnl} ${winRate} ${trades}`)
  }

  console.log('═'.repeat(90))
}

/**
 * Main execution
 */
export async function main() {
  const startTime = Date.now()

  console.log('═'.repeat(80))
  console.log('    COMPUTE WALLET METRICS BY CATEGORY - PHASE 2 (TIER 1)')
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

  // Get all (wallet, category) pairs
  const pairs = await getWalletCategoryPairs()

  let totalMetricsInserted = 0

  // Process each time window
  for (const window of TIME_WINDOWS) {
    console.log(`\n${'═'.repeat(80)}`)
    console.log(`PROCESSING WINDOW: ${window.name}`)
    console.log('═'.repeat(80))

    // Compute all metrics for this window
    const metrics = await computeMetricsForWindow(window, pairs)

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
  console.log('✅ WALLET METRICS BY CATEGORY COMPUTATION COMPLETE!')
  console.log('═'.repeat(80))
  console.log(`   Total time: ${totalDuration} minutes`)
  console.log(`   Unique (wallet, category) pairs: ${pairs.length}`)
  console.log(`   Total metric rows: ${totalMetricsInserted}`)
  console.log(`   Time windows: ${TIME_WINDOWS.map(w => w.name).join(', ')}`)
  console.log('\n   TIER 1 Metrics Implemented (per category):')
  console.log('   ✅ metric_2_omega_net: Category-specific Omega ratio')
  console.log('   ✅ metric_6_sharpe: Category-specific Sharpe ratio')
  console.log('   ✅ metric_9_net_pnl_usd: Category-specific P&L')
  console.log('   ✅ metric_12_hit_rate: Category-specific win rate')
  console.log('   ✅ metric_13_avg_win_usd: Category-specific avg win')
  console.log('   ✅ metric_14_avg_loss_usd: Category-specific avg loss')
  console.log('   ✅ metric_22_resolved_bets: Category trade count')
  console.log('   ✅ metric_23_track_record_days: Category activity period')
  console.log('   ✅ metric_24_bets_per_week: Category activity rate')
  console.log('   ✅ metric_60_tail_ratio: Category win/loss distribution')
  console.log('   ✅ metric_69_ev_per_hour_capital: Category capital efficiency')
  console.log('   ✅ metric_85_performance_trend_flag: Category performance trend')
  console.log('   ✅ metric_88_sizing_discipline_trend: Category sizing consistency')
  console.log('   ✅ Resolution accuracy: Category prediction accuracy')
  console.log('\n   Category Context Fields:')
  console.log('   ✅ trades_in_category: Total trades in category')
  console.log('   ✅ pct_of_total_trades: % of wallet trades in category')
  console.log('   ✅ pct_of_total_volume: % of wallet volume in category')
  console.log('   ✅ is_primary_category: TRUE if most trades in category')
  console.log('═'.repeat(80))

  if (isDryRun) {
    console.log('\nThis was a DRY_RUN. To execute for real:')
    console.log('   npx tsx scripts/compute-wallet-metrics-by-category.ts\n')
  } else {
    console.log('\n📊 Next steps:')
    console.log('   1. Query top wallets by category: SELECT * FROM wallet_metrics_by_category WHERE category = \'Politics\' AND window = \'lifetime\' ORDER BY metric_2_omega_net DESC LIMIT 10')
    console.log('   2. Use category-specific metrics in Smart Money signals')
    console.log('   3. Build category leaderboards using these metrics\n')
  }
}

// Auto-execute when run directly
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })
}
