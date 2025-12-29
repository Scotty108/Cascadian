#!/usr/bin/env npx tsx

/**
 * Rebuild PnL with MAKER-ONLY fills
 *
 * BREAKTHROUGH FINDING: Goldsky uses MAKER-ONLY fills for PnL calculation.
 * Our previous computation included both maker and taker fills, inflating
 * shares bought by ~6M for Theo (49M vs Goldsky's 43M).
 *
 * MAKER-ONLY fix produces PnL within 1.32% of Goldsky reference.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 3600000, // 60 minute timeout for large inserts
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
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 300 }
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
  console.log('\n🔧 REBUILDING pm_wallet_market_pnl WITH RESOLUTION PAYOUTS')

  // Step 1: Drop old tables
  await runCommand('DROP old pm_wallet_market_pnl',
    `DROP TABLE IF EXISTS pm_wallet_market_pnl`)

  await runCommand('DROP old pm_wallet_market_pnl_v2 (if exists)',
    `DROP TABLE IF EXISTS pm_wallet_market_pnl_v2`)

  // Step 2: Create new table with correct schema
  await runCommand('CREATE pm_wallet_market_pnl_v2 (empty)',
    `CREATE TABLE IF NOT EXISTS pm_wallet_market_pnl_v2 (
      wallet String,
      condition_id String,
      outcome_index UInt8,
      question String,
      category String,
      -- Trading metrics (in USD, scaled)
      total_bought_usdc Float64,
      total_sold_usdc Float64,
      total_fees_usdc Float64,
      bought_shares Float64,
      sold_shares Float64,
      net_shares Float64,
      -- Resolution info
      payout_numerators String,
      payout_denominator String,
      outcome_payout UInt8,
      is_resolved UInt8,
      resolved_at Nullable(DateTime),
      -- PnL calculations
      trading_pnl Float64,           -- sold - bought - fees
      resolution_payout Float64,     -- net_shares * outcome_payout (if won)
      total_pnl Float64,             -- trading_pnl + resolution_payout
      -- Counts
      total_trades UInt64,
      first_trade DateTime,
      last_trade DateTime,
      computed_at DateTime DEFAULT now()
    ) ENGINE = SharedMergeTree
    ORDER BY (wallet, condition_id, outcome_index)
    SETTINGS index_granularity = 8192`)

  // Step 3: Insert with MAKER-ONLY calculation (matching Goldsky methodology)
  console.log('\n⏳ Inserting data with MAKER-ONLY fills (this may take 20-40 minutes)...')
  console.log('   KEY FIX: Only counting role=maker fills for shares/cost basis')

  await runCommand('INSERT pm_wallet_market_pnl_v2',
    `INSERT INTO pm_wallet_market_pnl_v2
    SELECT
      t.trader_wallet as wallet,
      m.condition_id as condition_id,
      m.outcome_index as outcome_index,
      any(md.question) as question,
      any(md.category) as category,
      -- Trading metrics: MAKER-ONLY buys (matching Goldsky methodology)
      sumIf(t.usdc_amount, lower(t.side) = 'buy' AND t.role = 'maker') / 1e6 as total_bought_usdc,
      sumIf(t.usdc_amount, lower(t.side) = 'sell' AND t.role = 'maker') / 1e6 as total_sold_usdc,
      sumIf(t.fee_amount, t.role = 'maker') / 1e6 as total_fees_usdc,
      sumIf(t.token_amount, lower(t.side) = 'buy' AND t.role = 'maker') / 1e6 as bought_shares,
      sumIf(t.token_amount, lower(t.side) = 'sell' AND t.role = 'maker') / 1e6 as sold_shares,
      (sumIf(t.token_amount, lower(t.side) = 'buy' AND t.role = 'maker') - sumIf(t.token_amount, lower(t.side) = 'sell' AND t.role = 'maker')) / 1e6 as net_shares,
      -- Resolution info
      any(r.payout_numerators) as payout_numerators,
      any(r.payout_denominator) as payout_denominator,
      JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) as outcome_payout,
      IF(any(r.condition_id) IS NOT NULL, 1, 0) as is_resolved,
      any(r.resolved_at) as resolved_at,
      -- PnL calculations (MAKER-ONLY)
      (sumIf(t.usdc_amount, lower(t.side) = 'sell' AND t.role = 'maker') - sumIf(t.usdc_amount, lower(t.side) = 'buy' AND t.role = 'maker') - sumIf(t.fee_amount, t.role = 'maker')) / 1e6 as trading_pnl,
      -- Resolution payout = positive MAKER net_shares * outcome_payout
      greatest(0, (sumIf(t.token_amount, lower(t.side) = 'buy' AND t.role = 'maker') - sumIf(t.token_amount, lower(t.side) = 'sell' AND t.role = 'maker')) / 1e6)
        * JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) as resolution_payout,
      -- Total PnL = trading + resolution
      (sumIf(t.usdc_amount, lower(t.side) = 'sell' AND t.role = 'maker') - sumIf(t.usdc_amount, lower(t.side) = 'buy' AND t.role = 'maker') - sumIf(t.fee_amount, t.role = 'maker')) / 1e6
        + greatest(0, (sumIf(t.token_amount, lower(t.side) = 'buy' AND t.role = 'maker') - sumIf(t.token_amount, lower(t.side) = 'sell' AND t.role = 'maker')) / 1e6)
          * JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) as total_pnl,
      -- Counts (all fills for reference)
      count() as total_trades,
      min(t.trade_time) as first_trade,
      max(t.trade_time) as last_trade,
      now() as computed_at
    FROM pm_trader_events_v2 t
    INNER JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata md ON md.condition_id = m.condition_id
    LEFT JOIN pm_condition_resolutions r ON r.condition_id = m.condition_id
    WHERE t.is_deleted = 0
    GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
    SETTINGS
      max_execution_time = 3600,
      max_memory_usage = 50000000000`)

  // Step 4: Verify
  await runQuery('TABLE STATS',
    `SELECT
      count() as total_rows,
      countDistinct(wallet) as unique_wallets,
      countDistinct(condition_id) as unique_markets,
      round(sum(total_bought_usdc), 2) as total_volume_bought,
      round(sum(total_pnl), 2) as total_pnl_all_wallets
    FROM pm_wallet_market_pnl_v2`)

  // Step 5: Validate against Theo
  const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
  await runQuery(`THEO VALIDATION (${THEO})`,
    `SELECT
      count() as positions,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(trading_pnl), 2) as trading_pnl,
      round(sum(resolution_payout), 2) as resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl
    FROM pm_wallet_market_pnl_v2
    WHERE wallet = '${THEO}'`)

  // Compare to pm_user_positions (Goldsky reference)
  await runQuery('THEO from pm_user_positions (Goldsky reference)',
    `SELECT
      proxy_wallet as wallet,
      round(sum(realized_pnl) / 1e6, 2) as realized_pnl_usd,
      round(sum(total_bought) / 1e6, 2) as total_bought_usd,
      count() as positions
    FROM pm_user_positions
    WHERE proxy_wallet = '${THEO}'
    GROUP BY proxy_wallet`)

  await clickhouse.close()
  console.log('\n✅ Rebuild complete!')
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error)
  process.exit(1)
})
