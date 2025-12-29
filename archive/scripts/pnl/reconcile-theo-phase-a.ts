// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * reconcile-theo-phase-a.ts
 *
 * Phase A: Hard reconcile Theo outcome by outcome
 *
 * Target: UI PnL = $22,053,934 (14 bets shown in UI)
 * Wallet: 0x56687bf447db6ffa42ffe2204a05edaa20f55839
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
const TARGET_UI_PNL = 22_053_934

function formatUSD(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`
  return `${sign}$${abs.toFixed(2)}`
}

interface OutcomeData {
  condition_id: string
  outcome_index: number
  question: string
  outcome_name: string
  total_buys_usdc: number
  total_sells_usdc: number
  net_cash_flow_usdc: number
  net_shares: number
  trade_count: number
  // Resolution data
  outcome_won: boolean
  resolution_payout: number
  // Computed PnL
  ledger_pnl: number
  ui_like_pnl: number
}

async function main() {
  console.log('='.repeat(80))
  console.log('PHASE A: THEO OUTCOME-BY-OUTCOME RECONCILIATION')
  console.log('='.repeat(80))
  console.log()
  console.log(`Wallet: ${THEO}`)
  console.log(`Target UI PnL: ${formatUSD(TARGET_UI_PNL)}`)
  console.log()

  // ========================================
  // STEP A1: Build Theo's outcome-level trade view from CLOB
  // ========================================
  console.log('STEP A1: Building outcome-level trade view from CLOB...')
  console.log()

  const clobResult = await clickhouse.query({
    query: `
      SELECT
        l.condition_id,
        l.outcome_index,
        m.question,
        arrayElement(m.outcomes, toInt32(l.outcome_index) + 1) as outcome_name,
        sumIf(abs(l.cash_delta_usdc), l.side = 'buy') as total_buys_usdc,
        sumIf(abs(l.cash_delta_usdc), l.side = 'sell') as total_sells_usdc,
        sum(l.cash_delta_usdc) as net_cash_flow_usdc,
        sum(l.shares_delta) as net_shares,
        count(*) as trade_count
      FROM vw_pm_ledger l
      LEFT JOIN pm_market_metadata m ON m.condition_id = l.condition_id
      WHERE l.wallet_address = '${THEO}'
      GROUP BY l.condition_id, l.outcome_index, m.question, m.outcomes
      ORDER BY total_buys_usdc DESC
    `,
    format: 'JSONEachRow',
  })

  const clobOutcomes = (await clobResult.json()) as any[]
  console.log(`  Found ${clobOutcomes.length} outcomes from CLOB`)
  console.log()

  // ========================================
  // STEP A2: Build Theo's outcome-level resolution view
  // ========================================
  console.log('STEP A2: Getting resolution data...')
  console.log()

  const resolutionResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        payout_numerators,
        payout_denominator
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
  console.log(`  Loaded ${resolutions.length} resolutions`)
  console.log()

  // Build complete outcome data with resolution and PnL
  const outcomes: OutcomeData[] = []

  for (const o of clobOutcomes) {
    const conditionId = o.condition_id
    const outcomeIndex = Number(o.outcome_index)
    const totalBuys = Number(o.total_buys_usdc)
    const totalSells = Number(o.total_sells_usdc)
    const netCashFlow = Number(o.net_cash_flow_usdc)
    const netShares = Number(o.net_shares)
    const tradeCount = Number(o.trade_count)

    // Get resolution
    let outcomeWon = false
    let resolutionPayout = 0

    const resolution = resolutionMap.get(conditionId)
    if (resolution) {
      try {
        const numerators = JSON.parse(resolution.payout_numerators)
        const numerator = numerators[outcomeIndex] || 0
        outcomeWon = numerator > 0

        // Winning shares pay $1 each if position is positive
        if (outcomeWon && netShares > 0) {
          resolutionPayout = netShares
        }
      } catch {
        // Handle non-JSON format
      }
    }

    // Compute PnL
    const ledgerPnl = netCashFlow + resolutionPayout
    const uiLikePnl = resolutionPayout - totalBuys

    outcomes.push({
      condition_id: conditionId,
      outcome_index: outcomeIndex,
      question: o.question || 'Unknown',
      outcome_name: o.outcome_name || `idx:${outcomeIndex}`,
      total_buys_usdc: totalBuys,
      total_sells_usdc: totalSells,
      net_cash_flow_usdc: netCashFlow,
      net_shares: netShares,
      trade_count: tradeCount,
      outcome_won: outcomeWon,
      resolution_payout: resolutionPayout,
      ledger_pnl: ledgerPnl,
      ui_like_pnl: uiLikePnl,
    })
  }

  // ========================================
  // STEP A3: Display all 28 outcomes with computed values
  // ========================================
  console.log('STEP A3: Complete outcome table')
  console.log()
  console.log('=' .repeat(150))
  console.log(
    '| # | Question (35 chars)                 | Outcome | Buys (Cost) | Sells      | Net Shares | Res Payout | UI PnL    | Ledger PnL | Won  |'
  )
  console.log(
    '|---|-------------------------------------|---------|-------------|------------|------------|------------|-----------|------------|------|'
  )

  let totalBuys = 0
  let totalSells = 0
  let totalResolution = 0
  let totalUiPnl = 0
  let totalLedgerPnl = 0

  // Sort by absolute UI PnL for clarity
  outcomes.sort((a, b) => Math.abs(b.ui_like_pnl) - Math.abs(a.ui_like_pnl))

  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i]
    totalBuys += o.total_buys_usdc
    totalSells += o.total_sells_usdc
    totalResolution += o.resolution_payout
    totalUiPnl += o.ui_like_pnl
    totalLedgerPnl += o.ledger_pnl

    const q = o.question.substring(0, 35).padEnd(35)
    const out = o.outcome_name.substring(0, 7).padEnd(7)
    const won = o.outcome_won ? 'WON' : 'LOST'

    console.log(
      `| ${String(i + 1).padStart(2)} | ${q} | ${out} | ${formatUSD(o.total_buys_usdc).padStart(11)} | ${formatUSD(o.total_sells_usdc).padStart(10)} | ${formatUSD(o.net_shares).padStart(10)} | ${formatUSD(o.resolution_payout).padStart(10)} | ${formatUSD(o.ui_like_pnl).padStart(9)} | ${formatUSD(o.ledger_pnl).padStart(10)} | ${won.padStart(4)} |`
    )
  }

  console.log('=' .repeat(150))
  console.log()

  // ========================================
  // TOTALS
  // ========================================
  console.log('TOTALS:')
  console.log(`  Total Buys (Cost Basis): ${formatUSD(totalBuys)}`)
  console.log(`  Total Sells:             ${formatUSD(totalSells)}`)
  console.log(`  Total Resolution Payout: ${formatUSD(totalResolution)}`)
  console.log(`  Total UI-like PnL:       ${formatUSD(totalUiPnl)}`)
  console.log(`  Total Ledger PnL:        ${formatUSD(totalLedgerPnl)}`)
  console.log()
  console.log(`  Target UI PnL:           ${formatUSD(TARGET_UI_PNL)}`)
  console.log(`  Difference:              ${formatUSD(totalUiPnl - TARGET_UI_PNL)}`)
  console.log(`  Error:                   ${((totalUiPnl - TARGET_UI_PNL) / TARGET_UI_PNL * 100).toFixed(2)}%`)
  console.log()

  // ========================================
  // STEP A4: Categorize outcomes by type
  // ========================================
  console.log('=' .repeat(80))
  console.log('STEP A4: CATEGORIZING OUTCOMES')
  console.log('=' .repeat(80))
  console.log()

  // Category 1: Regular bets (bought shares, held to resolution)
  const regularBets = outcomes.filter(o => o.total_buys_usdc > 0 && o.total_sells_usdc < o.total_buys_usdc * 0.1)

  // Category 2: Sold positions (significant sells)
  const soldPositions = outcomes.filter(o => o.total_sells_usdc > o.total_buys_usdc * 0.1)

  // Category 3: NegRisk conversions (sells without buys, or sells > buys)
  const negRiskPositions = outcomes.filter(o => o.total_sells_usdc > o.total_buys_usdc || (o.total_buys_usdc === 0 && o.total_sells_usdc > 0))

  // Category 4: Zero cost basis (from conversions)
  const zeroCostBasis = outcomes.filter(o => o.total_buys_usdc === 0)

  console.log('Category 1: Regular bets (held to resolution):')
  console.log(`  Count: ${regularBets.length}`)
  let cat1UiPnl = 0
  for (const o of regularBets) {
    cat1UiPnl += o.ui_like_pnl
    console.log(`    ${o.question.substring(0, 40)}... (${o.outcome_name}): UI PnL ${formatUSD(o.ui_like_pnl)}`)
  }
  console.log(`  Subtotal UI PnL: ${formatUSD(cat1UiPnl)}`)
  console.log()

  console.log('Category 2: Positions with significant sells:')
  console.log(`  Count: ${soldPositions.length}`)
  let cat2UiPnl = 0
  for (const o of soldPositions) {
    cat2UiPnl += o.ui_like_pnl
    const sellRatio = (o.total_sells_usdc / o.total_buys_usdc * 100).toFixed(0)
    console.log(`    ${o.question.substring(0, 40)}... (${o.outcome_name}): sells=${formatUSD(o.total_sells_usdc)} (${sellRatio}% of buys), UI PnL ${formatUSD(o.ui_like_pnl)}`)
  }
  console.log(`  Subtotal UI PnL: ${formatUSD(cat2UiPnl)}`)
  console.log()

  console.log('Category 3: NegRisk conversion positions (sells > buys):')
  console.log(`  Count: ${negRiskPositions.length}`)
  let cat3UiPnl = 0
  let cat3LedgerPnl = 0
  for (const o of negRiskPositions) {
    cat3UiPnl += o.ui_like_pnl
    cat3LedgerPnl += o.ledger_pnl
    console.log(`    ${o.question.substring(0, 40)}... (${o.outcome_name}): buys=${formatUSD(o.total_buys_usdc)}, sells=${formatUSD(o.total_sells_usdc)}, UI PnL ${formatUSD(o.ui_like_pnl)}, Ledger PnL ${formatUSD(o.ledger_pnl)}`)
  }
  console.log(`  Subtotal UI PnL:     ${formatUSD(cat3UiPnl)}`)
  console.log(`  Subtotal Ledger PnL: ${formatUSD(cat3LedgerPnl)}`)
  console.log(`  Delta (Ledger - UI): ${formatUSD(cat3LedgerPnl - cat3UiPnl)}`)
  console.log()

  console.log('Category 4: Zero cost basis positions:')
  console.log(`  Count: ${zeroCostBasis.length}`)
  let cat4UiPnl = 0
  let cat4LedgerPnl = 0
  for (const o of zeroCostBasis) {
    cat4UiPnl += o.ui_like_pnl
    cat4LedgerPnl += o.ledger_pnl
    console.log(`    ${o.question.substring(0, 40)}... (${o.outcome_name}): sells=${formatUSD(o.total_sells_usdc)}, net_shares=${formatUSD(o.net_shares)}, UI PnL ${formatUSD(o.ui_like_pnl)}, Ledger PnL ${formatUSD(o.ledger_pnl)}`)
  }
  console.log(`  Subtotal UI PnL:     ${formatUSD(cat4UiPnl)}`)
  console.log(`  Subtotal Ledger PnL: ${formatUSD(cat4LedgerPnl)}`)
  console.log()

  // ========================================
  // KEY INSIGHT: What explains the $2.04M gap?
  // ========================================
  console.log('=' .repeat(80))
  console.log('KEY INSIGHT: EXPLAINING THE GAP')
  console.log('=' .repeat(80))
  console.log()
  console.log(`Our UI-like PnL:  ${formatUSD(totalUiPnl)}`)
  console.log(`Target UI PnL:    ${formatUSD(TARGET_UI_PNL)}`)
  console.log(`Gap:              ${formatUSD(totalUiPnl - TARGET_UI_PNL)}`)
  console.log()
  console.log('The $2.04M excess in our calculation likely comes from:')
  console.log()
  console.log('1. NegRisk positions where we count resolution payout but UI may not:')
  const negRiskWithResolution = outcomes.filter(o =>
    (o.total_sells_usdc > o.total_buys_usdc || o.total_buys_usdc === 0) &&
    o.resolution_payout > 0
  )
  for (const o of negRiskWithResolution) {
    console.log(`   ${o.question.substring(0, 40)}... resolution=${formatUSD(o.resolution_payout)}`)
  }
  console.log()

  console.log('2. Outcomes where our resolution_payout exceeds what UI shows:')
  // These would need comparison with actual UI data
  console.log('   (Need actual UI "Amount Won" values to compare)')
  console.log()

  // ========================================
  // HYPOTHESIS: What if UI groups by condition, not outcome?
  // ========================================
  console.log('=' .repeat(80))
  console.log('HYPOTHESIS: CONDITION-LEVEL (14 bets) vs OUTCOME-LEVEL (28 outcomes)')
  console.log('=' .repeat(80))
  console.log()

  // Group outcomes by condition
  const byCondition = new Map<string, OutcomeData[]>()
  for (const o of outcomes) {
    const existing = byCondition.get(o.condition_id) || []
    existing.push(o)
    byCondition.set(o.condition_id, existing)
  }

  console.log(`Found ${byCondition.size} unique conditions (UI shows 14 bets)`)
  console.log()

  let conditionUiPnlTotal = 0
  console.log('Per-condition aggregation:')
  console.log()

  for (const [conditionId, conditionOutcomes] of byCondition) {
    const question = conditionOutcomes[0].question
    let conditionBuys = 0
    let conditionSells = 0
    let conditionResolution = 0
    let conditionUiPnl = 0
    let conditionLedgerPnl = 0

    for (const o of conditionOutcomes) {
      conditionBuys += o.total_buys_usdc
      conditionSells += o.total_sells_usdc
      conditionResolution += o.resolution_payout
      conditionUiPnl += o.ui_like_pnl
      conditionLedgerPnl += o.ledger_pnl
    }

    conditionUiPnlTotal += conditionUiPnl

    console.log(`${question.substring(0, 50)}...`)
    console.log(`  Outcomes: ${conditionOutcomes.length}, Buys: ${formatUSD(conditionBuys)}, Resolution: ${formatUSD(conditionResolution)}, UI PnL: ${formatUSD(conditionUiPnl)}`)
  }

  console.log()
  console.log(`Condition-level total UI PnL: ${formatUSD(conditionUiPnlTotal)}`)
  console.log(`(Same as outcome-level since formula is additive)`)
  console.log()

  // ========================================
  // NEXT STEP: Need actual UI values to proceed
  // ========================================
  console.log('=' .repeat(80))
  console.log('NEXT STEP REQUIRED')
  console.log('=' .repeat(80))
  console.log()
  console.log('To proceed with exact reconciliation, need the 22 UI row values:')
  console.log('  - Market name')
  console.log('  - "Total Bet" value')
  console.log('  - "Amount Won" value')
  console.log('  - "Profit" value')
  console.log()
  console.log('This will allow mapping each UI row to our outcomes and identifying')
  console.log('exactly which calculations differ.')

  await clickhouse.close()
}

main().catch(console.error)
