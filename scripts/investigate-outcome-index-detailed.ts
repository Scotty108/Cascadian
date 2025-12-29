import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function investigateDetailed() {
  console.log('=== Detailed Investigation: Outcome Index Consistency ===\n')

  // First, let's check both [0,1] and [1,0] resolutions
  console.log('Query 1: Token rank distribution for [0,1] markets (outcome 1 wins)\n')

  const q1Result = await clickhouse.query({
    query: `
      WITH resolved_markets AS (
          SELECT condition_id
          FROM pm_condition_resolutions
          WHERE payout_numerators = '[0,1]'
          LIMIT 200
      ),
      token_info AS (
          SELECT
              m.condition_id,
              m.outcome_index,
              m.token_id_dec,
              ROW_NUMBER() OVER (PARTITION BY m.condition_id ORDER BY m.token_id_dec) as token_rank
          FROM pm_token_to_condition_map_v3 m
          WHERE m.condition_id IN (SELECT condition_id FROM resolved_markets)
      )
      SELECT
          outcome_index,
          token_rank,
          count(*) as cnt
      FROM token_info
      GROUP BY outcome_index, token_rank
      ORDER BY outcome_index, token_rank
    `,
    format: 'JSONEachRow'
  })

  const q1Data = await q1Result.json<{outcome_index: number, token_rank: string, cnt: string}>()
  console.table(q1Data)

  console.log('\nQuery 2: Token rank distribution for [1,0] markets (outcome 0 wins)\n')

  const q2Result = await clickhouse.query({
    query: `
      WITH resolved_markets AS (
          SELECT condition_id
          FROM pm_condition_resolutions
          WHERE payout_numerators = '[1,0]'
          LIMIT 200
      ),
      token_info AS (
          SELECT
              m.condition_id,
              m.outcome_index,
              m.token_id_dec,
              ROW_NUMBER() OVER (PARTITION BY m.condition_id ORDER BY m.token_id_dec) as token_rank
          FROM pm_token_to_condition_map_v3 m
          WHERE m.condition_id IN (SELECT condition_id FROM resolved_markets)
      )
      SELECT
          outcome_index,
          token_rank,
          count(*) as cnt
      FROM token_info
      GROUP BY outcome_index, token_rank
      ORDER BY outcome_index, token_rank
    `,
    format: 'JSONEachRow'
  })

  const q2Data = await q2Result.json<{outcome_index: number, token_rank: string, cnt: string}>()
  console.table(q2Data)

  // Now let's look at specific examples to understand the inconsistencies
  console.log('\nQuery 3: Sample markets showing the relationship\n')

  const q3Result = await clickhouse.query({
    query: `
      SELECT
          m.condition_id,
          m.question,
          arraySort((x, y) -> y,
                    groupArray(m.outcome_index),
                    groupArray(m.token_id_dec)) as outcome_indices_by_token_order,
          r.payout_numerators
      FROM pm_token_to_condition_map_v3 m
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.payout_numerators IN ('[0,1]', '[1,0]')
      GROUP BY m.condition_id, m.question, r.payout_numerators
      ORDER BY payout_numerators, condition_id
      LIMIT 30
    `,
    format: 'JSONEachRow'
  })

  const q3Data = await q3Result.json<{
    condition_id: string,
    question: string,
    outcome_indices_by_token_order: number[],
    payout_numerators: string
  }>()

  console.log('Sample markets:')
  for (const row of q3Data) {
    console.log(`\nCondition: ${row.condition_id.slice(0, 16)}...`)
    console.log(`Question: ${row.question.slice(0, 80)}`)
    console.log(`Payout: ${row.payout_numerators}`)
    console.log(`Outcome indices by token order: ${JSON.stringify(row.outcome_indices_by_token_order)}`)

    // Check if it's consistent
    const expectedOrder = row.outcome_indices_by_token_order.toString() === '0,1' ? 'CONSISTENT (0,1)' :
                          row.outcome_indices_by_token_order.toString() === '1,0' ? 'REVERSED (1,0)' :
                          'INCONSISTENT'
    console.log(`Pattern: ${expectedOrder}`)
  }

  console.log('\n=== FINAL ANALYSIS ===\n')

  // Count the patterns
  const consistent01 = q3Data.filter(d => d.outcome_indices_by_token_order.toString() === '0,1').length
  const reversed10 = q3Data.filter(d => d.outcome_indices_by_token_order.toString() === '1,0').length
  const other = q3Data.filter(d => d.outcome_indices_by_token_order.toString() !== '0,1' && d.outcome_indices_by_token_order.toString() !== '1,0').length

  console.log(`Total sampled: ${q3Data.length}`)
  console.log(`Consistent [0,1] pattern: ${consistent01} (${(consistent01/q3Data.length*100).toFixed(1)}%)`)
  console.log(`Reversed [1,0] pattern: ${reversed10} (${(reversed10/q3Data.length*100).toFixed(1)}%)`)
  console.log(`Other/Inconsistent: ${other} (${(other/q3Data.length*100).toFixed(1)}%)`)

  // Final verdict
  if (consistent01 === q3Data.length) {
    console.log('\n✅ FULLY CONSISTENT: outcome_index 0 = lowest token_id, outcome_index 1 = highest token_id')
  } else if (reversed10 === q3Data.length) {
    console.log('\n✅ FULLY CONSISTENT (REVERSED): outcome_index 1 = lowest token_id, outcome_index 0 = highest token_id')
  } else if (consistent01 > q3Data.length * 0.9 || reversed10 > q3Data.length * 0.9) {
    console.log('\n⚠️  MOSTLY CONSISTENT but with exceptions - investigate edge cases')
  } else {
    console.log('\n❌ INCONSISTENT: outcome_index assignment varies per market')
  }
}

investigateDetailed().catch(console.error)
