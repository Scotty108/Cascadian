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
  console.log('\n🚀 Starting async INSERT for pm_wallet_market_pnl...')
  console.log('This will run in the background on the ClickHouse server.')
  
  // Start the INSERT without waiting for completion
  // Using async_insert settings to allow long-running queries
  try {
    await clickhouse.command({
      query: `
        INSERT INTO pm_wallet_market_pnl
        SELECT
          t.trader_wallet as wallet,
          m.condition_id as condition_id,
          any(md.question) as question,
          any(md.category) as category,
          any(md.tags) as tags,
          any(md.outcomes) as outcomes,
          sumIf(t.usdc_amount, lower(t.side) = 'buy') / 1000000.0 as total_bought_usdc,
          sumIf(t.token_amount, lower(t.side) = 'buy') / 1000000.0 as total_bought_shares,
          countIf(lower(t.side) = 'buy') as buy_count,
          avgIf(t.usdc_amount / t.token_amount, lower(t.side) = 'buy' AND t.token_amount > 0) as avg_buy_price,
          sumIf(t.usdc_amount, lower(t.side) = 'sell') / 1000000.0 as total_sold_usdc,
          sumIf(t.token_amount, lower(t.side) = 'sell') / 1000000.0 as total_sold_shares,
          countIf(lower(t.side) = 'sell') as sell_count,
          avgIf(t.usdc_amount / t.token_amount, lower(t.side) = 'sell' AND t.token_amount > 0) as avg_sell_price,
          (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1000000.0 as net_shares,
          sum(t.fee_amount) / 1000000.0 as total_fees,
          (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy') - sum(t.fee_amount)) / 1000000.0 as trading_pnl,
          count() as total_trades,
          min(t.trade_time) as first_trade,
          max(t.trade_time) as last_trade,
          any(r.resolved_at) as resolved_at,
          any(r.payout_numerators) as payout_numerators,
          any(r.payout_denominator) as payout_denominator,
          any(r.condition_id) IS NOT NULL as is_resolved,
          now() as computed_at
        FROM pm_trader_events_v2 AS t
        INNER JOIN pm_token_to_condition_map AS m ON m.token_id_dec = t.token_id
        LEFT JOIN pm_market_metadata AS md ON md.condition_id = m.condition_id
        LEFT JOIN pm_condition_resolutions AS r ON r.condition_id = m.condition_id
        WHERE t.is_deleted = 0
        GROUP BY t.trader_wallet, m.condition_id
        SETTINGS
          max_execution_time = 3600,
          max_memory_usage = 50000000000
      `,
      clickhouse_settings: {
        wait_end_of_query: 0,
        max_execution_time: 3600
      }
    })
    console.log('✅ INSERT query submitted!')
  } catch (error) {
    console.error(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  // Check progress by monitoring the table
  console.log('\n📊 Checking current table status...')
  
  const countResult = await clickhouse.query({
    query: `SELECT count() as rows FROM pm_wallet_market_pnl`,
    format: 'JSONEachRow'
  })
  const countData = await countResult.json()
  console.log('Current row count:', countData)

  // Check running queries
  const runningResult = await clickhouse.query({
    query: `SELECT query_id, query, elapsed, read_rows, written_rows, memory_usage 
            FROM system.processes 
            WHERE query LIKE '%pm_wallet_market_pnl%' AND query NOT LIKE '%system.processes%'`,
    format: 'JSONEachRow'
  })
  const runningData = await runningResult.json()
  console.log('\nRunning queries:', runningData.length > 0 ? runningData : 'None found')

  await clickhouse.close()
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error)
  process.exit(1)
})
