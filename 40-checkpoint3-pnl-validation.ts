#!/usr/bin/env npx tsx

/**
 * CHECKPOINT 3: Test Wallets 2-4 P&L Validation
 *
 * Atomic swap recovered data into trades_raw, then validate P&L
 * Expected values from Polymarket UI (with ±5% tolerance):
 * - Wallet 2: ~$360,492
 * - Wallet 3: ~$94,730
 * - Wallet 4: ~$12,171
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = {
  'wallet2': '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  'wallet3': '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'wallet4': '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',
}

const EXPECTED_PNL = {
  'wallet2': 360492,
  'wallet3': 94730,
  'wallet4': 12171,
}

async function main() {
  console.log('='.repeat(100))
  console.log('CHECKPOINT 3: Test Wallets 2-4 P&L Validation')
  console.log('='.repeat(100))

  // Step 1: Check if recovery table exists
  console.log('\n[STEP 1] Checking recovery table...')

  try {
    const tableCheck = await (await clickhouse.query({
      query: `SELECT COUNT(*) as cnt FROM trades_raw_test_wallets_recovered`,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`  ✅ Recovery table exists with ${tableCheck[0].cnt} rows`)
  } catch (e) {
    console.error('  ❌ Recovery table not found! Phase A may have failed.')
    return
  }

  // Step 2: Perform atomic swap (sequentially due to Shared database limitation)
  console.log('\n[STEP 2] Performing atomic swap (trades_raw → trades_raw_before_test_wallets_recovery)...')

  try {
    await clickhouse.command({
      query: `RENAME TABLE trades_raw TO trades_raw_before_test_wallets_recovery`
    })
    console.log('  ✅ Backup complete')
  } catch (e: any) {
    console.error('  ❌ Backup failed:', e.message)
    return
  }

  console.log('\n[STEP 2B] Renaming recovered table to trades_raw...')

  try {
    await clickhouse.command({
      query: `RENAME TABLE trades_raw_test_wallets_recovered TO trades_raw`
    })
    console.log('  ✅ Swap complete')
  } catch (e: any) {
    console.error('  ❌ Swap failed:', e.message)
    console.error('  Attempting rollback...')
    try {
      await clickhouse.command({
        query: `RENAME TABLE trades_raw_before_test_wallets_recovery TO trades_raw`
      })
      console.error('  ✅ Rollback successful')
    } catch {}
    return
  }

  // Step 3: Calculate P&L for test wallets
  console.log('\n[STEP 3] Calculating P&L for test wallets...')

  const pnlQuery = `
    WITH wallet_trades AS (
      SELECT
        wallet_address,
        condition_id,
        outcome_index,
        shares,
        entry_price,
        fee_usd,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
      FROM trades_raw
      WHERE lower(wallet_address) IN (
        '${Object.values(TEST_WALLETS).map(w => w.toLowerCase()).join("', '")}')
      AND condition_id != ''
    )
    SELECT
      wt.wallet_address,
      COUNT(*) as total_trades,
      COUNT(CASE WHEN r.winning_index IS NOT NULL THEN 1 END) as resolved_trades,
      ROUND(
        SUM(
          CASE
            WHEN r.winning_index IS NOT NULL
            THEN
              CASE
                WHEN outcome_index = r.winning_index
                THEN shares * (payout_numerators[outcome_index + 1] / payout_denominator) - (entry_price * shares) - fee_usd
                ELSE -(entry_price * shares) - fee_usd
              END
            ELSE 0
          END
        ), 2
      ) as realized_pnl_usd
    FROM wallet_trades wt
    LEFT JOIN market_resolutions_final r ON wt.condition_id_norm = r.condition_id_norm
    GROUP BY wallet_address
    ORDER BY wallet_address
  `

  try {
    const results = await (await clickhouse.query({
      query: pnlQuery,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n[RESULTS] P&L Validation:')
    console.log('─'.repeat(100))

    for (const row of results) {
      const addr = row.wallet_address.toLowerCase()
      const walletName = Object.entries(TEST_WALLETS).find(([_, w]) => w.toLowerCase() === addr)?.[0] || 'UNKNOWN'
      const expected = EXPECTED_PNL[walletName as keyof typeof EXPECTED_PNL] || 0
      const actual = parseFloat(row.realized_pnl_usd) || 0
      const diff = actual - expected
      const diffPct = expected !== 0 ? ((diff / expected) * 100).toFixed(1) : '∞'
      const tolerance = 5 // ±5%
      const passed = expected !== 0 && Math.abs(diff / expected) * 100 <= tolerance

      console.log(`\n${walletName.toUpperCase()}: ${addr.substring(0, 12)}...`)
      console.log(`  Total trades: ${row.total_trades}`)
      console.log(`  Resolved trades: ${row.resolved_trades}`)
      console.log(`  Actual P&L: $${actual.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Expected P&L: $${expected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Difference: $${diff.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${diffPct}%)`)
      console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'} (tolerance: ±${tolerance}%)`)
    }

    console.log('\n' + '─'.repeat(100))

    // Step 4: Summary
    console.log('\n[STEP 4] Checkpoint 3 Summary:')

    let allPassed = true
    for (const row of results) {
      const addr = row.wallet_address.toLowerCase()
      const walletName = Object.entries(TEST_WALLETS).find(([_, w]) => w.toLowerCase() === addr)?.[0] || 'UNKNOWN'
      const expected = EXPECTED_PNL[walletName as keyof typeof EXPECTED_PNL] || 0
      const actual = parseFloat(row.realized_pnl_usd) || 0
      const diff = actual - expected
      const tolerance = 5
      const passed = expected !== 0 && Math.abs(diff / expected) * 100 <= tolerance

      if (!passed) {
        allPassed = false
        console.log(`  ❌ ${walletName}: FAILED (${actual} vs expected ${expected})`)
      } else {
        console.log(`  ✅ ${walletName}: PASSED`)
      }
    }

    if (allPassed) {
      console.log('\n✅ CHECKPOINT 3 PASSED - Ready for Phase B full batch recovery')
    } else {
      console.log('\n⚠️  CHECKPOINT 3 INCOMPLETE - Some wallets still not matching expected values')
      console.log('   Next steps:')
      console.log('   1. Check if all test wallets have recovered condition_ids')
      console.log('   2. Verify market_resolutions_final data is complete')
      console.log('   3. Run Wallet 2 debug to check token ID format and resolution data')
    }

  } catch (e: any) {
    console.error('  ❌ Query failed:', e.message)
    return
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
