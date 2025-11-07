#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function debug() {
  const client = getClickHouseClient()

  // Check 1: Sample condition_id from trades_raw
  console.log('=== TRADES_RAW Sample ===')
  const tradesResult = await client.query({
    query: `
      SELECT 
        condition_id,
        length(condition_id) as len,
        lower(condition_id) as lower_cid
      FROM trades_raw 
      WHERE condition_id != '' AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const trades = await tradesResult.json()
  console.log(JSON.stringify(trades, null, 2))

  // Check 2: Sample condition_id_norm from market_resolutions_final
  console.log('\n=== MARKET_RESOLUTIONS_FINAL Sample ===')
  const marketsResult = await client.query({
    query: `
      SELECT 
        condition_id_norm,
        length(condition_id_norm) as len,
        lower(condition_id_norm) as lower_cid
      FROM market_resolutions_final 
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const markets = await marketsResult.json()
  console.log(JSON.stringify(markets, null, 2))

  // Check 3: Try the join with sample data
  console.log('\n=== JOIN TEST ===')
  const joinResult = await client.query({
    query: `
      SELECT 
        count() as match_count
      FROM trades_raw t
      JOIN market_resolutions_final m ON lower(t.condition_id) = lower(m.condition_id_norm)
      WHERE t.condition_id != '' AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow'
  })
  const joinData = await joinResult.json()
  console.log('Join matches:', JSON.stringify(joinData, null, 2))

  // Check 4: Count valid trades
  console.log('\n=== VALID TRADES COUNT ===')
  const countResult = await client.query({
    query: `
      SELECT count() as valid_trades
      FROM trades_raw
      WHERE condition_id != '' AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow'
  })
  const countData = await countResult.json()
  console.log('Valid trades:', JSON.stringify(countData, null, 2))
}

debug().catch(console.error)
