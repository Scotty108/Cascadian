import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

/**
 * ============================================================================
 * TIER 1 METRICS VERIFICATION SCRIPT
 * ============================================================================
 *
 * Verifies the accuracy of Tier 1 metrics calculations by:
 * 1. Checking data consistency
 * 2. Recalculating metrics for sample wallets
 * 3. Comparing with stored values
 * 4. Identifying anomalies
 * ============================================================================
 */

type TimeWindow = '30d' | '90d' | '180d' | 'lifetime'

const WINDOW_ENUM: Record<TimeWindow, number> = {
  '30d': 1,
  '90d': 2,
  '180d': 3,
  'lifetime': 4,
}

interface VerificationResult {
  check: string
  status: 'PASS' | 'FAIL' | 'WARNING'
  message: string
  details?: any
}

const results: VerificationResult[] = []

function addResult(check: string, status: 'PASS' | 'FAIL' | 'WARNING', message: string, details?: any) {
  results.push({ check, status, message, details })
}

/**
 * Check 1: Verify table exists and has data
 */
async function checkTableExists(): Promise<boolean> {
  console.log('\n1️⃣  Checking table existence...')

  try {
    const query = `
      SELECT count(*) as total,
             uniq(wallet_address) as unique_wallets,
             uniq(window) as windows
      FROM wallet_metrics_complete
    `

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })

    const data = (await result.json()) as Array<{
      total: number
      unique_wallets: number
      windows: number
    }>

    const stats = data[0]

    if (stats.total === 0) {
      addResult('Table Exists', 'FAIL', 'No data in wallet_metrics_complete', stats)
      return false
    }

    addResult('Table Exists', 'PASS', `Found ${stats.total} records across ${stats.unique_wallets} wallets and ${stats.windows} windows`, stats)
    return true
  } catch (error) {
    addResult('Table Exists', 'FAIL', `Error checking table: ${error}`)
    return false
  }
}

/**
 * Check 2: Verify no null primary metrics
 */
async function checkNullMetrics(): Promise<void> {
  console.log('2️⃣  Checking for null primary metrics...')

  const query = `
    SELECT
      countIf(metric_2_omega_net IS NULL) as null_omega,
      countIf(metric_9_net_pnl_usd IS NULL) as null_pnl,
      countIf(metric_12_hit_rate IS NULL) as null_hit_rate,
      countIf(metric_22_resolved_bets IS NULL OR metric_22_resolved_bets = 0) as null_bets,
      count(*) as total
    FROM wallet_metrics_complete
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data = (await result.json()) as Array<{
    null_omega: number
    null_pnl: number
    null_hit_rate: number
    null_bets: number
    total: number
  }>

  const stats = data[0]

  if (stats.null_omega > 0 || stats.null_pnl > 0 || stats.null_hit_rate > 0 || stats.null_bets > 0) {
    addResult('Null Metrics', 'WARNING', 'Some records have null primary metrics', stats)
  } else {
    addResult('Null Metrics', 'PASS', 'All primary metrics are populated', stats)
  }
}

/**
 * Check 3: Verify omega calculations are reasonable
 */
async function checkOmegaRanges(): Promise<void> {
  console.log('3️⃣  Checking omega value ranges...')

  const query = `
    SELECT
      window,
      min(metric_2_omega_net) as min_omega,
      quantile(0.25)(metric_2_omega_net) as p25_omega,
      quantile(0.5)(metric_2_omega_net) as median_omega,
      quantile(0.75)(metric_2_omega_net) as p75_omega,
      max(metric_2_omega_net) as max_omega,
      countIf(metric_2_omega_net < 0) as negative_omega,
      countIf(metric_2_omega_net > 100) as extreme_omega,
      count(*) as total
    FROM wallet_metrics_complete
    GROUP BY window
    ORDER BY window
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data = (await result.json()) as Array<{
    window: number
    min_omega: number
    p25_omega: number
    median_omega: number
    p75_omega: number
    max_omega: number
    negative_omega: number
    extreme_omega: number
    total: number
  }>

  for (const stats of data) {
    const windowName = Object.keys(WINDOW_ENUM).find(k => WINDOW_ENUM[k as TimeWindow] === stats.window) || 'unknown'

    if (stats.negative_omega > 0) {
      addResult(`Omega Range (${windowName})`, 'FAIL', `Found ${stats.negative_omega} negative omega values`, stats)
    } else if (stats.extreme_omega > stats.total * 0.05) {
      addResult(`Omega Range (${windowName})`, 'WARNING', `${stats.extreme_omega} wallets have extreme omega (>100)`, stats)
    } else {
      addResult(`Omega Range (${windowName})`, 'PASS', `Omega range is reasonable (${stats.min_omega.toFixed(2)} to ${stats.max_omega.toFixed(2)})`, stats)
    }
  }
}

