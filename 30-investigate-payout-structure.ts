#!/usr/bin/env npx tsx

/**
 * INVESTIGATE PAYOUT STRUCTURE
 *
 * The backfill with [1, 0] / 1 payout assumption gave us:
 * - Wallet 3: $2,103.68 actual vs $94,730 expected (2.22% of expected)
 * - Wallet 4: $159 actual vs $12,171 expected (1.31% of expected)
 *
 * This suggests the payout structure is fundamentally different.
 * Possibilities:
 * 1. 3+ outcome markets (not binary)
 * 2. Custom payout vectors (like [100, 0] / 100 instead of [1, 0] / 1)
 * 3. winning_index doesn't map to the right position
 *
 * Let's check what we inserted vs. what might be correct
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('INVESTIGATE PAYOUT STRUCTURE')
  console.log('='.repeat(100))

  // Sample from Wallet 3's trades
  console.log('\n\nWallet 3 Sample Analysis')
  console.log('='.repeat(100))

  const wallet3Sample = await (await clickhouse.query({
    query: `
      SELECT
        tr.condition_id,
        tr.outcome_index,
        COUNT(*) as trade_count,
        SUM(CASE WHEN tr.outcome_index = 0 THEN tr.shares ELSE 0 END) as shares_outcome_0,
        SUM(CASE WHEN tr.outcome_index = 1 THEN tr.shares ELSE 0 END) as shares_outcome_1,
        SUM(CASE WHEN tr.outcome_index = 2 THEN tr.shares ELSE 0 END) as shares_outcome_2,
        SUM(CASE WHEN tr.outcome_index = 3 THEN tr.shares ELSE 0 END) as shares_outcome_3,
        mrf.winning_index,
        mrf.payout_numerators,
        mrf.payout_denominator
      FROM trades_raw tr
      LEFT JOIN market_resolutions_final mrf ON
        toString(lower(replaceAll(tr.condition_id, '0x', ''))) = toString(mrf.condition_id_norm)
      WHERE lower(tr.wallet_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      GROUP BY tr.condition_id, tr.outcome_index, mrf.winning_index, mrf.payout_numerators, mrf.payout_denominator
      ORDER BY trade_count DESC
      LIMIT 20
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  console.log('\nTop 20 by trade count:')
  console.log('Cond_ID | Outcome | Count | Shares | Win_Idx | Payout')
  console.log('-'.repeat(80))

  for (const row of wallet3Sample) {
    const condId = (row.condition_id || '').toString().substring(0, 12)
    const shares = (row.shares_outcome_0 || 0) + (row.shares_outcome_1 || 0) + (row.shares_outcome_2 || 0) + (row.shares_outcome_3 || 0)
    console.log(`${condId}... | ${row.outcome_index} | ${row.trade_count} | ${shares.toFixed(0)} | ${row.winning_index} | ${JSON.stringify(row.payout_numerators)} / ${row.payout_denominator}`)
  }

  // Check outcome count per market
  console.log('\n\nOutcome Count Analysis for Wallet 3')
  console.log('='.repeat(100))

  const outcomeCount = await (await clickhouse.query({
    query: `
      SELECT
        lower(replaceAll(tr.condition_id, '0x', '')) as condition_id,
        COUNT(DISTINCT tr.outcome_index) as outcome_count,
        MAX(tr.outcome_index) as max_outcome_index,
        COUNT(*) as total_trades
      FROM trades_raw tr
      WHERE lower(tr.wallet_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      GROUP BY condition_id
      ORDER BY total_trades DESC
      LIMIT 10
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  console.log('\nOutcome counts for top 10 conditions:')
  let binary = 0, ternary = 0, quaternary = 0, other = 0

  for (const row of outcomeCount) {
    const count = row.outcome_count
    if (count === 2) binary++
    else if (count === 3) ternary++
    else if (count === 4) quaternary++
    else other++

    console.log(`${row.condition_id.substring(0, 16)}... | Outcomes: ${count} | Max_Index: ${row.max_outcome_index} | Trades: ${row.total_trades}`)
  }

  console.log(`\nOutcome distribution (top 10): Binary: ${binary}, Ternary: ${ternary}, Quaternary: ${quaternary}, Other: ${other}`)

  // Check if there's a pattern in the payout values we inserted
  console.log('\n\nPayout Vectors in market_resolutions_final')
  console.log('='.repeat(100))

  const payoutSamples = await (await clickhouse.query({
    query: `
      SELECT
        payout_numerators,
        payout_denominator,
        COUNT(*) as count
      FROM market_resolutions_final
      WHERE condition_id_norm IN (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
        FROM trades_raw
        WHERE lower(wallet_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      )
      GROUP BY payout_numerators, payout_denominator
      ORDER BY count DESC
      LIMIT 10
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  console.log('\nPayout structures found in Wallet 3\'s conditions:')
  for (const row of payoutSamples) {
    console.log(`  ${JSON.stringify(row.payout_numerators)} / ${row.payout_denominator} (${row.count} markets)`)
  }

  // Compare expected vs actual settlement
  console.log('\n\nSettlement Comparison')
  console.log('='.repeat(100))

  const settlement = await (await clickhouse.query({
    query: `
      WITH trade_details AS (
        SELECT
          lower(tr.wallet_address) as wallet,
          lower(replaceAll(tr.condition_id, '0x', '')) as condition_id,
          toInt16(tr.outcome_index) as outcome_idx,
          toFloat64(tr.shares) as shares,
          toFloat64(tr.entry_price) as entry_price
        FROM trades_raw tr
        WHERE lower(tr.wallet_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      ),
      with_resolution AS (
        SELECT
          td.wallet,
          td.condition_id,
          td.outcome_idx,
          td.shares,
          td.entry_price,
          mrf.winning_index as win_idx,
          mrf.payout_numerators,
          mrf.payout_denominator,
          arrayLength(mrf.payout_numerators) as num_outcomes
        FROM trade_details td
        INNER JOIN market_resolutions_final mrf ON
          toString(lower(td.condition_id)) = toString(mrf.condition_id_norm)
      )
      SELECT
        condition_id,
        num_outcomes,
        sum(if(outcome_idx = win_idx, shares, 0)) as winning_shares,
        arrayElement(payout_numerators, win_idx + 1) as payout_for_winner,
        payout_denominator,
        sum(if(outcome_idx = win_idx, shares, 0)) * arrayElement(payout_numerators, win_idx + 1) / payout_denominator as settlement_with_current,
        sum(shares) as total_shares
      FROM with_resolution
      GROUP BY condition_id, num_outcomes, payout_numerators, payout_denominator
      ORDER BY winning_shares DESC
      LIMIT 5
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  console.log('\nTop 5 conditions by winning shares:')
  console.log('Cond_ID | Outcomes | Win_Shares | Payout | Denom | Settlement | Total_Shares')
  for (const row of settlement) {
    const condId = row.condition_id.substring(0, 12)
    console.log(`${condId}... | ${row.num_outcomes} | ${row.winning_shares.toFixed(0)} | ${row.payout_for_winner} | ${row.payout_denominator} | ${row.settlement_with_current.toFixed(2)} | ${row.total_shares.toFixed(0)}`)
  }

  console.log('\n\n' + '='.repeat(100))
  console.log('HYPOTHESIS')
  console.log('='.repeat(100))
  console.log(`
The [1, 0] / 1 payout structure we used may be too simplistic.

Polymarket standard payout structures:
1. Binary (2 outcomes): [1, 0] / 1 (winner gets $1 per share)
2. Ternary (3 outcomes): [1, 0, 0] / 1
3. Custom: Can be anything, but often [100, 0] or similar

Possibility: The actual payout vectors might be:
- [100, 0] / 100 (so winner gets $1 per share, but denominator is 100)
- OR different payout structures per market

Next: Query Polymarket API again but this time look for payout data in the market structure
(may be in clob_tokens or orderbook data)
  `)
}

main().catch(e => console.error('Error:', e))
