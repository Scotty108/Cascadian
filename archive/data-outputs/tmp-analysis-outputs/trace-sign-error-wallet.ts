#!/usr/bin/env npx tsx
/**
 * TRACE SIGN ERROR WALLET
 * End-to-end trace of wallet 0x7f3c8979... to find where negative sign reappears
 *
 * Expected: +$179K
 * Actual (snapshot): -$9.5M
 * Error: -5,393%
 *
 * Strategy:
 * 1. Pull raw fills from vw_clob_fills_enriched
 * 2. Pull P&L entries from realized_pnl_by_market_backup_20251111
 * 3. Manually compute per-market: cashflow (cost basis) + payout
 * 4. Compare manual calculation vs snapshot values
 * 5. Identify where sign flips occur
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import * as fs from 'fs'

const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'
const EXPECTED_PNL = 179243
const ACTUAL_PNL = -9486571

async function traceSignError() {
  const client = getClickHouseClient()

  try {
    console.log('\n' + '='.repeat(80))
    console.log('SIGN ERROR TRACE - Wallet 0x7f3c8979...')
    console.log('='.repeat(80))
    console.log(`Target wallet: ${TARGET_WALLET}`)
    console.log(`Expected P&L: $${(EXPECTED_PNL / 1000).toFixed(1)}K`)
    console.log(`Actual P&L (snapshot): $${(ACTUAL_PNL / 1000).toFixed(1)}K`)
    console.log(`Error: ${((ACTUAL_PNL - EXPECTED_PNL) / EXPECTED_PNL * 100).toFixed(1)}%`)
    console.log('='.repeat(80) + '\n')

    // STEP 1: Pull raw fills from enriched view
    console.log('STEP 1: Pulling raw fills from vw_clob_fills_enriched\n')

    const fillsResult = await client.query({
      query: `
        SELECT
          market_question,
          \`cf.condition_id\` as condition_id,
          asset_id,
          side,
          outcome,
          price,
          size,
          (price * size) as cost_usdc,
          timestamp,
          tx_hash,
          proxy_wallet,
          user_eoa
        FROM vw_clob_fills_enriched
        WHERE lower(user_eoa) = lower('${TARGET_WALLET}')
           OR lower(proxy_wallet) = lower('${TARGET_WALLET}')
        ORDER BY timestamp ASC
      `,
      format: 'JSONEachRow'
    })
    const fills = await fillsResult.json<any[]>()

    console.log(`✅ Found ${fills.length} fills for wallet\n`)

    if (fills.length === 0) {
      console.log('❌ No fills found - wallet may not exist in vw_clob_fills_enriched')
      console.log('   Checking if wallet exists as proxy or user_eoa...\n')

      const baseCheckResult = await client.query({
        query: `
          SELECT COUNT(*) as count
          FROM vw_clob_fills_enriched
          WHERE lower(user_eoa) = lower('${TARGET_WALLET}')
        `,
        format: 'JSONEachRow'
      })
      const baseCheck = await baseCheckResult.json<any[]>()
      console.log(`   As user_eoa: ${baseCheck[0].count} rows`)

      const proxyCheckResult = await client.query({
        query: `
          SELECT COUNT(*) as count
          FROM vw_clob_fills_enriched
          WHERE lower(proxy_wallet) = lower('${TARGET_WALLET}')
        `,
        format: 'JSONEachRow'
      })
      const proxyCheck = await proxyCheckResult.json<any[]>()
      console.log(`   As proxy_wallet: ${proxyCheck[0].count} rows\n`)

      if (parseInt(baseCheck[0].count) === 0 && parseInt(proxyCheck[0].count) === 0) {
        console.log('❌ Wallet not found in either role - data pipeline issue\n')
        return
      }
    }

    // Sample first 5 fills
    console.log('Sample fills (first 5):\n')
    fills.slice(0, 5).forEach((f: any, idx: number) => {
      console.log(`${idx + 1}. ${f.market_question || 'N/A'}`)
      console.log(`   Condition: ${f.condition_id}`)
      console.log(`   Side: ${f.side}, Outcome: ${f.outcome}, Price: $${parseFloat(f.price).toFixed(2)}`)
      console.log(`   Size: ${parseFloat(f.size).toFixed(2)}, Cost: $${parseFloat(f.cost_usdc).toFixed(2)}`)
      console.log(`   Role: ${f.user_eoa.toLowerCase() === TARGET_WALLET.toLowerCase() ? 'user_eoa' : 'proxy'}`)
      console.log(`   Time: ${f.timestamp}\n`)
    })

    // STEP 2: Pull P&L entries from snapshot
    console.log('STEP 2: Pulling P&L entries from snapshot table\n')

    const pnlResult = await client.query({
      query: `
        SELECT
          wallet,
          condition_id_norm,
          realized_pnl_usd
        FROM realized_pnl_by_market_backup_20251111
        WHERE lower(wallet) = lower('${TARGET_WALLET}')
        ORDER BY realized_pnl_usd ASC
      `,
      format: 'JSONEachRow'
    })
    const pnlEntries = await pnlResult.json<any[]>()

    console.log(`✅ Found ${pnlEntries.length} P&L entries in snapshot\n`)

    // Calculate total P&L from snapshot
    const snapshotTotal = pnlEntries.reduce((sum, p) => sum + parseFloat(p.realized_pnl_usd), 0)
    console.log(`Snapshot total P&L: $${(snapshotTotal / 1000).toFixed(1)}K\n`)

    // Sign distribution
    const positive = pnlEntries.filter(p => parseFloat(p.realized_pnl_usd) > 0).length
    const negative = pnlEntries.filter(p => parseFloat(p.realized_pnl_usd) < 0).length
    const zero = pnlEntries.filter(p => parseFloat(p.realized_pnl_usd) === 0).length

    console.log('Sign distribution in snapshot:')
    console.log(`  Positive: ${positive} (${(positive / pnlEntries.length * 100).toFixed(1)}%)`)
    console.log(`  Negative: ${negative} (${(negative / pnlEntries.length * 100).toFixed(1)}%)`)
    console.log(`  Zero: ${zero} (${(zero / pnlEntries.length * 100).toFixed(1)}%)\n`)

    // Show worst markets
    console.log('Top 5 most negative markets:\n')
    pnlEntries.slice(0, 5).forEach((p: any, idx: number) => {
      console.log(`${idx + 1}. ${p.condition_id_norm}`)
      console.log(`   P&L: $${(parseFloat(p.realized_pnl_usd) / 1000).toFixed(1)}K\n`)
    })

    console.log('Top 5 most positive markets:\n')
    pnlEntries.sort((a, b) => parseFloat(b.realized_pnl_usd) - parseFloat(a.realized_pnl_usd))
      .slice(0, 5).forEach((p: any, idx: number) => {
        console.log(`${idx + 1}. ${p.condition_id_norm}`)
        console.log(`   P&L: $${(parseFloat(p.realized_pnl_usd) / 1000).toFixed(1)}K\n`)
      })

    // STEP 3: Check for condition_id format mismatches
    console.log('STEP 3: Checking condition_id format consistency\n')

    // Normalize condition IDs from fills
    const fillConditions = new Set(
      fills.map(f => f.condition_id ? f.condition_id.toLowerCase().replace('0x', '') : null)
        .filter(c => c && c.length === 64)
    )

    const pnlConditions = new Set(
      pnlEntries.map(p => p.condition_id_norm.toLowerCase().replace('0x', ''))
    )

    console.log(`Unique condition IDs in fills: ${fillConditions.size}`)
    console.log(`Unique condition IDs in P&L: ${pnlConditions.size}`)

    // Check overlap
    const inBoth = [...fillConditions].filter(c => pnlConditions.has(c)).length
    const onlyInFills = fillConditions.size - inBoth
    const onlyInPnl = pnlConditions.size - inBoth

    console.log(`\nOverlap:`)
    console.log(`  In both: ${inBoth}`)
    console.log(`  Only in fills: ${onlyInFills}`)
    console.log(`  Only in P&L: ${onlyInPnl}\n`)

    // STEP 4: Manual P&L calculation for ONE market
    console.log('STEP 4: Manual P&L calculation for sample market\n')

    // Pick a market that exists in both
    const sharedCondition = [...fillConditions].find(c => pnlConditions.has(c))

    if (!sharedCondition) {
      console.log('❌ No shared condition IDs between fills and P&L - format mismatch!\n')
      return
    }

    console.log(`Sample market: ${sharedCondition}\n`)

    // Get fills for this market
    const marketFills = fills.filter(f =>
      f.condition_id && f.condition_id.toLowerCase().replace('0x', '') === sharedCondition
    )

    console.log(`Fills for this market: ${marketFills.length}\n`)

    // Calculate total cost basis (cashflow)
    let totalCost = 0
    let totalSharesBought = 0
    let totalSharesSold = 0

    marketFills.forEach(f => {
      const cost = parseFloat(f.cost_usdc) || 0
      const size = parseFloat(f.size) || 0

      if (f.side === 'BUY') {
        totalCost -= cost // Spent USDC
        totalSharesBought += size
      } else if (f.side === 'SELL') {
        totalCost += cost // Received USDC
        totalSharesSold += size
      }
    })

    console.log('Manual calculation:')
    console.log(`  Total cost (cashflow): $${totalCost.toFixed(2)}`)
    console.log(`  Shares bought: ${totalSharesBought.toFixed(2)}`)
    console.log(`  Shares sold: ${totalSharesSold.toFixed(2)}`)
    console.log(`  Net shares: ${(totalSharesBought - totalSharesSold).toFixed(2)}\n`)

    // Get P&L from snapshot for this market
    const snapshotPnl = pnlEntries.find(p =>
      p.condition_id_norm.toLowerCase().replace('0x', '') === sharedCondition
    )

    if (snapshotPnl) {
      console.log(`Snapshot P&L: $${parseFloat(snapshotPnl.realized_pnl_usd).toFixed(2)}`)
      console.log(`Manual cost basis: $${totalCost.toFixed(2)}`)
      console.log(`\n⚠️  If snapshot P&L ≈ -1 × manual cost basis, sign was flipped!`)
      console.log(`Check: ${parseFloat(snapshotPnl.realized_pnl_usd).toFixed(2)} ≈ ${(-totalCost).toFixed(2)}?\n`)
    }

    // STEP 5: Check for payout data
    console.log('STEP 5: Checking for resolution/payout data\n')

    const resolutionResult = await client.query({
      query: `
        SELECT
          condition_id_norm,
          winning_outcome_index,
          payout_numerators,
          payout_denominator
        FROM winning_index
        WHERE condition_id_norm IN (
          SELECT DISTINCT condition_id_norm
          FROM realized_pnl_by_market_backup_20251111
          WHERE lower(wallet) = lower('${TARGET_WALLET}')
        )
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const resolutions = await resolutionResult.json<any[]>()

    console.log(`✅ Found ${resolutions.length} resolutions for wallet's markets\n`)

    if (resolutions.length > 0) {
      console.log('Sample resolution data (first 3):\n')
      resolutions.slice(0, 3).forEach((r: any, idx: number) => {
        console.log(`${idx + 1}. ${r.condition_id_norm}`)
        console.log(`   Winner index: ${r.winning_outcome_index}`)
        console.log(`   Payout: ${r.payout_numerators} / ${r.payout_denominator}\n`)
      })
    }

    // Summary
    console.log('='.repeat(80))
    console.log('SUMMARY')
    console.log('='.repeat(80))
    console.log(`\n✅ Data collection complete for wallet 0x7f3c8979...`)
    console.log(`\nKey findings:`)
    console.log(`  - Fills found: ${fills.length}`)
    console.log(`  - P&L entries in snapshot: ${pnlEntries.length}`)
    console.log(`  - Snapshot total: $${(snapshotTotal / 1000).toFixed(1)}K`)
    console.log(`  - Expected (Dome): $${(EXPECTED_PNL / 1000).toFixed(1)}K`)
    console.log(`  - Delta: $${((snapshotTotal - EXPECTED_PNL) / 1000).toFixed(1)}K`)
    console.log(`\n  - Negative entries: ${negative}/${pnlEntries.length} (${(negative / pnlEntries.length * 100).toFixed(1)}%)`)
    console.log(`  - Positive entries: ${positive}/${pnlEntries.length} (${(positive / pnlEntries.length * 100).toFixed(1)}%)`)
    console.log(`\n🔍 Next: Examine cost-basis calculation in rebuild-pnl-materialized.ts`)
    console.log(`    and check for sign inversion in payout logic\n`)

    // Save detailed breakdown
    const breakdown = {
      wallet: TARGET_WALLET,
      expected_pnl: EXPECTED_PNL,
      snapshot_total_pnl: snapshotTotal,
      delta: snapshotTotal - EXPECTED_PNL,
      fills_count: fills.length,
      pnl_entries_count: pnlEntries.length,
      sign_distribution: { positive, negative, zero },
      condition_id_overlap: { inBoth, onlyInFills, onlyInPnl },
      sample_market: sharedCondition || 'N/A',
      sample_market_manual_cost: totalCost,
      sample_market_snapshot_pnl: snapshotPnl ? parseFloat(snapshotPnl.realized_pnl_usd) : null,
      resolutions_found: resolutions.length
    }

    fs.writeFileSync(
      'tmp/sign-error-trace-wallet-0x7f3c.json',
      JSON.stringify(breakdown, null, 2)
    )

    console.log('📝 Detailed breakdown saved to: tmp/sign-error-trace-wallet-0x7f3c.json\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }
  } finally {
    await client.close()
  }
}

traceSignError()