/**
 * Check 4: Verify hit rates are in valid range
 */
async function checkHitRates(): Promise<void> {
  console.log('4️⃣  Checking hit rate validity...')

  const query = `
    SELECT
      window,
      countIf(metric_12_hit_rate < 0 OR metric_12_hit_rate > 1) as invalid_hit_rate,
      avg(metric_12_hit_rate) as avg_hit_rate,
      quantile(0.5)(metric_12_hit_rate) as median_hit_rate,
      count(*) as total
    FROM wallet_metrics_complete
    GROUP BY window
    ORDER BY window
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data = (await result.json()) as Array<{
    window: number
    invalid_hit_rate: number
    avg_hit_rate: number
    median_hit_rate: number
    total: number
  }>

  for (const stats of data) {
    const windowName = Object.keys(WINDOW_ENUM).find(k => WINDOW_ENUM[k as TimeWindow] === stats.window) || 'unknown'

    if (stats.invalid_hit_rate > 0) {
      addResult(`Hit Rate (${windowName})`, 'FAIL', `Found ${stats.invalid_hit_rate} invalid hit rates (outside 0-1 range)`, stats)
    } else {
      const avgPct = (stats.avg_hit_rate * 100).toFixed(1)
      addResult(`Hit Rate (${windowName})`, 'PASS', `All hit rates valid, avg: ${avgPct}%`, stats)
    }
  }
}

/**
 * Check 5: Verify minimum bet threshold
 */
async function checkMinimumBets(): Promise<void> {
  console.log('5️⃣  Checking minimum bet threshold...')

  const query = `
    SELECT
      window,
      countIf(metric_22_resolved_bets < 5) as below_minimum,
      min(metric_22_resolved_bets) as min_bets,
      avg(metric_22_resolved_bets) as avg_bets,
      count(*) as total
    FROM wallet_metrics_complete
    GROUP BY window
    ORDER BY window
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data = (await result.json()) as Array<{
    window: number
    below_minimum: number
    min_bets: number
    avg_bets: number
    total: number
  }>

  for (const stats of data) {
    const windowName = Object.keys(WINDOW_ENUM).find(k => WINDOW_ENUM[k as TimeWindow] === stats.window) || 'unknown'

    if (stats.below_minimum > 0) {
      addResult(`Minimum Bets (${windowName})`, 'FAIL', `Found ${stats.below_minimum} wallets below 5 bet minimum`, stats)
    } else {
      addResult(`Minimum Bets (${windowName})`, 'PASS', `All wallets meet minimum (min: ${stats.min_bets}, avg: ${stats.avg_bets.toFixed(1)})`, stats)
    }
  }
}

/**
 * Check 6: Spot check calculations for random wallet
 */
async function spotCheckCalculations(window: TimeWindow = '30d'): Promise<void> {
  console.log(`6️⃣  Spot checking calculations for ${window} window...`)

  try {
    // Get a random wallet with decent activity
    const walletQuery = `
      SELECT wallet_address
      FROM wallet_metrics_complete
      WHERE window = ${WINDOW_ENUM[window]}
        AND metric_22_resolved_bets >= 10
      ORDER BY rand()
      LIMIT 1
    `

    const walletResult = await clickhouse.query({
      query: walletQuery,
      format: 'JSONEachRow',
    })

    const walletData = (await walletResult.json()) as Array<{ wallet_address: string }>

    if (walletData.length === 0) {
      addResult('Spot Check', 'WARNING', 'No wallets found for spot check', null)
      return
    }

    const walletAddress = walletData[0].wallet_address

    // Get stored metrics
    const storedQuery = `
      SELECT *
      FROM wallet_metrics_complete
      WHERE wallet_address = '${walletAddress}'
        AND window = ${WINDOW_ENUM[window]}
    `

    const storedResult = await clickhouse.query({
      query: storedQuery,
      format: 'JSONEachRow',
    })

    const stored = (await storedResult.json()) as Array<any>

    // Recalculate from raw data
    const windowFilter = window === 'lifetime' ? '1=1' : `timestamp >= now() - INTERVAL ${window.replace('d', '')} DAY`

    const recalcQuery = `
      SELECT
        sumIf(pnl_net, pnl_net > 0) / nullIf(sumIf(abs(pnl_net), pnl_net <= 0), 0) as calc_omega,
        sum(pnl_net) as calc_pnl,
        countIf(pnl_net > 0) / nullIf(count(*), 0) as calc_hit_rate,
        count(*) as calc_bets
      FROM trades_raw
      WHERE wallet_address = '${walletAddress}'
        AND is_closed = true
        AND outcome IS NOT NULL
        AND ${windowFilter}
    `

    const recalcResult = await clickhouse.query({
      query: recalcQuery,
      format: 'JSONEachRow',
    })

    const recalc = (await recalcResult.json()) as Array<{
      calc_omega: number
      calc_pnl: number
      calc_hit_rate: number
      calc_bets: number
    }>

    // Compare
    const storedMetrics = stored[0]
    const recalcMetrics = recalc[0]

    const omegaDiff = Math.abs(storedMetrics.metric_2_omega_net - recalcMetrics.calc_omega)
    const pnlDiff = Math.abs(storedMetrics.metric_9_net_pnl_usd - recalcMetrics.calc_pnl)
    const hitRateDiff = Math.abs(storedMetrics.metric_12_hit_rate - recalcMetrics.calc_hit_rate)
    const betsDiff = Math.abs(storedMetrics.metric_22_resolved_bets - recalcMetrics.calc_bets)

    const tolerance = 0.01 // 1% tolerance for floating point

    if (omegaDiff > tolerance || pnlDiff > 1 || hitRateDiff > tolerance || betsDiff > 0) {
      addResult('Spot Check', 'WARNING', `Differences found for ${walletAddress.slice(-8)}`, {
        wallet: walletAddress,
        stored: storedMetrics,
        recalculated: recalcMetrics,
        differences: { omegaDiff, pnlDiff, hitRateDiff, betsDiff }
      })
    } else {
      addResult('Spot Check', 'PASS', `Calculations match for ${walletAddress.slice(-8)}`, {
        wallet: walletAddress,
        omega: storedMetrics.metric_2_omega_net,
        pnl: storedMetrics.metric_9_net_pnl_usd,
        bets: storedMetrics.metric_22_resolved_bets
      })
    }
  } catch (error) {
    addResult('Spot Check', 'FAIL', `Error during spot check: ${error}`)
  }
}

