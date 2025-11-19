#!/usr/bin/env npx tsx
/**
 * VALIDATE SNAPSHOT VS DOME
 * Re-run Dome validation against the immutable backup snapshot
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import * as fs from 'fs'

interface BaselineWallet {
  wallet: string
  expected_pnl: number
  expected_gains: number
  expected_losses: number
}

interface ActualPnL {
  wallet: string
  realized_pnl_usd: number
  total_gains: number
  total_losses: number
  markets_traded: number
}

async function validateSnapshot() {
  const client = getClickHouseClient()

  try {
    console.log('\n' + '='.repeat(80))
    console.log('P&L VALIDATION: Cascadian Snapshot vs Dome Baseline')
    console.log('='.repeat(80))
    console.log(`Date: ${new Date().toISOString()}`)
    console.log('Baseline source: tmp/omega-baseline-2025-11-11.csv (Dome values)')
    console.log('Cascadian source: realized_pnl_by_market_backup_20251111 (immutable snapshot)')
    console.log('='.repeat(80) + '\n')

    // Load baseline
    const csvContent = fs.readFileSync('tmp/omega-baseline-2025-11-11.csv', 'utf-8')
    const lines = csvContent.split('\n').slice(1) // Skip header

    const expectedWallets: BaselineWallet[] = lines
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(',')
        return {
          wallet: parts[0].trim(),
          expected_pnl: parseFloat(parts[1]),
          expected_gains: parseFloat(parts[2]),
          expected_losses: parseFloat(parts[3])
        }
      })

    console.log(`✅ Loaded ${expectedWallets.length} baseline wallets\n`)

    // Query snapshot
    console.log('📊 Querying snapshot table...\n')

    const walletListLower = expectedWallets.map(w => `'${w.wallet.toLowerCase()}'`).join(',')

    const result = await client.query({
      query: `
        SELECT
          wallet,
          SUM(realized_pnl_usd) as total_pnl,
          COUNT(DISTINCT condition_id_norm) as markets_traded
        FROM realized_pnl_by_market_backup_20251111
        WHERE lower(wallet) IN (${walletListLower})
        GROUP BY wallet
      `,
      format: 'JSONEachRow'
    })
    const actualPnL = await result.json<any[]>()

    // Map to expected interface
    const mappedPnL: ActualPnL[] = actualPnL.map(row => ({
      wallet: row.wallet,
      realized_pnl_usd: parseFloat(row.total_pnl),
      total_gains: 0, // Not calculated in this query
      total_losses: 0, // Not calculated in this query
      markets_traded: parseInt(row.markets_traded)
    }))

    console.log(`✅ Found ${mappedPnL.length}/${expectedWallets.length} wallets in snapshot\n`)

    // Comparison report
    console.log('='.repeat(80))
    console.log('WALLET-BY-WALLET COMPARISON')
    console.log('='.repeat(80) + '\n')

    const diffReport: any[] = []
    let walletsWithin1Pct = 0
    let walletsWithin5Pct = 0
    let walletsWithin10Pct = 0
    let maxAbsVariance = 0
    let totalAbsError = 0

    for (const expected of expectedWallets) {
      const actual = mappedPnL.find(a => a.wallet.toLowerCase() === expected.wallet.toLowerCase())

      if (!actual) {
        console.log(`❌ ${expected.wallet}`)
        console.log(`   Status: NOT FOUND in snapshot`)
        console.log(`   Expected: $${(expected.expected_pnl / 1000).toFixed(1)}K\n`)

        diffReport.push({
          wallet: expected.wallet,
          expected_pnl: expected.expected_pnl,
          actual_pnl: 0,
          delta_abs: -expected.expected_pnl,
          delta_pct: -100,
          status: 'MISSING'
        })
        continue
      }

      const deltaAbs = actual.realized_pnl_usd - expected.expected_pnl
      const deltaPct = expected.expected_pnl !== 0
        ? (deltaAbs / Math.abs(expected.expected_pnl)) * 100
        : 0

      const absDeltaPct = Math.abs(deltaPct)
      maxAbsVariance = Math.max(maxAbsVariance, absDeltaPct)
      totalAbsError += Math.abs(deltaAbs)

      let status = ''
      let symbol = ''

      if (absDeltaPct <= 1) {
        status = 'OK'
        symbol = '✅'
        walletsWithin1Pct++
        walletsWithin5Pct++
        walletsWithin10Pct++
      } else if (absDeltaPct <= 5) {
        status = 'MINOR'
        symbol = '⚠️ '
        walletsWithin5Pct++
        walletsWithin10Pct++
      } else if (absDeltaPct <= 10) {
        status = 'MODERATE'
        symbol = '⚠️ '
        walletsWithin10Pct++
      } else {
        status = 'HIGH'
        symbol = '❌'
      }

      console.log(`${symbol} ${expected.wallet}`)
      console.log(`   Expected: $${(expected.expected_pnl / 1000).toFixed(1)}K`)
      console.log(`   Actual:   $${(actual.realized_pnl_usd / 1000).toFixed(1)}K`)
      console.log(`   Delta:    $${(deltaAbs / 1000).toFixed(1)}K (${deltaPct.toFixed(1)}%)`)
      console.log(`   Status:   ${status}`)
      console.log(`   Markets:  ${actual.markets_traded}\n`)

      diffReport.push({
        wallet: expected.wallet,
        expected_pnl: expected.expected_pnl,
        actual_pnl: actual.realized_pnl_usd,
        delta_abs: deltaAbs,
        delta_pct: deltaPct,
        markets_traded: actual.markets_traded,
        status
      })
    }

    // Summary
    console.log('='.repeat(80))
    console.log('VALIDATION SUMMARY')
    console.log('='.repeat(80))
    console.log(`Total wallets:           ${expectedWallets.length}`)
    console.log(`Wallets found:           ${mappedPnL.length}`)
    console.log(`Wallets missing:         ${expectedWallets.length - mappedPnL.length}`)
    console.log('')
    console.log(`Within 1% tolerance:     ${walletsWithin1Pct}/${expectedWallets.length} (${(walletsWithin1Pct / expectedWallets.length * 100).toFixed(1)}%)`)
    console.log(`Within 5% tolerance:     ${walletsWithin5Pct}/${expectedWallets.length} (${(walletsWithin5Pct / expectedWallets.length * 100).toFixed(1)}%)`)
    console.log(`Within 10% tolerance:    ${walletsWithin10Pct}/${expectedWallets.length} (${(walletsWithin10Pct / expectedWallets.length * 100).toFixed(1)}%)`)
    console.log('')
    console.log(`Max absolute variance:   ${maxAbsVariance.toFixed(1)}%`)
    console.log(`Average absolute error:  $${(totalAbsError / expectedWallets.length / 1000).toFixed(1)}K`)
    console.log(`Snapshot date:           2025-11-11`)
    console.log('='.repeat(80) + '\n')

    // Write detailed CSV
    const csvHeader = 'wallet,expected_pnl,actual_pnl,delta_abs,delta_pct,markets_traded,status'
    const csvRows = diffReport.map(r =>
      `${r.wallet},${r.expected_pnl},${r.actual_pnl},${r.delta_abs},${r.delta_pct.toFixed(2)},${r.markets_traded || 0},${r.status}`
    )
    const csvOutput = [csvHeader, ...csvRows].join('\n')

    const outputFile = 'tmp/snapshot-vs-dome-validation-2025-11-11.csv'
    fs.writeFileSync(outputFile, csvOutput)
    console.log(`✅ Detailed report saved to: ${outputFile}\n`)

    // Decision
    if (walletsWithin1Pct === expectedWallets.length) {
      console.log('✅ VALIDATION PASSED: All wallets within 1% tolerance')
      console.log('   Ready to proceed with sign/magnitude debugging\n')
    } else if (walletsWithin5Pct >= expectedWallets.length * 0.9) {
      console.log('⚠️  VALIDATION PARTIAL: 90%+ wallets within 5% tolerance')
      console.log('   May proceed with caution, but investigate outliers\n')
    } else {
      console.log('❌ VALIDATION FAILED: <90% wallets within 5% tolerance')
      console.log('   Significant issues remain - do NOT proceed with rebuild\n')
    }

    // Save validation state
    const validationState = {
      timestamp: new Date().toISOString(),
      snapshot_table: 'realized_pnl_by_market_backup_20251111',
      baseline_file: 'tmp/omega-baseline-2025-11-11.csv',
      total_wallets: expectedWallets.length,
      wallets_found: mappedPnL.length,
      within_1pct: walletsWithin1Pct,
      within_5pct: walletsWithin5Pct,
      within_10pct: walletsWithin10Pct,
      max_variance_pct: maxAbsVariance,
      avg_error_usd: totalAbsError / expectedWallets.length,
      ready_for_debugging: walletsWithin5Pct >= expectedWallets.length * 0.9
    }

    fs.writeFileSync('tmp/validation-state-2025-11-11.json', JSON.stringify(validationState, null, 2))
    console.log('📝 Validation state saved to: tmp/validation-state-2025-11-11.json\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }
  } finally {
    await client.close()
  }
}

validateSnapshot()
