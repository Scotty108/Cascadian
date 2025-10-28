#!/usr/bin/env tsx
/**
 * Pre-Overnight State Verification
 *
 * PURPOSE:
 * Sanity check before launching overnight historical data load.
 * Gathers current state from ClickHouse (READ-ONLY) and writes baseline snapshot.
 *
 * WHAT IT CHECKS:
 * - Total trades in trades_raw
 * - % trades with market_id populated
 * - % trades with is_resolved=1
 * - wallet_resolution_outcomes row count
 * - Distinct wallets in trades_raw
 * - Distinct wallets with resolution outcomes
 * - Global resolution accuracy snapshot (AVG(won) from wallet_resolution_outcomes)
 *
 * OUTPUT:
 * - runtime/pre-overnight-baseline.json (full snapshot)
 * - Console: PRE_OVERNIGHT_BASELINE: {json} (machine-readable)
 *
 * SAFETY:
 * This script is READ-ONLY and will NOT mutate ClickHouse. Safe to run before bed.
 * You must explicitly call main() to execute.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

const BASELINE_FILE = resolve(process.cwd(), 'runtime/pre-overnight-baseline.json')

interface BaselineSnapshot {
  timestamp: string
  trades_raw: {
    total_rows: number
    rows_with_market_id: number
    market_id_coverage_pct: number
    rows_resolved: number
    resolved_pct: number
  }
  wallets: {
    distinct_wallets_in_trades: number
    distinct_wallets_with_outcomes: number
  }
  resolution_outcomes: {
    total_outcome_rows: number
    global_resolution_accuracy_pct: number | null
    markets_tracked: number
  }
}

/**
 * Query ClickHouse for trades_raw stats
 */
async function getTradesRawStats() {
  // TODO: If running before ClickHouse is fully ready, these may timeout
  // For now, we assume connection works

  // Total rows
  const totalResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw',
    format: 'JSONEachRow'
  })
  const totalRows = await totalResult.json() as any[]
  const total = parseInt(totalRows[0].count)

  // Rows with market_id
  const marketIdResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM trades_raw WHERE market_id != ''`,
    format: 'JSONEachRow'
  })
  const marketIdRows = await marketIdResult.json() as any[]
  const withMarketId = parseInt(marketIdRows[0].count)

  // Rows resolved
  const resolvedResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw WHERE is_resolved = 1',
    format: 'JSONEachRow'
  })
  const resolvedRows = await resolvedResult.json() as any[]
  const resolved = parseInt(resolvedRows[0].count)

  return {
    total_rows: total,
    rows_with_market_id: withMarketId,
    market_id_coverage_pct: total > 0 ? parseFloat(((withMarketId / total) * 100).toFixed(2)) : 0,
    rows_resolved: resolved,
    resolved_pct: total > 0 ? parseFloat(((resolved / total) * 100).toFixed(2)) : 0
  }
}

/**
 * Query ClickHouse for wallet stats
 */
async function getWalletStats() {
  // Distinct wallets in trades_raw
  const tradesWalletsResult = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw',
    format: 'JSONEachRow'
  })
  const tradesWalletsRows = await tradesWalletsResult.json() as any[]
  const distinctTradesWallets = parseInt(tradesWalletsRows[0].count)

  // Distinct wallets with outcomes
  const outcomesWalletsResult = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_resolution_outcomes',
    format: 'JSONEachRow'
  })
  const outcomesWalletsRows = await outcomesWalletsResult.json() as any[]
  const distinctOutcomesWallets = parseInt(outcomesWalletsRows[0].count)

  return {
    distinct_wallets_in_trades: distinctTradesWallets,
    distinct_wallets_with_outcomes: distinctOutcomesWallets
  }
}

/**
 * Query ClickHouse for resolution outcomes stats
 *
 * CRITICAL: Resolution accuracy = % of markets where wallet held winning side at resolution
 * Formula: AVG(won) * 100 from wallet_resolution_outcomes
 * markets_tracked = COUNT(DISTINCT condition_id) in wallet_resolution_outcomes
 */
async function getResolutionOutcomesStats() {
  // Total outcome rows
  const totalResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM wallet_resolution_outcomes',
    format: 'JSONEachRow'
  })
  const totalRows = await totalResult.json() as any[]
  const total = parseInt(totalRows[0].count)

  // Global resolution accuracy and markets tracked
  let accuracy: number = 0
  let marketsTracked = 0

  if (total > 0) {
    const accuracyResult = await clickhouse.query({
      query: `
        SELECT
          AVG(won) * 100 as accuracy_pct,
          COUNT(DISTINCT condition_id) as markets_tracked
        FROM wallet_resolution_outcomes
      `,
      format: 'JSONEachRow'
    })
    const accuracyRows = await accuracyResult.json() as any[]
    accuracy = parseFloat(parseFloat(accuracyRows[0].accuracy_pct).toFixed(2))
    marketsTracked = parseInt(accuracyRows[0].markets_tracked)
  }

  return {
    total_outcome_rows: total,
    global_resolution_accuracy_pct: accuracy,
    markets_tracked: marketsTracked
  }
}

/**
 * Main execution function
 */
export async function main() {
  console.log('🔍 Verifying pre-overnight state...\n')

  const snapshot: BaselineSnapshot = {
    timestamp: new Date().toISOString(),
    trades_raw: await getTradesRawStats(),
    wallets: await getWalletStats(),
    resolution_outcomes: await getResolutionOutcomesStats()
  }

  // Write to file
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(snapshot, null, 2))
  console.log(`✅ Baseline snapshot written to: ${BASELINE_FILE}\n`)

  // Print summary
  console.log('📊 Pre-Overnight Baseline Summary:')
  console.log(`   Trades Total: ${snapshot.trades_raw.total_rows.toLocaleString()}`)
  console.log(`   Market ID Coverage: ${snapshot.trades_raw.market_id_coverage_pct}%`)
  console.log(`   Resolved Trades: ${snapshot.trades_raw.resolved_pct}%`)
  console.log(`   Distinct Wallets: ${snapshot.wallets.distinct_wallets_in_trades}`)
  console.log(`   Wallets with Outcomes: ${snapshot.wallets.distinct_wallets_with_outcomes}`)
  console.log(`   Resolution Outcomes: ${snapshot.resolution_outcomes.total_outcome_rows}`)
  console.log(`   Global Resolution Accuracy: ${snapshot.resolution_outcomes.global_resolution_accuracy_pct}%`)
  console.log(`   Resolution Markets Tracked: ${snapshot.resolution_outcomes.markets_tracked}`)
  console.log('')

  // Machine-readable output for log scraping
  console.log(`PRE_OVERNIGHT_BASELINE: ${JSON.stringify(snapshot)}`)

  return snapshot
}

// DO NOT auto-execute
// Call main() explicitly when ready
