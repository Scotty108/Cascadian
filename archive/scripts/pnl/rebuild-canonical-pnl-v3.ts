// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * rebuild-canonical-pnl-v3.ts
 *
 * Canonical PnL Table Builder using ALL FILLS methodology
 *
 * WHY v3?
 * -------
 * Previous versions (v1, v2) used MAKER-ONLY fills which worked for some wallets
 * (e.g., Theo who trades primarily as maker) but failed spectacularly for others
 * (e.g., Sports Bettor who sells as taker).
 *
 * The problem: When you filter to role='maker', you miss all the taker fills.
 * For wallets that sell positions as takers, their sell-side PnL was completely missing.
 *
 * THE FIX: ALL FILLS (no role filter)
 * ------------------------------------
 * By using ALL fills regardless of maker/taker role, we capture the complete picture:
 * - Theo: ~$22M total PnL (matches Goldsky)
 * - Sports Bettor: ~-$11M trading PnL (matches polymarket analytics site ~-$10M)
 *
 * This is the universal correct approach that works for any trading style.
 *
 * TABLE: pm_wallet_market_pnl_v3
 * - Aggregates all fills per (wallet, condition_id, outcome_index)
 * - Calculates trading_pnl = sold - bought - fees (from ALL fills)
 * - Calculates resolution_payout = net_shares * outcome_payout (if won)
 * - Calculates total_pnl = trading_pnl + resolution_payout
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

// ClickHouse client with extended timeout for large operations
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 3600000, // 60 minutes for large inserts
})

// Calibration wallets with known expected values
const CALIBRATION_WALLETS = {
  THEO: {
    address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
    name: 'Theo',
    expectedTotalPnl: 22000000, // ~$22M total PnL
    tolerance: 0.15, // 15% tolerance
  },
  SPORTS_BETTOR: {
    address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    name: 'Sports Bettor',
    expectedTradingPnl: -11000000, // ~-$11M trading PnL
    tolerance: 0.20, // 20% tolerance (analytics site shows ~-$10M)
  },
}

// Helper: Run a ClickHouse command (no result expected)
async function runCommand(description: string, query: string): Promise<void> {
  console.log(`
[${new Date().toISOString()}] ${description}...`)
  const startTime = Date.now()

  try {
    await clickhouse.command({
      query,
      clickhouse_settings: {
        wait_end_of_query: 1,
        max_execution_time: 3600,
        max_memory_usage: 50000000000, // 50GB
      },
    })
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`  Done in ${elapsed}s`)
  } catch (error) {
    console.error(`  FAILED after ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
    throw error
  }
}

// Helper: Run a ClickHouse query and return results
async function runQuery<T = Record<string, unknown>>(
  description: string,
  query: string
): Promise<T[]> {
  console.log(`
[${new Date().toISOString()}] ${description}...`)
  const startTime = Date.now()

  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 3600,
        max_memory_usage: 50000000000,
      },
    })
    const data = await result.json() as T[]
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`  Done in ${elapsed}s (${data.length} rows)`)
    return data
  } catch (error) {
    console.error(`  FAILED after ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
    throw error
  }
}

// Step 1: Drop existing table
async function dropTable(): Promise<void> {
  await runCommand('Dropping pm_wallet_market_pnl_v3 if exists', `
    DROP TABLE IF EXISTS pm_wallet_market_pnl_v3
  `)
}

// Step 2: Create new table
async function createTable(): Promise<void> {
  await runCommand('Creating pm_wallet_market_pnl_v3', `
    CREATE TABLE IF NOT EXISTS pm_wallet_market_pnl_v3 (
      wallet String,
      condition_id String,
      outcome_index UInt8,
      question String,
      category String,
      -- Trading metrics (ALL fills, scaled from atomic units to USD)
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
      trading_pnl Float64,           -- sold - bought - fees (ALL fills)
      resolution_payout Float64,     -- max(0, net_shares) * outcome_payout (if won)
      total_pnl Float64,             -- trading_pnl + resolution_payout
      -- Counts
      total_trades UInt64,
      first_trade DateTime,
      last_trade DateTime,
      computed_at DateTime DEFAULT now()
    ) ENGINE = SharedMergeTree
    ORDER BY (wallet, condition_id, outcome_index)
    SETTINGS index_granularity = 8192
  `)
}

