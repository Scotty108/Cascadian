import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function investigateOutcomeIndex() {
  console.log('=== QUERY 1: Tables with outcome/token/market in name ===\n')

  const q1Result = await clickhouse.query({
    query: `
      SELECT name, engine
      FROM system.tables
      WHERE database = 'default'
        AND (name LIKE '%outcome%' OR name LIKE '%token%' OR name LIKE '%market%')
    `,
    format: 'TabSeparated'
  })

  const q1Text = await q1Result.text()
  console.log(q1Text)
  console.log('\n')

  console.log('=== QUERY 2: Token rank vs outcome_index for [0,1] resolved markets ===\n')

  const q2Result = await clickhouse.query({
    query: `
      WITH resolved_markets AS (
          SELECT condition_id
          FROM pm_condition_resolutions
          WHERE payout_numerators = '[0,1]'
          LIMIT 100
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
    format: 'TabSeparated'
  })

  const q2Text = await q2Result.text()
  console.log(q2Text)
  console.log('\n')

  console.log('=== QUERY 3: Sample markets with resolutions ===\n')

  const q3Result = await clickhouse.query({
    query: `
      SELECT
          m.condition_id,
          m.question,
          m.outcome_index,
          m.token_id_dec,
          r.payout_numerators
      FROM pm_token_to_condition_map_v3 m
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.payout_numerators IN ('[0,1]', '[1,0]')
      ORDER BY m.condition_id, m.outcome_index
      LIMIT 20
    `,
    format: 'TabSeparated'
  })

  const q3Text = await q3Result.text()
  console.log(q3Text)

  console.log('\n=== ANALYSIS ===\n')

  // Now let's parse and analyze the results
  const q2Lines = q2Text.trim().split('\n')
  const q2Data: Array<{outcome_index: number, token_rank: number, cnt: number}> = []

  for (const line of q2Lines) {
    const [outcome_index, token_rank, cnt] = line.split('\t').map(Number)
    q2Data.push({ outcome_index, token_rank, cnt })
  }

  console.log('Query 2 Analysis:')
  console.log('For markets resolved [0,1] (outcome 1 wins):')
  console.table(q2Data)

  // Check for consistency
  const outcome0TokenRank1 = q2Data.find(d => d.outcome_index === 0 && d.token_rank === 1)
  const outcome1TokenRank2 = q2Data.find(d => d.outcome_index === 1 && d.token_rank === 2)

  if (outcome0TokenRank1 && outcome1TokenRank2) {
    console.log('\n✅ CONSISTENT PATTERN DETECTED:')
    console.log('   - outcome_index 0 corresponds to lowest token_id (rank 1)')
    console.log('   - outcome_index 1 corresponds to highest token_id (rank 2)')
    console.log('   - This means outcome_index is assigned by token_id ordering')
  } else if (q2Data.find(d => d.outcome_index === 0 && d.token_rank === 2) &&
             q2Data.find(d => d.outcome_index === 1 && d.token_rank === 1)) {
    console.log('\n✅ CONSISTENT PATTERN DETECTED (REVERSED):')
    console.log('   - outcome_index 1 corresponds to lowest token_id (rank 1)')
    console.log('   - outcome_index 0 corresponds to highest token_id (rank 2)')
    console.log('   - This means outcome_index is INVERSELY assigned by token_id ordering')
  } else {
    console.log('\n⚠️  INCONSISTENT PATTERN:')
    console.log('   - outcome_index does not have a consistent relationship with token_id ordering')
    console.log('   - This could indicate market-specific assignment')
  }
}

investigateOutcomeIndex().catch(console.error)
