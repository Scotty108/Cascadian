// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * debug-theo-v4-vs-reference.ts
 *
 * Debug script to find the gap between v4 PnL ($33M) and Goldsky reference ($22M) for Theo.
 *
 * External Reference Targets:
 * - Theo: $22,053,934.00 (from Goldsky pm_user_positions)
 *
 * This script:
 * 1. Pulls Theo's data from vw_pm_ledger, pm_wallet_market_pnl_v4, and pm_user_positions
 * 2. Shows per-condition breakdown to identify where the gap comes from
 * 3. Identifies NegRisk patterns (sells without prior buys = synthetic shorts)
 * 4. Enforces and verifies the global PnL identity
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

// Calibration targets
const THEO = {
  address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
  name: 'Theo',
  target_total_pnl: 22_053_934.00,
}

const SPORTS = {
  address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
  name: 'Sports Bettor',
  target_total_pnl: -10_021_172.00,
  target_total_gains: 28_812_489.00,
  target_total_losses: -38_833_660.00,
}

function formatUSD(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const absAmount = Math.abs(amount)
  if (absAmount >= 1_000_000) {
    return `${sign}$${(absAmount / 1_000_000).toFixed(2)}M`
  } else if (absAmount >= 1_000) {
    return `${sign}$${(absAmount / 1_000).toFixed(2)}K`
  }
  return `${sign}$${absAmount.toFixed(2)}`
}

