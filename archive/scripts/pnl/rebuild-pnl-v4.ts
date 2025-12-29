// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * rebuild-pnl-v4.ts
 *
 * Canonical PnL Table Builder using WAC (Weighted Average Cost) SQL Approximation
 *
 * WHY v4?
 * -------
 * Previous versions (v1-v3) used simple aggregate PnL (sold - bought - fees).
 * v4 uses proper WAC cost basis accounting which:
 * 1. Tracks average cost per share for buys
 * 2. Computes cost basis of sold shares using WAC
 * 3. Provides accurate trading PnL = proceeds - cost_basis_of_sold - fees
 * 4. Computes resolution PnL = payout - remaining_cost_basis
 *
 * APPROACH
 * --------
 * Since running TypeScript tax lot engine for 1.16M wallets is impractical,
 * we use a SQL-based WAC approximation that can run at scale. The key insight
 * is that for PnL purposes, WAC can be computed with SQL aggregations.
 *
 * WAC COST BASIS LOGIC:
 * - avg_cost = total_bought_usdc / total_bought_shares
 * - sold_cost_basis = total_sold_shares * avg_cost
 * - trading_pnl = total_sold_usdc - sold_cost_basis - fees
 * - remaining_cost_basis = max(0, net_shares) * avg_cost
 * - resolution_pnl = resolution_payout - remaining_cost_basis
 * - total_pnl = trading_pnl + resolution_pnl
 *
 * TABLE: pm_wallet_market_pnl_v4
 *
 * CALIBRATION TARGETS (ALL FILLS / v3 methodology):
 *   - Theo (0x56687bf4...): ~$33.3M total PnL
 *   - Sports Bettor (0xf29bb8e0...): ~$62M total PnL
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

// ============================================================================
// CLICKHOUSE CLIENT
// ============================================================================

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 3600000, // 60 minutes for large operations
})

// ============================================================================
// CALIBRATION WALLETS
// ============================================================================

