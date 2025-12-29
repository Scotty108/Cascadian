#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  console.log('=== pm_condition_resolutions schema ===')
  const schema = await clickhouse.query({
    query: 'DESCRIBE pm_condition_resolutions',
    format: 'TabSeparated',
  })
  console.log(await schema.text())

  console.log('\n=== Sample row ===')
  const sample = await clickhouse.query({
    query: 'SELECT * FROM pm_condition_resolutions LIMIT 1',
    format: 'JSONEachRow',
  })
  console.log(JSON.stringify(await sample.json(), null, 2))

  await clickhouse.close()
}

main().catch(console.error)
