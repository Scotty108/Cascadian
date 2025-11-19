import { clickhouse } from '../lib/clickhouse/client'

async function testFactTradesClean() {
  console.log('📊 C2 Phase 2: Testing fact_trades_clean Incremental Coverage\n')

  // Test join on transaction_hash (strongest key from earlier findings)
  // Use direct query instead of temp table joins due to async_insert settings
  const joinTest = `
    WITH orphan_sample AS (
      SELECT *
      FROM tmp_c2_orphan_sample_100k
    ),
    ftc_match_counts AS (
      SELECT tx_hash, count() as match_count
      FROM fact_trades_clean
      GROUP BY tx_hash
    )
    SELECT
      count() AS total_orphans,
      countIf(ftc.cid IS NOT NULL AND ftc.cid != '' AND length(ftc.cid) = 64) AS ftc_has_cid,
      countIf(mc.match_count > 1) AS ambiguous_matches,
      countIf(mc.match_count = 1 AND ftc.cid IS NOT NULL AND ftc.cid != '' AND length(ftc.cid) = 64) AS safe_matches,
      countIf(ftc.cid IS NULL) AS no_match,
      round(100.0 * countIf(mc.match_count = 1 AND ftc.cid IS NOT NULL AND ftc.cid != '' AND length(ftc.cid) = 64) / count(), 2) AS safe_coverage_pct,
      round(100.0 * countIf(mc.match_count > 1) / count(), 2) AS ambiguous_pct,
      round(100.0 * countIf(ftc.cid IS NULL) / count(), 2) AS no_match_pct
    FROM orphan_sample o
    LEFT JOIN (
      SELECT DISTINCT tx_hash, cid
      FROM fact_trades_clean
      WHERE tx_hash != ''
    ) ftc ON o.transaction_hash = ftc.tx_hash
    LEFT JOIN ftc_match_counts mc ON o.transaction_hash = mc.tx_hash
  `

  const joinResult = await clickhouse.query({
    query: joinTest,
    format: 'JSONEachRow'
  })

  const joinData = await joinResult.json()
  const result = joinData[0]

  console.log('fact_trades_clean Join Test Results:')
  console.log('  Total orphans tested:', result.total_orphans.toLocaleString())
  console.log('  ✅ Safe matches (1:1, valid cid):', result.safe_matches.toLocaleString(), `(${result.safe_coverage_pct}%)`)
  console.log('  ⚠️  Ambiguous (multiple matches):', result.ambiguous_matches.toLocaleString(), `(${result.ambiguous_pct}%)`)
  console.log('  ❌ No match:', result.no_match.toLocaleString(), `(${result.no_match_pct}%)`)

  // Classify into buckets
  console.log('\nClassification:')
  console.log('  SAFE:', result.safe_coverage_pct + '% of orphans can be repaired safely')
  console.log('  AMBIGUOUS:', result.ambiguous_pct + '% require disambiguation logic')
  console.log('  MISSING:', result.no_match_pct + '% cannot be repaired via fact_trades_clean')

  // Extrapolate to global orphan count
  const globalOrphans = 42872936 // From Phase 1
  const safeGlobal = Math.round(globalOrphans * (result.safe_coverage_pct / 100))
  const ambiguousGlobal = Math.round(globalOrphans * (result.ambiguous_pct / 100))

  console.log('\nGlobal Extrapolation (42,872,936 total orphans):')
  console.log('  Safe repairs:', safeGlobal.toLocaleString(), 'trades')
  console.log('  Ambiguous:', ambiguousGlobal.toLocaleString(), 'trades (need disambiguation)')

  // Estimate new global coverage if only Safe mappings integrated
  const currentValid = 96752024 // From Phase 1
  const newValid = currentValid + safeGlobal
  const totalTrades = 139624960
  const newCoverage = (100.0 * newValid / totalTrades).toFixed(2)

  console.log('\nProjected V4 Coverage (Safe mappings only):')
  console.log('  Current v3:', '69.29%')
  console.log('  + Safe fact_trades_clean:', `${result.safe_coverage_pct}% of remaining orphans`)
  console.log('  = Projected v4:', newCoverage + '%')
  console.log('  Improvement:', (parseFloat(newCoverage) - 69.29).toFixed(2) + '% gain')

  return {
    sample_size: result.total_orphans,
    safe_pct: result.safe_coverage_pct,
    ambiguous_pct: result.ambiguous_pct,
    missing_pct: result.no_match_pct,
    projected_v4_coverage: parseFloat(newCoverage)
  }
}

testFactTradesClean().catch(console.error)
