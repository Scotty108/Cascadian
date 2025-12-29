// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * create-ledger-view.ts
 *
 * Creates `vw_pm_ledger` - the event stream normalization layer.
 *
 * PURPOSE:
 * --------
 * This view provides a clean, normalized view of ALL asset movements
 * regardless of maker/taker role. It serves as the foundation for the
 * tax lot engine and any downstream PnL calculations.
 *
 * KEY PRINCIPLES:
 * ---------------
 * 1. ALL fills included - no maker-only filter (learned lesson from v1/v2)
 * 2. Proper sign conventions:
 *    - BUY:  shares_delta = +amount, cash_delta = -amount (you spend cash, gain shares)
 *    - SELL: shares_delta = -amount, cash_delta = +amount (you gain cash, lose shares)
 * 3. Role is informational only - NOT used for filtering
 * 4. Unit scaling: /1e6 to convert atomic units to human-readable (1 share = 1.0)
 *
 * SCHEMA:
 * -------
 * - event_id:         Unique fill identifier
 * - wallet_address:   Trader's wallet
 * - token_id:         Position token (from pm_token_to_condition_map_v2)
 * - condition_id:     Market condition
 * - outcome_index:    Which outcome (0 or 1 for binary markets)
 * - role:             'maker' or 'taker' (informational only)
 * - side:             'buy' or 'sell' (from trader's perspective)
 * - shares_delta:     Positive for buys, negative for sells
 * - cash_delta_usdc:  Negative for buys (spent), positive for sells (received)
 * - fee_usdc:         Always positive
 * - block_time:       When the trade occurred
 * - tx_hash:          Transaction hash
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

// ClickHouse client
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000, // 5 minutes
})

