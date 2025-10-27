#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  const wallet = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'

  // Check without JOIN
  const q1 = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE wallet_address = '${wallet}' AND pnl_net IS NOT NULL`,
    format: 'JSONEachRow',
  })
  const r1: any = await q1.json()
  console.log(`Trades with pnl_net for wallet (no JOIN): ${r1[0]?.count || 0}`)

  // Check total with pnl_net
  const q2 = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE pnl_net IS NOT NULL`,
    format: 'JSONEachRow',
  })
  const r2: any = await q2.json()
  console.log(`Total trades with pnl_net in system: ${r2[0]?.count || 0}`)

  // Check total trades for wallet
  const q3 = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE wallet_address = '${wallet}'`,
    format: 'JSONEachRow',
  })
  const r3: any = await q3.json()
  console.log(`Total trades for wallet: ${r3[0]?.count || 0}`)

  await clickhouse.close()
}

main()
