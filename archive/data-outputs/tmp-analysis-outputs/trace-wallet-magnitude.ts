#!/usr/bin/env npx tsx
/**
 * TRACE WALLET MAGNITUDE - Deep dive into a single wallet's P&L calculation
 *
 * Goal: Verify we're not counting unclosed positions or misapplying $1 payouts
 *
 * Focuses on: 0xeb6f0a13... (Expected +$125K, Actual +$1.07M, +758% error)
 * This wallet shows correct sign but massive magnitude inflation.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import { writeFileSync } from 'fs'

const WALLET_TO_TRACE = '0xeb6f0a13e67d8452271c195f5ce58f8eb9b3c58c'
const EXPECTED_PNL = 125000

interface MarketTrace {
  condition_id: string
  resolved: boolean
  winning_outcome?: number
  realized_pnl: number
  cashflow_usdc: number
  net_shares: number
  payout: number
  fees_paid?: number
  issue?: string
}

async function traceWalletMagnitude() {
  const client = getClickHouseClient()
  const traces: MarketTrace[] = []

  console.log('\n🔬 TRACING WALLET MAGNITUDE\n')
  console.log('=' .repeat(80) + '\n')
  console.log(`Wallet: ${WALLET_TO_TRACE}`)
  console.log(`Expected P&L: $${(EXPECTED_PNL / 1000).toFixed(1)}K`)
  console.log(`Actual P&L (production): $1.07M (+758% error)\n`)

  try {
    // Step 1: Get all markets this wallet traded in
    console.log('STEP 1: Get all markets for this wallet\n')

    const marketsResult = await client.query({
      query: `
        SELECT DISTINCT
          condition_id_norm
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET_TO_TRACE}'
          AND realized_pnl_usd != 0
        ORDER BY condition_id_norm
      `,
      format: 'JSONEachRow'
    })
    const markets = await marketsResult.json<any>()

    console.log(`   Found ${markets.length} markets with non-zero P&L\n`)

    // Step 2: For each market, check resolution status
    console.log('STEP 2: Check resolution status for each market\n')

    // Check which tables exist for resolution data
    const tablesResult = await client.query({
      query: `
        SELECT name
        FROM system.tables
        WHERE database = 'default'
          AND (name LIKE '%winning%' OR name LIKE '%resolved%' OR name LIKE '%resolution%')
        ORDER BY name
      `,
      format: 'JSONEachRow'
    })
    const tables = await tablesResult.json<any>()

    console.log('   Available resolution tables:')
    tables.forEach((t: any) => {
      console.log(`   - ${t.name}`)
    })
    console.log('')

    // Check if winning_index exists
    const winningIndexExists = tables.some((t: any) => t.name === 'winning_index')

    if (!winningIndexExists) {
      console.log('   ⚠️  WARNING: winning_index table does not exist!')
      console.log('   Cannot verify resolution status. This may be the issue!\n')
    }

    // Step 3: Analyze each market in detail
    console.log('STEP 3: Analyze markets in detail\n')

    let totalResolvedPnL = 0
    let totalUnresolvedPnL = 0
    let resolvedCount = 0
    let unresolvedCount = 0

    for (const market of markets.slice(0, 10)) { // Sample first 10 markets
      const conditionId = market.condition_id_norm

      // Get P&L for this market
      const pnlResult = await client.query({
        query: `
          SELECT
            realized_pnl_usd,
            condition_id_norm
          FROM realized_pnl_by_market_final
          WHERE wallet = '${WALLET_TO_TRACE}'
            AND condition_id_norm = '${conditionId}'
        `,
        format: 'JSONEachRow'
      })
      const pnlData = await pnlResult.json<any>()

      if (pnlData.length === 0) continue

      const realizedPnl = parseFloat(pnlData[0].realized_pnl_usd)

      // Check if resolved
      let isResolved = false
      let winningOutcome: number | undefined

      if (winningIndexExists) {
        const resolutionResult = await client.query({
          query: `
            SELECT winning_index
            FROM winning_index
            WHERE condition_id_norm = '${conditionId}'
            LIMIT 1
          `,
          format: 'JSONEachRow'
        })
        const resolutionData = await resolutionResult.json<any>()

        if (resolutionData.length > 0) {
          isResolved = true
          winningOutcome = parseInt(resolutionData[0].winning_index)
          resolvedCount++
          totalResolvedPnL += realizedPnl
        } else {
          unresolvedCount++
          totalUnresolvedPnL += realizedPnl
        }
      }

      // Get cashflow and shares data
      const detailResult = await client.query({
        query: `
          SELECT
            SUM(cashflow_usdc) as total_cashflow,
            SUM(net_shares) as total_shares
          FROM (
            SELECT
              toFloat64(0) as cashflow_usdc,
              toFloat64(0) as net_shares
            FROM system.one
            LIMIT 0
          )
        `,
        format: 'JSONEachRow'
      })
      // Note: Above query is placeholder - need actual cashflow/shares tables

      const issue = !isResolved ? 'UNRESOLVED' : undefined

      traces.push({
        condition_id: conditionId,
        resolved: isResolved,
        winning_outcome: winningOutcome,
        realized_pnl: realizedPnl,
        cashflow_usdc: 0, // Placeholder
        net_shares: 0, // Placeholder
        payout: 0, // Placeholder
        issue
      })

      console.log(`   ${isResolved ? '✅' : '❌'} ${conditionId.substring(0, 16)}...`)
      console.log(`      P&L: $${(realizedPnl / 1000).toFixed(2)}K${issue ? ` (${issue})` : ''}`)
      if (isResolved && winningOutcome !== undefined) {
        console.log(`      Winner: Outcome ${winningOutcome}`)
      }
    }

    // Step 4: Summary and diagnosis
    console.log('\n' + '='.repeat(80))
    console.log('\nSTEP 4: Summary and Diagnosis\n')

    console.log(`Markets analyzed: ${resolvedCount + unresolvedCount}`)
    console.log(`  Resolved: ${resolvedCount} ($${(totalResolvedPnL / 1000).toFixed(1)}K P&L)`)
    console.log(`  Unresolved: ${unresolvedCount} ($${(totalUnresolvedPnL / 1000).toFixed(1)}K P&L)\n`)

    if (unresolvedCount > 0) {
      console.log('⚠️  **ISSUE FOUND: Unresolved markets contributing to P&L**')
      console.log(`   Unresolved P&L: $${(totalUnresolvedPnL / 1000).toFixed(1)}K`)
      console.log(`   This should be in unrealized P&L, not realized!\n`)

      const unresolvedPct = (totalUnresolvedPnL / (totalResolvedPnL + totalUnresolvedPnL)) * 100
      console.log(`   Unresolved markets account for ${unresolvedPct.toFixed(1)}% of total P&L`)
      console.log(`   If we exclude unresolved: $${(totalResolvedPnL / 1000).toFixed(1)}K (resolved only)\n`)
    }

    // Step 5: Check fee handling
    console.log('STEP 5: Check fee handling\n')

    const feesResult = await client.query({
      query: `
        SELECT
          COUNT(*) as fill_count,
          SUM(toFloat64(size)) as total_volume,
          SUM(toFloat64(size) * 0.002) as estimated_fees
        FROM clob_fills
        WHERE user_eoa = '${WALLET_TO_TRACE}'
      `,
      format: 'JSONEachRow'
    })
    const fees = await feesResult.json<any>()

    if (fees.length > 0 && fees[0].fill_count > 0) {
      const estimatedFees = parseFloat(fees[0].estimated_fees)
      console.log(`   Total fills: ${parseInt(fees[0].fill_count).toLocaleString()}`)
      console.log(`   Total volume: $${(parseFloat(fees[0].total_volume) / 1000000).toFixed(1)}M`)
      console.log(`   Estimated fees (0.2%): $${(estimatedFees / 1000).toFixed(1)}K`)
      console.log(`   Note: Fees should reduce P&L. Check if they're being deducted.\n`)
    }

    // Step 6: Check payout calculation
    console.log('STEP 6: Check payout calculation\n')

    console.log('   Binary markets should pay:')
    console.log('   - $1.00 per share for winning outcome')
    console.log('   - $0.00 per share for losing outcome')
    console.log('   Formula: net_shares_won * $1.00 - cashflow_spent\n')

    console.log('   ⚠️  Common mistakes:')
    console.log('   - Using gross shares instead of net shares')
    console.log('   - Not subtracting shares sold')
    console.log('   - Double-counting in aggregation\n')

    // Step 7: Hypotheses
    console.log('\n💡 HYPOTHESES FOR MAGNITUDE INFLATION\n')
    console.log('=' .repeat(80) + '\n')

    console.log('1. **Unresolved Markets Included** (PRIMARY SUSPECT)')
    console.log(`   - Found ${unresolvedCount} unresolved markets in P&L`)
    console.log('   - These should be unrealized, not realized')
    console.log(`   - Impact: +$${(totalUnresolvedPnL / 1000).toFixed(1)}K inflated P&L\n`)

    console.log('2. **Missing Fee Deductions**')
    console.log('   - If fees not being subtracted from P&L')
    console.log(`   - Estimated impact: -$${(parseFloat(fees[0]?.estimated_fees || '0') / 1000).toFixed(1)}K\n`)

    console.log('3. **Incorrect Payout Multiplier**')
    console.log('   - If using something other than $1.00 per share')
    console.log('   - Check: Are we applying market-specific payout vectors?\n')

    console.log('4. **Aggregation Double-Counting**')
    console.log('   - If fills being counted multiple times')
    console.log('   - Check: Compare distinct fills vs aggregated rows\n')

    // Save results
    const outputPath = 'tmp/magnitude_trace_data.json'
    writeFileSync(outputPath, JSON.stringify({
      wallet: WALLET_TO_TRACE,
      expected_pnl: EXPECTED_PNL,
      summary: {
        resolved_count: resolvedCount,
        unresolved_count: unresolvedCount,
        resolved_pnl: totalResolvedPnL,
        unresolved_pnl: totalUnresolvedPnL,
        estimated_fees: parseFloat(fees[0]?.estimated_fees || '0')
      },
      markets: traces
    }, null, 2))

    console.log(`✅ Raw data saved to: ${outputPath}\n`)

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }
  } finally {
    await client.close()
  }
}

traceWalletMagnitude()
