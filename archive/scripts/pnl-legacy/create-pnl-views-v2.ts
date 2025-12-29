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

async function runCommand(name: string, query: string) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`${name}`)
  console.log('='.repeat(70))
  try {
    await clickhouse.command({ query })
    console.log('✅ Success')
    return true
  } catch (error) {
    console.error(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return false
  }
}

async function runQuery(name: string, query: string) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`${name}`)
  console.log('='.repeat(70))
  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' })
    const data = await result.json()
    console.log(JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return null
  }
}

async function main() {
  console.log('\n🔧 CREATING PnL VIEWS V2 FOR CASCADIAN')

  // First check the schema of pm_token_to_condition_map
  await runQuery('CHECK pm_token_to_condition_map SCHEMA', 
    `DESCRIBE TABLE pm_token_to_condition_map`)

  // Drop existing views
  await runCommand('DROP vw_trader_events_dedup (if exists)',
    `DROP VIEW IF EXISTS vw_trader_events_dedup`)
  
  await runCommand('DROP vw_trades_enriched (if exists)',
    `DROP VIEW IF EXISTS vw_trades_enriched`)

  await runCommand('DROP vw_wallet_market_fills (if exists)',
    `DROP VIEW IF EXISTS vw_wallet_market_fills`)
  
  await runCommand('DROP vw_wallet_pnl_base (if exists)',
    `DROP VIEW IF EXISTS vw_wallet_pnl_base`)

  // 1. Create dedup view - fixed syntax
  await runCommand('CREATE vw_trader_events_dedup',
    `CREATE VIEW vw_trader_events_dedup AS
    SELECT
      event_id,
      argMax(trader_wallet, insert_time) as trader_wallet,
      argMax(role, insert_time) as role,
      argMax(side, insert_time) as side,
      argMax(token_id, insert_time) as token_id,
      argMax(usdc_amount, insert_time) as usdc_amount,
      argMax(token_amount, insert_time) as token_amount,
      argMax(fee_amount, insert_time) as fee_amount,
      argMax(trade_time, insert_time) as trade_time,
      argMax(transaction_hash, insert_time) as transaction_hash,
      argMax(block_number, insert_time) as block_number,
      max(insert_time) as latest_insert_time
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY event_id`)

  // 2. Create enriched trades view - removed outcome_index reference
  await runCommand('CREATE vw_trades_enriched',
    `CREATE VIEW vw_trades_enriched AS
    SELECT
      t.event_id,
      t.trader_wallet,
      t.role,
      t.side,
      t.token_id,
      m.condition_id,
      -- Scale amounts to human units (Polymarket uses 6 decimals)
      t.usdc_amount / 1000000.0 as usdc_amount,
      t.token_amount / 1000000.0 as shares,
      t.fee_amount / 1000000.0 as fee_amount,
      -- Compute price
      IF(t.token_amount > 0, t.usdc_amount / t.token_amount, 0) as price,
      -- Market metadata
      md.question,
      md.slug,
      md.category,
      md.tags,
      md.outcomes,
      -- Timestamps
      t.trade_time,
      t.transaction_hash,
      t.block_number
    FROM pm_trader_events_v2 AS t
    LEFT JOIN pm_token_to_condition_map AS m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata AS md ON md.condition_id = m.condition_id
    WHERE t.is_deleted = 0`)

  // 3. Create wallet-market fills aggregation - fixed to use direct table reference
  await runCommand('CREATE vw_wallet_market_fills',
    `CREATE VIEW vw_wallet_market_fills AS
    SELECT
      t.trader_wallet as wallet,
      m.condition_id as condition_id,
      any(md.question) as question,
      any(md.category) as category,
      any(md.tags) as tags,
      any(md.outcomes) as outcomes,
      -- BUY aggregates
      sumIf(t.usdc_amount / 1000000.0, lower(t.side) = 'buy') as total_bought_usdc,
      sumIf(t.token_amount / 1000000.0, lower(t.side) = 'buy') as total_bought_shares,
      countIf(lower(t.side) = 'buy') as buy_count,
      avgIf(t.usdc_amount / t.token_amount, lower(t.side) = 'buy' AND t.token_amount > 0) as avg_buy_price,
      -- SELL aggregates
      sumIf(t.usdc_amount / 1000000.0, lower(t.side) = 'sell') as total_sold_usdc,
      sumIf(t.token_amount / 1000000.0, lower(t.side) = 'sell') as total_sold_shares,
      countIf(lower(t.side) = 'sell') as sell_count,
      avgIf(t.usdc_amount / t.token_amount, lower(t.side) = 'sell' AND t.token_amount > 0) as avg_sell_price,
      -- Fee totals
      sum(t.fee_amount / 1000000.0) as total_fees,
      -- Net position (shares held)
      sumIf(t.token_amount / 1000000.0, lower(t.side) = 'buy') - sumIf(t.token_amount / 1000000.0, lower(t.side) = 'sell') as net_shares,
      -- Trade dates
      min(t.trade_time) as first_trade,
      max(t.trade_time) as last_trade,
      count() as total_trades
    FROM pm_trader_events_v2 AS t
    INNER JOIN pm_token_to_condition_map AS m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata AS md ON md.condition_id = m.condition_id
    WHERE t.is_deleted = 0
    GROUP BY
      t.trader_wallet,
      m.condition_id`)

  // 4. Create wallet PnL base view - query directly from tables rather than view
  await runCommand('CREATE vw_wallet_pnl_base',
    `CREATE VIEW vw_wallet_pnl_base AS
    SELECT
      t.trader_wallet as wallet,
      m.condition_id,
      any(md.question) as question,
      any(md.category) as category,
      any(md.tags) as tags,
      any(md.outcomes) as outcomes,
      -- Buy totals
      sumIf(t.usdc_amount / 1000000.0, lower(t.side) = 'buy') as total_bought_usdc,
      sumIf(t.token_amount / 1000000.0, lower(t.side) = 'buy') as total_bought_shares,
      -- Sell totals
      sumIf(t.usdc_amount / 1000000.0, lower(t.side) = 'sell') as total_sold_usdc,
      sumIf(t.token_amount / 1000000.0, lower(t.side) = 'sell') as total_sold_shares,
      -- Net position
      sumIf(t.token_amount / 1000000.0, lower(t.side) = 'buy') - sumIf(t.token_amount / 1000000.0, lower(t.side) = 'sell') as net_shares,
      -- Fees
      sum(t.fee_amount / 1000000.0) as total_fees,
      count() as total_trades,
      min(t.trade_time) as first_trade,
      max(t.trade_time) as last_trade,
      -- Resolution info (using any since all rows for same condition have same resolution)
      any(r.resolved_at) as resolved_at,
      any(r.payout_numerators) as payout_numerators,
      any(r.payout_denominator) as payout_denominator,
      -- Trading PnL (sells - buys - fees)
      sumIf(t.usdc_amount / 1000000.0, lower(t.side) = 'sell') 
        - sumIf(t.usdc_amount / 1000000.0, lower(t.side) = 'buy')
        - sum(t.fee_amount / 1000000.0) as trading_pnl,
      -- Is resolved?
      any(r.condition_id) IS NOT NULL as is_resolved
    FROM pm_trader_events_v2 AS t
    INNER JOIN pm_token_to_condition_map AS m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata AS md ON md.condition_id = m.condition_id
    LEFT JOIN pm_condition_resolutions AS r ON r.condition_id = m.condition_id
    WHERE t.is_deleted = 0
    GROUP BY
      t.trader_wallet,
      m.condition_id`)

  console.log('\n\n✅ All views created!')
  
  // Test the views
  console.log('\n📊 Testing views...')
  
  await runQuery('vw_trader_events_dedup count',
    `SELECT count() as total FROM vw_trader_events_dedup`)

  await runQuery('vw_trades_enriched sample (5)',
    `SELECT 
      event_id,
      trader_wallet,
      side,
      price,
      shares,
      usdc_amount,
      condition_id,
      category
    FROM vw_trades_enriched
    LIMIT 5`)

  await runQuery('vw_wallet_market_fills sample (5)',
    `SELECT 
      wallet,
      condition_id,
      total_bought_usdc,
      total_sold_usdc,
      net_shares,
      total_trades
    FROM vw_wallet_market_fills
    WHERE total_trades > 5
    LIMIT 5`)

  await runQuery('vw_wallet_pnl_base resolved sample (5)',
    `SELECT 
      wallet,
      condition_id,
      question,
      total_bought_usdc,
      total_sold_usdc,
      net_shares,
      trading_pnl,
      is_resolved
    FROM vw_wallet_pnl_base
    WHERE is_resolved = 1
    ORDER BY abs(trading_pnl) DESC
    LIMIT 5`)

  await clickhouse.close()
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error)
  process.exit(1)
})
