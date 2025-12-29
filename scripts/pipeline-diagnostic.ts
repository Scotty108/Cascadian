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
  console.log('\n🔍 CASCADIAN PIPELINE DIAGNOSTIC - POLYMARKET FILLS')
  
  // Check what tables exist
  await runQuery(
    '1. AVAILABLE TABLES',
    `SELECT name, engine, total_rows FROM system.tables WHERE database = currentDatabase() ORDER BY name`
  )

  // Check pm_trader_events_v2
  await runQuery(
    '2. pm_trader_events_v2 SCHEMA',
    `DESCRIBE TABLE pm_trader_events_v2`
  )

  await runQuery(
    '3. pm_trader_events_v2 ROW COUNT & DATE RANGE',
    `SELECT
      count() as total_rows,
      countIf(event_id IS NOT NULL) as rows_with_event_id,
      countIf(trader_wallet IS NOT NULL) as rows_with_wallet,
      countIf(role IS NOT NULL) as rows_with_role,
      countIf(side IS NOT NULL) as rows_with_side,
      countIf(token_id IS NOT NULL) as rows_with_token_id,
      countIf(usdc_amount IS NOT NULL) as rows_with_usdc,
      countIf(token_amount IS NOT NULL) as rows_with_token_amount,
      countIf(fee_amount IS NOT NULL) as rows_with_fee,
      min(trade_time) as earliest_trade,
      max(trade_time) as latest_trade,
      countDistinct(event_id) as distinct_event_ids
    FROM pm_trader_events_v2`
  )

  await runQuery(
    '4. pm_trader_events_v2 SAMPLE DATA',
    `SELECT
      event_id,
      trader_wallet,
      role,
      side,
      token_id,
      usdc_amount,
      token_amount,
      fee_amount,
      trade_time
    FROM pm_trader_events_v2
    ORDER BY trade_time DESC
    LIMIT 5`
  )

  // Check for duplicates
  await runQuery(
    '5. pm_trader_events_v2 DUPLICATE EVENT IDS',
    `SELECT
      event_id,
      count() as occurrences
    FROM pm_trader_events_v2
    WHERE event_id IS NOT NULL
    GROUP BY event_id
    HAVING count() > 1
    LIMIT 10`
  )

  // Check pm_user_positions
  await runQuery(
    '6. pm_user_positions SCHEMA',
    `DESCRIBE TABLE pm_user_positions`
  )

  await runQuery(
    '7. pm_user_positions ROW COUNT',
    `SELECT
      count() as total_rows,
      countIf(wallet IS NOT NULL) as rows_with_wallet,
      countIf(realized_pnl IS NOT NULL) as rows_with_pnl,
      countIf(total_bought IS NOT NULL) as rows_with_total_bought,
      countDistinct(wallet) as distinct_wallets
    FROM pm_user_positions`
  )

  await runQuery(
    '8. pm_user_positions SAMPLE DATA',
    `SELECT
      wallet,
      realized_pnl,
      total_bought,
      market_count
    FROM pm_user_positions
    ORDER BY realized_pnl DESC
    LIMIT 5`
  )

  // Check pm_token_to_condition_map
  await runQuery(
    '9. pm_token_to_condition_map SCHEMA',
    `DESCRIBE TABLE pm_token_to_condition_map`
  )

  await runQuery(
    '10. pm_token_to_condition_map ROW COUNT',
    `SELECT
      count() as total_mappings,
      countIf(token_id IS NOT NULL) as rows_with_token_id,
      countIf(token_id_dec IS NOT NULL) as rows_with_token_id_dec,
      countIf(condition_id IS NOT NULL) as rows_with_condition_id,
      countDistinct(token_id) as distinct_token_ids,
      countDistinct(condition_id) as distinct_conditions
    FROM pm_token_to_condition_map`
  )

  await runQuery(
    '11. pm_token_to_condition_map SAMPLE DATA',
    `SELECT
      token_id,
      token_id_dec,
      condition_id
    FROM pm_token_to_condition_map
    LIMIT 10`
  )

  // Check token mapping coverage
  await runQuery(
    '12. TOKEN->CONDITION MAPPING COVERAGE',
    `SELECT
      count() as total_trades,
      countIf(m.condition_id IS NOT NULL) as trades_with_condition,
      countIf(m.condition_id IS NULL) as trades_without_condition
    FROM pm_trader_events_v2 as t
    LEFT JOIN pm_token_to_condition_map as m ON m.token_id_dec = t.token_id`
  )

  // Check pm_condition_resolutions
  await runQuery(
    '13. pm_condition_resolutions SCHEMA',
    `DESCRIBE TABLE pm_condition_resolutions`
  )

  await runQuery(
    '14. pm_condition_resolutions ROW COUNT',
    `SELECT
      count() as total_resolutions,
      countIf(condition_id IS NOT NULL) as rows_with_condition_id,
      countIf(resolution IS NOT NULL) as rows_with_resolution,
      countDistinct(condition_id) as distinct_conditions
    FROM pm_condition_resolutions`
  )

  // Check pm_market_metadata
  await runQuery(
    '15. pm_market_metadata SCHEMA',
    `DESCRIBE TABLE pm_market_metadata`
  )

  await runQuery(
    '16. pm_market_metadata ROW COUNT & SAMPLE',
    `SELECT
      count() as total_markets,
      countIf(condition_id IS NOT NULL) as rows_with_condition,
      countIf(category IS NOT NULL) as rows_with_category,
      countIf(tags IS NOT NULL) as rows_with_tags,
      countDistinct(condition_id) as distinct_conditions
    FROM pm_market_metadata`
  )

  // Sample complete trade flow
  await runQuery(
    '17. SAMPLE COMPLETE TRADE FLOW',
    `SELECT
      t.trader_wallet,
      t.event_id,
      t.side,
      t.token_id,
      t.usdc_amount,
      t.token_amount,
      m.condition_id,
      md.category,
      r.resolution,
      t.trade_time
    FROM pm_trader_events_v2 as t
    LEFT JOIN pm_token_to_condition_map as m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata as md ON md.condition_id = m.condition_id
    LEFT JOIN pm_condition_resolutions as r ON r.condition_id = m.condition_id
    LIMIT 10`
  )

  await clickhouse.close()
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error)
  process.exit(1)
})
