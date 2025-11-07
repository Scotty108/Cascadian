import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

interface OutcomeExpanded {
  condition_id_norm: string
  outcome_idx: number
  outcome_label: string
}

interface Resolution {
  condition_id_norm: string
  winning_index: number | null
  winning_outcome: string | null
  resolved_at: string | null
}

interface SpotCheckRow {
  condition_id_norm: string
  label_at_idx0: string
  label_at_idx1: string
  winning_index: number | null
  winning_outcome: string | null
  label_at_win_idx: string | null
  match: boolean
}

async function main() {
  const client = getClickHouseClient()

  console.log('=== Task 5A: Query market_outcomes_expanded ===\n')

  // First, let's see what tables exist
  const tablesResult = await client.query({
    query: `
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '%outcome%' OR name LIKE '%resolution%')
      ORDER BY name
    `,
    format: 'JSONEachRow',
  })

  const tables = await tablesResult.json() as Array<{ name: string; engine: string; total_rows: string }>
  console.log('Available tables:')
  tables.forEach(t => console.log(`  - ${t.name} (${t.engine}, ${t.total_rows} rows)`))
  console.log()

  // Task 5A: Get sample of outcomes expanded
  console.log('Sample outcomes (first 20):')
  const outcomesResult = await client.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_idx,
        outcome_label
      FROM market_outcomes_expanded
      ORDER BY condition_id_norm, outcome_idx
      LIMIT 20
    `,
    format: 'JSONEachRow',
  })

  const outcomesSample = await outcomesResult.json() as OutcomeExpanded[]
  console.table(outcomesSample)

  console.log('\n=== Task 5B: Query market_resolutions_final ===\n')

  // Check structure of resolution table
  const resolutionStructure = await client.query({
    query: `
      SELECT *
      FROM market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow',
  })

  const resolutionSample = await resolutionStructure.json()
  console.log('Resolution table structure (first 5 rows):')
  console.table(resolutionSample)

  console.log('\n=== Task 5C & 5D: Spot Check - 10 Random Resolved Conditions ===\n')

  // Get 10 random resolved conditions with their outcomes and resolutions
  const spotCheckQuery = `
    WITH resolved_conditions AS (
      SELECT DISTINCT condition_id_norm
      FROM market_resolutions_final
      WHERE resolved_at IS NOT NULL
        AND condition_id_norm IS NOT NULL
      ORDER BY rand()
      LIMIT 10
    ),
    outcomes_pivoted AS (
      SELECT
        condition_id_norm,
        argMaxIf(outcome_label, outcome_idx, outcome_idx = 0) as label_at_idx0,
        argMaxIf(outcome_label, outcome_idx, outcome_idx = 1) as label_at_idx1
      FROM market_outcomes_expanded
      WHERE condition_id_norm IN (SELECT condition_id_norm FROM resolved_conditions)
      GROUP BY condition_id_norm
    ),
    resolutions AS (
      SELECT
        condition_id_norm,
        winning_index,
        winning_outcome,
        resolved_at
      FROM market_resolutions_final
      WHERE condition_id_norm IN (SELECT condition_id_norm FROM resolved_conditions)
    )
    SELECT
      r.condition_id_norm,
      o.label_at_idx0,
      o.label_at_idx1,
      r.winning_index,
      r.winning_outcome,
      r.resolved_at,
      -- Get label at winning index
      multiIf(
        r.winning_index = 0, o.label_at_idx0,
        r.winning_index = 1, o.label_at_idx1,
        NULL
      ) as label_at_win_idx
    FROM resolutions r
    LEFT JOIN outcomes_pivoted o ON r.condition_id_norm = o.condition_id_norm
    ORDER BY r.condition_id_norm
  `

  const spotCheckResult = await client.query({
    query: spotCheckQuery,
    format: 'JSONEachRow',
  })

  const spotChecks = await spotCheckResult.json() as Array<{
    condition_id_norm: string
    label_at_idx0: string
    label_at_idx1: string
    winning_index: number
    winning_outcome: string | null
    resolved_at: string
    label_at_win_idx: string | null
  }>

  // Process and validate
  const results: SpotCheckRow[] = spotChecks.map(row => {
    const labelAtWinIdx = row.label_at_win_idx
    const winningOutcome = row.winning_outcome

    // Check if they match (case-insensitive)
    const match = labelAtWinIdx && winningOutcome
      ? labelAtWinIdx.toUpperCase() === winningOutcome.toUpperCase()
      : false

    return {
      condition_id_norm: row.condition_id_norm,
      label_at_idx0: row.label_at_idx0,
      label_at_idx1: row.label_at_idx1,
      winning_index: row.winning_index,
      winning_outcome: winningOutcome,
      label_at_win_idx: labelAtWinIdx,
      match,
    }
  })

  console.log('Spot Check Results:')
  console.table(results)

  // Task 5D: Count matches
  const matchCount = results.filter(r => r.match).length
  const totalCount = results.length

  console.log(`\n=== Validation Summary ===`)
  console.log(`Total spot checks: ${totalCount}`)
  console.log(`Matches: ${matchCount}`)
  console.log(`Mismatches: ${totalCount - matchCount}`)
  console.log(`Match rate: ${((matchCount / totalCount) * 100).toFixed(1)}%`)

  // Task 5E: Report mismatches
  if (matchCount < totalCount) {
    console.log('\n=== Task 5E: Mismatches Found ===\n')
    const mismatches = results.filter(r => !r.match)

    console.log('FAILED CONDITIONS:')
    mismatches.forEach(m => {
      console.log(`\nCondition: ${m.condition_id_norm}`)
      console.log(`  Outcome at idx 0: ${m.label_at_idx0}`)
      console.log(`  Outcome at idx 1: ${m.label_at_idx1}`)
      console.log(`  Winning index: ${m.winning_index}`)
      console.log(`  Expected (from index): ${m.label_at_win_idx}`)
      console.log(`  Actual (from resolution): ${m.winning_outcome}`)
    })

    // Check for normalization issues
    console.log('\n=== Checking for normalization issues ===')
    for (const m of mismatches) {
      const checkResult = await client.query({
        query: `
          SELECT
            condition_id_norm,
            winning_outcome,
            winning_index,
            source
          FROM market_resolutions_final
          WHERE condition_id_norm = '${m.condition_id_norm}'
          LIMIT 1
        `,
        format: 'JSONEachRow',
      })

      const checkData = await checkResult.json() as Array<{
        condition_id_norm: string
        winning_outcome: string
        winning_index: number
        source: string
      }>

      if (checkData.length > 0) {
        console.log(`\nCondition: ${m.condition_id_norm}`)
        console.log(`  Winning outcome: ${checkData[0].winning_outcome}`)
        console.log(`  Winning index: ${checkData[0].winning_index}`)
        console.log(`  Source: ${checkData[0].source}`)
      }
    }

    console.log('\n❌ VALIDATION FAILED - Some outcome mappings are incorrect')
    process.exit(1)
  } else {
    console.log('\n✅ VALIDATION PASSED - All 10 spot checks matched!')
    console.log('   Outcome mapping is correct.')
  }

  // Additional stats
  console.log('\n=== Additional Statistics ===')

  const statsResult = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT condition_id_norm) as total_conditions,
        COUNT(DISTINCT CASE WHEN resolved_at IS NOT NULL THEN condition_id_norm END) as resolved_conditions,
        COUNT(DISTINCT CASE WHEN winning_index = 0 THEN condition_id_norm END) as index_0_wins,
        COUNT(DISTINCT CASE WHEN winning_index = 1 THEN condition_id_norm END) as index_1_wins
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow',
  })

  const stats = await statsResult.json() as Array<{
    total_conditions: string
    resolved_conditions: string
    index_0_wins: string
    index_1_wins: string
  }>

  console.log('Resolution statistics:')
  console.table(stats)

  // Check outcome distribution
  const outcomeStatsResult = await client.query({
    query: `
      SELECT
        outcome_label,
        COUNT(DISTINCT condition_id_norm) as condition_count
      FROM market_outcomes_expanded
      GROUP BY outcome_label
      ORDER BY condition_count DESC
    `,
    format: 'JSONEachRow',
  })

  const outcomeStats = await outcomeStatsResult.json()
  console.log('\nOutcome label distribution:')
  console.table(outcomeStats)

  await client.close()
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
