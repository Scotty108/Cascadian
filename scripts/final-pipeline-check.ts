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
  console.log('\n🔍 CASCADIAN PIPELINE FINAL CHECK')
  
  // Check pm_condition_resolutions schema
  await runQuery(
    '1. pm_condition_resolutions SCHEMA',
    `DESCRIBE TABLE pm_condition_resolutions`
  )

  await runQuery(
    '2. pm_condition_resolutions SAMPLE (5)',
    `SELECT *
    FROM pm_condition_resolutions
    LIMIT 5`
  )

  // Complete trade flow without resolution
  await runQuery(
    '3. COMPLETE TRADE FLOW SAMPLE (5 trades)',
    `SELECT
      t.trader_wallet,
      t.event_id,
      t.side,
      t.token_id,
      t.usdc_amount,
      t.token_amount,
      t.fee_amount,
      m.condition_id,
      md.category,
      t.trade_time
    FROM pm_trader_events_v2 as t
    LEFT JOIN pm_token_to_condition_map as m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata as md ON md.condition_id = m.condition_id
    LIMIT 5`
  )

  // Test token->condition join quality
  await runQuery(
    '4. TOKEN TO CONDITION JOIN QUALITY CHECK',
    `SELECT
      count() as sampled_trades,
      countIf(m.condition_id IS NOT NULL) as trades_with_mapped_condition,
      countIf(m.condition_id IS NULL) as trades_unmapped,
      (countIf(m.condition_id IS NOT NULL) * 100.0 / count()) as mapping_coverage_pct
    FROM (SELECT token_id FROM pm_trader_events_v2 LIMIT 50000) as t
    LEFT JOIN pm_token_to_condition_map as m ON m.token_id_dec = t.token_id`
  )

  // Check market metadata coverage
  await runQuery(
    '5. MARKET METADATA COVERAGE',
    `SELECT
      count() as sampled_conditions,
      countIf(md.category IS NOT NULL) as conditions_with_category,
      countIf(md.tags IS NOT NULL AND length(tags) > 0) as conditions_with_tags
    FROM (SELECT DISTINCT condition_id FROM pm_token_to_condition_map LIMIT 10000) as m
    LEFT JOIN pm_market_metadata as md ON md.condition_id = m.condition_id`
  )

  // Check if we can aggregate by wallet
  await runQuery(
    '6. WALLET AGGREGATION TEST',
    `SELECT
      trader_wallet,
      count() as trade_count,
      sum(usdc_amount) as total_usdc_traded,
      sum(token_amount) as total_tokens,
      min(trade_time) as first_trade,
      max(trade_time) as last_trade
    FROM pm_trader_events_v2
    GROUP BY trader_wallet
    LIMIT 10`
  )

  // Check by category (if mapping is good)
  await runQuery(
    '7. TRADES BY CATEGORY SAMPLE',
    `SELECT
      md.category,
      count() as trade_count,
      sum(t.usdc_amount) as total_usdc
    FROM pm_trader_events_v2 as t
    LEFT JOIN pm_token_to_condition_map as m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata as md ON md.condition_id = m.condition_id
    WHERE m.condition_id IS NOT NULL
    GROUP BY md.category
    LIMIT 20`
  )

  await clickhouse.close()
  console.log('\n✅ Final diagnostic complete!')
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error)
  process.exit(1)
})
