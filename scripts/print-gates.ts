#!/usr/bin/env tsx
/**
 * Phase 0 Validation Gates Checker
 *
 * This script runs read-only queries to validate data correctness after Phase 0 enrichment.
 * All 4 gates must pass before proceeding with remaining phases.
 *
 * Expected values:
 * - Gate 1 (markets_missing_dim): 0 or 1 (1 market failed to fetch)
 * - Gate 2 (pnl_nulls): 0 (all resolved trades have P&L)
 * - Gate 3 (wallets): ~2,839 (all wallets have resolution accuracy)
 * - Gate 4 (pending_mutations): 0 (no mutations running)
 * - Extra: category_coverage_pct (tracks denormalization progress)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import { getMutationStatus } from '@/lib/clickhouse/mutations'

interface GateResult {
  gate: number
  name: string
  query: string
  actual: number | string
  expected: string
  status: 'PASS' | 'FAIL' | 'WARN'
  message?: string
}

async function runGate(
  gate: number,
  name: string,
  query: string,
  expected: string,
  validator: (value: any) => 'PASS' | 'FAIL' | 'WARN',
  message?: string
): Promise<GateResult> {
  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })
    const data = await result.json()
    const value = data[0] ? Object.values(data[0])[0] : 0
    const actual = typeof value === 'string' ? parseInt(value) : value
    const status = validator(actual)

    return {
      gate,
      name,
      query,
      actual,
      expected,
      status,
      message: message || undefined
    }
  } catch (error) {
    return {
      gate,
      name,
      query,
      actual: 'ERROR',
      expected,
      status: 'FAIL',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('       Phase 0 Validation Gates                          ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const gates: GateResult[] = []

  // Gate 1: All markets have dimensions (or 1 missing due to API failure)
  console.log('Running Gate 1: Markets Missing Dimensions...')
  gates.push(await runGate(
    1,
    'markets_missing_dim',
    `
      SELECT uniqExactIf(t.market_id, m.market_id IS NULL) AS markets_missing_dim
      FROM trades_raw t
      LEFT JOIN markets_dim m USING(market_id)
      WHERE t.market_id != ''
    `,
    '0 or 1',
    (value) => {
      if (value === 0) return 'PASS'
      if (value === 1) return 'WARN'
      return 'FAIL'
    },
    'One market failed to fetch from Polymarket API during Phase 0.3'
  ))

  // Gate 2: All resolved trades have P&L populated
  console.log('Running Gate 2: P&L Nulls...')
  gates.push(await runGate(
    2,
    'pnl_nulls',
    `
      SELECT countIf(realized_pnl_usd IS NULL AND is_resolved = 1) AS pnl_nulls
      FROM trades_raw
    `,
    '0',
    (value) => value === 0 ? 'PASS' : 'FAIL'
  ))

  // Gate 3: Resolution accuracy computed for all wallets
  console.log('Running Gate 3: Wallets with Resolution Outcomes...')
  gates.push(await runGate(
    3,
    'wallets_with_outcomes',
    `
      SELECT COUNT(DISTINCT wallet_address) AS wallets
      FROM wallet_resolution_outcomes
    `,
    '~2,839',
    (value) => {
      if (value >= 2835 && value <= 2845) return 'PASS'
      if (value >= 2800 && value < 2835) return 'WARN'
      return 'FAIL'
    }
  ))

  // Gate 4: No pending mutations
  console.log('Running Gate 4: Pending Mutations...')
  const mutationStatus = await getMutationStatus()
  gates.push({
    gate: 4,
    name: 'pending_mutations',
    query: 'SELECT count() FROM system.mutations WHERE is_done=0',
    actual: mutationStatus.pending,
    expected: '0',
    status: mutationStatus.pending === 0 ? 'PASS' : 'FAIL',
    message: mutationStatus.pending > 0
      ? `${mutationStatus.pending} mutations still running. Wait before proceeding.`
      : undefined
  })

  // Extra: Category coverage
  console.log('Running Extra Check: Category Coverage...')
  const categoryResult = await clickhouse.query({
    query: `
      SELECT
        countIf(canonical_category != '') AS with_category,
        count() AS total_trades,
        round(countIf(canonical_category != '') * 100.0 / count(), 2) AS coverage_pct
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  const categoryData = await categoryResult.json<{
    with_category: string
    total_trades: string
    coverage_pct: string
  }>()

  const coveragePct = parseFloat(categoryData[0].coverage_pct)
  const withCategory = parseInt(categoryData[0].with_category)
  const totalTrades = parseInt(categoryData[0].total_trades)

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('       Gate Results                                       ')
  console.log('═══════════════════════════════════════════════════════════\n')

  let allPass = true
  let hasWarnings = false

  gates.forEach((gate) => {
    const icon = gate.status === 'PASS' ? '✅' : gate.status === 'WARN' ? '⚠️ ' : '❌'
    console.log(`${icon} Gate ${gate.gate}: ${gate.name}`)
    console.log(`   Expected: ${gate.expected}`)
    console.log(`   Actual:   ${gate.actual}`)
    if (gate.message) {
      console.log(`   Note:     ${gate.message}`)
    }
    console.log()

    if (gate.status === 'FAIL') allPass = false
    if (gate.status === 'WARN') hasWarnings = true
  })

  // Print category coverage
  console.log('📊 Extra: Category Coverage')
  console.log(`   Trades with category: ${withCategory.toLocaleString()} / ${totalTrades.toLocaleString()}`)
  console.log(`   Coverage: ${coveragePct}%`)
  console.log()

  // Extra: Value conservation invariant (net P&L should be ~0 for resolved markets)
  console.log('📊 Extra: Value Conservation (Bad Markets)')
  try {
    const badMarketsResult = await clickhouse.query({
      query: `
        SELECT count() AS bad_markets
        FROM (
          SELECT market_id, round(sum(realized_pnl_usd), 2) AS net
          FROM trades_raw
          WHERE is_resolved = 1
          GROUP BY market_id
          HAVING abs(net) > 0.01
        )
      `,
      format: 'JSONEachRow'
    })
    const badMarketsData = await badMarketsResult.json<{ bad_markets: string }>()
    const badMarkets = parseInt(badMarketsData[0].bad_markets)

    console.log(`   Bad markets (|net P&L| > $0.01): ${badMarkets}`)
    if (badMarkets > 0) {
      console.log(`   ⚠️  Value conservation violated on ${badMarkets} markets`)
    } else {
      console.log(`   ✅ Value conservation holds (all markets sum to ~$0)`)
    }
  } catch (error) {
    console.log(`   ⚠️  Could not check value conservation: ${error}`)
  }
  console.log()

  // Final summary
  console.log('═══════════════════════════════════════════════════════════')
  if (allPass && !hasWarnings) {
    console.log('✅ ALL GATES PASS - Phase 0 Complete!')
  } else if (allPass && hasWarnings) {
    console.log('⚠️  ALL GATES PASS WITH WARNINGS - Review before proceeding')
  } else {
    console.log('❌ SOME GATES FAILED - Do not proceed with remaining phases')
  }
  console.log('═══════════════════════════════════════════════════════════\n')

  // Exit with appropriate code
  if (!allPass) {
    process.exit(1)
  } else if (hasWarnings) {
    process.exit(0) // Warnings are acceptable
  } else {
    process.exit(0)
  }
}

main().catch((error) => {
  console.error('Fatal error running gates:', error)
  process.exit(1)
})
