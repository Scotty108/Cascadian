// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * calibrate-v4-condition-level.ts
 *
 * Condition-level PnL calibration script per Gemini's guidance.
 *
 * KEY INSIGHT:
 * -----------
 * All NegRisk synthetic short complexity cancels at the condition level.
 * The canonical PnL formula at condition level is simply:
 *
 *   total_pnl = net_cash_flow + resolution_payout
 *
 * Where:
 * - net_cash_flow = sum of all trading cash (buys = negative, sells = positive)
 * - resolution_payout = sum(max(0, net_shares) * payout_ratio) per outcome
 *
 * EXTERNAL REFERENCE TARGETS:
 * - Theo: $22,053,934 total PnL (tolerance <= 1%)
 * - Sports Bettor: -$10,021,172 total PnL (tolerance <= 2%)
 *   - Total Gains: +$28,812,489
 *   - Total Losses: -$38,833,660
 *
 * This script:
 * 1. Creates/verifies the three condition-level views
 * 2. Validates internal identity (sum of parts = total)
 * 3. Compares to external targets
 * 4. Dumps top conditions for debugging if targets not met
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

// ============================================================================
// CALIBRATION TARGETS (External Reference - DO NOT CHANGE)
// ============================================================================

const CALIBRATION_TARGETS = {
  THEO: {
    address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
    name: 'Theo',
    total_pnl: 22_053_934,
    tolerance: 0.01, // 1%
  },
  SPORTS_BETTOR: {
    address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    name: 'Sports Bettor',
    total_pnl: -10_021_172,
    total_gains: 28_812_489,
    total_losses: -38_833_660,
    tolerance: 0.02, // 2%
  },
}