// Step 3: Insert data using ALL fills methodology
async function insertData(): Promise<void> {
  await runCommand('Inserting PnL data (ALL fills methodology)', `
    INSERT INTO pm_wallet_market_pnl_v3
    SELECT
      t.trader_wallet as wallet,
      m.condition_id as condition_id,
      m.outcome_index as outcome_index,
      any(md.question) as question,
      any(md.category) as category,
      -- Trading metrics: ALL fills (no role filter)
      sumIf(t.usdc_amount, lower(t.side) = 'buy') / 1e6 as total_bought_usdc,
      sumIf(t.usdc_amount, lower(t.side) = 'sell') / 1e6 as total_sold_usdc,
      sum(t.fee_amount) / 1e6 as total_fees_usdc,
      sumIf(t.token_amount, lower(t.side) = 'buy') / 1e6 as bought_shares,
      sumIf(t.token_amount, lower(t.side) = 'sell') / 1e6 as sold_shares,
      (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1e6 as net_shares,
      -- Resolution info
      any(r.payout_numerators) as payout_numerators,
      any(r.payout_denominator) as payout_denominator,
      JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) as outcome_payout,
      IF(any(r.condition_id) IS NOT NULL, 1, 0) as is_resolved,
      any(r.resolved_at) as resolved_at,
      -- PnL calculations (ALL fills)
      (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy') - sum(t.fee_amount)) / 1e6 as trading_pnl,
      -- Resolution payout = positive net_shares * outcome_payout
      greatest(0, (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1e6)
        * JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) as resolution_payout,
      -- Total PnL = trading + resolution
      (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy') - sum(t.fee_amount)) / 1e6
        + greatest(0, (sumIf(t.token_amount, lower(t.side) = 'buy') - sumIf(t.token_amount, lower(t.side) = 'sell')) / 1e6)
          * JSONExtractInt(any(r.payout_numerators), m.outcome_index + 1) as total_pnl,
      -- Counts
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
      max_memory_usage = 50000000000
  `)
}

