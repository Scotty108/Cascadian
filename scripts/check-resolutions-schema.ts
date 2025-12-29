import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function checkSchema() {
  const result = await clickhouse.query({
    query: 'DESCRIBE pm_ctf_events',
    format: 'JSONEachRow'
  })
  const schema = await result.json()
  console.log('pm_ctf_events schema:')
  console.log(JSON.stringify(schema, null, 2))

  // Also get a sample row to see data format
  const sampleResult = await clickhouse.query({
    query: `SELECT * FROM pm_ctf_events WHERE event_type = 'PayoutRedemption' AND is_deleted = 0 LIMIT 1`,
    format: 'JSONEachRow'
  })
  const sample = await sampleResult.json()
  console.log('\nSample PayoutRedemption row:')
  console.log(JSON.stringify(sample, null, 2))
}

checkSchema()
