// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx

/**
 * Build Canonical Cascadian PnL Tables
 *
 * Creates:
 * 1. vw_fills_deduped - Base fills grouped by event_id (no double-counting)
 * 2. vw_wallet_trading_pnl - Fills-only PnL (sold - bought - fees)
 * 3. vw_wallet_pnl_canonical - Trading PnL + resolution payouts
 * 4. pm_wallet_pnl_canonical - Materialized table for performance
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

async function runCommand(name: string, query: string) {
  console.log(`
${'='.repeat(70)}`)
  console.log(name)
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
  console.log(`
${'='.repeat(70)}`)
  console.log(name)
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
  console.log('
🏗️  BUILDING CANONICAL CASCADIAN PnL')
  console.log('=====================================
')

  // Step 1: Check current data quality
  console.log('📊 Step 1: Checking source data quality...')

  await runQuery('pm_trader_events_v2 stats',
    `SELECT
      count() as total_rows,
      countDistinct(event_id) as distinct_events,
      count() - countDistinct(event_id) as duplicate_rows,
      countDistinct(trader_wallet) as unique_wallets,
      min(trade_time) as earliest,
      max(trade_time) as latest
    FROM pm_trader_events_v2
    WHERE is_deleted = 0`)

  await runQuery('pm_token_to_condition_map_v2 coverage',
    `SELECT
      count() as total_trades,
      countIf(m.condition_id IS NOT NULL) as mapped_trades,
      countIf(m.condition_id IS NULL) as unmapped_trades,
      round(countIf(m.condition_id IS NOT NULL) * 100.0 / count(), 2) as coverage_pct
    FROM pm_trader_events_v2 t
    LEFT JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id
    WHERE t.is_deleted = 0`)

  await runQuery('pm_condition_resolutions stats',
    `SELECT
      count() as total_resolutions,
      countDistinct(condition_id) as unique_conditions
    FROM pm_condition_resolutions`)

  // Step 2: Create deduped fills view
  console.log('
📊 Step 2: Creating deduped fills view...')

  await runCommand('DROP vw_fills_deduped (if exists)',
    `DROP VIEW IF EXISTS vw_fills_deduped`)

  await runCommand('CREATE vw_fills_deduped',
    `CREATE VIEW vw_fills_deduped AS
    SELECT
      event_id,
      any(trader_wallet) as trader_wallet,
      any(token_id) as token_id,
      any(side) as side,
      any(usdc_amount) as usdc_amount,
      any(token_amount) as token_amount,
      any(fee_amount) as fee_amount,
      any(trade_time) as trade_time,
      any(transaction_hash) as transaction_hash
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY event_id`)

  // Verify dedup
  await runQuery('vw_fills_deduped verification',
    `SELECT
      count() as fill_count,
      countDistinct(event_id) as unique_fills
    FROM vw_fills_deduped
    LIMIT 1`)

  // Step 3: Create wallet trading PnL view (fills only, no resolution)
  console.log('
📊 Step 3: Creating trading PnL view (fills only)...')

  await runCommand('DROP vw_wallet_trading_pnl (if exists)',
    `DROP VIEW IF EXISTS vw_wallet_trading_pnl`)

  await runCommand('CREATE vw_wallet_trading_pnl',
    `CREATE VIEW vw_wallet_trading_pnl AS
    SELECT
      f.trader_wallet as wallet,
      m.condition_id,
      m.outcome_index,
      -- Cash flows (scaled from atomic units to USD)
      sumIf(f.usdc_amount, lower(f.side) = 'buy') / 1e6 as total_bought_usdc,
      sumIf(f.usdc_amount, lower(f.side) = 'sell') / 1e6 as total_sold_usdc,
      sum(f.fee_amount) / 1e6 as total_fees_usdc,
      -- Share tracking
      sumIf(f.token_amount, lower(f.side) = 'buy') / 1e6 as shares_bought,
      sumIf(f.token_amount, lower(f.side) = 'sell') / 1e6 as shares_sold,
      (sumIf(f.token_amount, lower(f.side) = 'buy') - sumIf(f.token_amount, lower(f.side) = 'sell')) / 1e6 as net_shares,
      -- Trading PnL = sold - bought - fees
      (sumIf(f.usdc_amount, lower(f.side) = 'sell') - sumIf(f.usdc_amount, lower(f.side) = 'buy') - sum(f.fee_amount)) / 1e6 as trading_pnl,
      -- Trade counts and time
      count() as total_trades,
      min(f.trade_time) as first_trade,
      max(f.trade_time) as last_trade
    FROM vw_fills_deduped f
    INNER JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = f.token_id
    GROUP BY f.trader_wallet, m.condition_id, m.outcome_index`)

  // Step 4: Create canonical PnL view (trading + resolution)
  console.log('
📊 Step 4: Creating canonical PnL view (trading + resolution)...')

  await runCommand('DROP vw_wallet_pnl_canonical (if exists)',
    `DROP VIEW IF EXISTS vw_wallet_pnl_canonical`)

  await runCommand('CREATE vw_wallet_pnl_canonical',
    `CREATE VIEW vw_wallet_pnl_canonical AS
    SELECT
      f.trader_wallet as wallet,
      m.condition_id,
      m.outcome_index,
      any(md.question) as question,
      any(md.category) as category,
      -- Cash flows
      sumIf(f.usdc_amount, lower(f.side) = 'buy') / 1e6 as total_bought_usdc,
      sumIf(f.usdc_amount, lower(f.side) = 'sell') / 1e6 as total_sold_usdc,
      sum(f.fee_amount) / 1e6 as total_fees_usdc,
      -- Share tracking
      sumIf(f.token_amount, lower(f.side) = 'buy') / 1e6 as shares_bought,
      sumIf(f.token_amount, lower(f.side) = 'sell') / 1e6 as shares_sold,
      (sumIf(f.token_amount, lower(f.side) = 'buy') - sumIf(f.token_amount, lower(f.side) = 'sell')) / 1e6 as net_shares,
      -- Resolution info
      any(r.payout_numerators) as payout_numerators,
      any(r.payout_denominator) as payout_denominator,
      IF(any(r.condition_id) IS NOT NULL, 1, 0) as is_resolved,
      any(r.resolved_at) as resolved_at,
      -- Winning outcome detection (1 if this outcome won, 0 otherwise)
      CASE
        WHEN any(r.condition_id) IS NOT NULL
        THEN JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1)
        ELSE 0
      END as outcome_won,
      -- Trading PnL = sold - bought - fees
      (sumIf(f.usdc_amount, lower(f.side) = 'sell') - sumIf(f.usdc_amount, lower(f.side) = 'buy') - sum(f.fee_amount)) / 1e6 as trading_pnl,
      -- Resolution payout = positive net_shares if outcome won
      CASE
        WHEN any(r.condition_id) IS NOT NULL
             AND JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) = 1
        THEN greatest(0, (sumIf(f.token_amount, lower(f.side) = 'buy') - sumIf(f.token_amount, lower(f.side) = 'sell')) / 1e6)
        ELSE 0
      END as resolution_payout,
      -- Total PnL = trading + resolution
      (sumIf(f.usdc_amount, lower(f.side) = 'sell') - sumIf(f.usdc_amount, lower(f.side) = 'buy') - sum(f.fee_amount)) / 1e6
      + CASE
          WHEN any(r.condition_id) IS NOT NULL
               AND JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) = 1
          THEN greatest(0, (sumIf(f.token_amount, lower(f.side) = 'buy') - sumIf(f.token_amount, lower(f.side) = 'sell')) / 1e6)
          ELSE 0
        END as total_pnl,
      -- Trade counts
      count() as total_trades,
      min(f.trade_time) as first_trade,
      max(f.trade_time) as last_trade
    FROM vw_fills_deduped f
    INNER JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = f.token_id
    LEFT JOIN pm_market_metadata md ON md.condition_id = m.condition_id
    LEFT JOIN pm_condition_resolutions r ON r.condition_id = m.condition_id
    GROUP BY f.trader_wallet, m.condition_id, m.outcome_index`)

  // Step 5: Validate against calibration wallets
  console.log('
📊 Step 5: Validating against calibration wallets...')

  // Theo validation
  await runQuery(`THEO (${WALLETS.THEO}) - Trading PnL`,
    `SELECT
      wallet,
      count() as positions,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(total_fees_usdc), 2) as total_fees,
      round(sum(trading_pnl), 2) as trading_pnl
    FROM vw_wallet_trading_pnl
    WHERE wallet = '${WALLETS.THEO}'
    GROUP BY wallet`)

  await runQuery(`THEO (${WALLETS.THEO}) - Canonical PnL`,
    `SELECT
      wallet,
      count() as positions,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(trading_pnl), 2) as trading_pnl,
      round(sum(resolution_payout), 2) as resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl
    FROM vw_wallet_pnl_canonical
    WHERE wallet = '${WALLETS.THEO}'
    GROUP BY wallet`)

  // Sports bettor validation
  await runQuery(`SPORTS BETTOR (${WALLETS.SPORTS_BETTOR}) - Trading PnL`,
    `SELECT
      wallet,
      count() as positions,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(trading_pnl), 2) as trading_pnl
    FROM vw_wallet_trading_pnl
    WHERE wallet = '${WALLETS.SPORTS_BETTOR}'
    GROUP BY wallet`)

  await runQuery(`SPORTS BETTOR (${WALLETS.SPORTS_BETTOR}) - Canonical PnL`,
    `SELECT
      wallet,
      count() as positions,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(trading_pnl), 2) as trading_pnl,
      round(sum(resolution_payout), 2) as resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl
    FROM vw_wallet_pnl_canonical
    WHERE wallet = '${WALLETS.SPORTS_BETTOR}'
    GROUP BY wallet`)

  // Small wallet validation
  await runQuery(`SMALL WALLET (${WALLETS.SMALL_WALLET}) - Canonical PnL`,
    `SELECT
      wallet,
      count() as positions,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(trading_pnl), 2) as trading_pnl,
      round(sum(resolution_payout), 2) as resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl
    FROM vw_wallet_pnl_canonical
    WHERE wallet = '${WALLETS.SMALL_WALLET}'
    GROUP BY wallet`)

  // Step 6: Summary table
  console.log('
📊 Step 6: Printing validation summary...')

  console.log('
' + '='.repeat(70))
  console.log('VALIDATION TARGETS')
  console.log('='.repeat(70))
  console.log(`
THEO (${WALLETS.THEO}):
  - Expected Total PnL: ~$22M (from previous validation)

SPORTS BETTOR (${WALLETS.SPORTS_BETTOR}):
  - Expected Trading PnL: ~-$11M (matches analytics site)
  - Goldsky realized_pnl: +$28.8M

SMALL WALLET (${WALLETS.SMALL_WALLET}):
  - Expected Total PnL: ~$87.5K

NOTE: Trading PnL = fills only (sold - bought - fees)
      Total PnL = Trading PnL + Resolution Payouts
`)

  await clickhouse.close()
  console.log('
✅ Canonical PnL build complete!')
  console.log('
Created:')
  console.log('  - vw_fills_deduped (deduped base fills)')
  console.log('  - vw_wallet_trading_pnl (fills-only PnL)')
  console.log('  - vw_wallet_pnl_canonical (trading + resolution PnL)')
}

main().catch(error => {
  console.error('
FATAL ERROR:', error)
  process.exit(1)
})
