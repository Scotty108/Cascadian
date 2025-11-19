#!/usr/bin/env npx tsx
/**
 * PROOF TEST: Calculate P&L for 10 random wallets
 * Compare against Polymarket UI values
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function test() {
  console.log('='.repeat(100))
  console.log('PROOF TEST: P&L Calculation for 10 Random Wallets')
  console.log('Formula: payout_numerators[outcome_index] (CORRECTED)')
  console.log('='.repeat(100))

  try {
    // Get 10 random wallets with resolved trades
    const query = `
      WITH random_wallets AS (
        SELECT DISTINCT wallet_address
        FROM trades_raw
        WHERE wallet_address != ''
        ORDER BY rand()
        LIMIT 10
      )
      SELECT
        t.wallet_address,
        COUNT(*) as total_trades,
        SUM(CASE WHEN r.winning_index IS NOT NULL THEN 1 ELSE 0 END) as resolved_trades,
        ROUND(SUM(
          CASE
            WHEN r.winning_index IS NOT NULL AND t.outcome_index = r.winning_index
            THEN CAST(t.shares AS Float64) * 
                 (CAST(r.payout_numerators[t.outcome_index] AS Float64) / CAST(r.payout_denominator AS Float64)) - 
                 (CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64)) - 
                 CAST(COALESCE(t.fee_usd, 0) AS Float64)
            ELSE -(CAST(t.entry_price AS Float64) * CAST(t.shares AS Float64)) - CAST(COALESCE(t.fee_usd, 0) AS Float64)
          END
        ), 2) as calculated_pnl_usd
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.wallet_address IN (SELECT wallet_address FROM random_wallets)
      GROUP BY t.wallet_address
      ORDER BY ABS(calculated_pnl_usd) DESC;
    `

    const result = await clickhouse.query({
      query: query,
      format: 'JSONEachRow'
    })

    const rows = await result.json()

    console.log('\n📊 RESULTS: 10 Random Wallets P&L Calculation\n')
    console.log('Wallet Address                              | Total Trades | Resolved | Calculated P&L')
    console.log('-'.repeat(100))

    let count = 0
    for (const row of rows) {
      const wallet = row.wallet_address
      const totalTrades = row.total_trades
      const resolvedTrades = row.resolved_trades
      const pnl = parseFloat(row.calculated_pnl_usd)
      console.log(`${wallet.substring(0, 42)} | ${String(totalTrades).padStart(12)} | ${String(resolvedTrades).padStart(8)} | $${pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      count++
    }

    console.log('\n' + '='.repeat(100))
    console.log(`\n✅ Got ${count} wallets with calculated P&L`)
    console.log('\n📝 NEXT: Copy each wallet address and check against Polymarket UI\n')
    console.log('Link: https://polymarket.com (search each wallet in portfolio section)\n')
    console.log('If calculated P&L matches Polymarket UI within ±5%, system is CORRECT ✅')
    console.log('If not, formula needs adjustment ❌\n')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

test()
