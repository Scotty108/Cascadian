import { config } from 'dotenv'
import { resolve } from 'path'
import { clickhouse } from '../lib/clickhouse/client'

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') })

async function rebaselineV3Coverage() {
  console.log('📊 C2 Re-Baseline: V3 Coverage Verification\n')
  console.log('=' .repeat(60))

  // Query vw_trades_canonical_v3_preview (current production-ready view)
  const globalCoverage = await clickhouse.query({
    query: `
      SELECT
        count() AS total_trades,
        countIf(
          canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
          AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
        ) AS valid_trades,
        countIf(
          canonical_condition_id IS NULL
          OR canonical_condition_id = ''
          OR canonical_condition_id = '0000000000000000000000000000000000000000000000000000000000000000'
        ) AS orphaned_trades,
        round(100.0 * valid_trades / total_trades, 2) AS coverage_pct,
        round(100.0 * orphaned_trades / total_trades, 2) AS orphan_pct,
        count(DISTINCT trade_id) AS unique_trade_ids
      FROM vw_trades_canonical_v3_preview
    `,
    format: 'JSONEachRow'
  })

  const coverageText = await globalCoverage.text()
  const result = JSON.parse(coverageText.split('\n')[0])

  console.log('\n📈 Global Coverage (vw_trades_canonical_v3_preview):')
  console.log('  Total trades:', result.total_trades.toLocaleString())
  console.log('  Valid trades:', result.valid_trades.toLocaleString())
  console.log('  Orphaned trades:', result.orphaned_trades.toLocaleString())
  console.log('  Coverage:', result.coverage_pct + '%')
  console.log('  Orphan rate:', result.orphan_pct + '%')
  console.log('  Unique trade_ids:', result.unique_trade_ids.toLocaleString())

  // Verify matches C1's reported numbers (~69% coverage)
  const expectedCoverage = 69.06
  const tolerance = 1.0 // 1% tolerance

  console.log('\n🔍 Verification Against C1 Report:')
  console.log('  Expected coverage: ~' + expectedCoverage + '%')
  console.log('  Actual coverage: ' + result.coverage_pct + '%')
  console.log('  Difference: ' + Math.abs(result.coverage_pct - expectedCoverage).toFixed(2) + '%')

  if (Math.abs(result.coverage_pct - expectedCoverage) > tolerance) {
    console.log(`\n⚠️  Coverage mismatch: Expected ~${expectedCoverage}%, got ${result.coverage_pct}%`)
  } else {
    console.log(`\n✅ Coverage verified: ${result.coverage_pct}% matches C1's report (~${expectedCoverage}%)`)
  }

  // Check canonical_condition_source breakdown
  console.log('\n📊 Source Breakdown (canonical_condition_source):')
  const sourceBreakdown = await clickhouse.query({
    query: `
      SELECT
        canonical_condition_source AS source,
        count() AS trade_count,
        round(100.0 * count() / (SELECT count() FROM vw_trades_canonical_v3_preview), 2) AS pct
      FROM vw_trades_canonical_v3_preview
      GROUP BY source
      ORDER BY trade_count DESC
    `,
    format: 'JSONEachRow'
  })

  const sourceText = await sourceBreakdown.text()
  sourceText.split('\n').filter(line => line.trim()).forEach(line => {
    const row = JSON.parse(line)
    const sourceLabel = row.source || '(orphan)'
    console.log(`  ${sourceLabel}: ${row.trade_count.toLocaleString()} trades (${row.pct}%)`)
  })

  // Additional diagnostics: Check for valid vs orphan breakdown by source
  console.log('\n🔬 Detailed Source Analysis:')
  const detailedSource = await clickhouse.query({
    query: `
      SELECT
        canonical_condition_source AS source,
        countIf(
          canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
          AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
        ) AS valid_count,
        countIf(
          canonical_condition_id IS NULL
          OR canonical_condition_id = ''
          OR canonical_condition_id = '0000000000000000000000000000000000000000000000000000000000000000'
        ) AS orphan_count,
        count() AS total_count
      FROM vw_trades_canonical_v3_preview
      GROUP BY source
      ORDER BY total_count DESC
    `,
    format: 'JSONEachRow'
  })

  const detailedText = await detailedSource.text()
  detailedText.split('\n').filter(line => line.trim()).forEach(line => {
    const row = JSON.parse(line)
    const sourceLabel = row.source || '(no source/orphan)'
    const validPct = ((row.valid_count / row.total_count) * 100).toFixed(2)
    console.log(`  ${sourceLabel}:`)
    console.log(`    Valid: ${row.valid_count.toLocaleString()} (${validPct}%)`)
    console.log(`    Orphan: ${row.orphan_count.toLocaleString()}`)
  })

  console.log('\n' + '='.repeat(60))
  console.log('✅ Re-baseline verification complete')

  return result
}

rebaselineV3Coverage().catch(console.error)
