#!/usr/bin/env npx tsx

/**
 * CHECK IF WALLETS WON OR LOST
 *
 * Key Question: Did wallets 2-4 actually WIN their trades?
 *
 * Hypothesis: These wallets may have mostly LOST positions
 * - They bought outcome_index=1 (YES) but market resolved to outcome_index=0 (NO)
 * - Result: $0 settlement on losing outcomes
 *
 * If this is true, showing $0 P&L might actually be CORRECT!
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = [
  { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', name: 'Wallet 2' },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', name: 'Wallet 3' },
  { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', name: 'Wallet 4' },
]

async function main() {
  console.log('='.repeat(100))
  console.log('CHECK IF WALLETS WON OR LOST - Key Insight')
  console.log('='.repeat(100))

  for (const wallet of TEST_WALLETS) {
    console.log(`\n\n${wallet.name}: ${wallet.addr.substring(0, 12)}...`)
    console.log('='.repeat(100))

    // For each condition, show:
    // - What outcome_indexes the wallet traded
    // - What the winning_index is
    // - Did they win or lose?

    const analysis = await (await clickhouse.query({
      query: `
        SELECT
          lower(replaceAll(tr.condition_id, '0x', '')) as condition_id,
          COUNT(*) as trade_count,
          SUM(tr.shares) as total_shares,
          groupUniqArray(tr.outcome_index) as traded_outcomes,
          mrf.winning_index as market_winner,
          mrf.payout_numerators,
          CASE
            WHEN mrf.winning_index IS NULL THEN 'UNRESOLVED'
            WHEN arrayExists(x -> x = mrf.winning_index, groupUniqArray(toInt16(tr.outcome_index))) THEN 'WON'
            ELSE 'LOST'
          END as result
        FROM trades_raw tr
        LEFT JOIN market_resolutions_final mrf ON
          toString(lower(replaceAll(tr.condition_id, '0x', ''))) = toString(mrf.condition_id_norm)
        WHERE lower(tr.wallet_address) = '${wallet.addr.toLowerCase()}'
          AND tr.condition_id != ''
        GROUP BY condition_id, mrf.winning_index, mrf.payout_numerators
        ORDER BY trade_count DESC
        LIMIT 20
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    console.log('\nTop 20 conditions:')
    console.log('Condition_ID      | Trades | Shares | Outcomes Traded | Winner | Result | Payout')
    console.log('-'.repeat(100))

    let wonCount = 0
    let lostCount = 0
    let unresolvedCount = 0

    for (const row of analysis) {
      const condId = row.condition_id.substring(0, 16)
      const outcomes = JSON.stringify(row.traded_outcomes).padEnd(16)
      const winner = row.market_winner ?? '-'
      const result = row.result
      const payout = JSON.stringify(row.payout_numerators).substring(0, 10)

      console.log(`${condId} | ${row.trade_count.toString().padStart(6)} | ${row.total_shares.toFixed(0).padStart(6)} | ${outcomes} | ${winner.toString().padStart(6)} | ${result.padEnd(9)} | ${payout}`)

      if (result === 'WON') wonCount++
      else if (result === 'LOST') lostCount++
      else unresolvedCount++
    }

    console.log('\n' + '-'.repeat(100))
    console.log(`Results (top 20): WON: ${wonCount}, LOST: ${lostCount}, UNRESOLVED: ${unresolvedCount}`)

    // Get total stats
    const totalStats = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(DISTINCT tr.condition_id) as total_conditions,
          SUM(CASE WHEN mrf.winning_index IS NULL THEN 1 ELSE 0 END) as unresolved,
          SUM(CASE WHEN mrf.winning_index IS NOT NULL AND arrayExists(x -> x = mrf.winning_index, [toInt16(tr.outcome_index)]) THEN 1 ELSE 0 END) as won_conditions,
          SUM(CASE WHEN mrf.winning_index IS NOT NULL AND NOT arrayExists(x -> x = mrf.winning_index, [toInt16(tr.outcome_index)]) THEN 1 ELSE 0 END) as lost_conditions
        FROM trades_raw tr
        LEFT JOIN market_resolutions_final mrf ON
          toString(lower(replaceAll(tr.condition_id, '0x', ''))) = toString(mrf.condition_id_norm)
        WHERE lower(tr.wallet_address) = '${wallet.addr.toLowerCase()}'
          AND tr.condition_id != ''
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const stats = totalStats[0]
    console.log(`\nTotal Statistics:`)
    console.log(`  Total Conditions: ${stats.total_conditions}`)
    console.log(`  Won: ${stats.won_conditions} (${((stats.won_conditions / (stats.total_conditions - stats.unresolved)) * 100).toFixed(1)}% of resolved)`)
    console.log(`  Lost: ${stats.lost_conditions} (${((stats.lost_conditions / (stats.total_conditions - stats.unresolved)) * 100).toFixed(1)}% of resolved)`)
    console.log(`  Unresolved: ${stats.unresolved}`)
  }

  console.log('\n\n' + '='.repeat(100))
  console.log('KEY INSIGHT')
  console.log('='.repeat(100))
  console.log(`
If wallets 2-4 have a HIGH LOSS RATE:
  → Their $0 (or near-$0) P&L might actually be CORRECT
  → The Polymarket UI might be showing something different (mark-to-market, unrealized P&L, etc.)
  → OR the Polymarket UI calculation method is different from ours

If wallets 2-4 have a HIGH WIN RATE:
  → They should have substantial positive P&L
  → The empty/zero payout data we inserted is the problem
  → We need to find the correct payout vectors from another source
  `)
}

main().catch(e => console.error('Error:', e))
