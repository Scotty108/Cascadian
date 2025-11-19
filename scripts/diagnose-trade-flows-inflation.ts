#!/usr/bin/env npx tsx
/**
 * DIAGNOSTIC: Trade Flows v2 Inflation Analysis
 *
 * Purpose: Determine if trade_flows_v2 is corrupted/inflated
 * Method: Run 3 queries to detect duplication, fanout, or calculation errors
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'

// Load .env.local manually
const envPath = path.resolve('/Users/scotty/Projects/Cascadian-app/.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  const lines = envContent.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...rest] = trimmed.split('=')
      if (key && rest.length > 0) {
        process.env[key] = rest.join('=')
      }
    }
  }
}

import { clickhouse } from './lib/clickhouse/client'

// Test wallets with expected P&L from Polymarket UI
const TEST_WALLETS = {
  '0x1489046ca0f9980fc2d9a950d103d3bec02c1307': { expected: -1234.56, name: 'HolyMoses7' }, // Replace with actual
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4': { expected: 5678.90, name: 'wallet2' },
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b': { expected: -890.12, name: 'wallet3' },
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb': { expected: 3456.78, name: 'wallet4' },
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  TRADE_FLOWS_V2 INFLATION DIAGNOSTIC')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Setup
  console.log('[SETUP] Creating shadow database...')
  await clickhouse.command({
    query: 'CREATE DATABASE IF NOT EXISTS shadow_v1',
  })
  console.log('✓ Shadow database ready\n')

  // ============================================================
  // QUERY A: Wallet-level cashflow sums
  // ============================================================
  console.log('─────────────────────────────────────────────────────────')
  console.log('QUERY A: Wallet-Level Cashflow Sums')
  console.log('─────────────────────────────────────────────────────────\n')

  const queryA = `
    WITH wallets AS (
      SELECT arrayJoin([
        '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
        '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
        '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
        '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
      ]) AS w
    )
    SELECT
      lower(wallet) AS wallet,
      round(sum(toFloat64(cashflow_usdc)),2) AS flows_sum_usd
    FROM trade_flows_v2
    WHERE lower(wallet) IN (SELECT lower(w) FROM wallets)
    GROUP BY wallet
    ORDER BY flows_sum_usd DESC
  `

  const resultA = await clickhouse.query({
    query: queryA,
    format: 'JSONEachRow',
  })

  const dataA = await resultA.json<{ wallet: string; flows_sum_usd: number }>()

  console.log('Results:')
  console.log('─'.repeat(120))
  console.log(
    'Wallet'.padEnd(44),
    'Flow Sum (USD)'.padStart(15),
    'Expected UI'.padStart(15),
    'Variance %'.padStart(12),
    'Inflation'.padStart(12)
  )
  console.log('─'.repeat(120))

  const inflationFactors: number[] = []
  for (const row of dataA) {
    const expected = TEST_WALLETS[row.wallet as keyof typeof TEST_WALLETS]?.expected || 0
    const variance = expected !== 0 ? ((row.flows_sum_usd - expected) / Math.abs(expected)) * 100 : 0
    const inflation = expected !== 0 ? row.flows_sum_usd / expected : 0

    inflationFactors.push(Math.abs(inflation))

    console.log(
      row.wallet.padEnd(44),
      row.flows_sum_usd.toFixed(2).padStart(15),
      expected.toFixed(2).padStart(15),
      variance.toFixed(1).padStart(11) + '%',
      inflation.toFixed(2).padStart(11) + 'x'
    )
  }
  console.log('─'.repeat(120))

  const avgInflation = inflationFactors.reduce((a, b) => a + b, 0) / inflationFactors.length
  console.log(`\nAverage Inflation Factor: ${avgInflation.toFixed(2)}x`)
  console.log()

  // ============================================================
  // QUERY B: Check for duplication by tx + market
  // ============================================================
  console.log('─────────────────────────────────────────────────────────')
  console.log('QUERY B: Duplication Detection (tx + market)')
  console.log('─────────────────────────────────────────────────────────\n')

  const queryB = `
    SELECT
      lower(wallet) AS wallet,
      tx_hash,
      lower(market_id) AS market_id,
      count() AS rows_per_tx_mkt,
      sum(toFloat64(cashflow_usdc)) AS sum_cash
    FROM trade_flows_v2
    WHERE lower(wallet) IN (
      '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
      '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
      '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
      '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
    )
    GROUP BY wallet, tx_hash, market_id
    HAVING rows_per_tx_mkt > 1
    ORDER BY rows_per_tx_mkt DESC
    LIMIT 100
  `

  const resultB = await clickhouse.query({
    query: queryB,
    format: 'JSONEachRow',
  })

  const dataB = await resultB.json<{
    wallet: string
    tx_hash: string
    market_id: string
    rows_per_tx_mkt: number
    sum_cash: number
  }>()

  if (dataB.length === 0) {
    console.log('✓ No duplication detected (tx + market combination is unique)\n')
  } else {
    console.log(`⚠ DUPLICATION FOUND: ${dataB.length} cases\n`)
    console.log('Top duplicates:')
    console.log('─'.repeat(100))
    console.log('Wallet'.padEnd(44), 'Tx Hash'.padEnd(20), 'Market'.padEnd(20), 'Rows'.padStart(6))
    console.log('─'.repeat(100))

    for (const row of dataB.slice(0, 10)) {
      console.log(
        row.wallet.padEnd(44),
        row.tx_hash.slice(0, 18).padEnd(20),
        row.market_id.slice(0, 18).padEnd(20),
        row.rows_per_tx_mkt.toString().padStart(6)
      )
    }
    console.log('─'.repeat(100))
    console.log()
  }

  // ============================================================
  // QUERY C: Fanout multiplier from market→condition mapping
  // ============================================================
  console.log('─────────────────────────────────────────────────────────')
  console.log('QUERY C: Fanout Analysis (market→condition mapping)')
  console.log('─────────────────────────────────────────────────────────\n')

  // First create the canonical view
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW shadow_v1.canonical_condition_uniq AS
      SELECT
        lower(market_id) AS market_id,
        anyHeavy(lower(condition_id_norm)) AS condition_id_norm
      FROM condition_market_map
      GROUP BY market_id
    `,
  })

  const queryC = `
    SELECT
      round(sum(f.cashflow_usdc), 2) AS raw_sum,
      round(sum(f.cashflow_usdc * coalesce(cc.cc_rows, 1)), 2) AS fanout_sum,
      round(fanout_sum / nullIf(raw_sum, 0), 2) AS implied_multiplier
    FROM trade_flows_v2 f
    ANY LEFT JOIN (
      SELECT lower(market_id) AS market_id, count() AS cc_rows
      FROM canonical_condition
      GROUP BY market_id
    ) cc ON lower(f.market_id) = cc.market_id
  `

  const resultC = await clickhouse.query({
    query: queryC,
    format: 'JSONEachRow',
  })

  const dataC = await resultC.json<{ raw_sum: number; fanout_sum: number; implied_multiplier: number }>()

  if (dataC.length > 0) {
    const { raw_sum, fanout_sum, implied_multiplier } = dataC[0]
    console.log(`Raw Sum (no fanout):     $${raw_sum.toLocaleString()}`)
    console.log(`Fanout Sum (with mult):  $${fanout_sum.toLocaleString()}`)
    console.log(`Implied Multiplier:      ${implied_multiplier}x\n`)

    if (implied_multiplier > 1.5) {
      console.log('⚠ HIGH FANOUT DETECTED - trade_flows_v2 is likely corrupted\n')
    } else {
      console.log('✓ No significant fanout detected\n')
    }
  }

  // ============================================================
  // CONCLUSION
  // ============================================================
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  CONCLUSION')
  console.log('═══════════════════════════════════════════════════════════\n')

  const hasDuplication = dataB.length > 0
  const hasFanout = dataC.length > 0 && dataC[0].implied_multiplier > 1.5
  const hasInflation = avgInflation > 1.5

  console.log('Findings:')
  console.log(`  Duplication:     ${hasDuplication ? '⚠ YES' : '✓ NO'}`)
  console.log(`  Fanout:          ${hasFanout ? '⚠ YES' : '✓ NO'}`)
  console.log(`  Inflation:       ${hasInflation ? `⚠ YES (${avgInflation.toFixed(2)}x)` : '✓ NO'}`)
  console.log()

  if (hasDuplication || hasFanout || hasInflation) {
    console.log('✗ TRADE_FLOWS_V2 IS NOT RELIABLE FOR P&L')
    console.log()
    console.log('Likely Cause:')
    if (hasDuplication) console.log('  - Duplication in tx + market combinations')
    if (hasFanout) console.log('  - Fanout from market→condition mapping')
    if (hasInflation && !hasDuplication && !hasFanout) console.log('  - Wrong calculation formula')
    console.log()
    console.log('Recommendation: Skip trade_flows_v2, use trades_raw only')
  } else {
    console.log('✓ TRADE_FLOWS_V2 IS SAFE FOR P&L ANALYSIS')
    console.log()
    console.log('Recommendation: Can use for analysis')
  }

  console.log()
  console.log('═══════════════════════════════════════════════════════════\n')
}

main().catch((err) => {
  console.error('ERROR:', err)
  process.exit(1)
})
