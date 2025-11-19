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

async function show() {
  const r = await ch.query({
    query: `SHOW CREATE TABLE vw_trades_canonical`,
    format: 'JSONEachRow'
  })
  const data = await r.json()
  console.log((data[0] as any).statement)

  console.log('\n\n═'.repeat(70))
  console.log('Checking vw_trades_canonical coverage:')
  console.log('═'.repeat(70))

  const stats = await ch.query({
    query: `
      SELECT
        count() as total,
        countIf(condition_id_norm != '') as with_condition,
        countIf(market_id_norm != '') as with_market,
        countIf(trade_direction = 'BUY' OR trade_direction = 'SELL') as with_direction,
        countIf(direction_confidence = 'HIGH') as high_confidence
      FROM vw_trades_canonical
    `,
    format: 'JSONEachRow'
  })
  const st = (await stats.json())[0]
  console.log(`Total: ${Number(st.total).toLocaleString()}`)
  console.log(`With condition_id: ${Number(st.with_condition).toLocaleString()} (${(Number(st.with_condition)/Number(st.total)*100).toFixed(1)}%)`)
  console.log(`With market_id: ${Number(st.with_market).toLocaleString()} (${(Number(st.with_market)/Number(st.total)*100).toFixed(1)}%)`)
  console.log(`With direction (BUY/SELL): ${Number(st.with_direction).toLocaleString()} (${(Number(st.with_direction)/Number(st.total)*100).toFixed(1)}%)`)
  console.log(`HIGH confidence: ${Number(st.high_confidence).toLocaleString()} (${(Number(st.high_confidence)/Number(st.total)*100).toFixed(1)}%)`)
}

show().catch(console.error)
