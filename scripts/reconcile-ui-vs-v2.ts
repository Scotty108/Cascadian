/**
 * UI vs V2 Reconciliation - Close the $59K Gap
 *
 * Goals:
 * 1. Identify 5 "missing" markets (in UI but not in V2)
 * 2. Audit Egg market PnL (~$41,289.47)
 * 3. Quantify per-market PnL deltas (where does $59K gap come from?)
 *
 * Data sources:
 * - pm_ui_positions_new: Polymarket UI positions
 * - vw_pm_realized_pnl_v2: Our V2 calculations (trades + CTF)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function reconcileUIvsV2() {
  console.log('🔍 UI vs V2 Reconciliation - Closing the Gap\n')
  console.log('='.repeat(80))
  console.log(`\nWallet: ${WALLET}\n`)
  console.log('='.repeat(80))

  try {
    // QUERY 1: UI vs V2 Per-Market Reconciliation
    console.log('\n📊 Query 1: UI vs V2 Per-Market Reconciliation\n')
    console.log('Comparing pm_ui_positions_new vs vw_pm_realized_pnl_v2...\n')

    const reconciliationResult = await clickhouse.query({
      query: `
        WITH ui_positions AS (
          SELECT
            lower(condition_id) AS condition_id,
            sum(pnl) AS ui_pnl,
            sum(size) AS ui_size,
            any(market_question) AS question
          FROM pm_ui_positions_new
          WHERE lower(user_address) = '${WALLET}'
            AND status = 'RESOLVED'
          GROUP BY condition_id
        ),
        v2_positions AS (
          SELECT
            condition_id,
            sum(realized_pnl) AS v2_pnl,
            sum(final_shares) AS v2_shares
          FROM vw_pm_realized_pnl_v2
          WHERE wallet_address = '${WALLET}'
            AND is_resolved = 1
          GROUP BY condition_id
        )
        SELECT
          COALESCE(ui.condition_id, v2.condition_id) AS condition_id,
          ui.question,
          ui.ui_pnl,
          v2.v2_pnl,
          ui.ui_pnl - v2.v2_pnl AS delta_pnl,
          ui.ui_size,
          v2.v2_shares,
          CASE
            WHEN ui.condition_id IS NULL THEN 'ONLY_IN_V2'
            WHEN v2.condition_id IS NULL THEN 'ONLY_IN_UI'
            ELSE 'SHARED'
          END AS status
        FROM ui_positions ui
        FULL OUTER JOIN v2_positions v2
          ON ui.condition_id = v2.condition_id
        ORDER BY abs(delta_pnl) DESC
      `,
      format: 'JSONEachRow'
    })
    const reconciliation = await reconciliationResult.json() as Array<{
      condition_id: string
      question: string | null
      ui_pnl: number | null
      v2_pnl: number | null
      delta_pnl: number | null
      ui_size: number | null
      v2_shares: number | null
      status: string
    }>

    // Summary counts
    const onlyInUI = reconciliation.filter(r => r.status === 'ONLY_IN_UI')
    const onlyInV2 = reconciliation.filter(r => r.status === 'ONLY_IN_V2')
    const shared = reconciliation.filter(r => r.status === 'SHARED')

    console.log('Summary:')
    console.log(`  Markets in UI only:  ${onlyInUI.length.toString().padStart(3)} (THE MISSING MARKETS!)`)
    console.log(`  Markets in V2 only:  ${onlyInV2.length.toString().padStart(3)}`)
    console.log(`  Markets in both:     ${shared.length.toString().padStart(3)}`)
    console.log()

    // Show missing markets (ONLY_IN_UI)
    if (onlyInUI.length > 0) {
      console.log('🎯 MISSING MARKETS (in UI but not in V2):\n')
      console.log('Market Question                          | UI PnL')
      console.log('-'.repeat(70))
      onlyInUI.forEach(row => {
        const question = (row.question || 'Unknown').slice(0, 40).padEnd(40)
        const pnl = row.ui_pnl !== null ? `$${row.ui_pnl.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
        console.log(`${question} | ${pnl}`)
      })

      const totalMissingPnL = onlyInUI.reduce((sum, r) => sum + (r.ui_pnl || 0), 0)
      console.log(`\nTotal PnL from missing markets: $${totalMissingPnL.toFixed(2)}`)
    }

    // Show markets only in V2 (shouldn't happen, but check)
    if (onlyInV2.length > 0) {
      console.log('\n⚠️  MARKETS IN V2 BUT NOT IN UI:\n')
      console.log('(These may be markets not yet synced from UI)')
      console.log('Condition ID (first 24)   | V2 PnL')
      console.log('-'.repeat(50))
      onlyInV2.slice(0, 10).forEach(row => {
        const condId = row.condition_id.slice(0, 23).padEnd(23)
        const pnl = row.v2_pnl !== null ? `$${row.v2_pnl.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
        console.log(`${condId} | ${pnl}`)
      })
      if (onlyInV2.length > 10) {
        console.log(`... and ${onlyInV2.length - 10} more`)
      }
    }

    // Show top PnL deltas for shared markets
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Top PnL Deltas for SHARED Markets (UI - V2)\n')

    const sharedWithDeltas = shared
      .filter(r => Math.abs(r.delta_pnl || 0) > 0.01)
      .sort((a, b) => Math.abs(b.delta_pnl || 0) - Math.abs(a.delta_pnl || 0))
      .slice(0, 20)

    if (sharedWithDeltas.length > 0) {
      console.log('Market Question (first 35)            | UI PnL      | V2 PnL      | Delta')
      console.log('-'.repeat(85))
      sharedWithDeltas.forEach(row => {
        const question = (row.question || 'Unknown').slice(0, 34).padEnd(34)
        const uiPnl = row.ui_pnl !== null ? `$${row.ui_pnl.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
        const v2Pnl = row.v2_pnl !== null ? `$${row.v2_pnl.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
        const delta = row.delta_pnl !== null ? `$${row.delta_pnl.toFixed(2)}`.padStart(7) : 'NULL'.padStart(7)
        console.log(`${question} | ${uiPnl} | ${v2Pnl} | ${delta}`)
      })

      const totalSharedDelta = shared.reduce((sum, r) => sum + (r.delta_pnl || 0), 0)
      console.log(`\nTotal PnL delta from shared markets: $${totalSharedDelta.toFixed(2)}`)
    } else {
      console.log('✅ NO differences found in shared markets!')
      console.log('   UI and V2 PnL calculations match perfectly for all shared markets')
    }

    // QUERY 2: Egg Market Audit
    console.log('\n' + '='.repeat(80))
    console.log('\n🥚 Query 2: Egg Market Audit\n')
    console.log('Searching for egg market (eggs below $4.50 in May)...\n')

    const eggMarketResult = await clickhouse.query({
      query: `
        WITH ui_egg AS (
          SELECT
            lower(condition_id) AS condition_id,
            market_question,
            sum(pnl) AS ui_pnl,
            sum(size) AS ui_size
          FROM pm_ui_positions_new
          WHERE lower(user_address) = '${WALLET}'
            AND status = 'RESOLVED'
            AND (
              lower(market_question) LIKE '%egg%'
              OR lower(market_question) LIKE '%$4.50%'
            )
          GROUP BY condition_id, market_question
        ),
        v2_egg AS (
          SELECT
            condition_id,
            sum(realized_pnl) AS v2_pnl,
            sum(final_shares) AS v2_shares,
            sum(trade_cash) AS v2_trade_cash,
            max(resolved_price) AS resolved_price
          FROM vw_pm_realized_pnl_v2
          WHERE wallet_address = '${WALLET}'
            AND is_resolved = 1
          GROUP BY condition_id
        )
        SELECT
          ui.condition_id,
          ui.market_question,
          ui.ui_pnl,
          v2.v2_pnl,
          ui.ui_pnl - v2.v2_pnl AS delta,
          ui.ui_size,
          v2.v2_shares,
          v2.v2_trade_cash,
          v2.resolved_price
        FROM ui_egg ui
        LEFT JOIN v2_egg v2 ON ui.condition_id = v2.condition_id
        ORDER BY abs(ui.ui_pnl) DESC
      `,
      format: 'JSONEachRow'
    })
    const eggMarket = await eggMarketResult.json() as Array<{
      condition_id: string
      market_question: string
      ui_pnl: number
      v2_pnl: number | null
      delta: number | null
      ui_size: number
      v2_shares: number | null
      v2_trade_cash: number | null
      resolved_price: number | null
    }>

    if (eggMarket.length > 0) {
      console.log('Egg market(s) found:\n')
      eggMarket.forEach(row => {
        console.log(`Question:      ${row.market_question}`)
        console.log(`Condition ID:  ${row.condition_id}`)
        console.log(`UI PnL:        $${row.ui_pnl.toFixed(2)}`)
        console.log(`V2 PnL:        ${row.v2_pnl !== null ? '$' + row.v2_pnl.toFixed(2) : 'NOT IN V2'}`)
        console.log(`Delta:         ${row.delta !== null ? '$' + row.delta.toFixed(2) : 'N/A'}`)
        console.log(`UI Size:       ${row.ui_size.toFixed(2)}`)
        console.log(`V2 Shares:     ${row.v2_shares !== null ? row.v2_shares.toFixed(2) : 'N/A'}`)
        console.log(`V2 Trade Cash: ${row.v2_trade_cash !== null ? '$' + row.v2_trade_cash.toFixed(2) : 'N/A'}`)
        console.log(`Resolved Price: ${row.resolved_price !== null ? row.resolved_price.toFixed(2) : 'N/A'}`)
        console.log()

        if (row.v2_pnl !== null && Math.abs(row.ui_pnl - 41289.47) < 100) {
          console.log('✅ This matches the expected ~$41,289.47 PnL from screenshot!')
          if (Math.abs(row.delta || 0) < 0.01) {
            console.log('✅ UI and V2 PnL MATCH for egg market!')
          } else {
            console.log(`⚠️  UI and V2 differ by $${row.delta?.toFixed(2)}`)
          }
        }
      })
    } else {
      console.log('❌ No egg market found matching search criteria')
      console.log('   Trying broader search...\n')

      // Fallback: show largest single-market PnL values
      const largestPnLResult = await clickhouse.query({
        query: `
          SELECT
            market_question,
            lower(condition_id) AS condition_id,
            sum(pnl) AS ui_pnl
          FROM pm_ui_positions_new
          WHERE lower(user_address) = '${WALLET}'
            AND status = 'RESOLVED'
          GROUP BY condition_id, market_question
          ORDER BY abs(ui_pnl) DESC
          LIMIT 10
        `,
        format: 'JSONEachRow'
      })
      const largestPnL = await largestPnLResult.json() as Array<{
        market_question: string
        condition_id: string
        ui_pnl: number
      }>

      console.log('Top 10 Markets by Absolute PnL (may contain egg market):\n')
      console.log('Question (first 45)                             | UI PnL')
      console.log('-'.repeat(70))
      largestPnL.forEach(row => {
        const question = row.market_question.slice(0, 45).padEnd(45)
        const pnl = `$${row.ui_pnl.toFixed(2)}`.padStart(12)
        console.log(`${question} | ${pnl}`)
      })
    }

    // QUERY 3: Aggregate Gap Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 3: Aggregate Gap Summary\n')

    const uiTotal = reconciliation
      .filter(r => r.ui_pnl !== null)
      .reduce((sum, r) => sum + (r.ui_pnl || 0), 0)

    const v2Total = reconciliation
      .filter(r => r.v2_pnl !== null)
      .reduce((sum, r) => sum + (r.v2_pnl || 0), 0)

    const totalGap = uiTotal - v2Total

    const missingMarketsPnL = onlyInUI.reduce((sum, r) => sum + (r.ui_pnl || 0), 0)
    const sharedMarketsDelta = shared.reduce((sum, r) => sum + (r.delta_pnl || 0), 0)

    console.log('Gap Breakdown:\n')
    console.log(`Total UI PnL:                  $${uiTotal.toFixed(2)}`)
    console.log(`Total V2 PnL:                  $${v2Total.toFixed(2)}`)
    console.log(`Total Gap:                     $${totalGap.toFixed(2)}`)
    console.log()
    console.log('Gap Attribution:')
    console.log(`  Missing markets (${onlyInUI.length}):        $${missingMarketsPnL.toFixed(2).padStart(11)} (${(missingMarketsPnL/totalGap*100).toFixed(1)}%)`)
    console.log(`  Shared market deltas:       $${sharedMarketsDelta.toFixed(2).padStart(11)} (${(sharedMarketsDelta/totalGap*100).toFixed(1)}%)`)
    console.log()

    if (Math.abs(totalGap - (missingMarketsPnL + sharedMarketsDelta)) < 0.01) {
      console.log('✅ Gap fully explained!')
    } else {
      const unexplained = totalGap - (missingMarketsPnL + sharedMarketsDelta)
      console.log(`⚠️  Unexplained gap: $${unexplained.toFixed(2)}`)
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 FINAL SUMMARY\n')
    console.log('Key Findings:')
    console.log(`  1. Missing ${onlyInUI.length} market(s) account for $${missingMarketsPnL.toFixed(2)} of gap`)
    console.log(`  2. Shared markets differ by $${sharedMarketsDelta.toFixed(2)}`)
    console.log(`  3. Total gap to UI: $${totalGap.toFixed(2)}`)
    console.log()
    console.log('Next Steps:')
    if (onlyInUI.length > 0) {
      console.log('  - Investigate why these markets are in UI but not in V2')
      console.log('  - Check if these markets have trades in vw_pm_ledger_v2')
      console.log('  - Verify condition_id format matches between tables')
    }
    if (Math.abs(sharedMarketsDelta) > 1) {
      console.log('  - Audit top shared market deltas to find calculation differences')
      console.log('  - Compare trade-by-trade ledger entries for mismatched markets')
    }
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

reconcileUIvsV2()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
