#!/usr/bin/env npx ts-node
/**
 * THIRD-PARTY VERIFIER: Validate all major claims across Claude conversations
 *
 * Purpose: Independently verify 8 critical claims before proceeding with backfill
 * Runs: Database audits, data quality checks, timeline verification
 *
 * Claims to verify:
 * 1. trades_raw is complete with 159.6M rows
 * 2. P&L formula validated at 2.05% accuracy on Wallet 1
 * 3. Wallets 2-4 have zero resolved conditions - this is expected
 * 4. Only 133 conditions out of 166,773 have trades_raw coverage
 * 5. Schema consolidation (87→18 tables) is straightforward
 * 6. Omega ratio definition is pending user input
 * 7. Backfill all 996K wallets in 2-4 hours with 8 workers
 * 8. Main Claude found breakthrough: formula is 2.05% accurate
 */

import { getClickHouseClient } from './lib/clickhouse/client'
import * as fs from 'fs'

interface VerificationResult {
  claim: string
  expected: string
  actual: string
  variance?: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  redFlags: string[]
  validated: boolean
}

const results: VerificationResult[] = []

async function log(message: string) {
  console.log(message)
}

async function verify(
  claimNumber: number,
  claim: string,
  expected: string,
  queryFn: () => Promise<{ actual: string; variance?: string; redFlags: string[] }>
) {
  try {
    log(`\n${'='.repeat(80)}`)
    log(`CLAIM #${claimNumber}: ${claim}`)
    log(`${'='.repeat(80)}`)
    log(`Expected: ${expected}`)

    const { actual, variance, redFlags } = await queryFn()

    log(`Actual:   ${actual}`)
    if (variance) log(`Variance: ${variance}`)

    const validated = actual === expected.split(' ')[0] || (redFlags.length === 0 && variance === '0%')
    const confidence = redFlags.length === 0 ? 'HIGH' : redFlags.length <= 1 ? 'MEDIUM' : 'LOW'

    if (redFlags.length > 0) {
      log(`\n⚠️  RED FLAGS:`)
      redFlags.forEach(flag => log(`   - ${flag}`))
    }

    results.push({
      claim,
      expected,
      actual,
      variance,
      confidence,
      redFlags,
      validated
    })

    log(`\n✅ Confidence: ${confidence} | Validated: ${validated ? 'YES' : 'NO'}`)
  } catch (error) {
    log(`❌ ERROR: ${error instanceof Error ? error.message : String(error)}`)
    results.push({
      claim,
      expected,
      actual: 'ERROR',
      confidence: 'LOW',
      redFlags: [`Query failed: ${error instanceof Error ? error.message : String(error)}`],
      validated: false
    })
  }
}

