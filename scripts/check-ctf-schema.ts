import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function checkSchema() {
  try {
    const result = await clickhouse.query({
      query: 'DESCRIBE pm_ctf_events',
      format: 'JSONEachRow',
    })
    const schema = await result.json()
    console.log('pm_ctf_events schema:')
    console.log(JSON.stringify(schema, null, 2))
  } catch (error) {
    console.error('Error:', error)
  }
}

checkSchema()
