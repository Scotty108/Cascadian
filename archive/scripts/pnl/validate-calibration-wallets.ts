// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx

/**
 * Validate PnL against calibration wallets using the existing pm_wallet_market_pnl_v2 table
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
})

// Calibration wallets
const WALLETS = {
  THEO: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
  SPORTS_BETTOR: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
  SMALL_WALLET: '0xcce2fc778c6389dad116cd743a0d1c0f3f52e177',
}

async function runQuery(name: string, query: string) {
  console.log(`
${'='.repeat(70)}`)
  console.log(name)
  console.log('='.repeat(70))
  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 120 }
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
  console.log('
🎯 VALIDATING CALIBRATION WALLETS')
  console.log('===================================
')

  // Step 1: Check pm_wallet_market_pnl_v2 stats
  await runQuery('pm_wallet_market_pnl_v2 TABLE STATS',
    `SELECT
      count() as total_rows,
      countDistinct(wallet) as unique_wallets,
      countDistinct(condition_id) as unique_markets,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(total_bought_usdc), 2) as total_volume,
      round(sum(trading_pnl), 2) as net_trading_pnl,
      round(sum(resolution_payout), 2) as total_resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl
    FROM pm_wallet_market_pnl_v2`)

  // Step 2: Validate THEO
  console.log('
📊 THEO VALIDATION')
  await runQuery(`THEO (${WALLETS.THEO}) - Aggregated PnL`,
    `SELECT
      wallet,
      count() as positions,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(total_fees_usdc), 2) as total_fees,
      round(sum(trading_pnl), 2) as trading_pnl,
      round(sum(resolution_payout), 2) as resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl
    FROM pm_wallet_market_pnl_v2
    WHERE wallet = '${WALLETS.THEO}'
    GROUP BY wallet`)

  await runQuery(`THEO - Top 5 winning positions`,
    `SELECT
      condition_id,
      question,
      round(trading_pnl, 2) as trading_pnl,
      round(resolution_payout, 2) as resolution_payout,
      round(total_pnl, 2) as total_pnl,
      is_resolved
    FROM pm_wallet_market_pnl_v2
    WHERE wallet = '${WALLETS.THEO}'
    ORDER BY total_pnl DESC
    LIMIT 5`)

  // Step 3: Validate SPORTS BETTOR
  console.log('
📊 SPORTS BETTOR VALIDATION')
  await runQuery(`SPORTS BETTOR (${WALLETS.SPORTS_BETTOR}) - Aggregated PnL`,
    `SELECT
      wallet,
      count() as positions,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(total_fees_usdc), 2) as total_fees,
      round(sum(trading_pnl), 2) as trading_pnl,
      round(sum(resolution_payout), 2) as resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl
    FROM pm_wallet_market_pnl_v2
    WHERE wallet = '${WALLETS.SPORTS_BETTOR}'
    GROUP BY wallet`)

  // Step 4: Validate SMALL WALLET
  console.log('
📊 SMALL WALLET VALIDATION')
  await runQuery(`SMALL WALLET (${WALLETS.SMALL_WALLET}) - Aggregated PnL`,
    `SELECT
      wallet,
      count() as positions,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(total_fees_usdc), 2) as total_fees,
      round(sum(trading_pnl), 2) as trading_pnl,
      round(sum(resolution_payout), 2) as resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl
    FROM pm_wallet_market_pnl_v2
    WHERE wallet = '${WALLETS.SMALL_WALLET}'
    GROUP BY wallet`)

  // Step 5: Compare with pm_user_positions (Goldsky)
  console.log('
📊 COMPARISON WITH pm_user_positions (Goldsky)')
  await runQuery('pm_user_positions schema check',
    `DESCRIBE TABLE pm_user_positions LIMIT 5`)

  // Summary
  console.log('
' + '='.repeat(70))
  console.log('VALIDATION TARGETS')
  console.log('='.repeat(70))
  console.log(`
THEO (${WALLETS.THEO}):
  - Expected Total PnL: ~$22M (from previous session)
  - If lower, check if all positions are being captured

SPORTS BETTOR (${WALLETS.SPORTS_BETTOR}):
  - Expected Trading PnL: ~-$11M (matches analytics site)
  - Expected Goldsky realized_pnl: +$28.8M
  - The difference is resolution payouts

SMALL WALLET (${WALLETS.SMALL_WALLET}):
  - Expected Total PnL: ~$87.5K

KEY METRICS:
  - Trading PnL = fills only (sold - bought - fees)
  - Resolution Payout = net_shares * $1 if won
  - Total PnL = Trading PnL + Resolution Payout
`)

  await clickhouse.close()
  console.log('
✅ Validation complete!')
}

main().catch(error => {
  console.error('
FATAL ERROR:', error)
  process.exit(1)
})
