#!/usr/bin/env npx tsx

/**
 * DEEP DIVE: Offset Analysis
 *
 * The 5x settlement error suggests outcome_index → winning_index mapping is wrong.
 * This script analyzes one condition in detail to understand the offset pattern.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const WALLET_1 = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'

async function execute() {
  console.log('='.repeat(100))
  console.log('DEEP DIVE: Offset Analysis for Settlement Calculation')
  console.log('='.repeat(100))

  try {
    // Get one sample condition for Wallet 1 that is resolved
    console.log('\n[STEP 1] Find a sample resolved condition with trades for Wallet 1...')

    const sampleCondition = await (await clickhouse.query({
      query: `
        SELECT
          lower(replaceAll(tr.condition_id, '0x', '')) as condition_id,
          count() as trade_count,
          uniqExact(toInt16(tr.outcome_index)) as unique_outcome_indices,
          groupArray(distinct toInt16(tr.outcome_index)) as outcome_indices
        FROM trades_raw tr
        INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
        WHERE lower(tr.wallet_address) = '${WALLET_1.toLowerCase()}'
          AND mrf.winning_index IS NOT NULL
        GROUP BY condition_id
        ORDER BY trade_count DESC
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (sampleCondition.length === 0) {
      console.log('❌ No resolved conditions found for Wallet 1')
      process.exit(1)
    }

    const conditionId = sampleCondition[0].condition_id
    console.log(`✅ Sample condition: ${conditionId}`)
    console.log(`   Trades: ${sampleCondition[0].trade_count}`)
    console.log(`   Outcome indices in trades: ${sampleCondition[0].outcome_indices}`)

    // Get resolution data for this condition
    console.log('\n[STEP 2] Get market resolution data for this condition...')

    const resolutionData = await (await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          toInt16(winning_index) as win_idx,
          payout_numerators,
          payout_denominator,
          winning_outcome,
          outcome_count
        FROM market_resolutions_final
        WHERE condition_id_norm = '${conditionId}'
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (resolutionData.length === 0) {
      console.log('❌ No resolution data found')
      process.exit(1)
    }

    const res = resolutionData[0]
    console.log(`✅ Resolution data:`)
    console.log(`   Winning index: ${res.win_idx}`)
    console.log(`   Winning outcome: ${res.winning_outcome}`)
    console.log(`   Outcome count: ${res.outcome_count}`)
    console.log(`   Payout numerators: ${res.payout_numerators}`)
    console.log(`   Payout denominator: ${res.payout_denominator}`)

    // Get all trades for this condition for Wallet 1
    console.log('\n[STEP 3] Get all trades for this condition...')

    const trades = await (await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          entry_price,
          shares,
          side,
          fee_usd
        FROM trades_raw
        WHERE lower(wallet_address) = '${WALLET_1.toLowerCase()}'
          AND lower(replaceAll(condition_id, '0x', '')) = '${conditionId}'
        ORDER BY outcome_index
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`✅ Found ${trades.length} trades for this condition`)

    // Analyze the trades
    console.log('\n[STEP 4] Analyze trades and calculate winning shares...')
    console.log(`\nOutcome Index Analysis:`)

    const outcomeTrades = new Map<number, any[]>()
    for (const trade of trades) {
      const idx = parseInt(trade.outcome_index)
      if (!outcomeTrades.has(idx)) {
        outcomeTrades.set(idx, [])
      }
      outcomeTrades.get(idx)!.push(trade)
    }

    for (const [idx, tradesForIdx] of outcomeTrades.entries()) {
      const totalShares = tradesForIdx.reduce((sum, t) => sum + parseFloat(t.shares), 0)
      const cost = tradesForIdx.reduce((sum, t) => sum + parseFloat(t.entry_price) * parseFloat(t.shares), 0)
      const isWinning = idx === parseInt(res.win_idx)
      const isWinningWithOffset = idx === (parseInt(res.win_idx) + 1) || idx === (parseInt(res.win_idx) - 1)

      console.log(`  outcome_index=${idx}: ${totalShares.toFixed(0)} shares | Cost: $${cost.toFixed(2)} | ${isWinning ? '✅ DIRECT MATCH' : isWinningWithOffset ? '⚠️  OFFSET MATCH' : '❌ LOSING'}`)
    }

    // Calculate settlement with different offset hypotheses
    console.log('\n[STEP 5] Calculate settlement with different offset strategies...')

    const winningShares = outcomeTrades.get(parseInt(res.win_idx))?.reduce((sum, t) => sum + parseFloat(t.shares), 0) || 0
    const winningShares_Offset1 = outcomeTrades.get(parseInt(res.win_idx) + 1)?.reduce((sum, t) => sum + parseFloat(t.shares), 0) || 0
    const winningShares_Offset_1 = outcomeTrades.get(parseInt(res.win_idx) - 1)?.reduce((sum, t) => sum + parseFloat(t.shares), 0) || 0

    // ClickHouse arrays are 1-indexed, so add 1 to the winning_index
    const winIdx = parseInt(res.win_idx)
    const payoutNum = Array.isArray(res.payout_numerators)
      ? res.payout_numerators[winIdx] // array is 0-indexed in TypeScript
      : res.payout_numerators
    const payoutDenom = parseFloat(res.payout_denominator)

    console.log(`  Winning index: ${res.win_idx}`)
    console.log(`  Payout array: ${res.payout_numerators}`)
    console.log(`  Payout numerator at index [${winIdx}]: ${payoutNum} / ${payoutDenom}`)
    console.log(`\n  Settlement Hypothesis A (direct outcome_index = win_idx):`);
    console.log(`    Shares: ${winningShares.toFixed(0)}`)
    console.log(`    Settlement: $${(winningShares * payoutNum / payoutDenom).toFixed(2)}`)
    console.log(`\n  Settlement Hypothesis B (offset = +1):`);
    console.log(`    Shares: ${winningShares_Offset1.toFixed(0)}`)
    console.log(`    Settlement: $${(winningShares_Offset1 * payoutNum / payoutDenom).toFixed(2)}`)
    console.log(`\n  Settlement Hypothesis C (offset = -1):`);
    console.log(`    Shares: ${winningShares_Offset_1.toFixed(0)}`)
    console.log(`    Settlement: $${(winningShares_Offset_1 * payoutNum / payoutDenom).toFixed(2)}`)

    // Now check if summing ALL outcome_indices gives 5x
    console.log('\n[STEP 6] Check if problem is summing all outcomes...')

    let totalAllOutcomes = 0
    for (const [idx, tradesForIdx] of outcomeTrades.entries()) {
      const shares = tradesForIdx.reduce((sum, t) => sum + parseFloat(t.shares), 0)
      console.log(`  outcome_index=${idx}: ${shares.toFixed(0)} shares`)
      totalAllOutcomes += shares
    }

    console.log(`\n  Total shares across ALL outcomes: ${totalAllOutcomes.toFixed(0)}`)
    console.log(`  Winning shares (direct match): ${winningShares.toFixed(0)}`)
    console.log(`  Ratio: ${(totalAllOutcomes / (winningShares || 1)).toFixed(2)}x`)

    console.log('\n' + '='.repeat(100))
    console.log('HYPOTHESIS TESTING')
    console.log('='.repeat(100))

    if (Math.abs((totalAllOutcomes / (winningShares || 1)) - 5) < 0.5) {
      console.log('\n✅ ROOT CAUSE IDENTIFIED:')
      console.log('   Summing ALL outcome_indices (not filtering by winner)')
      console.log('   This explains the 5x error exactly')
      console.log('\n   FIX: Add WHERE clause to only sum winning shares')
    } else if (winningShares === 0 && (winningShares_Offset1 > 0 || winningShares_Offset_1 > 0)) {
      console.log('\n✅ ROOT CAUSE IDENTIFIED:')
      console.log('   Offset mismatch: Need to apply +1 or -1 to winning_index')
      console.log(`   Correct offset for this condition: ${winningShares_Offset1 > 0 ? '+1' : '-1'}`)
    } else {
      console.log('\n⚠️  Root cause unclear')
      console.log(`   Winning shares with direct match: ${winningShares}`)
      console.log(`   Winning shares with +1 offset: ${winningShares_Offset1}`)
      console.log(`   Winning shares with -1 offset: ${winningShares_Offset_1}`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
