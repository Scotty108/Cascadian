#!/usr/bin/env npx tsx

/**
 * CHECKPOINT 3B: P&L Validation Only (Swap Already Complete)
 *
 * Validate P&L for test wallets 2-4
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
  console.log('CHECKPOINT 3: P&L Validation (Swap Already Complete)')
  console.log('='.repeat(100))

  // Step 1: Verify trades_raw has the recovered data
  console.log('\n[STEP 1] Verifying trades_raw is the recovered table...')

  try {
    const check = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_condition_ids
        FROM trades_raw
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const total = parseInt(check[0].total_rows)
    const empty = parseInt(check[0].empty_condition_ids)
    console.log(`  ✅ trades_raw has ${total.toLocaleString()} rows, ${empty.toLocaleString()} empty condition_ids`)
  } catch (e) {
    console.error('  ❌ Query failed')
    return
  }

  // Step 2: Check test wallet condition_id coverage
  console.log('\n[STEP 2] Checking test wallet condition_id coverage...')

  for (const [name, addr] of Object.entries(TEST_WALLETS)) {
    try {
      const coverage = await (await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as total_trades,
            SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as trades_with_ids,
            SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as trades_without_ids
          FROM trades_raw
          WHERE lower(wallet_address) = lower('${addr}')
        `,
        format: 'JSONEachRow'
      })).json() as any[]

      const c = coverage[0]
      const coverage_pct = parseInt(c.total_trades) > 0
        ? ((parseInt(c.trades_with_ids) / parseInt(c.total_trades)) * 100).toFixed(1)
        : '0'

      console.log(`  ${name.toUpperCase()}: ${c.total_trades} total, ${c.trades_with_ids} with IDs (${coverage_pct}%)`)
    } catch (e: any) {
      console.log(`  ${name.toUpperCase()}: Error - ${e.message}`)
    }
  }

  // Step 3: Calculate P&L
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
                THEN CAST(shares AS Float64) * (CAST(payout_numerators[outcome_index + 1] AS Float64) / CAST(payout_denominator AS Float64)) - (CAST(entry_price AS Float64) * CAST(shares AS Float64)) - CAST(fee_usd AS Float64)
                ELSE -(CAST(entry_price AS Float64) * CAST(shares AS Float64)) - CAST(fee_usd AS Float64)
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

    if (results.length === 0) {
      console.error('  ❌ No results returned. Check condition_id format.')
      return
    }

    console.log('\n[RESULTS] P&L Validation:')
    console.log('─'.repeat(100))

    const walletResults: {[key: string]: {actual: number, expected: number, passed: boolean}} = {}

    for (const row of results) {
      const addr = row.wallet_address.toLowerCase()
      const walletName = Object.entries(TEST_WALLETS).find(([_, w]) => w.toLowerCase() === addr)?.[0] || 'UNKNOWN'
      const expected = EXPECTED_PNL[walletName as keyof typeof EXPECTED_PNL] || 0
      const actual = parseFloat(row.realized_pnl_usd) || 0
      const diff = actual - expected
      const diffPct = expected !== 0 ? ((diff / expected) * 100).toFixed(1) : '∞'
      const tolerance = 5 // ±5%
      const passed = expected !== 0 && Math.abs(diff / expected) * 100 <= tolerance

      walletResults[walletName] = { actual, expected, passed }

      console.log(`\n${walletName.toUpperCase()}: ${addr.substring(0, 12)}...`)
      console.log(`  Total trades: ${row.total_trades}`)
      console.log(`  Resolved trades: ${row.resolved_trades}`)
      console.log(`  Actual P&L: $${actual.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Expected P&L: $${expected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log(`  Difference: $${diff.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${diffPct}%)`)
      console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'} (tolerance: ±${tolerance}%)`)
    }

    console.log('\n' + '─'.repeat(100))

    // Step 4: Final Summary
    console.log('\n[STEP 4] Checkpoint 3 Summary:')

    let allPassed = true
    for (const [name, result] of Object.entries(walletResults)) {
      if (!result.passed) {
        allPassed = false
        console.log(`  ❌ ${name}: FAILED ($${result.actual.toLocaleString('en-US', {maximumFractionDigits: 0})} vs expected $${result.expected.toLocaleString('en-US', {maximumFractionDigits: 0})})`)
      } else {
        console.log(`  ✅ ${name}: PASSED`)
      }
    }

    console.log()
    if (allPassed && Object.keys(walletResults).length === 3) {
      console.log('✅ CHECKPOINT 3 PASSED - All test wallets match expected P&L')
      console.log('   Ready to proceed with Phase B: Full batch recovery for all 996K wallets')
    } else if (Object.keys(walletResults).length < 3) {
      console.log('⚠️  CHECKPOINT 3 INCOMPLETE - Not all test wallets found or have valid data')
      console.log('   This likely means:')
      console.log('   1. Some test wallets still have 0% condition_id coverage')
      console.log('   2. ERC1155 recovery did not match these wallets')
      console.log('   3. Need to investigate why condition_ids cannot be recovered for certain wallets')
    } else {
      console.log('⚠️  CHECKPOINT 3 INCOMPLETE - P&L values do not match Polymarket UI')
      console.log('   Likely causes:')
      console.log('   1. Recovered condition_id format mismatch (uppercase vs lowercase, 0x prefix, etc)')
      console.log('   2. market_resolutions_final missing resolution data for some markets')
      console.log('   3. Payout vector or outcome_index calculation issue')
    }

  } catch (e: any) {
    console.error('  ❌ Query failed:', e.message)
    return
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