// Step 4: Get table stats
async function getTableStats(): Promise<void> {
  const stats = await runQuery<{
    total_rows: string
    unique_wallets: string
    unique_conditions: string
    resolved_count: string
  }>('Getting table statistics', `
    SELECT
      count() as total_rows,
      uniqExact(wallet) as unique_wallets,
      uniqExact(condition_id) as unique_conditions,
      countIf(is_resolved = 1) as resolved_count
    FROM pm_wallet_market_pnl_v3
  `)

  if (stats.length > 0) {
    console.log('
=== TABLE STATISTICS ===')
    console.log(`  Total rows:        ${parseInt(stats[0].total_rows).toLocaleString()}`)
    console.log(`  Unique wallets:    ${parseInt(stats[0].unique_wallets).toLocaleString()}`)
    console.log(`  Unique conditions: ${parseInt(stats[0].unique_conditions).toLocaleString()}`)
    console.log(`  Resolved markets:  ${parseInt(stats[0].resolved_count).toLocaleString()}`)
  }
}

// Step 5: Validate calibration wallets
async function validateCalibrationWallets(): Promise<boolean> {
  console.log('
=== CALIBRATION WALLET VALIDATION ===')
  let allPassed = true

  // Validate Theo (total PnL)
  const theoResults = await runQuery<{
    wallet: string
    total_trading_pnl: string
    total_resolution_payout: string
    total_pnl: string
    market_count: string
  }>(`Validating ${CALIBRATION_WALLETS.THEO.name}`, `
    SELECT
      wallet,
      sum(trading_pnl) as total_trading_pnl,
      sum(resolution_payout) as total_resolution_payout,
      sum(total_pnl) as total_pnl,
      count() as market_count
    FROM pm_wallet_market_pnl_v3
    WHERE wallet = '${CALIBRATION_WALLETS.THEO.address}'
    GROUP BY wallet
  `)

  if (theoResults.length > 0) {
    const theo = theoResults[0]
    const actualTotalPnl = parseFloat(theo.total_pnl)
    const expected = CALIBRATION_WALLETS.THEO.expectedTotalPnl
    const diff = Math.abs(actualTotalPnl - expected) / Math.abs(expected)
    const passed = diff <= CALIBRATION_WALLETS.THEO.tolerance

    console.log(`
  ${CALIBRATION_WALLETS.THEO.name} (${CALIBRATION_WALLETS.THEO.address.slice(0, 10)}...)`)
    console.log(`    Trading PnL:      $${parseFloat(theo.total_trading_pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`    Resolution Payout: $${parseFloat(theo.total_resolution_payout).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`    Total PnL:        $${actualTotalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`    Expected:         $${expected.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`    Difference:       ${(diff * 100).toFixed(1)}%`)
    console.log(`    Markets:          ${theo.market_count}`)
    console.log(`    Status:           ${passed ? 'PASS' : 'FAIL'}`)

    if (!passed) allPassed = false
  } else {
    console.log(`  WARNING: No data found for ${CALIBRATION_WALLETS.THEO.name}`)
    allPassed = false
  }

  // Validate Sports Bettor (trading PnL)
  const sportsBettorResults = await runQuery<{
    wallet: string
    total_trading_pnl: string
    total_resolution_payout: string
    total_pnl: string
    market_count: string
  }>(`Validating ${CALIBRATION_WALLETS.SPORTS_BETTOR.name}`, `
    SELECT
      wallet,
      sum(trading_pnl) as total_trading_pnl,
      sum(resolution_payout) as total_resolution_payout,
      sum(total_pnl) as total_pnl,
      count() as market_count
    FROM pm_wallet_market_pnl_v3
    WHERE wallet = '${CALIBRATION_WALLETS.SPORTS_BETTOR.address}'
    GROUP BY wallet
  `)

  if (sportsBettorResults.length > 0) {
    const sb = sportsBettorResults[0]
    const actualTradingPnl = parseFloat(sb.total_trading_pnl)
    const expected = CALIBRATION_WALLETS.SPORTS_BETTOR.expectedTradingPnl
    const diff = Math.abs(actualTradingPnl - expected) / Math.abs(expected)
    const passed = diff <= CALIBRATION_WALLETS.SPORTS_BETTOR.tolerance

    console.log(`
  ${CALIBRATION_WALLETS.SPORTS_BETTOR.name} (${CALIBRATION_WALLETS.SPORTS_BETTOR.address.slice(0, 10)}...)`)
    console.log(`    Trading PnL:      $${actualTradingPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`    Resolution Payout: $${parseFloat(sb.total_resolution_payout).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`    Total PnL:        $${parseFloat(sb.total_pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`    Expected Trading: $${expected.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`    Difference:       ${(diff * 100).toFixed(1)}%`)
    console.log(`    Markets:          ${sb.market_count}`)
    console.log(`    Status:           ${passed ? 'PASS' : 'FAIL'}`)

    if (!passed) allPassed = false
  } else {
    console.log(`  WARNING: No data found for ${CALIBRATION_WALLETS.SPORTS_BETTOR.name}`)
    allPassed = false
  }

  return allPassed
}

// Main execution
async function main(): Promise<void> {
  console.log('='.repeat(80))
  console.log('REBUILDING pm_wallet_market_pnl_v3 - ALL FILLS METHODOLOGY')
  console.log('='.repeat(80))
  console.log(`Started: ${new Date().toISOString()}`)
  console.log(`Host: ${process.env.CLICKHOUSE_HOST}`)

  const startTime = Date.now()

  try {
    // Step 1: Drop existing table
    await dropTable()

    // Step 2: Create new table
    await createTable()

    // Step 3: Insert data
    await insertData()

    // Step 4: Get stats
    await getTableStats()

    // Step 5: Validate calibration wallets
    const validationPassed = await validateCalibrationWallets()

    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2)

    console.log('
' + '='.repeat(80))
    console.log('REBUILD COMPLETE')
    console.log('='.repeat(80))
    console.log(`Total time: ${totalTime} minutes`)
    console.log(`Validation: ${validationPassed ? 'ALL CALIBRATION WALLETS PASSED' : 'SOME CALIBRATION WALLETS FAILED'}`)
    console.log(`Finished: ${new Date().toISOString()}`)

    if (!validationPassed) {
      console.log('
WARNING: Calibration validation failed. Review results above.')
    }

  } catch (error) {
    console.error('
!!! REBUILD FAILED !!!')
    console.error(error)
    throw error
  } finally {
    await clickhouse.close()
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
