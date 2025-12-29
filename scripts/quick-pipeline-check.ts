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

async function runQuery(name: string, query: string) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`${name}`)
  console.log('='.repeat(80))
  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    })
    const data = await result.json()
    console.log(JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return null
  }
}

async function main() {
  console.log('\n🔍 CASCADIAN PIPELINE QUICK CHECK - POLYMARKET FILLS')
  
  // Quick sample from pm_trader_events_v2
  await runQuery(
    '1. pm_trader_events_v2 SAMPLE (5 trades)',
    `SELECT 
      event_id, trader_wallet, role, side, token_id, usdc_amount, token_amount, fee_amount, trade_time
    FROM pm_trader_events_v2
    LIMIT 5`
  )

  // Quick check on pm_user_positions with correct column names
  await runQuery(
    '2. pm_user_positions SCHEMA REMINDER',
    `DESCRIBE TABLE pm_user_positions`
  )

  await runQuery(
    '3. pm_user_positions SAMPLE (5 positions)',
    `SELECT 
      position_id, proxy_wallet, condition_id, realized_pnl, total_bought, total_sold
    FROM pm_user_positions
    LIMIT 5`
  )

  // Check token_to_condition_map
  await runQuery(
    '4. pm_token_to_condition_map SAMPLE (5 mappings)',
    `SELECT 
      token_id_dec, condition_id, slug, question
    FROM pm_token_to_condition_map
    LIMIT 5`
  )

  // Check pm_condition_resolutions
  await runQuery(
    '5. pm_condition_resolutions SAMPLE (5)',
    `SELECT 
      condition_id, resolution
    FROM pm_condition_resolutions
    LIMIT 5`
  )

  // Check pm_market_metadata
  await runQuery(
    '6. pm_market_metadata SAMPLE (5)',
    `SELECT 
      condition_id, category
    FROM pm_market_metadata
    LIMIT 5`
  )

  // Join test: do we have token_id coverage
  await runQuery(
    '7. TOKEN MAPPING COVERAGE (limited scan)',
    `SELECT
      count() as total_trades,
      countIf(m.condition_id IS NOT NULL) as trades_with_condition
    FROM (SELECT token_id FROM pm_trader_events_v2 LIMIT 100000) as t
    LEFT JOIN pm_token_to_condition_map as m ON m.token_id_dec = t.token_id`
  )

  // Check one complete flow
  await runQuery(
    '8. COMPLETE TRADE FLOW SAMPLE (3 trades)',
    `SELECT
      t.trader_wallet,
      t.event_id,
      t.side,
      t.token_id,
      t.usdc_amount,
      m.condition_id,
      md.category,
      r.resolution
    FROM pm_trader_events_v2 as t
    LEFT JOIN pm_token_to_condition_map as m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata as md ON md.condition_id = m.condition_id
    LEFT JOIN pm_condition_resolutions as r ON r.condition_id = m.condition_id
    LIMIT 3`
  )

  await clickhouse.close()
  console.log('\n✅ Diagnostic complete!')
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error)
  process.exit(1)
})
