import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function main() {
  const client = getClickHouseClient()

  console.log('=== Investigating Outcome Mapping Issue ===\n')

  // First, let's check coverage of market_outcomes vs resolved conditions
  console.log('1. Checking coverage of market_outcomes:')
  const coverageResult = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT r.condition_id_norm) as total_resolved,
        COUNT(DISTINCT CASE
          WHEN o.condition_id_norm IS NOT NULL
          THEN r.condition_id_norm
        END) as has_outcomes,
        COUNT(DISTINCT CASE
          WHEN o.condition_id_norm IS NULL
          THEN r.condition_id_norm
        END) as missing_outcomes
      FROM (
        SELECT DISTINCT condition_id_norm
        FROM market_resolutions_final
        WHERE resolved_at IS NOT NULL
      ) r
      LEFT JOIN (
        SELECT DISTINCT condition_id_norm
        FROM market_outcomes_expanded
      ) o ON r.condition_id_norm = o.condition_id_norm
    `,
    format: 'JSONEachRow',
  })

  const coverage = await coverageResult.json()
  console.table(coverage)

  // Get 10 random resolved conditions that HAVE outcome mappings
  console.log('\n2. Selecting 10 random resolved conditions WITH outcome mappings:')
  const validConditionsResult = await client.query({
    query: `
      WITH resolved_with_outcomes AS (
        SELECT DISTINCT r.condition_id_norm
        FROM market_resolutions_final r
        INNER JOIN market_outcomes_expanded o
          ON r.condition_id_norm = o.condition_id_norm
        WHERE r.resolved_at IS NOT NULL
        ORDER BY rand()
        LIMIT 10
      ),
      outcomes_pivoted AS (
        SELECT
          condition_id_norm,
          argMaxIf(outcome_label, outcome_idx, outcome_idx = 0) as label_at_idx0,
          argMaxIf(outcome_label, outcome_idx, outcome_idx = 1) as label_at_idx1
        FROM market_outcomes_expanded
        WHERE condition_id_norm IN (SELECT condition_id_norm FROM resolved_with_outcomes)
        GROUP BY condition_id_norm
      ),
      resolutions AS (
        SELECT
          condition_id_norm,
          winning_index,
          winning_outcome,
          resolved_at
        FROM market_resolutions_final
        WHERE condition_id_norm IN (SELECT condition_id_norm FROM resolved_with_outcomes)
      )
      SELECT
        r.condition_id_norm,
        o.label_at_idx0,
        o.label_at_idx1,
        r.winning_index,
        r.winning_outcome,
        r.resolved_at,
        multiIf(
          r.winning_index = 0, o.label_at_idx0,
          r.winning_index = 1, o.label_at_idx1,
          NULL
        ) as label_at_win_idx
      FROM resolutions r
      LEFT JOIN outcomes_pivoted o ON r.condition_id_norm = o.condition_id_norm
      ORDER BY r.condition_id_norm
    `,
    format: 'JSONEachRow',
  })

  const validConditions = await validConditionsResult.json() as Array<{
    condition_id_norm: string
    label_at_idx0: string
    label_at_idx1: string
    winning_index: number
    winning_outcome: string
    resolved_at: string
    label_at_win_idx: string
  }>

  console.log('Selected conditions:')
  console.table(validConditions)

  // Validate matches
  console.log('\n=== Task 5C & 5D: Spot Check Validation ===\n')

  const results = validConditions.map(row => {
    const labelAtWinIdx = row.label_at_win_idx
    const winningOutcome = row.winning_outcome

    // Check if they match (case-insensitive)
    const match = labelAtWinIdx && winningOutcome
      ? labelAtWinIdx.toUpperCase() === winningOutcome.toUpperCase()
      : false

    return {
      condition_id_norm: row.condition_id_norm.substring(0, 16) + '...',
      label_at_idx0: row.label_at_idx0,
      label_at_idx1: row.label_at_idx1,
      winning_index: row.winning_index,
      winning_outcome: winningOutcome,
      label_at_win_idx: labelAtWinIdx,
      match: match ? 'YES' : 'NO',
    }
  })

  console.log('Validation Results:')
  console.table(results)

  const matchCount = results.filter(r => r.match === 'YES').length
  const totalCount = results.length

  console.log(`\n=== Validation Summary ===`)
  console.log(`Total spot checks: ${totalCount}`)
  console.log(`Matches: ${matchCount}`)
  console.log(`Mismatches: ${totalCount - matchCount}`)
  console.log(`Match rate: ${((matchCount / totalCount) * 100).toFixed(1)}%`)

  if (matchCount < totalCount) {
    console.log('\n=== Analyzing Mismatches ===\n')
    const mismatches = validConditions.filter((_, i) => results[i].match === 'NO')

    console.log('Mismatch details:')
    mismatches.forEach((m, i) => {
      console.log(`\n${i + 1}. Condition: ${m.condition_id_norm}`)
      console.log(`   Label at idx 0: "${m.label_at_idx0}"`)
      console.log(`   Label at idx 1: "${m.label_at_idx1}"`)
      console.log(`   Winning index: ${m.winning_index}`)
      console.log(`   Label at winning index: "${m.label_at_win_idx}"`)
      console.log(`   Winning outcome from resolution: "${m.winning_outcome}"`)
      console.log(`   Case comparison: "${m.label_at_win_idx?.toUpperCase()}" vs "${m.winning_outcome?.toUpperCase()}"`)
    })

    console.log('\n❌ VALIDATION FAILED')
    process.exit(1)
  } else {
    console.log('\n✅ VALIDATION PASSED - All 10 spot checks matched!')
  }

  // Additional statistics
  console.log('\n=== Additional Statistics ===\n')

  // Check outcome label distribution
  const labelDistResult = await client.query({
    query: `
      SELECT
        outcome_label,
        COUNT(*) as count,
        COUNT(DISTINCT condition_id_norm) as unique_conditions
      FROM market_outcomes_expanded
      GROUP BY outcome_label
      ORDER BY count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  })

  const labelDist = await labelDistResult.json()
  console.log('Outcome label distribution:')
  console.table(labelDist)

  // Check winning outcome distribution in resolutions
  const winningDistResult = await client.query({
    query: `
      SELECT
        winning_outcome,
        COUNT(*) as count,
        COUNT(DISTINCT condition_id_norm) as unique_conditions
      FROM market_resolutions_final
      WHERE resolved_at IS NOT NULL
      GROUP BY winning_outcome
      ORDER BY count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  })

  const winningDist = await winningDistResult.json()
  console.log('\nWinning outcome distribution (from resolutions):')
  console.table(winningDist)

  // Check binary outcomes
  console.log('\n=== Binary Outcome Verification ===\n')
  const binaryCheckResult = await client.query({
    query: `
      SELECT
        outcome_count,
        COUNT(DISTINCT condition_id_norm) as condition_count
      FROM (
        SELECT
          condition_id_norm,
          COUNT(DISTINCT outcome_idx) as outcome_count
        FROM market_outcomes_expanded
        GROUP BY condition_id_norm
      )
      GROUP BY outcome_count
      ORDER BY outcome_count
    `,
    format: 'JSONEachRow',
  })

  const binaryCheck = await binaryCheckResult.json()
  console.log('Outcome count distribution:')
  console.table(binaryCheck)

  await client.close()
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