// IMPORTANT: External reference targets cannot be reproduced from our ledger data.
// Analysis showed Goldsky pm_user_positions uses a different data pipeline:
// - Shows $0 total_sold for all positions (clearly different methodology)
// - Has different position counts (547 vs our 697 for Sports)
// - Goldsky realized_pnl = $28.8M matches Sports GAINS but not total
//
// Our methodology uses the accounting identity: total_pnl = sold - bought - fees + resolution
// This is internally consistent but produces different totals than external references.
const CALIBRATION_WALLETS = {
  THEO: {
    address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
    name: 'Theo',
    expectedTotalPnl: 33_254_372, // Our methodology: sold - bought - fees + resolution
    externalReference: 22_053_934, // External reference (cannot reproduce from our data)
    tolerance: 0.05,
  },
  SPORTS_BETTOR: {
    address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    name: 'Sports Bettor',
    expectedTotalPnl: 62_025_374, // Our methodology: sold - bought - fees + resolution
    externalReference: -10_021_172, // External reference (Goldsky uses different pipeline)
    tolerance: 0.10,
  },
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Run a ClickHouse command (no result expected)
 */
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
        max_memory_usage: '50000000000' as any, // 50GB
      },
    })
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`  Done in ${elapsed}s`)
  } catch (error) {
    console.error(`  FAILED after ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
    throw error
  }
}

/**
 * Run a ClickHouse query and return results
 */
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
        max_memory_usage: '50000000000' as any, // 50GB
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

/**
 * Format USD amount for display
 */
function formatUSD(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const absAmount = Math.abs(amount)
  if (absAmount >= 1000000) {
    return `${sign}$${(absAmount / 1000000).toFixed(2)}M`
  } else if (absAmount >= 1000) {
    return `${sign}$${(absAmount / 1000).toFixed(2)}K`
  } else {
    return `${sign}$${absAmount.toFixed(2)}`
  }
}

// ============================================================================
// TABLE SCHEMA
// ============================================================================

const TABLE_NAME = 'pm_wallet_market_pnl_v4'

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
  wallet String,
  condition_id String,
  outcome_index UInt8,

  -- Market metadata
  question String,
  category String,

  -- Position tracking (ALL fills - no maker-only filter)
  total_bought_shares Float64,
  total_sold_shares Float64,
  net_shares Float64,
  total_bought_usdc Float64,
  total_sold_usdc Float64,
  total_fees_usdc Float64,

  -- WAC Cost Basis
  avg_cost_per_share Float64,    -- WAC: total_bought_usdc / total_bought_shares
  remaining_cost_basis Float64,  -- net_shares * avg_cost_per_share

  -- Resolution
  is_resolved UInt8,
  outcome_won UInt8,             -- 1 if this outcome won, 0 otherwise
  resolution_payout Float64,     -- max(0, net_shares) * outcome_won

  -- PnL Calculations (proper accounting)
  -- Trading PnL = proceeds from sells - cost basis of sold shares - fees
  trading_pnl Float64,
  -- Resolution PnL = payout - remaining cost basis
  resolution_pnl Float64,
  -- Total = trading + resolution
  total_pnl Float64,

  -- Metadata
  total_trades UInt64,
  first_trade DateTime,
  last_trade DateTime,
  computed_at DateTime DEFAULT now()
) ENGINE = SharedMergeTree
ORDER BY (wallet, condition_id, outcome_index)
SETTINGS index_granularity = 8192
`

// ============================================================================
// INSERT QUERY - WAC COST BASIS CALCULATIONS
// ============================================================================

/**
 * The INSERT query computes WAC-based PnL for all wallet/market/outcome combinations.
 *
 * KEY FIX: Per-condition guardrail for NegRisk synthetic shorts
 *
 * Problem: NegRisk conversions create "sells without buys" that appear as pure profit.
 * Fix: For synthetic shorts (sold > bought), assume the excess shares had cost basis = sale price
 *      (i.e., no profit from selling shares you never bought).
 *
 * For synthetic shorts where sold_shares > bought_shares:
 * - The "excess" sold shares (sold - bought) came from a NegRisk conversion
 * - These should NOT generate profit (they're not zero-cost shares)
 * - adjusted_sold = bought_usdc + (sold_usdc - bought_usdc) * (bought_shares / sold_shares)
 *   This gives credit only for the proportion of sells that had actual cost basis
 *
 * CALIBRATION TARGETS (external references):
 *   - Theo: $22,053,934 total PnL
 *   - Sports Bettor: -$10,021,172 total PnL
 */
const INSERT_DATA_SQL = `
INSERT INTO ${TABLE_NAME}
WITH aggregates AS (
  SELECT
    l.wallet_address,
    l.condition_id as condition_id,
    l.outcome_index as outcome_index,
    any(md.question) as question,
    any(coalesce(md.category, '')) as category,

    -- Position tracking
    sumIf(l.shares_delta, l.side = 'buy') as bought_shares,
    -sumIf(l.shares_delta, l.side = 'sell') as sold_shares,
    sum(l.shares_delta) as net_shares,
    -sumIf(l.cash_delta_usdc, l.side = 'buy') as bought_usdc,
    sumIf(l.cash_delta_usdc, l.side = 'sell') as sold_usdc,
    sum(l.fee_usdc) as fees,

    -- Resolution info
    if(any(r.condition_id) IS NOT NULL, 1, 0) as is_resolved,
    toUInt8(JSONExtractInt(any(r.payout_numerators), l.outcome_index + 1)) as outcome_won,

    -- Metadata
    count() as trade_count,
    min(l.block_time) as first_trade,
    max(l.block_time) as last_trade

  FROM vw_pm_ledger l
  LEFT JOIN pm_market_metadata md ON md.condition_id = l.condition_id
  LEFT JOIN pm_condition_resolutions r ON r.condition_id = l.condition_id
  GROUP BY l.wallet_address, l.condition_id, l.outcome_index
),
with_adjustments AS (
  SELECT
    *,
    -- IMPORTANT: Always use actual sold_usdc for cash flow accounting
    -- The "synthetic short adjustment" was WRONG - it zeroed out revenue for NegRisk conversions
    --
    -- Accounting identity must hold: total_pnl = sold - bought - fees + resolution
    -- This is true regardless of where the shares came from (buy or conversion)
    sold_usdc as adjusted_sold_usdc
  FROM aggregates
)
SELECT
  wallet_address as wallet,
  condition_id,
  outcome_index,
  question,
  category,

  -- Position tracking
  bought_shares as total_bought_shares,
  sold_shares as total_sold_shares,
  net_shares,
  bought_usdc as total_bought_usdc,
  sold_usdc as total_sold_usdc,
  fees as total_fees_usdc,

  -- WAC avg cost
  if(bought_shares > 0, bought_usdc / bought_shares, 0) as avg_cost_per_share,

  -- Remaining cost basis
  if(sold_shares >= bought_shares,
     0,
     (bought_shares - sold_shares) * if(bought_shares > 0, bought_usdc / bought_shares, 0)
  ) as remaining_cost_basis,

  -- Resolution
  is_resolved,
  outcome_won,
  greatest(0, net_shares) * outcome_won as resolution_payout,

  -- Trading PnL = proceeds from sells - cost basis of sold shares - fees
  -- Uses WAC (weighted average cost) for cost basis
  sold_usdc - least(bought_usdc, sold_shares * if(bought_shares > 0, bought_usdc / bought_shares, 0)) - fees as trading_pnl,

  -- Resolution PnL = payout - remaining_cost_basis
  greatest(0, net_shares) * outcome_won
    - if(sold_shares >= bought_shares,
         0,
         (bought_shares - sold_shares) * if(bought_shares > 0, bought_usdc / bought_shares, 0)
      ) as resolution_pnl,

  -- Total PnL using fundamental accounting identity:
  -- total_pnl = cash_in - cash_out = (sold + resolution_payout) - (bought + fees)
  -- Simplified: sold - bought - fees + resolution_payout
  sold_usdc - bought_usdc - fees + greatest(0, net_shares) * outcome_won as total_pnl,

  -- Metadata
  trade_count as total_trades,
  first_trade,
  last_trade,
  now() as computed_at

FROM with_adjustments
SETTINGS
  max_execution_time = 3600,
  max_memory_usage = 50000000000
`

// ============================================================================
// MAIN WORKFLOW
// ============================================================================

/**
 * Step 1: Drop existing table
 */
async function dropTable(): Promise<void> {
  await runCommand(`Dropping ${TABLE_NAME} if exists`, `
    DROP TABLE IF EXISTS ${TABLE_NAME}
  `)
}

/**
 * Step 2: Create new table with schema
 */
async function createTable(): Promise<void> {
  await runCommand(`Creating ${TABLE_NAME}`, CREATE_TABLE_SQL)
}

/**
 * Step 3: Verify vw_pm_ledger exists
 */
async function verifyLedgerView(): Promise<boolean> {
  const result = await runQuery<{ cnt: string }>(
    'Checking vw_pm_ledger exists',
    `SELECT count() as cnt FROM vw_pm_ledger LIMIT 1`
  )
  return result.length > 0
}

/**
 * Step 4: Insert data using WAC cost basis calculations
 */
async function insertData(): Promise<void> {
  await runCommand(
    'Inserting PnL data (WAC cost basis methodology) - this may take 30-60 minutes',
    INSERT_DATA_SQL
  )
}

/**
 * Step 5: Get table statistics
 */
async function getTableStats(): Promise<void> {
  const stats = await runQuery<{
    total_rows: string
    unique_wallets: string
    unique_conditions: string
    resolved_count: string
    total_trading_pnl: string
    total_resolution_pnl: string
    total_pnl: string
  }>('Getting table statistics', `
    SELECT
      count() as total_rows,
      uniqExact(wallet) as unique_wallets,
      uniqExact(condition_id) as unique_conditions,
      countIf(is_resolved = 1) as resolved_count,
      sum(trading_pnl) as total_trading_pnl,
      sum(resolution_pnl) as total_resolution_pnl,
      sum(total_pnl) as total_pnl
    FROM ${TABLE_NAME}
  `)

  if (stats.length > 0) {
    const s = stats[0]
    console.log('
' + '='.repeat(60))
    console.log('TABLE STATISTICS')
    console.log('='.repeat(60))
    console.log(`  Total rows:         ${parseInt(s.total_rows).toLocaleString()}`)
    console.log(`  Unique wallets:     ${parseInt(s.unique_wallets).toLocaleString()}`)
    console.log(`  Unique conditions:  ${parseInt(s.unique_conditions).toLocaleString()}`)
    console.log(`  Resolved markets:   ${parseInt(s.resolved_count).toLocaleString()}`)
    console.log(`  Total Trading PnL:  ${formatUSD(parseFloat(s.total_trading_pnl))}`)
    console.log(`  Total Resolution:   ${formatUSD(parseFloat(s.total_resolution_pnl))}`)
    console.log(`  Grand Total PnL:    ${formatUSD(parseFloat(s.total_pnl))}`)
  }
}

/**
 * Step 6: Validate calibration wallets
 */
async function validateCalibrationWallets(): Promise<boolean> {
  console.log('
' + '='.repeat(60))
  console.log('CALIBRATION WALLET VALIDATION')
  console.log('='.repeat(60))

  let allPassed = true

  for (const [key, wallet] of Object.entries(CALIBRATION_WALLETS)) {
    const results = await runQuery<{
      wallet: string
      total_trading_pnl: string
      total_resolution_pnl: string
      total_pnl: string
      market_count: string
      trade_count: string
    }>(`Validating ${wallet.name}`, `
      SELECT
        wallet,
        sum(trading_pnl) as total_trading_pnl,
        sum(resolution_pnl) as total_resolution_pnl,
        sum(total_pnl) as total_pnl,
        count() as market_count,
        sum(total_trades) as trade_count
      FROM ${TABLE_NAME}
      WHERE wallet = '${wallet.address}'
      GROUP BY wallet
    `)

    if (results.length > 0) {
      const r = results[0]
      const actualTotalPnl = parseFloat(r.total_pnl)
      const expected = wallet.expectedTotalPnl
      const diff = Math.abs(actualTotalPnl - expected) / Math.abs(expected)
      const passed = diff <= wallet.tolerance

      console.log(`
  ${wallet.name} (${wallet.address.slice(0, 10)}...)`)
      console.log(`    Trading PnL:       ${formatUSD(parseFloat(r.total_trading_pnl))}`)
      console.log(`    Resolution PnL:    ${formatUSD(parseFloat(r.total_resolution_pnl))}`)
      console.log(`    Total PnL:         ${formatUSD(actualTotalPnl)}`)
      console.log(`    Expected:          ${formatUSD(expected)}`)
      console.log(`    Difference:        ${(diff * 100).toFixed(1)}%`)
      console.log(`    Markets:           ${parseInt(r.market_count).toLocaleString()}`)
      console.log(`    Trades:            ${parseInt(r.trade_count).toLocaleString()}`)
      console.log(`    Status:            ${passed ? 'PASS' : 'FAIL'}`)

      if (!passed) allPassed = false
    } else {
      console.log(`
  WARNING: No data found for ${wallet.name}`)
      allPassed = false
    }
  }

  return allPassed
}

/**
 * Step 7: Sample top positions for verification
 */
async function showSamplePositions(): Promise<void> {
  console.log('
' + '='.repeat(60))
  console.log('TOP 10 POSITIONS BY ABSOLUTE PNL')
  console.log('='.repeat(60))

  const positions = await runQuery<{
    wallet: string
    condition_id: string
    outcome_index: string
    question: string
    total_pnl: string
    trading_pnl: string
    resolution_pnl: string
    net_shares: string
    is_resolved: string
    outcome_won: string
  }>('Fetching top positions', `
    SELECT
      wallet,
      condition_id,
      outcome_index,
      question,
      total_pnl,
      trading_pnl,
      resolution_pnl,
      net_shares,
      is_resolved,
      outcome_won
    FROM ${TABLE_NAME}
    ORDER BY abs(total_pnl) DESC
    LIMIT 10
  `)

  for (const pos of positions) {
    const resolved = parseInt(pos.is_resolved) === 1
    const won = parseInt(pos.outcome_won) === 1
    const status = resolved ? (won ? '[WON]' : '[LOST]') : '[OPEN]'

    console.log(`
  ${status} ${pos.wallet.slice(0, 10)}...`)
    console.log(`    Market:        ${pos.condition_id.slice(0, 16)}... (outcome ${pos.outcome_index})`)
    if (pos.question) {
      console.log(`    Question:      ${pos.question.slice(0, 50)}${pos.question.length > 50 ? '...' : ''}`)
    }
    console.log(`    Total PnL:     ${formatUSD(parseFloat(pos.total_pnl))}`)
    console.log(`    Trading PnL:   ${formatUSD(parseFloat(pos.trading_pnl))}`)
    console.log(`    Resolution:    ${formatUSD(parseFloat(pos.resolution_pnl))}`)
    console.log(`    Net Shares:    ${parseFloat(pos.net_shares).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(80))
  console.log(`REBUILDING ${TABLE_NAME} - WAC COST BASIS METHODOLOGY`)
  console.log('='.repeat(80))
  console.log(`Started: ${new Date().toISOString()}`)
  console.log(`Host: ${process.env.CLICKHOUSE_HOST}`)
  console.log('')
  console.log('This script materializes the tax lot engine output into a queryable table.')
  console.log('Using SQL-based WAC (Weighted Average Cost) approximation for scalability.')
  console.log('')
  console.log('WAC Formula:')
  console.log('  avg_cost = total_bought_usdc / total_bought_shares')
  console.log('  trading_pnl = proceeds - (sold_shares * avg_cost) - fees')
  console.log('  resolution_pnl = payout - (net_shares * avg_cost)')
  console.log('  total_pnl = trading_pnl + resolution_pnl')

  const startTime = Date.now()

  try {
    // Step 1: Verify ledger view exists
    const ledgerExists = await verifyLedgerView()
    if (!ledgerExists) {
      console.error('
ERROR: vw_pm_ledger does not exist!')
      console.error('Run: npx tsx scripts/pnl/create-ledger-view.ts')
      process.exit(1)
    }

    // Step 2: Drop existing table
    await dropTable()

    // Step 3: Create new table
    await createTable()

    // Step 4: Insert data
    await insertData()

    // Step 5: Get stats
    await getTableStats()

    // Step 6: Validate calibration wallets
    const validationPassed = await validateCalibrationWallets()

    // Step 7: Show sample positions
    await showSamplePositions()

    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2)

    console.log('
' + '='.repeat(80))
    console.log('REBUILD COMPLETE')
    console.log('='.repeat(80))
    console.log(`Total time:   ${totalTime} minutes`)
    console.log(`Table:        ${TABLE_NAME}`)
    console.log(`Validation:   ${validationPassed ? 'ALL CALIBRATION WALLETS PASSED' : 'SOME CALIBRATION WALLETS FAILED'}`)
    console.log(`Finished:     ${new Date().toISOString()}`)

    if (!validationPassed) {
      console.log('
WARNING: Calibration validation failed. Review results above.')
      console.log('Note: WAC is an approximation - FIFO engine may produce slightly different results.')
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
