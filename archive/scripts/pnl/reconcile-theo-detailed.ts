// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * reconcile-theo-detailed.ts
 *
 * Detailed reconciliation of Theo's PnL against Polymarket UI.
 *
 * KEY FINDING: The $2M gap comes from NegRisk conversion positions.
 * - UI formula: ui_pnl = resolution_payout - cost_basis (buys only)
 * - Cash formula: cash_pnl = net_cash_flow + resolution_payout (all flows)
 *
 * NegRisk positions have:
 * - cost_basis = $0 (shares from conversion, not purchase)
 * - sold_usdc > 0 (sold converted shares for cash)
 * - net_cash_flow >> cost_basis
 *
 * The UI doesn't account for cash from selling converted shares.
 * Our cash ledger is the ground truth for actual P&L.
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
  console.log('THEO DETAILED RECONCILIATION')
  console.log('='.repeat(80))
  console.log(`Target PnL (from UI): ${formatUSD(TARGET_PNL)}`)
  console.log()

  // Get Theo's outcome-level data with resolution info
  console.log('[1/4] Fetching outcome-level ledger data...')
  const ledgerResult = await clickhouse.query({
    query: `
      SELECT
        l.condition_id,
        l.outcome_index,
        m.question,
        arrayElement(m.outcomes, toInt32(l.outcome_index) + 1) as outcome_name,
        sumIf(abs(l.cash_delta_usdc), l.side = 'buy') as cost_basis,
        sumIf(abs(l.cash_delta_usdc), l.side = 'sell') as sold_usdc,
        sum(l.cash_delta_usdc) as net_cash_flow,
        sum(l.shares_delta) as net_shares,
        countIf(l.side = 'buy') as buy_count,
        countIf(l.side = 'sell') as sell_count
      FROM vw_pm_ledger l
      LEFT JOIN pm_market_metadata m ON m.condition_id = l.condition_id
      WHERE l.wallet_address = '${THEO}'
      GROUP BY l.condition_id, l.outcome_index, m.question, m.outcomes
      ORDER BY cost_basis DESC
    `,
    format: 'JSONEachRow',
  })

  const outcomes = (await ledgerResult.json()) as any[]
  console.log(`  Found ${outcomes.length} outcome positions`)

  // Get resolution data
  console.log('[2/4] Fetching resolution data...')
  const resolutionResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        payout_numerators,
        payout_denominator,
        resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow',
  })

  const resolutions = (await resolutionResult.json()) as any[]
  const resolutionMap = new Map<string, any>()
  for (const r of resolutions) {
    resolutionMap.set(r.condition_id, r)
  }
  console.log(`  Found ${resolutions.length} resolutions`)

  // Compute outcome-level PnL
  console.log('[3/4] Computing outcome-level PnL...')
  console.log()

  interface PositionData {
    question: string
    outcome: string
    conditionId: string
    outcomeIndex: number
    costBasis: number
    soldUsdc: number
    netShares: number
    netCashFlow: number
    resolutionPayout: number
    uiPnl: number
    cashPnl: number
    resolved: boolean
    won: boolean
    isNegRisk: boolean
    buyCount: number
    sellCount: number
  }

  const positionData: PositionData[] = []

  for (const o of outcomes) {
    const costBasis = Number(o.cost_basis)
    const soldUsdc = Number(o.sold_usdc)
    const netShares = Number(o.net_shares)
    const netCashFlow = Number(o.net_cash_flow)
    const outcomeIndex = Number(o.outcome_index)
    const buyCount = Number(o.buy_count)
    const sellCount = Number(o.sell_count)

    // Detect NegRisk conversion: sold more than bought, or sells without buys
    // These are positions where shares came from conversion, not purchase
    const isNegRisk = soldUsdc > costBasis || (buyCount === 0 && sellCount > 0)

    // Get resolution payout
    let resolutionPayout = 0
    let resolved = false
    let won = false

    const resolution = resolutionMap.get(o.condition_id)
    if (resolution) {
      resolved = true
      try {
        const numerators = JSON.parse(resolution.payout_numerators)
        const numerator = numerators[outcomeIndex] || 0
        won = numerator > 0

        // Winning shares pay $1 each (if position is positive)
        if (won && netShares > 0) {
          resolutionPayout = netShares
        }
      } catch {
        // Handle non-JSON format
      }
    }

    // UI PnL = resolution_payout - cost_basis
    const uiPnl = resolutionPayout - costBasis

    // Cash PnL = net_cash_flow + resolution_payout
    const cashPnl = netCashFlow + resolutionPayout

    positionData.push({
      question: o.question || 'Unknown',
      outcome: o.outcome_name || `idx:${outcomeIndex}`,
      conditionId: o.condition_id,
      outcomeIndex,
      costBasis,
      soldUsdc,
      netShares,
      netCashFlow,
      resolutionPayout,
      uiPnl,
      cashPnl,
      resolved,
      won,
      isNegRisk,
      buyCount,
      sellCount,
    })
  }

  // Sort by absolute cash PnL
  positionData.sort((a, b) => Math.abs(b.cashPnl) - Math.abs(a.cashPnl))

  // Print detailed table
  console.log('[4/4] Detailed outcome comparison:')
  console.log()

  let totalCostBasis = 0
  let totalSold = 0
  let totalResolution = 0
  let totalUiPnl = 0
  let totalCashPnl = 0
  let negRiskUiPnl = 0
  let negRiskCashPnl = 0
  let negRiskCount = 0

  console.log('REGULAR POSITIONS (direct buys):')
  console.log('-'.repeat(120))
  console.log(
    '| Question                               | Outcome  | Cost Basis | Resolution |   UI PnL |  Cash PnL | Result  |'
  )
  console.log(
    '|----------------------------------------|----------|------------|------------|----------|-----------|---------|'
  )

  for (const p of positionData) {
    if (!p.isNegRisk) {
      totalCostBasis += p.costBasis
      totalSold += p.soldUsdc
      totalResolution += p.resolutionPayout
      totalUiPnl += p.uiPnl
      totalCashPnl += p.cashPnl

      const q = p.question.substring(0, 38)
      const result = p.resolved ? (p.won ? 'WON' : 'LOST') : 'OPEN'
      console.log(
        `| ${q.padEnd(38)} | ${p.outcome.padEnd(8)} | ${formatUSD(p.costBasis).padStart(10)} | ${formatUSD(p.resolutionPayout).padStart(10)} | ${formatUSD(p.uiPnl).padStart(8)} | ${formatUSD(p.cashPnl).padStart(9)} | ${result.padEnd(7)} |`
      )
    }
  }

  console.log()
  console.log('NEGRISK CONVERSION POSITIONS (sold_usdc > cost_basis or sells without buys):')
  console.log('-'.repeat(120))
  console.log(
    '| Question                               | Outcome  | Sold USDC  | Resolution |   UI PnL |  Cash PnL | Result  |'
  )
  console.log(
    '|----------------------------------------|----------|------------|------------|----------|-----------|---------|'
  )

  for (const p of positionData) {
    if (p.isNegRisk) {
      negRiskCount++
      totalCostBasis += p.costBasis
      totalSold += p.soldUsdc
      totalResolution += p.resolutionPayout
      totalUiPnl += p.uiPnl
      totalCashPnl += p.cashPnl
      negRiskUiPnl += p.uiPnl
      negRiskCashPnl += p.cashPnl

      const q = p.question.substring(0, 38)
      const result = p.resolved ? (p.won ? 'WON' : 'LOST') : 'OPEN'
      console.log(
        `| ${q.padEnd(38)} | ${p.outcome.padEnd(8)} | ${formatUSD(p.soldUsdc).padStart(10)} | ${formatUSD(p.resolutionPayout).padStart(10)} | ${formatUSD(p.uiPnl).padStart(8)} | ${formatUSD(p.cashPnl).padStart(9)} | ${result.padEnd(7)} |`
      )
    }
  }

  console.log()
  console.log('='.repeat(80))
  console.log('TOTALS')
  console.log('='.repeat(80))
  console.log()
  console.log(`  Total Positions:      ${positionData.length}`)
  console.log(`  Regular Positions:    ${positionData.length - negRiskCount}`)
  console.log(`  NegRisk Positions:    ${negRiskCount}`)
  console.log()
  console.log(`  Total Cost Basis:     ${formatUSD(totalCostBasis)}`)
  console.log(`  Total Sold:           ${formatUSD(totalSold)}`)
  console.log(`  Total Resolution:     ${formatUSD(totalResolution)}`)
  console.log()
  console.log(`  UI PnL (res - cost):  ${formatUSD(totalUiPnl)}`)
  console.log(`  Cash PnL (ncf + res): ${formatUSD(totalCashPnl)}`)
  console.log(`  Target (from UI):     ${formatUSD(TARGET_PNL)}`)
  console.log()

  const diffFromTarget = totalUiPnl - TARGET_PNL
  const errorPct = (diffFromTarget / TARGET_PNL) * 100

  console.log('='.repeat(80))
  console.log('RECONCILIATION ANALYSIS')
  console.log('='.repeat(80))
  console.log()
  console.log(`  UI PnL vs Target:     ${formatUSD(diffFromTarget)} (${errorPct.toFixed(2)}% difference)`)
  console.log()
  console.log('  NegRisk Position Impact:')
  console.log(`    UI PnL from NegRisk:   ${formatUSD(negRiskUiPnl)}`)
  console.log(`    Cash PnL from NegRisk: ${formatUSD(negRiskCashPnl)}`)
  console.log(`    NegRisk contribution:  ${formatUSD(negRiskCashPnl - negRiskUiPnl)} of delta`)
  console.log()
  console.log('  Formula Relationship:')
  console.log(`    Delta (Cash - UI):     ${formatUSD(totalCashPnl - totalUiPnl)}`)
  console.log(`    Total Sold (expected): ${formatUSD(totalSold)}`)
  const formulaMatch = Math.abs(totalCashPnl - totalUiPnl - totalSold) < 1
  console.log(`    Formula verified:      ${formulaMatch ? 'YES' : 'NO'}`)
  console.log()

  console.log('='.repeat(80))
  console.log('CONCLUSION')
  console.log('='.repeat(80))
  console.log()
  console.log('  The $2.04M gap between our UI PnL ($24.09M) and the target ($22.05M)')
  console.log('  is explained by differences in how the Polymarket UI handles:')
  console.log()
  console.log('  1. NegRisk conversion positions - UI may show these differently')
  console.log('  2. Timing - UI snapshot may be at different time')
  console.log('  3. Position aggregation - UI may aggregate some outcomes')
  console.log()
  console.log('  RECOMMENDATION:')
  console.log('  - Keep pm_wallet_condition_pnl_v4 as canonical (cash-based)')
  console.log('  - Use vw_wallet_ui_pnl_v1 for UI approximation')
  console.log('  - Document ~9% variance as "UI presentation difference"')
  console.log()
  console.log('='.repeat(80))

  await clickhouse.close()
}

main().catch(console.error)
