/**
 * Focused Gap Analysis - SQL Queries Only
 *
 * Goals:
 * 1. Quantify non-egg PnL (offsetting losses)
 * 2. Identify top losing markets
 * 3. Find coverage gaps (missing metadata/resolutions)
 * 4. Sanity check counts
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function gapAnalysisFocused() {
  console.log('🔍 Focused Gap Analysis\n')
  console.log('='.repeat(80))
  console.log(`\nWallet: ${WALLET}\n`)
  console.log('='.repeat(80))

  try {
    // Query 1: Non-egg PnL total
    console.log('\n📊 Query 1: Non-Egg PnL Total\n')

    const nonEggPnLResult = await clickhouse.query({
      query: `
        SELECT sum(realized_pnl) AS non_egg_pnl
        FROM vw_pm_realized_pnl_v2 p
        LEFT JOIN pm_market_metadata m ON p.condition_id = lower(m.condition_id)
        WHERE p.wallet_address = '${WALLET}'
          AND (m.question IS NULL OR NOT lower(m.question) LIKE '%egg%')
      `,
      format: 'JSONEachRow'
    })
    const nonEggPnL = await nonEggPnLResult.json() as Array<{ non_egg_pnl: number | null }>

    const nonEggTotal = nonEggPnL[0].non_egg_pnl || 0
    console.log(`Non-egg PnL total: $${nonEggTotal.toFixed(2)}`)
    console.log()
    console.log('Breakdown:')
    console.log(`  Egg markets PnL:     $42,782.14`)
    console.log(`  Non-egg markets PnL: $${nonEggTotal.toFixed(2)}`)
    console.log(`  Total wallet PnL:    $${(42782.14 + nonEggTotal).toFixed(2)}`)

    // Query 2: Top losing markets
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 2: Top 15 Losing Markets\n')

    const topLosersResult = await clickhouse.query({
      query: `
        SELECT
          p.condition_id,
          m.question,
          sum(p.realized_pnl) AS pnl_usdc,
          sum(p.trade_cash) AS trade_cash_usdc,
          sum(p.resolution_cash) AS resolution_cash_usdc
        FROM vw_pm_realized_pnl_v2 p
        LEFT JOIN pm_market_metadata m ON p.condition_id = lower(m.condition_id)
        WHERE p.wallet_address = '${WALLET}'
        GROUP BY p.condition_id, m.question
        ORDER BY pnl_usdc ASC
        LIMIT 15
      `,
      format: 'JSONEachRow'
    })
    const topLosers = await topLosersResult.json() as Array<{
      condition_id: string
      question: string | null
      pnl_usdc: number | null
      trade_cash_usdc: number
      resolution_cash_usdc: number
    }>

    console.log('Top 15 losing markets:\n')
    console.log('PnL         | Trade Cash  | Question (first 50)')
    console.log('-'.repeat(90))

    topLosers.forEach((row, idx) => {
      const rank = (idx + 1).toString().padStart(2)
      const pnl = row.pnl_usdc !== null ? `$${row.pnl_usdc.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
      const tradeCash = `$${row.trade_cash_usdc.toFixed(2)}`.padStart(11)
      const question = (row.question || '[NO METADATA]').slice(0, 50).padEnd(50)
      console.log(`${pnl} | ${tradeCash} | ${question}`)
    })

    const totalLosses = topLosers.reduce((sum, r) => sum + (r.pnl_usdc || 0), 0)
    console.log()
    console.log(`Total from top 15 losers: $${totalLosses.toFixed(2)}`)

    // Query 3: Coverage gaps - missing metadata
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 3: Coverage Gaps - Missing Metadata\n')

    const missingMetadataResult = await clickhouse.query({
      query: `
        SELECT countDistinct(l.condition_id) AS markets_missing_metadata
        FROM vw_pm_ledger_v2 l
        LEFT JOIN pm_market_metadata m ON l.condition_id = lower(m.condition_id)
        WHERE l.wallet_address = '${WALLET}'
          AND m.condition_id IS NULL
      `,
      format: 'JSONEachRow'
    })
    const missingMetadata = await missingMetadataResult.json() as Array<{ markets_missing_metadata: string }>

    const missingMetadataCount = parseInt(missingMetadata[0].markets_missing_metadata)
    console.log(`Markets with missing metadata: ${missingMetadataCount}`)

    if (missingMetadataCount > 0) {
      console.log()
      console.log('⚠️  These markets have trades but no metadata in pm_market_metadata')
      console.log('   This is a potential ingestion gap')

      // Get the condition_ids
      const missingConditionsResult = await clickhouse.query({
        query: `
          SELECT DISTINCT l.condition_id
          FROM vw_pm_ledger_v2 l
          LEFT JOIN pm_market_metadata m ON l.condition_id = lower(m.condition_id)
          WHERE l.wallet_address = '${WALLET}'
            AND m.condition_id IS NULL
          LIMIT 10
        `,
        format: 'JSONEachRow'
      })
      const missingConditions = await missingConditionsResult.json() as Array<{ condition_id: string }>

      console.log()
      console.log('Sample condition_ids with missing metadata:')
      missingConditions.forEach(row => console.log(`  ${row.condition_id}`))
    } else {
      console.log()
      console.log('✅ All markets have metadata')
    }

    // Query 4: Coverage gaps - missing resolutions
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 4: Coverage Gaps - Missing Resolutions\n')

    const missingResolutionResult = await clickhouse.query({
      query: `
        SELECT countDistinct(l.condition_id) AS markets_missing_resolution
        FROM vw_pm_ledger_v2 l
        LEFT JOIN pm_condition_resolutions r ON l.condition_id = lower(r.condition_id)
        WHERE l.wallet_address = '${WALLET}'
          AND r.condition_id IS NULL
      `,
      format: 'JSONEachRow'
    })
    const missingResolution = await missingResolutionResult.json() as Array<{ markets_missing_resolution: string }>

    const missingResolutionCount = parseInt(missingResolution[0].markets_missing_resolution)
    console.log(`Markets with missing resolutions: ${missingResolutionCount}`)

    if (missingResolutionCount > 0) {
      console.log()
      console.log('⚠️  These markets have trades but no resolution data')
      console.log('   These are likely unresolved/open markets')

      // Get PnL impact
      const unresolvedImpactResult = await clickhouse.query({
        query: `
          SELECT
            sum(trade_cash) AS unresolved_trade_cash,
            countDistinct(condition_id) AS unresolved_count
          FROM vw_pm_realized_pnl_v2
          WHERE wallet_address = '${WALLET}'
            AND is_resolved = 0
        `,
        format: 'JSONEachRow'
      })
      const unresolvedImpact = await unresolvedImpactResult.json() as Array<{
        unresolved_trade_cash: number | null
        unresolved_count: string
      }>

      console.log()
      console.log('Unresolved markets impact:')
      console.log(`  Count: ${unresolvedImpact[0].unresolved_count}`)
      console.log(`  Trade cash (cost basis): $${(unresolvedImpact[0].unresolved_trade_cash || 0).toFixed(2)}`)
    } else {
      console.log()
      console.log('✅ All traded markets have resolutions')
    }

    // Query 5: Sanity counts
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 5: Sanity Counts\n')

    const sanityCountsResult = await clickhouse.query({
      query: `
        SELECT
          (SELECT countDistinct(condition_id)
           FROM vw_pm_ledger_v2
           WHERE wallet_address = '${WALLET}') AS total_traded,
          (SELECT countDistinct(condition_id)
           FROM vw_pm_realized_pnl_v2
           WHERE wallet_address = '${WALLET}'
             AND is_resolved = 1) AS resolved_markets,
          (SELECT countDistinct(condition_id)
           FROM vw_pm_realized_pnl_v2
           WHERE wallet_address = '${WALLET}'
             AND is_resolved = 0) AS unresolved_markets
      `,
      format: 'JSONEachRow'
    })
    const sanityCounts = await sanityCountsResult.json() as Array<{
      total_traded: string
      resolved_markets: string
      unresolved_markets: string
    }>

    const totalTraded = parseInt(sanityCounts[0].total_traded)
    const resolvedMarkets = parseInt(sanityCounts[0].resolved_markets)
    const unresolvedMarkets = parseInt(sanityCounts[0].unresolved_markets)

    console.log('Market counts:')
    console.log(`  Total markets traded:    ${totalTraded}`)
    console.log(`  Resolved markets:        ${resolvedMarkets}`)
    console.log(`  Unresolved markets:      ${unresolvedMarkets}`)
    console.log()
    console.log('Validation:')
    console.log(`  Resolved + Unresolved:   ${resolvedMarkets + unresolvedMarkets}`)
    console.log(`  Expected (from ledger):  ${totalTraded}`)
    console.log()
    if (totalTraded === resolvedMarkets + unresolvedMarkets) {
      console.log('✅ Counts match - all markets accounted for')
    } else {
      console.log(`⚠️  Count mismatch: ${totalTraded - (resolvedMarkets + unresolvedMarkets)} markets unaccounted for`)
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 SUMMARY\n')
    console.log('Key Findings:')
    console.log()
    console.log(`1. Non-egg PnL: $${nonEggTotal.toFixed(2)}`)
    console.log(`   - Egg markets:     +$42,782.14`)
    console.log(`   - Non-egg markets: $${nonEggTotal.toFixed(2)}`)
    console.log(`   - Total:           $${(42782.14 + nonEggTotal).toFixed(2)}`)
    console.log()
    console.log(`2. Top losses offsetting egg wins: $${totalLosses.toFixed(2)} (top 15)`)
    console.log()
    console.log(`3. Coverage gaps:`)
    console.log(`   - Missing metadata:    ${missingMetadataCount} markets`)
    console.log(`   - Missing resolutions: ${missingResolutionCount} markets`)
    console.log()
    console.log(`4. Market counts:`)
    console.log(`   - Total traded:   ${totalTraded}`)
    console.log(`   - Resolved:       ${resolvedMarkets}`)
    console.log(`   - Unresolved:     ${unresolvedMarkets}`)
    console.log()
    console.log('Conclusion:')
    if (missingMetadataCount > 0 || missingResolutionCount > 0) {
      console.log(`  ⚠️  Found ${missingMetadataCount + missingResolutionCount} markets with data gaps`)
      console.log('     These are likely the "5 missing markets" from UI (92 vs 87)')
      console.log('     Need to patch mapping/ingestion for these markets')
    } else {
      console.log('  ✅ No ingestion gaps - all markets have metadata and resolutions')
      console.log('     The remaining gap to UI ($58,596) is due to:')
      console.log('     - Different data sources')
      console.log('     - Different calculation methodology')
      console.log('     - Timing differences')
    }
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

gapAnalysisFocused()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