function formatUSD(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`
  return `${sign}$${abs.toFixed(2)}`
}

// ============================================================================
// VIEW DEFINITIONS
// ============================================================================

const CREATE_LEDGER_BY_CONDITION_VIEW = `
CREATE OR REPLACE VIEW vw_pm_ledger_by_condition AS
SELECT
    wallet_address,
    condition_id,
    /* Net trading cash flow for this condition.
       Buys: cash_delta_usdc < 0
       Sells: cash_delta_usdc > 0 */
    sum(cash_delta_usdc) AS net_cash_flow_usdc,
    sum(fee_usdc) AS total_fees_usdc,

    -- For diagnostics only
    sumIf(abs(cash_delta_usdc), side = 'buy') AS total_bought_usdc,
    sumIf(abs(cash_delta_usdc), side = 'sell') AS total_sold_usdc
FROM vw_pm_ledger
WHERE condition_id IS NOT NULL AND condition_id != ''
GROUP BY wallet_address, condition_id
`

const CREATE_RESOLUTION_PAYOUTS_VIEW = `
CREATE OR REPLACE VIEW vw_pm_resolution_payouts AS
WITH NetShares AS (
    SELECT
        wallet_address,
        condition_id,
        outcome_index,
        sum(shares_delta) AS net_shares
    FROM vw_pm_ledger
    WHERE condition_id IS NOT NULL AND condition_id != ''
    GROUP BY wallet_address, condition_id, outcome_index
),
ResolutionDetails AS (
    SELECT
        condition_id,
        payout_numerators
    FROM pm_condition_resolutions
    WHERE is_deleted = 0
)
SELECT
    N.wallet_address,
    N.condition_id,
    /* Resolution payout: For each outcome with positive net shares,
       if that outcome won (payout_numerators > 0 for that index), pay $1 per share.

       payout_numerators is JSON like '[1,0]' (outcome 0 won) or '[0,1]' (outcome 1 won).
       JSONExtractInt returns the numerator (0 or 1 typically).

       Key insight: In binary markets, winning shares pay $1 each.
       The formula is: net_shares * (outcome_won ? 1 : 0)
       where outcome_won = payout_numerators[outcome_index + 1] > 0 */
    sum(
        greatest(0.0, N.net_shares) *
        if(JSONExtractInt(R.payout_numerators, N.outcome_index + 1) > 0, 1.0, 0.0)
    ) AS resolution_payout_usdc
FROM NetShares N
LEFT JOIN ResolutionDetails R ON N.condition_id = R.condition_id
GROUP BY N.wallet_address, N.condition_id
`

const CREATE_CONDITION_PNL_VIEW = `
CREATE OR REPLACE VIEW vw_pm_wallet_condition_pnl_v4 AS
SELECT
    L.wallet_address,
    L.condition_id,
    L.net_cash_flow_usdc,
    L.total_fees_usdc,
    L.total_bought_usdc,
    L.total_sold_usdc,
    coalesce(R.resolution_payout_usdc, 0) AS resolution_payout_usdc,

    /* Canonical condition PnL.
       Trading PnL = net_cash_flow_usdc (already includes fees as they affect cash)
       Total PnL   = trading PnL + resolution payout */
    L.net_cash_flow_usdc + coalesce(R.resolution_payout_usdc, 0) AS total_pnl_usdc
FROM vw_pm_ledger_by_condition L
LEFT JOIN vw_pm_resolution_payouts R
  ON L.wallet_address = R.wallet_address
 AND L.condition_id = R.condition_id
`

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

async function runQuery<T>(description: string, query: string): Promise<T[]> {
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

// ============================================================================
// STEP 1: CREATE VIEWS
// ============================================================================

async function createViews(): Promise<void> {
  console.log('
' + '='.repeat(80))
  console.log('STEP 1: CREATING CONDITION-LEVEL VIEWS')
  console.log('='.repeat(80))

  await runCommand('Creating vw_pm_ledger_by_condition', CREATE_LEDGER_BY_CONDITION_VIEW)
  await runCommand('Creating vw_pm_resolution_payouts', CREATE_RESOLUTION_PAYOUTS_VIEW)
  await runCommand('Creating vw_pm_wallet_condition_pnl_v4', CREATE_CONDITION_PNL_VIEW)
}

// ============================================================================
// STEP 2: VERIFY INTERNAL IDENTITY
// ============================================================================

interface IdentityCheck {
  wallet_address: string
  sum_net_cash: string
  sum_resolution: string
  computed_total: string
  view_total: string
}

async function verifyInternalIdentity(wallet: string): Promise<boolean> {
  const result = await runQuery<IdentityCheck>(
    `Verifying internal identity for ${wallet.slice(0, 10)}...`,
    `
    WITH base AS (
      SELECT
        sum(net_cash_flow_usdc) as sum_net_cash,
        sum(resolution_payout_usdc) as sum_resolution,
        sum(net_cash_flow_usdc) + sum(resolution_payout_usdc) as computed_total,
        sum(total_pnl_usdc) as view_total
      FROM vw_pm_wallet_condition_pnl_v4
      WHERE wallet_address = '${wallet}'
    )
    SELECT
      '${wallet}' as wallet_address,
      sum_net_cash,
      sum_resolution,
      computed_total,
      view_total
    FROM base
    `
  )

  if (result.length === 0) {
    console.error(`  ERROR: No data found for wallet`)
    return false
  }

  const r = result[0]
  const computed = Number(r.computed_total)
  const viewTotal = Number(r.view_total)
  const diff = Math.abs(computed - viewTotal)

  console.log(`  Sum net_cash:       ${formatUSD(Number(r.sum_net_cash))}`)
  console.log(`  Sum resolution:     ${formatUSD(Number(r.sum_resolution))}`)
  console.log(`  Computed total:     ${formatUSD(computed)}`)
  console.log(`  View total:         ${formatUSD(viewTotal)}`)
  console.log(`  Identity diff:      ${formatUSD(diff)}`)

  if (diff > 1) {
    console.error(`  IDENTITY CHECK FAILED: computed != view_total`)
    return false
  }

  console.log(`  IDENTITY CHECK:     PASS`)
  return true
}

// ============================================================================
// STEP 3: CALIBRATE AGAINST TARGETS
// ============================================================================

interface WalletPnL {
  total_pnl: string
  total_gains: string
  total_losses: string
  condition_count: string
}

async function calibrateWallet(
  wallet: string,
  name: string,
  targetPnl: number,
  targetGains?: number,
  targetLosses?: number,
  tolerance: number = 0.01
): Promise<boolean> {
  const result = await runQuery<WalletPnL>(
    `Calculating PnL for ${name}`,
    `
    SELECT
      sum(total_pnl_usdc) as total_pnl,
      sum(greatest(total_pnl_usdc, 0)) as total_gains,
      sum(least(total_pnl_usdc, 0)) as total_losses,
      count() as condition_count
    FROM vw_pm_wallet_condition_pnl_v4
    WHERE wallet_address = '${wallet}'
    `
  )

  if (result.length === 0) {
    console.error(`  ERROR: No data found`)
    return false
  }

  const r = result[0]
  const actualPnl = Number(r.total_pnl)
  const actualGains = Number(r.total_gains)
  const actualLosses = Number(r.total_losses)
  const pnlDiff = Math.abs(actualPnl - targetPnl) / Math.abs(targetPnl)
  const pnlPassed = pnlDiff <= tolerance

  console.log(`
  === ${name.toUpperCase()} CALIBRATION ===`)
  console.log(`  Conditions:         ${Number(r.condition_count).toLocaleString()}`)
  console.log(`  Total PnL:          ${formatUSD(actualPnl)}`)
  console.log(`  Target PnL:         ${formatUSD(targetPnl)}`)
  console.log(`  Difference:         ${(pnlDiff * 100).toFixed(2)}%`)
  console.log(`  PnL Status:         ${pnlPassed ? 'PASS' : 'FAIL'}`)

  if (targetGains !== undefined && targetLosses !== undefined) {
    const gainsDiff = Math.abs(actualGains - targetGains) / Math.abs(targetGains)
    const lossesDiff = Math.abs(actualLosses - targetLosses) / Math.abs(targetLosses)

    console.log(`
  Total Gains:        ${formatUSD(actualGains)}`)
    console.log(`  Target Gains:       ${formatUSD(targetGains)}`)
    console.log(`  Gains Diff:         ${(gainsDiff * 100).toFixed(2)}%`)
    console.log(`
  Total Losses:       ${formatUSD(actualLosses)}`)
    console.log(`  Target Losses:      ${formatUSD(targetLosses)}`)
    console.log(`  Losses Diff:        ${(lossesDiff * 100).toFixed(2)}%`)
  }

  return pnlPassed
}

// ============================================================================
// STEP 4: DEBUG - TOP CONDITIONS
// ============================================================================

interface TopCondition {
  condition_id: string
  net_cash_flow_usdc: string
  resolution_payout_usdc: string
  total_pnl_usdc: string
  total_bought_usdc: string
  total_sold_usdc: string
}

async function dumpTopConditions(wallet: string, name: string, limit: number = 20): Promise<void> {
  console.log(`
  --- TOP ${limit} CONDITIONS BY ABS(PNL) FOR ${name.toUpperCase()} ---`)

  const result = await runQuery<TopCondition>(
    `Fetching top conditions`,
    `
    SELECT
      condition_id,
      net_cash_flow_usdc,
      resolution_payout_usdc,
      total_pnl_usdc,
      total_bought_usdc,
      total_sold_usdc
    FROM vw_pm_wallet_condition_pnl_v4
    WHERE wallet_address = '${wallet}'
    ORDER BY abs(total_pnl_usdc) DESC
    LIMIT ${limit}
    `
  )

  for (const c of result) {
    console.log(`
  Condition: ${c.condition_id.slice(0, 16)}...`)
    console.log(`    Net Cash Flow:    ${formatUSD(Number(c.net_cash_flow_usdc))}`)
    console.log(`    Resolution:       ${formatUSD(Number(c.resolution_payout_usdc))}`)
    console.log(`    Total PnL:        ${formatUSD(Number(c.total_pnl_usdc))}`)
    console.log(`    (Bought: ${formatUSD(Number(c.total_bought_usdc))}, Sold: ${formatUSD(Number(c.total_sold_usdc))})`)
  }
}

// ============================================================================
// MAIN CALIBRATION
// ============================================================================

async function runCalibration(): Promise<boolean> {
  console.log('='.repeat(80))
  console.log('V4 CONDITION-LEVEL CALIBRATION')
  console.log('='.repeat(80))
  console.log()
  console.log('Canonical PnL formula at condition level:')
  console.log('  total_pnl = net_cash_flow + resolution_payout')
  console.log()
  console.log('Where:')
  console.log('  net_cash_flow = sum(cash_delta_usdc) [buys negative, sells positive]')
  console.log('  resolution_payout = sum(max(0, net_shares) * payout_ratio)')
  console.log()

  // Step 1: Create views
  await createViews()

  // Step 2: Verify internal identity for both wallets
  console.log('
' + '='.repeat(80))
  console.log('STEP 2: VERIFY INTERNAL IDENTITY')
  console.log('='.repeat(80))

  const theoIdentityOk = await verifyInternalIdentity(CALIBRATION_TARGETS.THEO.address)
  const sportsIdentityOk = await verifyInternalIdentity(CALIBRATION_TARGETS.SPORTS_BETTOR.address)

  if (!theoIdentityOk || !sportsIdentityOk) {
    console.error('
IDENTITY CHECK FAILED - BUG IN SQL!')
    await clickhouse.close()
    return false
  }

  // Step 3: Calibrate against external targets
  console.log('
' + '='.repeat(80))
  console.log('STEP 3: CALIBRATE AGAINST EXTERNAL TARGETS')
  console.log('='.repeat(80))

  const theoPassed = await calibrateWallet(
    CALIBRATION_TARGETS.THEO.address,
    CALIBRATION_TARGETS.THEO.name,
    CALIBRATION_TARGETS.THEO.total_pnl,
    undefined,
    undefined,
    CALIBRATION_TARGETS.THEO.tolerance
  )

  const sportsPassed = await calibrateWallet(
    CALIBRATION_TARGETS.SPORTS_BETTOR.address,
    CALIBRATION_TARGETS.SPORTS_BETTOR.name,
    CALIBRATION_TARGETS.SPORTS_BETTOR.total_pnl,
    CALIBRATION_TARGETS.SPORTS_BETTOR.total_gains,
    CALIBRATION_TARGETS.SPORTS_BETTOR.total_losses,
    CALIBRATION_TARGETS.SPORTS_BETTOR.tolerance
  )

  // Step 4: If calibration failed, dump top conditions for debugging
  if (!theoPassed || !sportsPassed) {
    console.log('
' + '='.repeat(80))
    console.log('STEP 4: DEBUG - TOP CONDITIONS')
    console.log('='.repeat(80))

    if (!theoPassed) {
      await dumpTopConditions(CALIBRATION_TARGETS.THEO.address, CALIBRATION_TARGETS.THEO.name)
    }
    if (!sportsPassed) {
      await dumpTopConditions(CALIBRATION_TARGETS.SPORTS_BETTOR.address, CALIBRATION_TARGETS.SPORTS_BETTOR.name)
    }
  }

  // Final verdict
  console.log('
' + '='.repeat(80))
  console.log('CALIBRATION RESULT')
  console.log('='.repeat(80))

  const allPassed = theoPassed && sportsPassed
  if (allPassed) {
    console.log('
CALIBRATION PASSED')
    console.log('Ready to materialize pm_wallet_condition_pnl_v4 globally!')
  } else {
    console.log('
CALIBRATION FAILED')
    console.log('Investigate the top conditions above to find the issue.')
    console.log('Possible causes:')
    console.log('  1. Resolution vector issue (wrong payout_numerators or condition mapping)')
    console.log('  2. Ledger issue (missing or double counted trades)')
    console.log('  3. NegRisk complexity NOT canceling at condition level (investigate)')
  }

  await clickhouse.close()
  return allPassed
}

runCalibration().catch(console.error)
