// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * calibrate-v4-wallets.ts
 *
 * Calibration script for v4 PnL methodology using condition-level guardrails.
 *
 * EXTERNAL REFERENCE TARGETS:
 * - Theo: $22,053,934 total PnL (tolerance ≤ 1%)
 * - Sports Bettor: -$10,021,172 total PnL (tolerance ≤ 2%)
 *   - Total Gains: +$28,812,489
 *   - Total Losses: -$38,833,660
 *
 * KEY INSIGHT: The correct PnL formula at the condition level is simply:
 *   total_pnl_condition = sold - bought - fees + resolution_payout
 *
 * This is the fundamental accounting identity. Individual outcome PnLs
 * must sum to this condition total, no more.
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
// COMPUTE PnL USING CONDITION-LEVEL GUARDRAILS
// ============================================================================

interface ConditionPnL {
  condition_id: string
  sold_usdc: number
  bought_usdc: number
  fees_usdc: number
  resolution_payout: number
  total_pnl: number // This is THE source of truth: sold - bought - fees + payout
}

interface WalletPnL {
  wallet: string
  conditions: ConditionPnL[]
  total_sold: number
  total_bought: number
  total_fees: number
  total_resolution: number
  total_pnl: number
  // For Sports Bettor validation
  total_gains: number
  total_losses: number
}