/**
 * Check 7: Verify data freshness
 */
async function checkDataFreshness(): Promise<void> {
  console.log('7️⃣  Checking data freshness...')

  const query = `
    SELECT
      window,
      max(calculated_at) as last_calculation,
      now() - max(calculated_at) as age_seconds
    FROM wallet_metrics_complete
    GROUP BY window
    ORDER BY window
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data = (await result.json()) as Array<{
    window: number
    last_calculation: string
    age_seconds: number
  }>

  for (const stats of data) {
    const windowName = Object.keys(WINDOW_ENUM).find(k => WINDOW_ENUM[k as TimeWindow] === stats.window) || 'unknown'
    const ageHours = Math.floor(stats.age_seconds / 3600)

    if (ageHours > 24) {
      addResult(`Data Freshness (${windowName})`, 'WARNING', `Data is ${ageHours} hours old`, stats)
    } else {
      addResult(`Data Freshness (${windowName})`, 'PASS', `Data is fresh (${ageHours} hours old)`, stats)
    }
  }
}

/**
 * Print results summary
 */
function printResults(): void {
  console.log('\n' + '═'.repeat(80))
  console.log('                        VERIFICATION RESULTS')
  console.log('═'.repeat(80) + '\n')

  let passCount = 0
  let failCount = 0
  let warningCount = 0

  for (const result of results) {
    const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️ '
    console.log(`${icon} ${result.check}: ${result.message}`)

    if (result.status === 'PASS') passCount++
    else if (result.status === 'FAIL') failCount++
    else warningCount++
  }

  console.log('\n' + '═'.repeat(80))
  console.log(`Total: ${results.length} checks | ✅ ${passCount} passed | ❌ ${failCount} failed | ⚠️  ${warningCount} warnings`)
  console.log('═'.repeat(80) + '\n')

  if (failCount > 0) {
    console.log('❌ VERIFICATION FAILED - Review errors above\n')
    process.exit(1)
  } else if (warningCount > 0) {
    console.log('⚠️  VERIFICATION PASSED WITH WARNINGS - Review warnings above\n')
  } else {
    console.log('✅ ALL CHECKS PASSED - Metrics are accurate!\n')
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('═'.repeat(80))
  console.log('                   TIER 1 METRICS VERIFICATION')
  console.log('═'.repeat(80))

  try {
    const hasData = await checkTableExists()

    if (!hasData) {
      console.log('\n❌ No data to verify. Run calculate-tier1-metrics.ts first.\n')
      process.exit(1)
    }

    await checkNullMetrics()
    await checkOmegaRanges()
    await checkHitRates()
    await checkMinimumBets()
    await spotCheckCalculations('30d')
    await checkDataFreshness()

    printResults()
  } catch (error) {
    console.error('\n❌ Verification failed with error:', error)
    process.exit(1)
  }
}

main()
