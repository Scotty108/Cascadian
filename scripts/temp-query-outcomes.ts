import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {

  const result = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT wallet_address) as wallets_with_outcomes,
        COUNT(*) as total_outcome_rows,
        AVG(won) * 100 as avg_accuracy_pct,
        COUNT(DISTINCT condition_id) as markets_scored
      FROM wallet_resolution_outcomes
    `,
    format: 'JSONEachRow'
  })

  const rows = await result.json()
  console.log('RESOLUTION_OUTCOMES_COVERAGE:', JSON.stringify(rows[0], null, 2))
}

main()
