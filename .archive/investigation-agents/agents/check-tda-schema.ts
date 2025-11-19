#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@clickhouse/client'

const ch = createClient({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
})

async function checkSchema() {
  const r = await ch.query({
    query: `DESCRIBE trade_direction_assignments`,
    format: 'JSONEachRow'
  })
  const schema = await r.json()
  console.log('trade_direction_assignments schema:')
  schema.forEach((col: any) => {
    console.log(`  ${col.name}: ${col.type}`)
  })
}

checkSchema().catch(console.error)
