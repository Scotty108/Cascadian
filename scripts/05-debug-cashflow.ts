#!/usr/bin/env npx tsx

/**
 * DEBUG: Understand why cashflow is massively negative
 * Wallet 1 shows -$1.5M instead of +$137K
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  const wallet = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'

  console.log('='.repeat(100))
  console.log(`Cashflow Debug for ${wallet}`)
  console.log('='.repeat(100))

  try {
    // Get basic stats
    console.log('\n[1] Basic trade stats...')
    const stats = await (await clickhouse.query({
      query: `
        SELECT
          count() as total_trades,
          countIf(side = 1) as side_yes,
          countIf(side = 2) as side_no,
          sum(toFloat64(entry_price) * toFloat64(shares)) as total_notional,
          sum(if(side = 1, toFloat64(entry_price) * toFloat64(shares), 0)) as yes_notional,
          sum(if(side = 2, toFloat64(entry_price) * toFloat64(shares), 0)) as no_notional
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (stats[0]) {
      console.log(`Total trades: ${stats[0].total_trades}`)
      console.log(`Side YES: ${stats[0].side_yes}`)
      console.log(`Side NO: ${stats[0].side_no}`)
      console.log(`Total notional: $${parseFloat(stats[0].total_notional).toFixed(2)}`)
      console.log(`YES notional: $${parseFloat(stats[0].yes_notional).toFixed(2)}`)
      console.log(`NO notional: $${parseFloat(stats[0].no_notional).toFixed(2)}`)
    }

    // Test cashflow formula
    console.log('\n[2] Cashflow calculation test (all resolved trades)...')
    const cashflow1 = await (await clickhouse.query({
      query: `
        SELECT
          lower(tr.wallet_address) as wallet,
          round(sum(if(tr.side = 1, -toFloat64(tr.entry_price) * toFloat64(tr.shares), toFloat64(tr.entry_price) * toFloat64(tr.shares))), 2) as signed_cashflow,
          round(sum(if(tr.side = 1, toFloat64(tr.entry_price) * toFloat64(tr.shares), 0)), 2) as yes_cost,
          round(sum(if(tr.side = 2, toFloat64(tr.entry_price) * toFloat64(tr.shares), 0)), 2) as no_revenue
        FROM (
          SELECT lower(wallet_address) as wallet_address, condition_id, side, entry_price, shares
          FROM trades_raw
          WHERE lower(wallet_address) = lower('${wallet}')
        ) tr
        INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
        GROUP BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (cashflow1[0]) {
      console.log(`Signed cashflow: $${cashflow1[0].signed_cashflow}`)
      console.log(`YES cost (spent): $${cashflow1[0].yes_cost}`)
      console.log(`NO revenue (received): $${cashflow1[0].no_revenue}`)
      console.log(`Net: $${cashflow1[0].no_revenue} - $${cashflow1[0].yes_cost} = ${parseFloat(cashflow1[0].no_revenue) - parseFloat(cashflow1[0].yes_cost)}`)
    }

    // Sample resolved trades
    console.log('\n[3] Sample of resolved trades (first 5)...')
    const sample = await (await clickhouse.query({
      query: `
        SELECT
          tr.timestamp,
          tr.side,
          tr.entry_price,
          tr.shares,
          mrf.winning_index,
          tr.condition_id
        FROM (
          SELECT timestamp, condition_id, side, entry_price, shares
          FROM trades_raw
          WHERE lower(wallet_address) = lower('${wallet}')
        ) tr
        INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('Sample trades:')
    for (const row of sample) {
      const cf = row.side === 1 ? -parseFloat(row.entry_price) * parseFloat(row.shares) : parseFloat(row.entry_price) * parseFloat(row.shares)
      console.log(`  ${row.timestamp} | Side: ${row.side === 1 ? 'YES' : 'NO '} | Price: $${row.entry_price} | Shares: ${row.shares} | Cashflow: $${cf.toFixed(2)}`)
    }

    // Check if side direction is backwards
    console.log('\n[4] Test INVERTED cashflow formula...')
    const cashflow2 = await (await clickhouse.query({
      query: `
        SELECT
          lower(tr.wallet_address) as wallet,
          round(sum(if(tr.side = 1, toFloat64(tr.entry_price) * toFloat64(tr.shares), -toFloat64(tr.entry_price) * toFloat64(tr.shares))), 2) as inverted_cashflow
        FROM (
          SELECT lower(wallet_address) as wallet_address, condition_id, side, entry_price, shares
          FROM trades_raw
          WHERE lower(wallet_address) = lower('${wallet}')
        ) tr
        INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
        GROUP BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (cashflow2[0]) {
      console.log(`Inverted cashflow: $${cashflow2[0].inverted_cashflow}`)
      console.log(`(This would be: YES=+revenue, NO=-cost instead of YES=-cost, NO=+revenue)`)
    }

    // Check settlement component - simpler version
    console.log('\n[5] Settlement component check...')
    const settlement = await (await clickhouse.query({
      query: `
        SELECT
          count() as total_resolved_positions,
          round(sum(if(outcome_index = win_idx, toFloat64(shares), 0)), 2) as winning_shares
        FROM (
          SELECT tr.outcome_index, w.win_idx, tr.shares
          FROM (
            SELECT condition_id, outcome_index, shares FROM trades_raw
            WHERE lower(wallet_address) = lower('${wallet}')
          ) tr
          INNER JOIN market_resolutions_final mrf ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
          INNER JOIN (
            SELECT condition_id_norm, toInt16(winning_index) as win_idx
            FROM market_resolutions_final
          ) w ON mrf.condition_id_norm = w.condition_id_norm
        )
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (settlement[0]) {
      console.log(`Total resolved positions: ${settlement[0].total_resolved_positions}`)
      console.log(`Winning shares (without offset): ${settlement[0].winning_shares}`)
    }

    console.log('\n' + '='.repeat(100))
    console.log('DIAGNOSIS')
    console.log('='.repeat(100))
    console.log('\nUI expects: +$137,663')
    console.log('We calculated: -$1,499,037.51')
    console.log('\nPossible issues:')
    console.log('1. Cashflow sign is inverted (YES should be +, NO should be -)')
    console.log('2. Settlement component not being included')
    console.log('3. Offset detection failing (using wrong outcome_idx)')
    console.log('4. Some trades should not be counted (filter issue)')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
