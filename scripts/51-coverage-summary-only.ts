#!/usr/bin/env npx tsx

/**
 * COVERAGE SUMMARY - Just the key numbers
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('CRITICAL COVERAGE ANALYSIS')
  console.log('='.repeat(100))

  // Get overall stats
  const stats = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(DISTINCT wallet_address) as total_wallets,
        SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as trades_with_id,
        ROUND(SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as coverage_pct,
        COUNT(CASE WHEN condition_id = '' THEN 1 END) as trades_missing_id
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  const s = stats[0]
  console.log(`\nTotal trades in trades_raw: ${parseInt(s.total_trades).toLocaleString()}`)
  console.log(`Total unique wallets: ${parseInt(s.total_wallets).toLocaleString()}`)
  console.log(`Trades WITH condition_id: ${parseInt(s.trades_with_id).toLocaleString()} (${parseFloat(s.coverage_pct)}%)`)
  console.log(`Trades MISSING condition_id: ${parseInt(s.trades_missing_id).toLocaleString()} (${(100 - parseFloat(s.coverage_pct)).toFixed(2)}%)`)

  // Get wallet coverage breakdown
  console.log('\n' + '─'.repeat(100))
  console.log('[WALLET COVERAGE BREAKDOWN]')
  console.log('─'.repeat(100))

  const walletBreakdown = await (await clickhouse.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          wallet_address,
          COUNT(*) as total_trades,
          SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as trades_with_id,
          ROUND(SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 0) as coverage_pct
        FROM trades_raw
        GROUP BY wallet_address
      )
      SELECT
        CASE
          WHEN coverage_pct = 100 THEN '100% (Complete)'
          WHEN coverage_pct >= 90 THEN '90-99% (Near complete)'
          WHEN coverage_pct >= 70 THEN '70-89% (Substantial)'
          WHEN coverage_pct >= 50 THEN '50-69% (Moderate)'
          WHEN coverage_pct > 0 THEN '1-49% (Minimal)'
          ELSE '0% (No data)'
        END as coverage_bin,
        COUNT(*) as wallet_count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(DISTINCT wallet_address) FROM trades_raw), 2) as pct_of_wallets,
        SUM(total_trades) as total_trades_in_bin,
        SUM(trades_with_id) as trades_with_id_in_bin,
        ROUND(SUM(trades_with_id) * 100.0 / (SELECT COUNT(DISTINCT wallet_address) FROM trades_raw), 2) as pct_of_all_trades
      FROM wallet_stats
      GROUP BY coverage_bin
      ORDER BY
        CASE coverage_bin
          WHEN '100% (Complete)' THEN 1
          WHEN '90-99% (Near complete)' THEN 2
          WHEN '70-89% (Substantial)' THEN 3
          WHEN '50-69% (Moderate)' THEN 4
          WHEN '1-49% (Minimal)' THEN 5
          ELSE 6
        END
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  for (const row of walletBreakdown) {
    console.log(`\n${row.coverage_bin}`)
    console.log(`  Wallets: ${parseInt(row.wallet_count).toLocaleString()} (${parseFloat(row.pct_of_wallets)}% of total)`)
    console.log(`  Trades: ${parseInt(row.total_trades_in_bin).toLocaleString()} total, ${parseInt(row.trades_with_id_in_bin).toLocaleString()} with ID`)
    console.log(`  Trade volume: ${parseFloat(row.pct_of_all_trades)}% of total`)
  }

  // Get distribution of 0% wallets
  console.log('\n' + '─'.repeat(100))
  console.log('[WALLETS WITH ZERO COVERAGE (0% - completely missing)]')
  console.log('─'.repeat(100))

  const zeroCoverage = await (await clickhouse.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          wallet_address,
          COUNT(*) as total_trades,
          SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as trades_with_id
        FROM trades_raw
        GROUP BY wallet_address
      )
      SELECT
        COUNT(*) as zero_coverage_wallets,
        SUM(total_trades) as trades_with_zero_coverage,
        ROUND(SUM(total_trades) * 100.0 / (SELECT COUNT(*) FROM trades_raw), 2) as pct_of_all_trades
      FROM wallet_stats
      WHERE trades_with_id = 0
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  const z = zeroCoverage[0]
  console.log(`\nWallets with 0% coverage: ${parseInt(z.zero_coverage_wallets).toLocaleString()}`)
  console.log(`Trades in these wallets: ${parseInt(z.trades_with_zero_coverage).toLocaleString()} (${parseFloat(z.pct_of_all_trades)}% of all trades)`)
  console.log(`→ These ${parseInt(z.zero_coverage_wallets).toLocaleString()} wallets have ZERO data and are completely excluded`)

  console.log('\n' + '='.repeat(100))
  console.log('[CONCLUSION]')
  console.log('='.repeat(100))

  const coverage = parseFloat(s.coverage_pct)
  const zeroCoverageWallets = parseInt(z.zero_coverage_wallets)
  const totalWallets = parseInt(s.total_wallets)
  const zeroTradesPct = parseFloat(z.pct_of_all_trades)

  console.log(`\nOverall coverage: ${coverage}% of trades have condition_ids`)
  console.log(`Wallets completely excluded: ${zeroCoverageWallets.toLocaleString()} (${(zeroCoverageWallets/totalWallets*100).toFixed(2)}% of wallets)`)
  console.log(`Missing trades: ${parseInt(s.trades_missing_id).toLocaleString()} (${(100-coverage).toFixed(2)}% of all activity)`)
  console.log(`\nKey insight: Using trades_working (all with condition_id) covers only ${coverage}% of original activity.`)
  console.log(`The other ${(100-coverage).toFixed(2)}% is permanently lost data (empty condition_ids with no recovery path).`)

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
