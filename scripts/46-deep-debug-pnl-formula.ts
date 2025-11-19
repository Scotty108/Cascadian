#!/usr/bin/env npx tsx

/**
 * DEEP DEBUG: Analyze P&L formula row-by-row for one wallet
 * Check payout calculation, fees, costs, and settlement values
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('DEEP DEBUG: P&L Formula Analysis for Wallet 3')
  console.log('='.repeat(100))

  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

  // Get first 10 trades for detailed analysis
  const query = `
    SELECT
      t.trade_id,
      t.condition_id,
      lower(replaceAll(t.condition_id, '0x', '')) as condition_norm,
      t.outcome_index,
      r.winning_index,
      CAST(t.shares AS Float64) as shares_f,
      CAST(t.entry_price AS Float64) as entry_price_f,
      CAST(t.fee_usd AS Float64) as fee_f,
      r.payout_numerators,
      r.payout_denominator,
      r.outcome_count,
      CASE
        WHEN outcome_index = r.winning_index
        THEN CAST(t.shares AS Float64) *
             (CAST(r.payout_numerators[outcome_index + 1] AS Float64) / CAST(r.payout_denominator AS Float64)) -
             (CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64)) -
             CAST(t.fee_usd AS Float64)
        ELSE -(CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64)) - CAST(t.fee_usd AS Float64)
      END as pnl_calculated,
      CASE
        WHEN outcome_index = r.winning_index THEN 'WIN'
        ELSE 'LOSS'
      END as trade_result
    FROM trades_raw t
    LEFT JOIN market_resolutions_final r ON
      lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    WHERE lower(t.wallet_address) = lower('${wallet}')
    ORDER BY t.timestamp
    LIMIT 10
  `

  try {
    const results = await (await clickhouse.query({
      query,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\n[WALLET] ${wallet}\n`)
    console.log(`First 10 trades for detailed analysis:\n`)

    let totalPNL = 0
    for (let i = 0; i < results.length; i++) {
      const row = results[i]
      const pnl = parseFloat(row.pnl_calculated) || 0
      totalPNL += pnl

      console.log(`[Trade ${i+1}] ${row.trade_id.substring(0, 16)}...`)
      console.log(`  Condition: ${row.condition_norm.substring(0, 16)}...`)
      console.log(`  Outcome index: ${row.outcome_index} | Winning index: ${row.winning_index} | Result: ${row.trade_result}`)
      console.log(`  Payout numerators: [${row.payout_numerators}]`)
      console.log(`  Payout denominator: ${row.payout_denominator} | Outcome count: ${row.outcome_count}`)
      console.log(`  Shares: ${row.shares_f} | Entry price: ${row.entry_price_f} | Fee: ${row.fee_f}`)

      if (row.trade_result === 'WIN') {
        const payout_factor = row.payout_numerators[row.outcome_index + 1] / row.payout_denominator
        const settlement = row.shares_f * payout_factor
        const cost = row.entry_price_f * row.shares_f
        console.log(`  Settlement: ${settlement.toFixed(2)} | Cost: ${cost.toFixed(2)} | Net: ${(settlement - cost - row.fee_f).toFixed(2)}`)
      } else {
        const cost = row.entry_price_f * row.shares_f
        console.log(`  Cost: ${cost.toFixed(2)} | Fee: ${row.fee_f.toFixed(6)} | Net: ${(-cost - row.fee_f).toFixed(2)}`)
      }

      console.log(`  PNL: $${pnl.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
      console.log()
    }

    console.log(`\n[SUMMARY] First 10 trades total PNL: $${totalPNL.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
    console.log(`Expected for all trades: $94,730.00`)

  } catch (e: any) {
    console.error('  ❌ Query failed:', e.message)
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
