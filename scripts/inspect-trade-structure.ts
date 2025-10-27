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
  // Check one resolved condition to see trade structure
  const query = `
SELECT
  condition_id,
  side,
  entry_price,
  shares,
  pnl_net,
  pnl_gross,
  is_closed,
  timestamp
FROM trades_raw
WHERE wallet_address = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'
  AND condition_id = '0x8156c8887f48b1f4629a6a3930edf7d35b0a47bb2fd97e9619c75bf6b6ee031a'
ORDER BY timestamp
LIMIT 20
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data: any[] = await result.json()

  console.log(JSON.stringify(data, null, 2))

  await clickhouse.close()
}

main()
