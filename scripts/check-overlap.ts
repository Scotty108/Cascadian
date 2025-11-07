import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function main() {
  const client = getClickHouseClient()

  console.log('=== Checking Overlap Between market_outcomes and Resolutions ===\n')

  // Check overlap
  const overlapResult = await client.query({
    query: `
      SELECT
        COUNT(DISTINCT mo.condition_id_norm) as total_in_outcomes,
        COUNT(DISTINCT CASE
          WHEN r.condition_id_norm IS NOT NULL AND r.resolved_at IS NOT NULL
          THEN mo.condition_id_norm
        END) as outcomes_that_are_resolved
      FROM market_outcomes mo
      LEFT JOIN market_resolutions_final r
        ON mo.condition_id_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  })

  const overlap = await overlapResult.json()
  console.log('Overlap statistics:')
  console.table(overlap)

  // Get specific examples of resolved conditions in market_outcomes
  console.log('\n=== Resolved conditions in market_outcomes table ===')
  const examplesResult = await client.query({
    query: `
      SELECT
        mo.condition_id_norm,
        mo.outcomes,
        r.winning_index,
        r.winning_outcome,
        r.resolved_at
      FROM market_outcomes mo
      INNER JOIN market_resolutions_final r
        ON mo.condition_id_norm = r.condition_id_norm
      WHERE r.resolved_at IS NOT NULL
      LIMIT 20
    `,
    format: 'JSONEachRow',
  })

  const examples = await examplesResult.json()
  console.table(examples)

  await client.close()
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
