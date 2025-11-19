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

async function q(sql: string) {
  const r = await ch.query({ query: sql, format: 'JSONEachRow' })
  return await r.json()
}

async function compare() {
  console.log('═'.repeat(70))
  console.log('COMPARING TRADE TABLES')
  console.log('═'.repeat(70))
  console.log()

  // trades_with_direction
  console.log('1. trades_with_direction')
  console.log('-'.repeat(70))
  const stats1 = await q(`
    SELECT
      count() as total,
      countIf(condition_id_norm != '') as with_condition,
      countIf(market_id != '' AND market_id != '12') as with_market,
      countIf(market_id = '12') as market_is_12
    FROM trades_with_direction
  `)
  const r1 = stats1[0]
  console.log(`  Total rows: ${Number(r1.total).toLocaleString()}`)
  console.log(`  With condition_id_norm: ${Number(r1.with_condition).toLocaleString()} (${(Number(r1.with_condition)/Number(r1.total)*100).toFixed(1)}%)`)
  console.log(`  With valid market_id: ${Number(r1.with_market).toLocaleString()} (${(Number(r1.with_market)/Number(r1.total)*100).toFixed(1)}%)`)
  console.log(`  market_id='12': ${Number(r1.market_is_12).toLocaleString()}`)
  console.log()

  // trades_dedup_mat_new
  console.log('2. trades_dedup_mat_new')
  console.log('-'.repeat(70))
  const stats2 = await q(`
    SELECT
      count() as total,
      countIf(condition_id != '') as with_condition,
      countIf(market_id != '') as with_market,
      countIf(market_id = '') as empty_market
    FROM trades_dedup_mat_new
  `)
  const r2 = stats2[0]
  console.log(`  Total rows: ${Number(r2.total).toLocaleString()}`)
  console.log(`  With condition_id: ${Number(r2.with_condition).toLocaleString()} (${(Number(r2.with_condition)/Number(r2.total)*100).toFixed(1)}%)`)
  console.log(`  With market_id: ${Number(r2.with_market).toLocaleString()} (${(Number(r2.with_market)/Number(r2.total)*100).toFixed(1)}%)`)
  console.log(`  Empty market_id: ${Number(r2.empty_market).toLocaleString()}`)
  console.log()

  // trades_raw
  console.log('3. trades_raw')
  console.log('-'.repeat(70))
  const stats3 = await q(`
    SELECT
      count() as total,
      countIf(condition_id != '') as with_condition,
      countIf(market_id != '' AND lower(market_id) NOT IN ('0x0','0x')) as with_market
    FROM trades_raw
  `)
  const r3 = stats3[0]
  console.log(`  Total rows: ${Number(r3.total).toLocaleString()}`)
  console.log(`  With condition_id: ${Number(r3.with_condition).toLocaleString()} (${(Number(r3.with_condition)/Number(r3.total)*100).toFixed(1)}%)`)
  console.log(`  With market_id: ${Number(r3.with_market).toLocaleString()} (${(Number(r3.with_market)/Number(r3.total)*100).toFixed(1)}%)`)
  console.log()

  console.log('═'.repeat(70))
  console.log('RECOMMENDATION')
  console.log('═'.repeat(70))

  if (Number(r2.with_condition) > Number(r1.with_condition) && Number(r2.with_condition) > Number(r3.with_condition)) {
    console.log('✅ trades_dedup_mat_new has the best condition_id coverage!')
    console.log(`   ${Number(r2.with_condition).toLocaleString()} rows (${(Number(r2.with_condition)/Number(r2.total)*100).toFixed(1)}%)`)
  } else if (Number(r1.with_condition) > Number(r3.with_condition)) {
    console.log('✅ trades_with_direction has the best condition_id coverage!')
    console.log(`   ${Number(r1.with_condition).toLocaleString()} rows (${(Number(r1.with_condition)/Number(r1.total)*100).toFixed(1)}%)`)
  } else {
    console.log('✅ trades_raw has the best condition_id coverage!')
    console.log(`   ${Number(r3.with_condition).toLocaleString()} rows (${(Number(r3.with_condition)/Number(r3.total)*100).toFixed(1)}%)`)
  }
  console.log()
}

compare().catch(console.error)