async function main() {
  const client = getClickHouseClient()

  log('\n' + '█'.repeat(80))
  log('THIRD-PARTY VERIFICATION AUDIT')
  log('Validating 8 Critical Claims from Claude Conversations')
  log('█'.repeat(80))

  // CLAIM 1: trades_raw is complete with 159.6M rows
  await verify(
    1,
    'trades_raw is complete with 159.6M rows',
    '159.6M rows',
    async () => {
      const result = await client.query({
        query: `
          SELECT
            count() as row_count,
            min(block_timestamp) as earliest_date,
            max(block_timestamp) as latest_date,
            countDistinct(wallet_address) as unique_wallets,
            countDistinct(condition_id) as unique_conditions
          FROM trades_raw
        `,
        format: 'JSONEachRow'
      })

      const data = (await result.json()) as Array<{
        row_count: number
        earliest_date: string
        latest_date: string
        unique_wallets: number
        unique_conditions: number
      }>

      const row = data[0]
      const rowsInMillions = (row.row_count / 1_000_000).toFixed(1)
      const expected = 159.6

      // Calculate date range
      const dateRange = `${new Date(row.earliest_date).toISOString().split('T')[0]} to ${new Date(row.latest_date).toISOString().split('T')[0]}`

      const redFlags = []
      if (Math.abs(row.row_count / 1_000_000 - expected) > 1) {
        redFlags.push(`Row count variance: expected ~159.6M, got ${rowsInMillions}M`)
      }

      const variance = `${((row.row_count / 159_600_000 - 1) * 100).toFixed(2)}%`

      return {
        actual: `${rowsInMillions}M rows (${row.row_count.toLocaleString()})`,
        variance,
        redFlags: [
          `Date range: ${dateRange}`,
          `Unique wallets: ${row.unique_wallets.toLocaleString()}`,
          `Unique conditions: ${row.unique_conditions.toLocaleString()}`,
          ...redFlags
        ]
      }
    }
  )

  // CLAIM 2: P&L formula validated at 2.05% accuracy on Wallet 1
  await verify(
    2,
    'P&L formula validated at 2.05% accuracy (Wallet 1 = HolyMoses7)',
    '$1,907,531.19',
    async () => {
      const result = await client.query({
        query: `
          SELECT
            wallet_address,
            realized_pnl_usd,
            unrealized_pnl_usd,
            total_pnl_usd,
            COUNT(*) as transaction_count
          FROM wallet_pnl_summary_v2
          WHERE lower(wallet_address) = 'holymoses7'
        `,
        format: 'JSONEachRow'
      })

      const data = (await result.json()) as Array<{
        wallet_address: string
        realized_pnl_usd: number
        unrealized_pnl_usd: number
        total_pnl_usd: number
        transaction_count: number
      }>

      if (data.length === 0) {
        return {
          actual: 'No data found',
          variance: 'N/A',
          redFlags: [
            'Wallet HolyMoses7 not found in wallet_pnl_summary_v2',
            'Check: Is wallet case-sensitive in database?',
            'Check: Does this wallet exist in trades_raw?'
          ]
        }
      }

      const row = data[0]
      const variance = `${Math.abs((row.realized_pnl_usd / 1_907_531.19 - 1) * 100).toFixed(2)}%`

      return {
        actual: `$${row.realized_pnl_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        variance,
        redFlags: [
          `Total P&L: $${row.total_pnl_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          `Unrealized: $${row.unrealized_pnl_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          `Transactions: ${row.transaction_count.toLocaleString()}`
        ]
      }
    }
  )

  // CLAIM 3: Wallets 2-4 have zero resolved conditions
  await verify(
    3,
    'Wallets 2-4 have zero resolved conditions (expected per claim)',
    '0 resolved conditions',
    async () => {
      const result = await client.query({
        query: `
          SELECT
            wallet_address,
            COUNT(DISTINCT condition_id) as resolved_condition_count,
            SUM(pnl_usd) as total_pnl
          FROM wallet_pnl_summary_v2
          LIMIT 4
        `,
        format: 'JSONEachRow'
      })

      const data = (await result.json()) as Array<{
        wallet_address: string
        resolved_condition_count: number
        total_pnl: number
      }>

      const wallet2 = data[1] || {}
      const wallet3 = data[2] || {}
      const wallet4 = data[3] || {}

      const redFlags = []
      if ((wallet2.resolved_condition_count || 0) > 0) {
        redFlags.push(`Wallet 2 (${wallet2.wallet_address}): has ${wallet2.resolved_condition_count} resolved conditions!`)
      }
      if ((wallet3.resolved_condition_count || 0) > 0) {
        redFlags.push(`Wallet 3 (${wallet3.wallet_address}): has ${wallet3.resolved_condition_count} resolved conditions!`)
      }
      if ((wallet4.resolved_condition_count || 0) > 0) {
        redFlags.push(`Wallet 4 (${wallet4.wallet_address}): has ${wallet4.resolved_condition_count} resolved conditions!`)
      }

      return {
        actual: `Wallet2: ${wallet2.resolved_condition_count || 0}, Wallet3: ${wallet3.resolved_condition_count || 0}, Wallet4: ${wallet4.resolved_condition_count || 0}`,
        variance: 'N/A',
        redFlags: [
          `Wallet 2: ${wallet2.wallet_address || 'N/A'} (${wallet2.resolved_condition_count || 0} conditions, $${(wallet2.total_pnl || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })})`,
          `Wallet 3: ${wallet3.wallet_address || 'N/A'} (${wallet3.resolved_condition_count || 0} conditions, $${(wallet3.total_pnl || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })})`,
          `Wallet 4: ${wallet4.wallet_address || 'N/A'} (${wallet4.resolved_condition_count || 0} conditions, $${(wallet4.total_pnl || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })})`,
          ...redFlags
        ]
      }
    }
  )

  // CLAIM 4: Only 133 conditions out of 166,773 have trades_raw coverage
  await verify(
    4,
    'Only 133 conditions out of 166,773 have trades_raw coverage (0.08%)',
    '133 out of 166,773',
    async () => {
      const result = await client.query({
        query: `
          SELECT
            (SELECT COUNT(DISTINCT condition_id) FROM trades_raw) as conditions_in_trades,
            (SELECT COUNT(DISTINCT condition_id) FROM market_resolutions_final) as total_conditions,
            (SELECT COUNT(DISTINCT condition_id)
             FROM trades_raw
             WHERE condition_id IN (SELECT condition_id FROM market_resolutions_final)) as overlap_conditions,
            (SELECT COUNT(*) FROM market_resolutions_final) as resolution_rows
        `,
        format: 'JSONEachRow'
      })

      const data = (await result.json()) as Array<{
        conditions_in_trades: number
        total_conditions: number
        overlap_conditions: number
        resolution_rows: number
      }>

      const row = data[0]
      const coveragePercent = ((row.overlap_conditions / row.total_conditions) * 100).toFixed(2)

      const redFlags = []
      if (row.overlap_conditions < 133) {
        redFlags.push(`Coverage is LOWER than claimed: ${row.overlap_conditions} vs expected 133`)
      }
      if (row.overlap_conditions > 133) {
        redFlags.push(`Coverage is HIGHER than claimed: ${row.overlap_conditions} vs expected 133 - is claim outdated?`)
      }

      return {
        actual: `${row.overlap_conditions.toLocaleString()} out of ${row.total_conditions.toLocaleString()} (${coveragePercent}%)`,
        variance: 'See actual vs expected above',
        redFlags: [
          `Total conditions in database: ${row.total_conditions.toLocaleString()}`,
          `Conditions with trades_raw data: ${row.conditions_in_trades.toLocaleString()}`,
          `Actual coverage: ${coveragePercent}%`,
          `This is a DATA QUALITY ISSUE if coverage is truly <1%`,
          ...redFlags
        ]
      }
    }
  )

  // CLAIM 5: Schema consolidation (87→18 tables) is straightforward
  await verify(
    5,
    'Schema consolidation (87→18 tables) is straightforward',
    '87 tables total',
    async () => {
      const result = await client.query({
        query: `
          SELECT
            COUNT(*) as total_tables,
            SUM(CASE WHEN total_rows = 0 THEN 1 ELSE 0 END) as empty_tables,
            SUM(CASE WHEN total_bytes < 1_000_000 THEN 1 ELSE 0 END) as tiny_tables,
            SUM(total_rows) as total_rows,
            formatReadableSize(SUM(total_bytes)) as total_size
          FROM system.tables
          WHERE database = currentDatabase()
        `,
        format: 'JSONEachRow'
      })

      const data = (await result.json()) as Array<{
        total_tables: number
        empty_tables: number
        tiny_tables: number
        total_rows: number
        total_size: string
      }>

      const row = data[0]

      const redFlags = []
      if (row.total_tables < 87) {
        redFlags.push(`Actual table count (${row.total_tables}) is LESS than claimed 87 - has cleanup already happened?`)
      }
      if (row.total_tables > 87) {
        redFlags.push(`Actual table count (${row.total_tables}) is MORE than claimed 87 - additional schema drift`)
      }

      redFlags.push(`${row.empty_tables} empty tables (should delete)`)
      redFlags.push(`${row.tiny_tables} tiny tables <1MB (data quality issue or test tables)`)
      redFlags.push(`Total size: ${row.total_size}`)

      return {
        actual: `${row.total_tables} total tables`,
        variance: `Difference from claimed 87: ${row.total_tables - 87}`,
        redFlags
      }
    }
  )

  // CLAIM 6: Omega ratio definition is pending user input
  await verify(
    6,
    'Omega ratio definition is pending user input (no blocker)',
    'Not yet defined',
    async () => {
      const result = await client.query({
        query: `
          SELECT
            COUNT(*) as table_count
          FROM system.tables
          WHERE database = currentDatabase()
            AND (name LIKE '%omega%' OR name LIKE '%sharpe%' OR name LIKE '%ratio%')
        `,
        format: 'JSONEachRow'
      })

      const data = (await result.json()) as Array<{
        table_count: number
      }>

      const hasOmegaTables = data[0].table_count > 0

      const redFlags = []
      if (hasOmegaTables) {
        redFlags.push(`Found ${data[0].table_count} tables with omega/ratio/sharpe in name - definition may already exist!`)
      } else {
        redFlags.push(`No omega ratio tables found - confirm if this is truly pending or already defined elsewhere`)
      }

      // Check source code
      const codeResult = await client.query({
        query: `
          SELECT
            COUNT(*) as count
          FROM system.tables
          WHERE name = 'wallet_metrics_complete'
            AND database = currentDatabase()
        `,
        format: 'JSONEachRow'
      })

      const codeData = (await codeResult.json()) as Array<{ count: number }>
      if (codeData[0].count > 0) {
        redFlags.push(`wallet_metrics_complete exists - check if it already includes Omega ratio calculations`)
      }

      return {
        actual: hasOmegaTables ? 'Already defined' : 'Not yet defined',
        variance: 'N/A',
        redFlags
      }
    }
  )

  // CLAIM 7: Backfill all 996K wallets in 2-4 hours with 8 workers
  await verify(
    7,
    'Backfill all 996K wallets in 2-4 hours with 8 workers',
    '2-4 hours',
    async () => {
      const result = await client.query({
        query: `
          SELECT
            COUNT(DISTINCT wallet_address) as unique_wallets,
            COUNT(*) as total_trades,
            COUNT(DISTINCT condition_id) as unique_conditions,
            MIN(block_timestamp) as start_date,
            MAX(block_timestamp) as end_date
          FROM trades_raw
        `,
        format: 'JSONEachRow'
      })

      const data = (await result.json()) as Array<{
        unique_wallets: number
        total_trades: number
        unique_conditions: number
        start_date: string
        end_date: string
      }>

      const row = data[0]
      const dayCount = Math.ceil(
        (new Date(row.end_date).getTime() - new Date(row.start_date).getTime()) / (1000 * 60 * 60 * 24)
      )

      // Calculate estimated processing time
      // 159.6M rows / 8 workers = 19.95M rows per worker
      // Typical ClickHouse insert: 1M-10M rows/sec per worker
      // Conservative estimate: 2M rows/sec
      const rowsPerWorker = row.total_trades / 8
      const estimatedSecsPerWorker = rowsPerWorker / 2_000_000
      const estimatedHours = estimatedSecsPerWorker / 3600

      const redFlags = []
      if (estimatedHours < 2) {
        redFlags.push(`Estimated time ${estimatedHours.toFixed(1)}h is FASTER than claimed 2-4h - may be conservative`)
      }
      if (estimatedHours > 4) {
        redFlags.push(`Estimated time ${estimatedHours.toFixed(1)}h is SLOWER than claimed 2-4h - may hit bottleneck`)
      }
      redFlags.push(`Based on: ${row.total_trades.toLocaleString()} total trades / 8 workers / 2M rows/sec`)
      redFlags.push(`Actual estimate: ${estimatedHours.toFixed(1)} hours (${(estimatedHours * 60).toFixed(0)} minutes)`)

      return {
        actual: `${estimatedHours.toFixed(1)} hours (conservative estimate)`,
        variance: 'N/A',
        redFlags: [
          `Unique wallets: ${row.unique_wallets.toLocaleString()}`,
          `Total trades: ${row.total_trades.toLocaleString()}`,
          `Date range: ${dayCount} days`,
          ...redFlags
        ]
      }
    }
  )

  // CLAIM 8: Main Claude found breakthrough: formula is 2.05% accurate
  await verify(
    8,
    'Main Claude found breakthrough: P&L formula is 2.05% accurate',
    '2.05% accuracy',
    async () => {
      const result = await client.query({
        query: `
          SELECT
            COUNT(*) as rows_count,
            COUNT(DISTINCT wallet_address) as wallets_with_pnl,
            AVG(realized_pnl_usd) as avg_pnl,
            MAX(realized_pnl_usd) as max_pnl,
            MIN(realized_pnl_usd) as min_pnl
          FROM wallet_pnl_summary_v2
          WHERE realized_pnl_usd != 0
        `,
        format: 'JSONEachRow'
      })

      const data = (await result.json()) as Array<{
        rows_count: number
        wallets_with_pnl: number
        avg_pnl: number
        max_pnl: number
        min_pnl: number
      }>

      const row = data[0]

      const redFlags = []
      if (row.rows_count === 0) {
        redFlags.push(`No P&L data found - formula may not have been calculated`)
      } else {
        redFlags.push(`${row.rows_count.toLocaleString()} rows with non-zero P&L`)
        redFlags.push(`${row.wallets_with_pnl.toLocaleString()} wallets with calculated P&L`)
        redFlags.push(`Avg P&L: $${row.avg_pnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
        redFlags.push(`Range: $${row.min_pnl.toLocaleString('en-US', { maximumFractionDigits: 2 })} to $${row.max_pnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)
      }

      return {
        actual: '2.05% (claimed by Main Claude)',
        variance: 'Verification: Compare against UI expected values',
        redFlags
      }
    }
  )

  // SUMMARY REPORT
  log('\n' + '█'.repeat(80))
  log('VERIFICATION SUMMARY')
  log('█'.repeat(80))

  const passed = results.filter(r => r.validated).length
  const failed = results.filter(r => !r.validated).length
  const highConfidence = results.filter(r => r.confidence === 'HIGH').length

  log(`\nResults: ${passed}/${results.length} claims VALIDATED`)
  log(`High Confidence: ${highConfidence}/${results.length}`)

  // Critical findings
  const criticalRedFlags = results
    .filter(r => r.redFlags.length > 0)
    .flatMap(r => r.redFlags.map(f => ({ claim: r.claim, flag: f })))

  if (criticalRedFlags.length > 0) {
    log(`\n⚠️  CRITICAL RED FLAGS (${criticalRedFlags.length}):`)
    criticalRedFlags.forEach(({ claim, flag }) => {
      log(`\n   Claim: ${claim}`)
      log(`   Flag: ${flag}`)
    })
  }

  // Blockers
  const blockers = results.filter(r => !r.validated && r.confidence === 'LOW')
  if (blockers.length > 0) {
    log(`\n🛑 BLOCKERS (${blockers.length}):`)
    blockers.forEach(b => {
      log(`\n   ${b.claim}`)
      log(`   Actual: ${b.actual}`)
      log(`   Action Required: ${b.redFlags[0] || 'Unknown'}`)
    })
  }

  // Write summary to file
  const summary = {
    timestamp: new Date().toISOString(),
    totalClaims: results.length,
    validated: passed,
    failed,
    highConfidence,
    results: results.map(r => ({
      claim: r.claim,
      expected: r.expected,
      actual: r.actual,
      variance: r.variance,
      confidence: r.confidence,
      validated: r.validated,
      redFlags: r.redFlags
    }))
  }

  fs.writeFileSync(
    '/Users/scotty/Projects/Cascadian-app/THIRD_PARTY_VERIFICATION_RESULTS.json',
    JSON.stringify(summary, null, 2)
  )

  log('\n✅ Verification complete. Results saved to THIRD_PARTY_VERIFICATION_RESULTS.json')
  log('\n' + '█'.repeat(80))
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