async function main() {
  console.log('='.repeat(80))
  console.log('DEBUG: THEO V4 vs EXTERNAL REFERENCE')
  console.log('='.repeat(80))
  console.log(`Target: ${formatUSD(THEO.target_total_pnl)}`)
  console.log()

  // Step 1: Get v4 aggregate for Theo
  console.log('--- STEP 1: V4 AGGREGATE ---')
  const v4Agg = await clickhouse.query({
    query: `
      SELECT
        sum(total_bought_usdc) as bought,
        sum(total_sold_usdc) as sold,
        sum(total_fees_usdc) as fees,
        sum(resolution_payout) as resolution_payout,
        sum(trading_pnl) as trading_pnl,
        sum(resolution_pnl) as resolution_pnl,
        sum(total_pnl) as total_pnl,
        count() as positions
      FROM pm_wallet_market_pnl_v4
      WHERE wallet = '${THEO.address}'
    `,
    format: 'JSONEachRow',
  })
  const v4Data = (await v4Agg.json())[0] as any

  console.log(`  Bought:           ${formatUSD(Number(v4Data.bought))}`)
  console.log(`  Sold:             ${formatUSD(Number(v4Data.sold))}`)
  console.log(`  Fees:             ${formatUSD(Number(v4Data.fees))}`)
  console.log(`  Resolution Payout: ${formatUSD(Number(v4Data.resolution_payout))}`)
  console.log(`  Trading PnL:      ${formatUSD(Number(v4Data.trading_pnl))}`)
  console.log(`  Resolution PnL:   ${formatUSD(Number(v4Data.resolution_pnl))}`)
  console.log(`  Total PnL (v4):   ${formatUSD(Number(v4Data.total_pnl))}`)
  console.log(`  Positions:        ${v4Data.positions}`)

  // Verify identity: total_pnl = sold - bought - fees + resolution_payout
  const identityCheck = Number(v4Data.sold) - Number(v4Data.bought) - Number(v4Data.fees) + Number(v4Data.resolution_payout)
  console.log(`
  Identity Check:   sold - bought - fees + payout = ${formatUSD(identityCheck)}`)
  console.log(`  Matches v4:       ${Math.abs(identityCheck - Number(v4Data.total_pnl)) < 1 ? 'YES' : 'NO'}`)

  // Step 2: Get Goldsky reference
  console.log('
--- STEP 2: GOLDSKY REFERENCE (pm_user_positions) ---')
  const goldsky = await clickhouse.query({
    query: `
      SELECT
        sum(realized_pnl) / 1e6 as realized_pnl,
        sum(total_bought) / 1e6 as total_bought,
        sum(total_sold) / 1e6 as total_sold,
        count() as positions
      FROM pm_user_positions
      WHERE proxy_wallet = '${THEO.address}'
    `,
    format: 'JSONEachRow',
  })
  const gsData = (await goldsky.json())[0] as any

  console.log(`  Realized PnL:     ${formatUSD(Number(gsData.realized_pnl))}`)
  console.log(`  Total Bought:     ${formatUSD(Number(gsData.total_bought))}`)
  console.log(`  Total Sold:       ${formatUSD(Number(gsData.total_sold))}`)
  console.log(`  Positions:        ${gsData.positions}`)

  const gap = Number(v4Data.total_pnl) - Number(gsData.realized_pnl)
  console.log(`
  GAP (v4 - Goldsky): ${formatUSD(gap)}`)

  // Step 3: Find synthetic shorts (positions where sold > bought)
  console.log('
--- STEP 3: SYNTHETIC SHORTS (sold_shares > bought_shares) ---')
  const shorts = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        outcome_index,
        question,
        total_bought_shares,
        total_sold_shares,
        net_shares,
        total_bought_usdc,
        total_sold_usdc,
        trading_pnl,
        resolution_pnl,
        total_pnl
      FROM pm_wallet_market_pnl_v4
      WHERE wallet = '${THEO.address}'
        AND total_sold_shares > total_bought_shares
      ORDER BY abs(total_pnl) DESC
    `,
    format: 'JSONEachRow',
  })
  const shortsData = await shorts.json() as any[]

  console.log(`  Found ${shortsData.length} synthetic short positions:`)
  let totalShortPnL = 0
  for (const s of shortsData) {
    totalShortPnL += Number(s.total_pnl)
    console.log(`
  [SHORT] ${s.condition_id.substring(0, 12)}... outcome ${s.outcome_index}`)
    console.log(`    Question: ${(s.question || '').substring(0, 50)}...`)
    console.log(`    Bought: ${Number(s.total_bought_shares).toLocaleString()} shares / ${formatUSD(Number(s.total_bought_usdc))}`)
    console.log(`    Sold:   ${Number(s.total_sold_shares).toLocaleString()} shares / ${formatUSD(Number(s.total_sold_usdc))}`)
    console.log(`    Net:    ${Number(s.net_shares).toLocaleString()} shares`)
    console.log(`    Trading PnL: ${formatUSD(Number(s.trading_pnl))}`)
    console.log(`    Total PnL:   ${formatUSD(Number(s.total_pnl))}`)
  }
  console.log(`
  Total PnL from synthetic shorts: ${formatUSD(totalShortPnL)}`)

  // Step 4: Per-condition analysis - find conditions where sum of PnL across outcomes exceeds cash flow
  console.log('
--- STEP 4: PER-CONDITION CASH FLOW ANALYSIS ---')
  const conditions = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        any(question) as question,
        sum(total_bought_usdc) as bought,
        sum(total_sold_usdc) as sold,
        sum(total_fees_usdc) as fees,
        sum(resolution_payout) as res_payout,
        sum(total_pnl) as total_pnl,
        count() as outcome_count
      FROM pm_wallet_market_pnl_v4
      WHERE wallet = '${THEO.address}'
      GROUP BY condition_id
      ORDER BY abs(total_pnl) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  })
  const condData = await conditions.json() as any[]

  console.log(`  Top ${condData.length} conditions by absolute PnL:`)
  let totalExcess = 0
  for (const c of condData) {
    // Max realizable = sold - bought - fees + resolution_payout
    const maxRealizable = Number(c.sold) - Number(c.bought) - Number(c.fees) + Number(c.res_payout)
    const excess = Number(c.total_pnl) - maxRealizable
    if (excess > 0.01) totalExcess += excess

    console.log(`
  Condition: ${c.condition_id.substring(0, 16)}...`)
    console.log(`    Question:      ${(c.question || '').substring(0, 50)}...`)
    console.log(`    Outcomes:      ${c.outcome_count}`)
    console.log(`    Bought:        ${formatUSD(Number(c.bought))}`)
    console.log(`    Sold:          ${formatUSD(Number(c.sold))}`)
    console.log(`    Resolution:    ${formatUSD(Number(c.res_payout))}`)
    console.log(`    Max Realizable: ${formatUSD(maxRealizable)}`)
    console.log(`    Total PnL:     ${formatUSD(Number(c.total_pnl))}`)
    if (excess > 0.01) {
      console.log(`    EXCESS:        ${formatUSD(excess)} *** PROBLEM ***`)
    }
  }
  console.log(`
  Total excess PnL from conditions with problems: ${formatUSD(totalExcess)}`)
  console.log(`  Gap to explain: ${formatUSD(gap)}`)

  // Step 5: If we subtract excess, does it match target?
  const adjustedPnL = Number(v4Data.total_pnl) - totalExcess
  console.log('
--- STEP 5: ADJUSTED PNL ---')
  console.log(`  V4 Total PnL:      ${formatUSD(Number(v4Data.total_pnl))}`)
  console.log(`  Total Excess:      ${formatUSD(totalExcess)}`)
  console.log(`  Adjusted PnL:      ${formatUSD(adjustedPnL)}`)
  console.log(`  Target:            ${formatUSD(THEO.target_total_pnl)}`)
  console.log(`  Remaining Gap:     ${formatUSD(adjustedPnL - THEO.target_total_pnl)}`)
  console.log(`  Error:             ${((adjustedPnL - THEO.target_total_pnl) / THEO.target_total_pnl * 100).toFixed(2)}%`)

  // Step 6: Per-outcome detail for the worst conditions
  console.log('
--- STEP 6: DETAILED BREAKDOWN OF WORST CONDITIONS ---')
  if (condData.length > 0) {
    const worstCondition = condData[0].condition_id
    const outcomes = await clickhouse.query({
      query: `
        SELECT
          outcome_index,
          total_bought_shares,
          total_sold_shares,
          net_shares,
          total_bought_usdc,
          total_sold_usdc,
          trading_pnl,
          resolution_payout,
          resolution_pnl,
          total_pnl,
          outcome_won
        FROM pm_wallet_market_pnl_v4
        WHERE wallet = '${THEO.address}'
          AND condition_id = '${worstCondition}'
        ORDER BY outcome_index
      `,
      format: 'JSONEachRow',
    })
    const outData = await outcomes.json() as any[]

    console.log(`  Condition: ${worstCondition}`)
    console.log(`  Question: ${condData[0].question}`)
    console.log()

    for (const o of outData) {
      const isShort = Number(o.total_sold_shares) > Number(o.total_bought_shares)
      console.log(`  Outcome ${o.outcome_index} ${isShort ? '[SHORT]' : '[LONG]'} ${Number(o.outcome_won) ? '[WON]' : '[LOST]'}`)
      console.log(`    Bought: ${Number(o.total_bought_shares).toLocaleString()} shares / ${formatUSD(Number(o.total_bought_usdc))}`)
      console.log(`    Sold:   ${Number(o.total_sold_shares).toLocaleString()} shares / ${formatUSD(Number(o.total_sold_usdc))}`)
      console.log(`    Net:    ${Number(o.net_shares).toLocaleString()} shares`)
      console.log(`    Trading PnL:    ${formatUSD(Number(o.trading_pnl))}`)
      console.log(`    Resolution:     ${formatUSD(Number(o.resolution_payout))} payout, ${formatUSD(Number(o.resolution_pnl))} PnL`)
      console.log(`    Total PnL:      ${formatUSD(Number(o.total_pnl))}`)
      console.log()
    }
  }

  console.log('='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))
  console.log(`V4 Total PnL:        ${formatUSD(Number(v4Data.total_pnl))}`)
  console.log(`Goldsky Reference:   ${formatUSD(Number(gsData.realized_pnl))}`)
  console.log(`External Target:     ${formatUSD(THEO.target_total_pnl)}`)
  console.log(`Gap (v4 - target):   ${formatUSD(Number(v4Data.total_pnl) - THEO.target_total_pnl)}`)
  console.log(`Synthetic Short PnL: ${formatUSD(totalShortPnL)}`)
  console.log(`Condition Excess:    ${formatUSD(totalExcess)}`)

  await clickhouse.close()
}

main().catch(console.error)
