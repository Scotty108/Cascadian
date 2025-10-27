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

  console.log('═'.repeat(80))
  console.log('QUERY D: Sample 20 of the wallet\'s markets from trades_raw')
  console.log('═'.repeat(80))

  const queryD = `
SELECT
  t.condition_id,
  t.market_id,
  t.side,
  t.entry_price,
  t.timestamp
FROM trades_raw t
WHERE t.wallet_address = '${wallet}'
GROUP BY
  t.condition_id,
  t.market_id,
  t.side,
  t.entry_price,
  t.timestamp
LIMIT 20`

  const resultD = await clickhouse.query({
    query: queryD,
    format: 'JSONEachRow',
  })
  const dataD: any[] = await resultD.json()
  console.log(JSON.stringify(dataD, null, 2))

  console.log('\n' + '═'.repeat(80))
  console.log('Checking for market question/title text columns in trades_raw...')
  console.log('═'.repeat(80))

  const schemaQuery = `
SELECT
  name,
  type
FROM system.columns
WHERE database = '${process.env.CLICKHOUSE_DATABASE || 'default'}'
  AND table = 'trades_raw'
ORDER BY name`

  const resultSchema = await clickhouse.query({
    query: schemaQuery,
    format: 'JSONEachRow',
  })
  const dataSchema: any[] = await resultSchema.json()
  console.log(JSON.stringify(dataSchema, null, 2))

  console.log('\n' + '═'.repeat(80))
  console.log('QUERY E: Sample 20 conditions from market_resolution_map')
  console.log('═'.repeat(80))

  const queryE = `
SELECT
  condition_id,
  market_id,
  resolved_outcome,
  resolved_timestamp
FROM market_resolution_map
LIMIT 20`

  const resultE = await clickhouse.query({
    query: queryE,
    format: 'JSONEachRow',
  })
  const dataE: any[] = await resultE.json()
  console.log(JSON.stringify(dataE, null, 2))

  console.log('\n' + '═'.repeat(80))
  console.log('QUERY F1: Count wallet\'s distinct condition_ids')
  console.log('═'.repeat(80))

  const queryF1 = `
SELECT
  COUNT(DISTINCT condition_id) AS wallet_condition_ids
FROM trades_raw
WHERE wallet_address = '${wallet}'`

  const resultF1 = await clickhouse.query({
    query: queryF1,
    format: 'JSONEachRow',
  })
  const dataF1: any[] = await resultF1.json()
  console.log(JSON.stringify(dataF1, null, 2))

  console.log('\n' + '═'.repeat(80))
  console.log('QUERY F2: Count overlapping condition_ids')
  console.log('═'.repeat(80))

  const queryF2 = `
SELECT
  COUNT(DISTINCT t.condition_id) AS overlapping_condition_ids
FROM trades_raw t
INNER JOIN market_resolution_map m
  ON t.condition_id = m.condition_id
WHERE t.wallet_address = '${wallet}'`

  const resultF2 = await clickhouse.query({
    query: queryF2,
    format: 'JSONEachRow',
  })
  const dataF2: any[] = await resultF2.json()
  console.log(JSON.stringify(dataF2, null, 2))

  await clickhouse.close()
}

main()
