import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function checkMultiOutcome() {
  console.log('=== Checking for markets with more than 2 outcomes ===\n')

  const result = await clickhouse.query({
    query: `
      SELECT
          condition_id,
          question,
          count(*) as num_outcomes,
          groupArray(outcome_index) as outcome_indices,
          groupArray(token_id_dec) as token_ids
      FROM pm_token_to_condition_map_v3
      GROUP BY condition_id, question
      HAVING count(*) > 2
      ORDER BY num_outcomes DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  })

  const data = await result.json<{
    condition_id: string,
    question: string,
    num_outcomes: number,
    outcome_indices: number[],
    token_ids: string[]
  }>()

  console.log(`Total multi-outcome markets in sample: ${data.length}\n`)

  if (data.length === 0) {
    console.log('✅ All markets in our database are binary (2 outcomes)')
  } else {
    console.log('⚠️  Found markets with more than 2 outcomes:\n')
    for (const row of data) {
      console.log(`Condition: ${row.condition_id.slice(0, 16)}...`)
      console.log(`Question: ${row.question}`)
      console.log(`Outcomes: ${row.num_outcomes}`)
      console.log(`Outcome indices: ${JSON.stringify(row.outcome_indices)}`)
      console.log('')
    }
  }

  // Also check total count
  const countResult = await clickhouse.query({
    query: `
      SELECT
          count(DISTINCT condition_id) as total_markets,
          sum(case when cnt = 2 then 1 else 0 end) as binary_markets,
          sum(case when cnt > 2 then 1 else 0 end) as multi_outcome_markets,
          max(cnt) as max_outcomes
      FROM (
          SELECT condition_id, count(*) as cnt
          FROM pm_token_to_condition_map_v3
          GROUP BY condition_id
      )
    `,
    format: 'JSONEachRow'
  })

  const stats = await countResult.json<{
    total_markets: string,
    binary_markets: string,
    multi_outcome_markets: string,
    max_outcomes: string
  }>()

  console.log('=== Market Statistics ===')
  console.table(stats)

  const multiPct = (parseInt(stats[0].multi_outcome_markets) / parseInt(stats[0].total_markets) * 100).toFixed(2)
  console.log(`\n${multiPct}% of markets have more than 2 outcomes`)
}

checkMultiOutcome().catch(console.error)
