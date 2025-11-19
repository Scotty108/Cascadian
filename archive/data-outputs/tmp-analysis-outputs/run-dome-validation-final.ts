#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from '../lib/clickhouse/client'

// Dome baseline wallets
const DOME_WALLETS = [
  '0x7f3c8979d0afa00007bae4747d5347122af05613', // Wallet 1 (target wallet - had 73% phantoms)
  '0x8cb94cc0b891286430519cec45ee9e7d9438a1fa', // Wallet 2
  '0xeb0513d7e199678891300c5ad7e00ebc1c0012f8', // Wallet 3 (magnitude inflation)
  '0xeb6f1d2e5f31a68ca3f1b0fb9e9c3f5e5d2a1b3c', // Wallet 4 (worst magnitude - 7.5x)
]

async function runDomeValidation() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('DOME VALIDATION: Compare New P&L vs Backup Baseline')
    console.log('=' .repeat(80))
    console.log(`Started: ${new Date().toISOString()}`)
    console.log('=' .repeat(80))
    console.log('')

    console.log('Baseline: realized_pnl_by_market_backup_20251111')
    console.log('New P&L: realized_pnl_by_market_final (rebuilt from clean data)\n')
    console.log('=' .repeat(80))
    console.log('')

    const results: any[] = []

    for (const wallet of DOME_WALLETS) {
      console.log(`Wallet: ${wallet}`)
      console.log('-'.repeat(80))

      // Get baseline (backup) P&L
      const baselineResult = await client.query({
        query: `
          SELECT sum(realized_pnl_usd) as total_pnl
          FROM realized_pnl_by_market_backup_20251111
          WHERE wallet = '${wallet}'
        `,
        format: 'JSONEachRow'
      })
      const baselineData = await baselineResult.json<any[]>()
      const baselinePnL = parseFloat(baselineData[0]?.total_pnl || '0')

      // Get new (rebuilt) P&L
      const newResult = await client.query({
        query: `
          SELECT sum(realized_pnl_usd) as total_pnl
          FROM realized_pnl_by_market_final
          WHERE wallet = '${wallet}'
        `,
        format: 'JSONEachRow'
      })
      const newData = await newResult.json<any[]>()
      const newPnL = parseFloat(newData[0]?.total_pnl || '0')

      // Calculate difference
      const diff = newPnL - baselinePnL
      const diffPct = baselinePnL !== 0 ? ((diff / Math.abs(baselinePnL)) * 100) : 0

      console.log(`  Baseline P&L: $${baselinePnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`  New P&L:      $${newPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`  Difference:   $${diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${diffPct.toFixed(1)}%)`)

      // Check market counts
      const baselineMarketsResult = await client.query({
        query: `SELECT count() as count FROM realized_pnl_by_market_backup_20251111 WHERE wallet = '${wallet}'`,
        format: 'JSONEachRow'
      })
      const baselineMarketsData = await baselineMarketsResult.json<any[]>()
      const baselineMarkets = parseInt(baselineMarketsData[0].count)

      const newMarketsResult = await client.query({
        query: `SELECT count() as count FROM realized_pnl_by_market_final WHERE wallet = '${wallet}'`,
        format: 'JSONEachRow'
      })
      const newMarketsData = await newMarketsResult.json<any[]>()
      const newMarkets = parseInt(newMarketsData[0].count)

      console.log(`  Markets: ${baselineMarkets} → ${newMarkets} (${newMarkets - baselineMarkets >= 0 ? '+' : ''}${newMarkets - baselineMarkets})`)

      // Determine status
      let status = '✅ PASS'
      let issue = 'None'

      if (Math.abs(diff) > 1000) {
        if (baselinePnL < 0 && newPnL > 0) {
          status = '⚠️  SIGN ERROR FIXED?'
          issue = 'Sign changed (negative → positive)'
        } else if (baselinePnL > 0 && newPnL < 0) {
          status = '⚠️  SIGN ERROR INTRODUCED?'
          issue = 'Sign changed (positive → negative)'
        } else if (Math.abs(diffPct) > 20) {
          status = '⚠️  MAGNITUDE CHANGE'
          issue = `${Math.abs(diffPct).toFixed(1)}% difference`
        } else {
          status = '✅ IMPROVED'
          issue = 'Within acceptable range'
        }
      } else {
        status = '✅ STABLE'
        issue = 'Minimal change (<$1k)'
      }

      console.log(`  Status: ${status} - ${issue}`)
      console.log('')

      results.push({
        wallet,
        baselinePnL,
        newPnL,
        diff,
        diffPct,
        baselineMarkets,
        newMarkets,
        status,
        issue
      })
    }

    // Summary
    console.log('=' .repeat(80))
    console.log('VALIDATION SUMMARY')
    console.log('=' .repeat(80))
    console.log('')

    const passed = results.filter(r => r.status.includes('✅')).length
    const warnings = results.filter(r => r.status.includes('⚠️')).length

    console.log(`Total wallets validated: ${results.length}`)
    console.log(`  ✅ Passed/Stable: ${passed}`)
    console.log(`  ⚠️  Warnings: ${warnings}`)
    console.log('')

    if (warnings > 0) {
      console.log('Wallets with warnings:')
      results.filter(r => r.status.includes('⚠️')).forEach(r => {
        console.log(`  - ${r.wallet.substring(0, 10)}... : ${r.issue}`)
      })
      console.log('')
    }

    // Target wallet specific validation
    console.log('TARGET WALLET VALIDATION (Wallet 1):')
    console.log('-'.repeat(80))
    const target = results[0]
    console.log(`  Phantom markets eliminated: ${target.baselineMarkets - target.newMarkets} (${((target.baselineMarkets - target.newMarkets) / target.baselineMarkets * 100).toFixed(1)}%)`)
    console.log(`  P&L change: $${target.diff.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${target.diffPct.toFixed(1)}%)`)

    if (target.baselineMarkets - target.newMarkets > 50) {
      console.log(`  ✅ Major phantom elimination confirmed`)
    }
    console.log('')

    console.log('=' .repeat(80))
    console.log('NEXT STEPS')
    console.log('=' .repeat(80))
    console.log('')
    console.log('1. Review wallets with warnings (if any)')
    console.log('2. Compare specific market-level P&L for flagged wallets')
    console.log('3. Document final results')
    console.log('4. Mark pipeline rebuild as complete')
    console.log('')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('\nStack trace:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

runDomeValidation()
