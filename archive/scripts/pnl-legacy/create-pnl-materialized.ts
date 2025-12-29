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

async function runQuery(name: string, query: string, timeout = 120000) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`${name}`)
  console.log('='.repeat(70))
  try {
    const result = await clickhouse.query({ 
      query, 
      format: 'JSONEachRow',
      query_params: {},
      clickhouse_settings: {
        max_execution_time: timeout / 1000
      }
    })
    const data = await result.json()
    console.log(JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return null
  }
}

async function main() {
  console.log('\n🔧 CREATING MATERIALIZED PnL TABLES')

  // First verify the raw data is accessible with a simple count
  await runQuery('Verify pm_trader_events_v2 accessible',
    `SELECT count() as total FROM pm_trader_events_v2`, 30000)

  // Drop existing materialized tables if any
  await runCommand('DROP pm_wallet_market_pnl (if exists)',
    `DROP TABLE IF EXISTS pm_wallet_market_pnl`)

  // Create wallet-market PnL materialized table
  // This is a one-time aggregation - we'll need to refresh periodically
  console.log('\n⏳ Creating pm_wallet_market_pnl table (this may take several minutes)...')
  
  const createTableResult = await runCommand('CREATE pm_wallet_market_pnl',
    `CREATE TABLE pm_wallet_market_pnl
    ENGINE = SharedMergeTree
    ORDER BY (wallet, condition_id)
    SETTINGS index_granularity = 8192
    AS
    SELECT
      t.trader_wallet as wallet,
      m.condition_id as condition_id,
      any(md.question) as question,
      any(md.category) as category,
      any(md.tags) as tags,
      any(md.outcomes) as outcomes,
      -- Buy aggregates
      sumIf(t.usdc_amount, lower(t.side) = 'buy') / 1000000.0 as total_bought_usdc,
      sumIf(t.token_amount, lower(t.side) = 'buy') / 1000000.0 as total_bought_shares,
      countIf(lower(t.side) = 'buy') as buy_count,
      avgIf(t.usdc_amount / t.token_amount, lower(t.side) = 'buy' AND t.token_amount > 0) as avg_buy_price,
      -- Sell aggregates
      sumIf(t.usdc_amount, lower(t.side) = 'sell') / 1000000.0 as total_sold_usdc,
      sumIf(t.token_amount, lower(t.side) = 'sell') / 1000000.0 as total_sold_shares,
      countIf(lower(t.side) = 'sell') as sell_count,
      avgIf(t.usdc_amount / t.token_amount, lower(t.side) = 'sell' AND t.token_amount > 0) as avg_sell_price,
      -- Net position
      (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1000000.0 as net_shares,
      -- Fees
      sum(t.fee_amount) / 1000000.0 as total_fees,
      -- Trading PnL (excludes resolution payouts)
      (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy') - sum(t.fee_amount)) / 1000000.0 as trading_pnl,
      -- Counts
      count() as total_trades,
      min(t.trade_time) as first_trade,
      max(t.trade_time) as last_trade,
      -- Resolution info
      any(r.resolved_at) as resolved_at,
      any(r.payout_numerators) as payout_numerators,
      any(r.payout_denominator) as payout_denominator,
      any(r.condition_id) IS NOT NULL as is_resolved,
      -- Metadata
      now() as computed_at
    FROM pm_trader_events_v2 AS t
    INNER JOIN pm_token_to_condition_map AS m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata AS md ON md.condition_id = m.condition_id
    LEFT JOIN pm_condition_resolutions AS r ON r.condition_id = m.condition_id
    WHERE t.is_deleted = 0
    GROUP BY t.trader_wallet, m.condition_id`)

  if (!createTableResult) {
    console.log('\n❌ Failed to create materialized table. Trying alternative approach...')
    
    // Try creating empty table first, then inserting in batches
    await runCommand('CREATE empty pm_wallet_market_pnl',
      `CREATE TABLE IF NOT EXISTS pm_wallet_market_pnl (
        wallet String,
        condition_id String,
        question String,
        category String,
        tags Array(String),
        outcomes Array(String),
        total_bought_usdc Float64,
        total_bought_shares Float64,
        buy_count UInt64,
        avg_buy_price Float64,
        total_sold_usdc Float64,
        total_sold_shares Float64,
        sell_count UInt64,
        avg_sell_price Float64,
        net_shares Float64,
        total_fees Float64,
        trading_pnl Float64,
        total_trades UInt64,
        first_trade DateTime,
        last_trade DateTime,
        resolved_at Nullable(DateTime),
        payout_numerators Nullable(String),
        payout_denominator Nullable(String),
        is_resolved UInt8,
        computed_at DateTime DEFAULT now()
      ) ENGINE = SharedMergeTree
      ORDER BY (wallet, condition_id)
      SETTINGS index_granularity = 8192`)
    
    console.log('\n⚠️ Table created but not populated. Use a batch INSERT for large data.')
  } else {
    // Verify the result
    await runQuery('pm_wallet_market_pnl stats',
      `SELECT
        count() as total_rows,
        countDistinct(wallet) as distinct_wallets,
        countDistinct(condition_id) as distinct_markets,
        countIf(is_resolved = 1) as resolved_positions,
        sum(total_bought_usdc) as total_volume_bought,
        sum(total_sold_usdc) as total_volume_sold,
        sum(trading_pnl) as net_trading_pnl
      FROM pm_wallet_market_pnl`)

    // Sample data
    await runQuery('pm_wallet_market_pnl sample (top PnL)',
      `SELECT
        wallet,
        condition_id,
        question,
        category,
        total_bought_usdc,
        total_sold_usdc,
        trading_pnl,
        net_shares,
        is_resolved
      FROM pm_wallet_market_pnl
      WHERE is_resolved = 1
      ORDER BY trading_pnl DESC
      LIMIT 10`)

    await runQuery('pm_wallet_market_pnl sample (worst PnL)',
      `SELECT
        wallet,
        condition_id,
        question,
        category,
        total_bought_usdc,
        total_sold_usdc,
        trading_pnl,
        net_shares,
        is_resolved
      FROM pm_wallet_market_pnl
      WHERE is_resolved = 1
      ORDER BY trading_pnl ASC
      LIMIT 10`)
  }

  await clickhouse.close()
  console.log('\n✅ Done!')
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error)
  process.exit(1)
})
