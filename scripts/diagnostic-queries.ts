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

  console.log('='.repeat(80))
  console.log('QUERY A: Does this wallet even exist in trades_raw')
  console.log('='.repeat(80))

  const queryA = `
SELECT
  COUNT(*)                              AS total_rows_for_wallet,
  COUNT(DISTINCT condition_id)          AS distinct_conditions_for_wallet
FROM trades_raw
WHERE wallet_address = '${wallet}'`

  const resultA = await clickhouse.query({
    query: queryA,
    format: 'JSONEachRow',
  })
  const dataA: any[] = await resultA.json()
  console.log(JSON.stringify(dataA, null, 2))

  console.log('\n' + '='.repeat(80))
  console.log('QUERY B: Can we join this wallet\'s trades to market_resolution_map')
  console.log('='.repeat(80))

  const queryB = `
SELECT
  COUNT(*) AS rows_after_join
FROM trades_raw t
INNER JOIN market_resolution_map m
  ON t.condition_id = m.condition_id
WHERE t.wallet_address = '${wallet}'`

  const resultB = await clickhouse.query({
    query: queryB,
    format: 'JSONEachRow',
  })
  const dataB: any[] = await resultB.json()
  console.log(JSON.stringify(dataB, null, 2))

  console.log('\n' + '='.repeat(80))
  console.log('QUERY C: Show 5 joined rows to inspect the shape')
  console.log('='.repeat(80))

  const queryC = `
SELECT
  t.wallet_address,
  t.condition_id,
  t.side,
  t.entry_price,
  t.shares,
  m.resolved_outcome
FROM trades_raw t
INNER JOIN market_resolution_map m
  ON t.condition_id = m.condition_id
WHERE t.wallet_address = '${wallet}'
LIMIT 5`

  const resultC = await clickhouse.query({
    query: queryC,
    format: 'JSONEachRow',
  })
  const dataC: any[] = await resultC.json()
  console.log(JSON.stringify(dataC, null, 2))

  await clickhouse.close()
}

main()
