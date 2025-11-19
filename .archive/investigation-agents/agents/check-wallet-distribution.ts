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
  console.log('═'.repeat(70))
  console.log('WALLET DISTRIBUTION CHECK')
  console.log('═'.repeat(70))
  console.log()

  // Check trades_raw
  console.log('trades_raw - Top 5 wallets:')
  const r1 = await ch.query({
    query: `SELECT wallet_address, count() as cnt FROM trades_raw GROUP BY wallet_address ORDER BY cnt DESC LIMIT 5`,
    format: 'JSONEachRow'
  })
  const data1 = await r1.json()
  data1.forEach((row: any) => {
    const pct = (Number(row.cnt) / 160913053 * 100).toFixed(1)
    console.log(`  ${row.wallet_address}: ${Number(row.cnt).toLocaleString()} trades (${pct}%)`)
  })
  console.log()

  // Check trades_dedup_mat_new
  console.log('trades_dedup_mat_new - Top 5 wallets:')
  const r2 = await ch.query({
    query: `SELECT wallet_address, count() as cnt FROM trades_dedup_mat_new GROUP BY wallet_address ORDER BY cnt DESC LIMIT 5`,
    format: 'JSONEachRow'
  })
  const data2 = await r2.json()
  data2.forEach((row: any) => {
    const pct = (Number(row.cnt) / 106609548 * 100).toFixed(1)
    console.log(`  ${row.wallet_address}: ${Number(row.cnt).toLocaleString()} trades (${pct}%)`)
  })
  console.log()

  // Check trades_with_direction
  console.log('trades_with_direction - Top 5 wallets:')
  const r3 = await ch.query({
    query: `SELECT wallet_address, count() as cnt FROM trades_with_direction GROUP BY wallet_address ORDER BY cnt DESC LIMIT 5`,
    format: 'JSONEachRow'
  })
  const data3 = await r3.json()
  data3.forEach((row: any) => {
    const pct = (Number(row.cnt) / 82138586 * 100).toFixed(1)
    console.log(`  ${row.wallet_address}: ${Number(row.cnt).toLocaleString()} trades (${pct}%)`)
  })
  console.log()

  console.log('═'.repeat(70))
}

check().catch(console.error)
