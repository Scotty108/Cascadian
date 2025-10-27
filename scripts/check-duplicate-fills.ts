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
  const condition = '0x70080390ef28a08f1a18b90e698a4b0c79aec12c63df1ddab4d461eae7ba5055'

  // Check for duplicates by transaction_hash and timestamp
  const query = `
SELECT
  transaction_hash,
  timestamp,
  side,
  entry_price,
  shares,
  COUNT(*) as dup_count
FROM trades_raw
WHERE wallet_address = '${wallet}'
  AND condition_id = '${condition}'
GROUP BY transaction_hash, timestamp, side, entry_price, shares
HAVING COUNT(*) > 1
ORDER BY dup_count DESC
LIMIT 20
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data: any[] = await result.json()

  console.log('Duplicate fills (same tx_hash, timestamp, side, price, shares):')
  console.log(JSON.stringify(data, null, 2))
  console.log(`\nTotal unique duplicate groups: ${data.length}`)

  if (data.length > 0) {
    const totalDups = data.reduce((sum, row) => sum + parseInt(row.dup_count), 0)
    console.log(`Total duplicate fills: ${totalDups}`)
  }

  await clickhouse.close()
}

main()
