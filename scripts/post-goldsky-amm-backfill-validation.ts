/**
 * Post-Goldsky AMM Backfill Validation Script
 *
 * Run AFTER Goldsky pipeline fix (ticket cmidn49pmaklj01sv0xbja6hu)
 * to validate AMM market data ingestion and PnL calculations.
 *
 * ⚠️  Uses V4 PnL Engine (V3 DEPRECATED - broken per-outcome aggregation)
 *
 * TARGET MARKET: 8e02dc3233cf073a64a9f0466ef8ddbe1f984e4b87eacfd1b8d10c725e042f39
 * Question: "Will egg prices be more than $6.00 in March?"
 * Expected PnL: $25,528.83 (from UI)
 * Current PnL: $0.00 (zero trades ingested)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const AMM_MARKET = '8e02dc3233cf073a64a9f0466ef8ddbe1f984e4b87eacfd1b8d10c725e042f39' // "more than $6 March"
const EXPECTED_PNL = 25528.83

async function postGoldskyAMMBackfillValidation() {
  console.log('🔍 Post-Goldsky AMM Backfill Validation\n')
  console.log('='.repeat(80))
  console.log('\n⚠️  RUN THIS SCRIPT ONLY AFTER:')
  console.log('   - Goldsky pipeline fix deployed (ticket cmidn49pmaklj01sv0xbja6hu)')
  console.log('   - AMM market trades backfilled to pm_trader_events_v2')
  console.log()
  console.log('Target Market: 8e02dc... ("more than $6 March")')
  console.log(`Expected PnL: $${EXPECTED_PNL.toFixed(2)}`)
  console.log('='.repeat(80))

  try {
    // Step 1: Verify token mapping still exists
    console.log('\n1. Verify Token Mapping...\n')

    const tokenMapResult = await clickhouse.query({
      query: `
        SELECT token_id_dec, outcome_index
        FROM pm_token_to_condition_map_v3
        WHERE lower(condition_id) = '${AMM_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const tokenMap = await tokenMapResult.json() as Array<{
      token_id_dec: string
      outcome_index: number
    }>

    if (tokenMap.length === 0) {
      console.log('❌ FAILED: No token mapping found!')
      console.log('   Cannot proceed without token mapping')
      return
    }

    console.log(`✅ Found ${tokenMap.length} token(s) mapped:`)
    tokenMap.forEach(t => {
      console.log(`   Token ${t.outcome_index}: ${t.token_id_dec.slice(0, 20)}...`)
    })

    // Step 2: Check trade ingestion
    console.log('\n2. Check Trade Ingestion...\n')

    const tokenIds = tokenMap.map(t => t.token_id_dec)
    const tradesResult = await clickhouse.query({
      query: `
        SELECT count(*) AS trade_count
        FROM pm_trader_events_v2
        WHERE toString(token_id) IN (${tokenIds.map(id => `'${id}'`).join(', ')})
      `,
      format: 'JSONEachRow'
    })
    const trades = await tradesResult.json() as Array<{ trade_count: string }>
    const tradeCount = parseInt(trades[0].trade_count)

    if (tradeCount === 0) {
      console.log('❌ FAILED: Still ZERO trades for this market!')
      console.log('   AMM backfill has NOT been applied yet')
      console.log('   Do not proceed until Goldsky fix is deployed')
      return
    }

    console.log(`✅ Found ${tradeCount.toLocaleString()} trades for this market`)

    // Check test wallet specifically
    const walletTradesResult = await clickhouse.query({
      query: `
        SELECT count(*) AS wallet_trades
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${TEST_WALLET}'
          AND toString(token_id) IN (${tokenIds.map(id => `'${id}'`).join(', ')})
      `,
      format: 'JSONEachRow'
    })
    const walletTrades = await walletTradesResult.json() as Array<{ wallet_trades: string }>
    const walletTradeCount = parseInt(walletTrades[0].wallet_trades)

    console.log(`   Test wallet trades: ${walletTradeCount}`)

    // Step 3: Verify ledger integration
    console.log('\n3. Verify Ledger Integration...\n')

    const ledgerResult = await clickhouse.query({
      query: `
        SELECT
          count(*) AS ledger_rows,
          sum(shares_delta) AS net_shares,
          sum(cash_delta_usdc) AS net_cash
        FROM vw_pm_ledger_v2
        WHERE wallet_address = '${TEST_WALLET}'
          AND condition_id = '${AMM_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const ledger = await ledgerResult.json() as Array<{
      ledger_rows: string
      net_shares: number | null
      net_cash: number | null
    }>

    const ledgerRows = parseInt(ledger[0].ledger_rows)
    const netShares = ledger[0].net_shares || 0
    const netCash = ledger[0].net_cash || 0

    if (ledgerRows === 0) {
      console.log('❌ FAILED: Trades exist but NOT in ledger!')
      console.log('   Token mapping or join issue')
      return
    }

    console.log(`✅ Found ${ledgerRows} ledger rows`)
    console.log(`   Net shares: ${netShares.toFixed(2)}`)
    console.log(`   Net cash: $${netCash.toFixed(2)}`)

    // Step 4: Calculate PnL
    console.log('\n4. Calculate PnL...\n')

    const pnlResult = await clickhouse.query({
      query: `
        SELECT
          trade_cash,
          resolution_cash,
          realized_pnl,
          is_resolved
        FROM vw_pm_realized_pnl_v4
        WHERE wallet_address = '${TEST_WALLET}'
          AND condition_id = '${AMM_MARKET}'
      `,
      format: 'JSONEachRow'
    })
    const pnl = await pnlResult.json() as Array<{
      trade_cash: number
      resolution_cash: number
      realized_pnl: number
      is_resolved: number
    }>

    if (pnl.length === 0) {
      console.log('❌ FAILED: No PnL entry for this market!')
      console.log('   V3 view not picking up the market')
      return
    }

    const p = pnl[0]
    console.log('V3 PnL Calculation:')
    console.log(`  Trade Cash:       $${p.trade_cash.toFixed(2)}`)
    console.log(`  Resolution Cash:  $${p.resolution_cash.toFixed(2)}`)
    console.log(`  Realized PnL:     $${p.realized_pnl.toFixed(2)}`)
    console.log(`  Is Resolved:      ${p.is_resolved === 1 ? 'Yes' : 'No'}`)

    // Step 5: Validate against expected PnL
    console.log('\n5. Validate Against Expected PnL...\n')

    const pnlDiff = p.realized_pnl - EXPECTED_PNL
    const pnlDiffPercent = (pnlDiff / EXPECTED_PNL) * 100

    console.log(`Expected PnL (UI):  $${EXPECTED_PNL.toFixed(2)}`)
    console.log(`Actual PnL (V3):    $${p.realized_pnl.toFixed(2)}`)
    console.log(`Difference:         $${pnlDiff.toFixed(2)} (${pnlDiffPercent.toFixed(1)}%)`)

    const isClose = Math.abs(pnlDiff) < EXPECTED_PNL * 0.05 // Within 5%

    if (isClose) {
      console.log('\n✅ PnL MATCHES (within 5% tolerance)')
    } else {
      console.log('\n⚠️  PnL MISMATCH (more than 5% difference)')
      console.log('   Possible causes:')
      console.log('   - Incomplete backfill (missing trades)')
      console.log('   - Fee handling differences')
      console.log('   - Different calculation methodology')
    }

    // Step 6: Update data quality flag
    console.log('\n6. Update Data Quality Flag...\n')

    if (isClose && p.is_resolved === 1) {
      const updateFlagSQL = `
        INSERT INTO pm_market_data_quality (condition_id, data_quality, note, verified_at)
        VALUES (
          '${AMM_MARKET}',
          'ok',
          'AMM trades backfilled. PnL verified: $${p.realized_pnl.toFixed(2)} (expected $${EXPECTED_PNL.toFixed(2)}).',
          now()
        )
      `
      await clickhouse.command({ query: updateFlagSQL })
      console.log('✅ Updated quality flag: 8e02dc... → ok (verified)')
    } else {
      console.log('⚠️  NOT updating quality flag - validation incomplete')
    }

    // Step 7: Rerun zero-sum validation
    console.log('\n7. Rerun Zero-Sum Validation...\n')

    const zeroSumResult = await clickhouse.query({
      query: `
        SELECT sum(realized_pnl) AS system_total
        FROM vw_pm_realized_pnl_v4
        WHERE is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const zeroSum = await zeroSumResult.json() as Array<{ system_total: number }>
    const systemTotal = zeroSum[0].system_total

    console.log(`System-wide PnL: $${systemTotal.toLocaleString(undefined, {maximumFractionDigits: 2})}`)

    const zeroSumPass = Math.abs(systemTotal) < 1000
    if (zeroSumPass) {
      console.log('✅ Zero-sum PASSED (within $1K tolerance)')
    } else {
      console.log(`⚠️  Zero-sum: $${Math.abs(systemTotal).toLocaleString()} deviation`)
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 VALIDATION SUMMARY\n')

    const allPassed = tradeCount > 0 && ledgerRows > 0 && pnl.length > 0 && isClose

    if (allPassed) {
      console.log('✅ AMM BACKFILL VALIDATION PASSED')
      console.log()
      console.log('Results:')
      console.log(`  - Trades ingested: ${tradeCount.toLocaleString()}`)
      console.log(`  - Ledger integrated: ${ledgerRows} rows`)
      console.log(`  - PnL calculated: $${p.realized_pnl.toFixed(2)}`)
      console.log(`  - Matches expected: ${isClose ? 'Yes' : 'No'} (${Math.abs(pnlDiffPercent).toFixed(1)}% diff)`)
      console.log(`  - Quality flag updated: Yes`)
      console.log()
      console.log('Next steps:')
      console.log('  1. Verify other egg markets ("below $4.50 May", etc.)')
      console.log('  2. Rerun per-market audit (scripts/audit-ui-specific-wins.ts)')
      console.log('  3. Update final documentation')
    } else {
      console.log('⚠️  AMM BACKFILL VALIDATION INCOMPLETE')
      console.log()
      console.log('Issues found:')
      if (tradeCount === 0) console.log('  - No trades ingested')
      if (ledgerRows === 0) console.log('  - Ledger integration failed')
      if (pnl.length === 0) console.log('  - PnL not calculated')
      if (!isClose) console.log(`  - PnL mismatch (${Math.abs(pnlDiffPercent).toFixed(1)}% difference)`)
      console.log()
      console.log('Action required:')
      console.log('  1. Verify Goldsky backfill completed')
      console.log('  2. Check token mapping is correct')
      console.log('  3. Investigate calculation differences')
    }

    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

postGoldskyAMMBackfillValidation()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
