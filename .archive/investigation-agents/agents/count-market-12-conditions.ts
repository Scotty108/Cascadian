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

async function check() {
  const r1 = await ch.query({
    query: `SELECT countDistinct(condition_id_norm) as distinct_conditions FROM trades_with_direction WHERE market_id = '12'`,
    format: 'JSONEachRow'
  })
  const data1 = await r1.json()

  const r2 = await ch.query({
    query: `SELECT condition_id_norm, count() as trade_count FROM trades_with_direction WHERE market_id = '12' GROUP BY condition_id_norm ORDER BY trade_count DESC LIMIT 10`,
    format: 'JSONEachRow'
  })
  const data2 = await r2.json()

  console.log('Distinct condition_ids with market_id="12":', (data1[0] as any).distinct_conditions)
  console.log('\nTop 10 by trade count:')
  data2.forEach((row: any, i: number) => {
    console.log(`  ${i+1}. ${row.condition_id_norm} (${row.trade_count} trades)`)
  })
}

check().catch(console.error)