// Calibration wallets for validation
const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
const SPORTS = '0xf29bb8e0712075041e87e8605b69833ef738dd4c'

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
        max_execution_time: 300,
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
        max_execution_time: 300,
      },
    })
    const data = (await result.json()) as T[]
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`  Done in ${elapsed}s (${data.length} rows)`)
    return data
  } catch (error) {
    console.error(`  FAILED after ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
    throw error
  }
}

// Step 1: Drop existing view if exists
async function dropView(): Promise<void> {
  await runCommand('Dropping vw_pm_ledger if exists', `
    DROP VIEW IF EXISTS vw_pm_ledger
  `)
}

// Step 2: Create the ledger view
async function createView(): Promise<void> {
  await runCommand('Creating vw_pm_ledger view', `
    CREATE OR REPLACE VIEW vw_pm_ledger AS
    SELECT
      t.event_id AS event_id,
      t.trader_wallet AS wallet_address,
      t.token_id AS token_id,
      m.condition_id AS condition_id,
      m.outcome_index AS outcome_index,
      t.role AS role,
      lower(t.side) AS side,
      -- Shares delta: positive for buys, negative for sells (scaled to 1 share = 1.0)
      CASE
        WHEN lower(t.side) = 'buy' THEN t.token_amount / 1e6
        ELSE -t.token_amount / 1e6
      END AS shares_delta,
      -- Cash delta: negative for buys (spent), positive for sells (received)
      CASE
        WHEN lower(t.side) = 'buy' THEN -t.usdc_amount / 1e6
        ELSE t.usdc_amount / 1e6
      END AS cash_delta_usdc,
      -- Fee is always positive
      t.fee_amount / 1e6 AS fee_usdc,
      t.trade_time AS block_time,
      t.transaction_hash AS tx_hash
    FROM pm_trader_events_v2 t
    INNER JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id
    WHERE t.is_deleted = 0
  `)
}

// Step 3: Verify the view works with a sample query
async function verifyView(): Promise<void> {
  interface VerifyResult {
    total_entries: string
    unique_wallets: string
    min_date: string
    max_date: string
  }

  const stats = await runQuery<VerifyResult>(
    'Verifying view with sample query',
    `
    SELECT
      count() AS total_entries,
      uniqExact(wallet_address) AS unique_wallets,
      min(block_time) AS min_date,
      max(block_time) AS max_date
    FROM vw_pm_ledger
  `
  )

  if (stats.length > 0) {
    console.log('
=== VIEW STATISTICS ===')
    console.log(`  Total entries:   ${parseInt(stats[0].total_entries).toLocaleString()}`)
    console.log(`  Unique wallets:  ${parseInt(stats[0].unique_wallets).toLocaleString()}`)
    console.log(`  Date range:      ${stats[0].min_date} to ${stats[0].max_date}`)
  }
}

// Step 4: Test with calibration wallets
async function testCalibrationWallets(): Promise<void> {
  console.log('
=== CALIBRATION WALLET SAMPLES ===')

  interface LedgerEntry {
    event_id: string
    wallet_address: string
    token_id: string
    condition_id: string
    outcome_index: string
    role: string
    side: string
    shares_delta: string
    cash_delta_usdc: string
    fee_usdc: string
    block_time: string
    tx_hash: string
  }

  // Test Theo's wallet
  console.log(`
--- Theo (${THEO.slice(0, 10)}...) ---`)
  const theoEntries = await runQuery<LedgerEntry>(
    "Fetching Theo's sample ledger entries",
    `
    SELECT *
    FROM vw_pm_ledger
    WHERE wallet_address = '${THEO}'
    ORDER BY block_time DESC
    LIMIT 10
  `
  )

  if (theoEntries.length > 0) {
    console.log('  Sample entries (most recent):')
    for (const entry of theoEntries.slice(0, 5)) {
      const sharesSign = parseFloat(entry.shares_delta) >= 0 ? '+' : ''
      const cashSign = parseFloat(entry.cash_delta_usdc) >= 0 ? '+' : ''
      console.log(
        `    [${entry.side.toUpperCase()}] ${sharesSign}${parseFloat(entry.shares_delta).toFixed(2)} shares, ` +
          `${cashSign}$${parseFloat(entry.cash_delta_usdc).toFixed(2)} cash, ` +
          `fee: $${parseFloat(entry.fee_usdc).toFixed(4)}, role: ${entry.role}`
      )
    }
  }

  // Get Theo's aggregate stats
  interface WalletStats {
    total_entries: string
    total_buys: string
    total_sells: string
    net_shares: string
    net_cash: string
    total_fees: string
  }

  const theoStats = await runQuery<WalletStats>(
    "Getting Theo's aggregate stats",
    `
    SELECT
      count() AS total_entries,
      countIf(side = 'buy') AS total_buys,
      countIf(side = 'sell') AS total_sells,
      sum(shares_delta) AS net_shares,
      sum(cash_delta_usdc) AS net_cash,
      sum(fee_usdc) AS total_fees
    FROM vw_pm_ledger
    WHERE wallet_address = '${THEO}'
  `
  )

  if (theoStats.length > 0) {
    const s = theoStats[0]
    console.log(`  Aggregates:`)
    console.log(`    Total entries: ${parseInt(s.total_entries).toLocaleString()}`)
    console.log(`    Buys: ${parseInt(s.total_buys).toLocaleString()}, Sells: ${parseInt(s.total_sells).toLocaleString()}`)
    console.log(`    Net shares: ${parseFloat(s.net_shares).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
    console.log(`    Net cash: $${parseFloat(s.net_cash).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
    console.log(`    Total fees: $${parseFloat(s.total_fees).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
  }

  // Test Sports Bettor's wallet
  console.log(`
--- Sports Bettor (${SPORTS.slice(0, 10)}...) ---`)
  const sportsEntries = await runQuery<LedgerEntry>(
    "Fetching Sports Bettor's sample ledger entries",
    `
    SELECT *
    FROM vw_pm_ledger
    WHERE wallet_address = '${SPORTS}'
    ORDER BY block_time DESC
    LIMIT 10
  `
  )

  if (sportsEntries.length > 0) {
    console.log('  Sample entries (most recent):')
    for (const entry of sportsEntries.slice(0, 5)) {
      const sharesSign = parseFloat(entry.shares_delta) >= 0 ? '+' : ''
      const cashSign = parseFloat(entry.cash_delta_usdc) >= 0 ? '+' : ''
      console.log(
        `    [${entry.side.toUpperCase()}] ${sharesSign}${parseFloat(entry.shares_delta).toFixed(2)} shares, ` +
          `${cashSign}$${parseFloat(entry.cash_delta_usdc).toFixed(2)} cash, ` +
          `fee: $${parseFloat(entry.fee_usdc).toFixed(4)}, role: ${entry.role}`
      )
    }
  }

  const sportsStats = await runQuery<WalletStats>(
    "Getting Sports Bettor's aggregate stats",
    `
    SELECT
      count() AS total_entries,
      countIf(side = 'buy') AS total_buys,
      countIf(side = 'sell') AS total_sells,
      sum(shares_delta) AS net_shares,
      sum(cash_delta_usdc) AS net_cash,
      sum(fee_usdc) AS total_fees
    FROM vw_pm_ledger
    WHERE wallet_address = '${SPORTS}'
  `
  )

  if (sportsStats.length > 0) {
    const s = sportsStats[0]
    console.log(`  Aggregates:`)
    console.log(`    Total entries: ${parseInt(s.total_entries).toLocaleString()}`)
    console.log(`    Buys: ${parseInt(s.total_buys).toLocaleString()}, Sells: ${parseInt(s.total_sells).toLocaleString()}`)
    console.log(`    Net shares: ${parseFloat(s.net_shares).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
    console.log(`    Net cash: $${parseFloat(s.net_cash).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
    console.log(`    Total fees: $${parseFloat(s.total_fees).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
  }
}

// Main execution
async function main(): Promise<void> {
  console.log('='.repeat(80))
  console.log('CREATING vw_pm_ledger - EVENT STREAM NORMALIZATION LAYER')
  console.log('='.repeat(80))
  console.log(`Started: ${new Date().toISOString()}`)
  console.log(`Host: ${process.env.CLICKHOUSE_HOST}`)

  const startTime = Date.now()

  try {
    // Step 1: Drop existing view
    await dropView()

    // Step 2: Create new view
    await createView()

    // Step 3: Verify the view works
    await verifyView()

    // Step 4: Test with calibration wallets
    await testCalibrationWallets()

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log('
' + '='.repeat(80))
    console.log('VIEW CREATION COMPLETE')
    console.log('='.repeat(80))
    console.log(`Total time: ${totalTime}s`)
    console.log(`View name: vw_pm_ledger`)
    console.log(`Finished: ${new Date().toISOString()}`)
    console.log('
The ledger view is ready for the tax lot engine.')
  } catch (error) {
    console.error('
!!! VIEW CREATION FAILED !!!')
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