async function computeWalletPnL(wallet: string): Promise<WalletPnL> {
  // Query: aggregate by condition_id, compute total_pnl using the fundamental identity
  const result = await clickhouse.query({
    query: `
      SELECT
        l.condition_id,
        sumIf(l.cash_delta_usdc, l.side = 'sell') as sold_usdc,
        -sumIf(l.cash_delta_usdc, l.side = 'buy') as bought_usdc,
        sum(l.fee_usdc) as fees_usdc,
        -- Resolution payout: sum of (max(0, net_shares) * outcome_won) for each outcome
        -- We need to join with resolutions for this
        0 as resolution_payout_placeholder
      FROM vw_pm_ledger l
      WHERE l.wallet_address = '${wallet}'
      GROUP BY l.condition_id
    `,
    format: 'JSONEachRow',
  })
  const conditionData = await result.json() as any[]

  // Now get resolution data per condition/outcome
  const resolutionResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        sum(greatest(0, net_shares) * outcome_won) as resolution_payout
      FROM pm_wallet_market_pnl_v4
      WHERE wallet = '${wallet}'
      GROUP BY condition_id
    `,
    format: 'JSONEachRow',
  })
  const resolutionData = await resolutionResult.json() as any[]
  const resolutionMap = new Map(resolutionData.map((r: any) => [r.condition_id, Number(r.resolution_payout)]))

  // Build condition-level PnL
  const conditions: ConditionPnL[] = conditionData.map((c: any) => {
    const sold = Number(c.sold_usdc)
    const bought = Number(c.bought_usdc)
    const fees = Number(c.fees_usdc)
    const resolution = resolutionMap.get(c.condition_id) || 0
    const pnl = sold - bought - fees + resolution

    return {
      condition_id: c.condition_id,
      sold_usdc: sold,
      bought_usdc: bought,
      fees_usdc: fees,
      resolution_payout: resolution,
      total_pnl: pnl,
    }
  })

  // Aggregate wallet totals
  const totalSold = conditions.reduce((sum, c) => sum + c.sold_usdc, 0)
  const totalBought = conditions.reduce((sum, c) => sum + c.bought_usdc, 0)
  const totalFees = conditions.reduce((sum, c) => sum + c.fees_usdc, 0)
  const totalResolution = conditions.reduce((sum, c) => sum + c.resolution_payout, 0)
  const totalPnL = conditions.reduce((sum, c) => sum + c.total_pnl, 0)

  // Compute gains/losses (sum of positive vs negative condition PnLs)
  const totalGains = conditions.filter(c => c.total_pnl > 0).reduce((sum, c) => sum + c.total_pnl, 0)
  const totalLosses = conditions.filter(c => c.total_pnl < 0).reduce((sum, c) => sum + c.total_pnl, 0)

  // Verify wallet-level identity: total_pnl = sold - bought - fees + resolution
  const identityCheck = totalSold - totalBought - totalFees + totalResolution
  if (Math.abs(identityCheck - totalPnL) > 1) {
    console.warn(`  WARNING: Wallet identity check failed! Identity=${formatUSD(identityCheck)}, Sum=${formatUSD(totalPnL)}`)
  }

  return {
    wallet,
    conditions,
    total_sold: totalSold,
    total_bought: totalBought,
    total_fees: totalFees,
    total_resolution: totalResolution,
    total_pnl: totalPnL,
    total_gains: totalGains,
    total_losses: totalLosses,
  }
}

// ============================================================================
// MAIN CALIBRATION
// ============================================================================

async function runCalibration(): Promise<boolean> {
  console.log('='.repeat(80))
  console.log('V4 CALIBRATION - CONDITION-LEVEL GUARDRAILS')
  console.log('='.repeat(80))
  console.log()
  console.log('This script computes PnL using the fundamental accounting identity:')
  console.log('  total_pnl_condition = sold - bought - fees + resolution_payout')
  console.log('  total_pnl_wallet = sum(total_pnl_condition)')
  console.log()

  let allPassed = true

  // Calibrate Theo
  console.log('--- THEO CALIBRATION ---')
  const theo = await computeWalletPnL(CALIBRATION_TARGETS.THEO.address)
  const theoDiff = Math.abs(theo.total_pnl - CALIBRATION_TARGETS.THEO.total_pnl) / Math.abs(CALIBRATION_TARGETS.THEO.total_pnl)
  const theoPassed = theoDiff <= CALIBRATION_TARGETS.THEO.tolerance

  console.log(`  Total Sold:       ${formatUSD(theo.total_sold)}`)
  console.log(`  Total Bought:     ${formatUSD(theo.total_bought)}`)
  console.log(`  Total Fees:       ${formatUSD(theo.total_fees)}`)
  console.log(`  Total Resolution: ${formatUSD(theo.total_resolution)}`)
  console.log(`  ---`)
  console.log(`  ACTUAL Total PnL: ${formatUSD(theo.total_pnl)}`)
  console.log(`  EXPECTED:         ${formatUSD(CALIBRATION_TARGETS.THEO.total_pnl)}`)
  console.log(`  DIFFERENCE:       ${(theoDiff * 100).toFixed(2)}%`)
  console.log(`  STATUS:           ${theoPassed ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log()

  if (!theoPassed) allPassed = false

  // Calibrate Sports Bettor
  console.log('--- SPORTS BETTOR CALIBRATION ---')
  const sports = await computeWalletPnL(CALIBRATION_TARGETS.SPORTS_BETTOR.address)
  const sportsDiff = Math.abs(sports.total_pnl - CALIBRATION_TARGETS.SPORTS_BETTOR.total_pnl) / Math.abs(CALIBRATION_TARGETS.SPORTS_BETTOR.total_pnl)
  const sportsPassed = sportsDiff <= CALIBRATION_TARGETS.SPORTS_BETTOR.tolerance

  console.log(`  Total Sold:       ${formatUSD(sports.total_sold)}`)
  console.log(`  Total Bought:     ${formatUSD(sports.total_bought)}`)
  console.log(`  Total Fees:       ${formatUSD(sports.total_fees)}`)
  console.log(`  Total Resolution: ${formatUSD(sports.total_resolution)}`)
  console.log(`  ---`)
  console.log(`  ACTUAL Total PnL: ${formatUSD(sports.total_pnl)}`)
  console.log(`  EXPECTED:         ${formatUSD(CALIBRATION_TARGETS.SPORTS_BETTOR.total_pnl)}`)
  console.log(`  DIFFERENCE:       ${(sportsDiff * 100).toFixed(2)}%`)
  console.log(`  STATUS:           ${sportsPassed ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log()
  console.log(`  Total Gains:      ${formatUSD(sports.total_gains)} (expected: ${formatUSD(CALIBRATION_TARGETS.SPORTS_BETTOR.total_gains)})`)
  console.log(`  Total Losses:     ${formatUSD(sports.total_losses)} (expected: ${formatUSD(CALIBRATION_TARGETS.SPORTS_BETTOR.total_losses)})`)
  console.log()

  if (!sportsPassed) allPassed = false

  // Final verdict
  console.log('='.repeat(80))
  if (allPassed) {
    console.log('CALIBRATION PASSED — v4 READY FOR GLOBAL REBUILD')
  } else {
    console.log('CALIBRATION FAILED — DO NOT REBUILD v4 YET')
    console.log()
    console.log('Analysis:')

    // For Theo, the issue is likely resolution payout mismatch
    const theoIdentity = theo.total_sold - theo.total_bought - theo.total_fees + theo.total_resolution
    console.log(`  Theo: Identity check = ${formatUSD(theoIdentity)}`)
    console.log(`         Raw formula (sold - bought - fees + resolution) gives the identity check above`)
    console.log(`         Target is ${formatUSD(CALIBRATION_TARGETS.THEO.total_pnl)}`)
    console.log(`         Gap is ${formatUSD(theoIdentity - CALIBRATION_TARGETS.THEO.total_pnl)}`)

    // For Sports Bettor, the gap is ~$17M
    const sportsIdentity = sports.total_sold - sports.total_bought - sports.total_fees + sports.total_resolution
    console.log(`  Sports: Identity check = ${formatUSD(sportsIdentity)}`)
    console.log(`          Target is ${formatUSD(CALIBRATION_TARGETS.SPORTS_BETTOR.total_pnl)}`)
    console.log(`          Gap is ${formatUSD(sportsIdentity - CALIBRATION_TARGETS.SPORTS_BETTOR.total_pnl)}`)

    // The fundamental issue: our resolution_payout calculation differs from external reference
    console.log()
    console.log('ROOT CAUSE HYPOTHESIS:')
    console.log('  The resolution_payout calculation differs from the external reference.')
    console.log('  External references may use different resolution data or methodology.')
  }
  console.log('='.repeat(80))

  await clickhouse.close()
  return allPassed
}

runCalibration().catch(console.error)
