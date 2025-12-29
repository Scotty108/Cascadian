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

async function main() {
  console.log('\n🔧 CREATING PnL VIEWS FOR CASCADIAN')

  // 1. Drop existing views (if any) to recreate
  await runCommand('DROP vw_trader_events_dedup (if exists)',
    `DROP VIEW IF EXISTS vw_trader_events_dedup`)
  
  await runCommand('DROP vw_trades_enriched (if exists)',
    `DROP VIEW IF EXISTS vw_trades_enriched`)

  await runCommand('DROP vw_wallet_market_fills (if exists)',
    `DROP VIEW IF EXISTS vw_wallet_market_fills`)
  
  await runCommand('DROP vw_wallet_pnl_base (if exists)',
    `DROP VIEW IF EXISTS vw_wallet_pnl_base`)

  // 2. Create dedup view for trader events
  // Uses argMax to get the latest version by insert_time for each event_id
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
      max(insert_time) as insert_time
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY event_id`)

  // 3. Create enriched trades view with condition_id and market metadata
  await runCommand('CREATE vw_trades_enriched',
    `CREATE VIEW vw_trades_enriched AS
    SELECT
      t.event_id,
      t.trader_wallet,
      t.role,
      t.side,
      t.token_id,
      m.condition_id,
      m.outcome_index,
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

  // 4. Create wallet-market fills aggregation
  // This aggregates all fills per (wallet, condition_id, side)
  await runCommand('CREATE vw_wallet_market_fills',
    `CREATE VIEW vw_wallet_market_fills AS
    SELECT
      t.trader_wallet as wallet,
      m.condition_id,
      md.question,
      md.category,
      md.tags,
      md.outcomes,
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
    LEFT JOIN pm_token_to_condition_map AS m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata AS md ON md.condition_id = m.condition_id
    WHERE t.is_deleted = 0
      AND m.condition_id IS NOT NULL
    GROUP BY
      t.trader_wallet,
      m.condition_id,
      md.question,
      md.category,
      md.tags,
      md.outcomes`)

  // 5. Create wallet PnL base view with resolution
  // Joins fills to resolution to compute realized PnL
  await runCommand('CREATE vw_wallet_pnl_base',
    `CREATE VIEW vw_wallet_pnl_base AS
    SELECT
      f.wallet,
      f.condition_id,
      f.question,
      f.category,
      f.tags,
      f.outcomes,
      f.total_bought_usdc,
      f.total_bought_shares,
      f.total_sold_usdc,
      f.total_sold_shares,
      f.net_shares,
      f.total_fees,
      f.total_trades,
      f.first_trade,
      f.last_trade,
      -- Resolution info
      r.resolved_at,
      r.payout_numerators,
      r.payout_denominator,
      -- Realized PnL calculation:
      -- = Sold USDC - Bought USDC + Resolution payout - Fees
      -- Note: payout_numerators is a string like "[1,0]" - we need to parse it
      -- For now, assume binary market with payout = net_shares * (winning_outcome_payout / denominator)
      -- This is simplified - full calc needs outcome_index from token map
      CASE 
        WHEN r.condition_id IS NOT NULL THEN
          f.total_sold_usdc - f.total_bought_usdc - f.total_fees
          -- + resolution payout (calculated separately, needs outcome matching)
        ELSE NULL
      END as trading_pnl,
      -- Is market resolved?
      r.condition_id IS NOT NULL as is_resolved
    FROM vw_wallet_market_fills AS f
    LEFT JOIN pm_condition_resolutions AS r ON r.condition_id = f.condition_id`)

  console.log('\n\n✅ All views created!')
  
  // Test the views
  console.log('\n📊 Testing views...')
  
  const testResult = await clickhouse.query({
    query: `SELECT count() as total_enriched_trades FROM vw_trades_enriched LIMIT 1`,
    format: 'JSONEachRow'
  })
  const testData = await testResult.json()
  console.log('\nvw_trades_enriched row count:', testData)

  const walletTest = await clickhouse.query({
    query: `SELECT 
      wallet,
      condition_id,
      total_bought_usdc,
      total_sold_usdc,
      net_shares,
      total_trades
    FROM vw_wallet_market_fills
    WHERE total_trades > 5
    LIMIT 5`,
    format: 'JSONEachRow'
  })
  const walletData = await walletTest.json()
  console.log('\nvw_wallet_market_fills sample:')
  console.log(JSON.stringify(walletData, null, 2))

  const pnlTest = await clickhouse.query({
    query: `SELECT 
      wallet,
      condition_id,
      total_bought_usdc,
      total_sold_usdc,
      trading_pnl,
      is_resolved
    FROM vw_wallet_pnl_base
    WHERE is_resolved = 1
    LIMIT 5`,
    format: 'JSONEachRow'
  })
  const pnlData = await pnlTest.json()
  console.log('\nvw_wallet_pnl_base (resolved markets) sample:')
  console.log(JSON.stringify(pnlData, null, 2))

  await clickhouse.close()
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error)
  process.exit(1)
})
