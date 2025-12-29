// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * reconcile-theo-to-ui.ts
 *
 * Reconcile Theo's PnL to Polymarket UI by computing cost-basis PnL.
 *
 * UI Formula: ui_pnl = resolution_payout - cost_basis
 * Our Formula: our_pnl = net_cash_flow + resolution_payout
 *
 * Where:
 * - cost_basis = sum(buy_shares * buy_price) = total_bought_usdc
 * - net_cash_flow = sold_usdc - bought_usdc
 *
 * Target: $22,053,934 (from Polymarket UI)
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

const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
const TARGET_PNL = 22_053_934

function formatUSD(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`
  return `${sign}$${abs.toFixed(2)}`
}

async function main() {
  console.log('='.repeat(80))
  console.log('RECONCILE THEO TO POLYMARKET UI')
  console.log('='.repeat(80))
  console.log(`Target PnL: ${formatUSD(TARGET_PNL)}`)
  console.log()

  // Get Theo's condition-level data
  const result = await clickhouse.query({
    query: `
      SELECT
        p.condition_id,
        m.question,
        p.total_bought_usdc as cost_basis,
        p.total_sold_usdc as sold,
        p.net_cash_flow_usdc as net_cash_flow,
        p.resolution_payout_usdc as resolution_payout,
        p.total_pnl_usdc as our_pnl,
        -- UI PnL = resolution_payout - cost_basis
        p.resolution_payout_usdc - p.total_bought_usdc as ui_pnl
      FROM pm_wallet_condition_pnl_v4 p
      LEFT JOIN pm_market_metadata m ON m.condition_id = p.condition_id
      WHERE p.wallet_address = '${THEO}'
      ORDER BY abs(p.total_pnl_usdc) DESC
    `,
    format: 'JSONEachRow',
  })

  const conditions = await result.json() as any[]

  console.log('=== PER-CONDITION COMPARISON ===
')
  console.log('| Condition | Question | Cost Basis | Resolution | UI PnL | Our PnL | Delta |')
  console.log('|-----------|----------|------------|------------|--------|---------|-------|')

  let totalCostBasis = 0
  let totalSold = 0
  let totalNetCash = 0
  let totalResolution = 0
  let totalUiPnl = 0
  let totalOurPnl = 0

  for (const c of conditions) {
    const costBasis = Number(c.cost_basis)
    const sold = Number(c.sold)
    const netCash = Number(c.net_cash_flow)
    const resolution = Number(c.resolution_payout)
    const uiPnl = Number(c.ui_pnl)
    const ourPnl = Number(c.our_pnl)
    const delta = ourPnl - uiPnl

    totalCostBasis += costBasis
    totalSold += sold
    totalNetCash += netCash
    totalResolution += resolution
    totalUiPnl += uiPnl
    totalOurPnl += ourPnl

    const question = (c.question || '').substring(0, 30)
    console.log(`| ${c.condition_id.substring(0, 8)}... | ${question}... | ${formatUSD(costBasis)} | ${formatUSD(resolution)} | ${formatUSD(uiPnl)} | ${formatUSD(ourPnl)} | ${formatUSD(delta)} |`)
  }

  console.log()
  console.log('=== TOTALS ===')
  console.log()
  console.log(`  Conditions:        ${conditions.length}`)
  console.log(`  Total Cost Basis:  ${formatUSD(totalCostBasis)}`)
  console.log(`  Total Sold:        ${formatUSD(totalSold)}`)
  console.log(`  Total Net Cash:    ${formatUSD(totalNetCash)}`)
  console.log(`  Total Resolution:  ${formatUSD(totalResolution)}`)
  console.log()
  console.log(`  UI PnL (resolution - cost_basis): ${formatUSD(totalUiPnl)}`)
  console.log(`  Our PnL (net_cash + resolution):  ${formatUSD(totalOurPnl)}`)
  console.log(`  Target PnL:                       ${formatUSD(TARGET_PNL)}`)
  console.log()
  console.log(`  Difference (UI - Target):         ${formatUSD(totalUiPnl - TARGET_PNL)}`)
  console.log(`  Error:                            ${((totalUiPnl - TARGET_PNL) / TARGET_PNL * 100).toFixed(2)}%`)
  console.log()

  // Explain the delta
  console.log('=== EXPLANATION OF DELTA ===')
  console.log()
  console.log(`  Delta (Our - UI) = ${formatUSD(totalOurPnl - totalUiPnl)}`)
  console.log(`  Total Sold =       ${formatUSD(totalSold)}`)
  console.log()
  console.log('  Mathematical proof:')
  console.log('    our_pnl = net_cash_flow + resolution_payout')
  console.log('    ui_pnl  = resolution_payout - cost_basis')
  console.log('    delta   = our_pnl - ui_pnl')
  console.log('            = (net_cash_flow + resolution_payout) - (resolution_payout - cost_basis)')
  console.log('            = net_cash_flow + cost_basis')
  console.log('            = (sold - bought) + bought')
  console.log('            = sold')
  console.log()
  console.log(`  Computed delta: ${formatUSD(totalNetCash + totalCostBasis)}`)
  console.log(`  Total sold:     ${formatUSD(totalSold)}`)
  console.log(`  Match:          ${Math.abs(totalNetCash + totalCostBasis - totalSold) < 1 ? 'YES' : 'NO'}`)

  // Check if UI formula matches target
  const withinTolerance = Math.abs(totalUiPnl - TARGET_PNL) / TARGET_PNL <= 0.01
  console.log()
  console.log('='.repeat(80))
  if (withinTolerance) {
    console.log('SUCCESS: UI PnL formula matches Polymarket target within 1%!')
    console.log('Next: Update canonical formula to: pnl = resolution_payout - cost_basis')
  } else {
    console.log('MISMATCH: UI PnL formula does not match Polymarket target.')
    console.log('Investigate which conditions are contributing to the error.')
  }
  console.log('='.repeat(80))

  await clickhouse.close()
}

main().catch(console.error)
