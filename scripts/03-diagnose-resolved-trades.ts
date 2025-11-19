#!/usr/bin/env npx tsx

/**
 * Diagnose why 3/4 test wallets have 0 resolved trades
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('='.repeat(100))
  console.log('Diagnostic: Why 3/4 wallets have 0 resolved trades')
  console.log('='.repeat(100))

  try {
    const wallets = [
      '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
      '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
      '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
      '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
    ]

    for (const wallet of wallets) {
      console.log(`\n${'='.repeat(100)}`)
      console.log(`Wallet: ${wallet}`)
      console.log('='.repeat(100))

      // Check overall stats
      const stats = await (await clickhouse.query({
        query: `
          SELECT
            count() as total_trades,
            countIf(is_resolved = 1) as resolved,
            countIf(is_resolved = 0) as unresolved,
            countIf(is_resolved IS NULL) as null_resolved,
            min(timestamp) as earliest_trade,
            max(timestamp) as latest_trade,
            uniqExact(condition_id) as unique_conditions,
            countIf(resolved_outcome IS NOT NULL) as with_outcome
          FROM trades_raw
          WHERE lower(wallet_address) = '${wallet.toLowerCase()}'
        `,
        format: 'JSONEachRow'
      })).json() as any[]

      if (stats[0]) {
        const s = stats[0]
        console.log(`\nOverall Stats:`)
        console.log(`  Total trades: ${s.total_trades}`)
        console.log(`  Resolved: ${s.resolved}`)
        console.log(`  Unresolved: ${s.unresolved}`)
        console.log(`  NULL resolved: ${s.null_resolved}`)
        console.log(`  Date range: ${s.earliest_trade} → ${s.latest_trade}`)
        console.log(`  Unique conditions: ${s.unique_conditions}`)
        console.log(`  With outcome label: ${s.with_outcome}`)
      }

      // Check if conditions exist in market_resolutions_final
      const conditions = await (await clickhouse.query({
        query: `
          SELECT count(distinct tr.cond_norm) as traded_conditions,
                 count(distinct mrf.condition_id_norm) as resolved_conditions
          FROM (
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cond_norm
            FROM trades_raw
            WHERE lower(wallet_address) = '${wallet.toLowerCase()}'
          ) tr
          LEFT JOIN market_resolutions_final mrf ON tr.cond_norm = mrf.condition_id_norm
        `,
        format: 'JSONEachRow'
      })).json() as any[]

      if (conditions[0]) {
        console.log(`\nCondition Resolution:`)
        console.log(`  Conditions traded: ${conditions[0].traded_conditions}`)
        console.log(`  Conditions resolved: ${conditions[0].resolved_conditions}`)
        const pct = conditions[0].resolved_conditions > 0 ? ((conditions[0].resolved_conditions / conditions[0].traded_conditions) * 100).toFixed(1) : '0'
        console.log(`  Coverage: ${pct}%`)
      }

      // Sample recent trades
      const recent = await (await clickhouse.query({
        query: `
          SELECT
            timestamp,
            condition_id,
            side,
            entry_price,
            shares,
            is_resolved,
            resolved_outcome,
            outcome_index
          FROM trades_raw
          WHERE lower(wallet_address) = '${wallet.toLowerCase()}'
          ORDER BY timestamp DESC
          LIMIT 5
        `,
        format: 'JSONEachRow'
      })).json() as any[]

      if (recent.length > 0) {
        console.log(`\nMost Recent 5 Trades:`)
        recent.forEach((tr, i) => {
          console.log(`  [${i+1}] ${tr.timestamp} | ${tr.condition_id?.substring(0, 16)}...`)
          console.log(`      Side: ${tr.side === 1 ? 'YES' : 'NO'} | Price: $${tr.entry_price} | Shares: ${tr.shares}`)
          console.log(`      Resolved: ${tr.is_resolved} | Outcome: ${tr.resolved_outcome}`)
        })
      }
    }

    console.log('\n' + '='.repeat(100))
    console.log('SUMMARY')
    console.log('='.repeat(100))
    console.log('\nKey Finding: Check if these wallets have traded positions that are still OPEN')
    console.log('(not yet resolved on Polymarket). If most markets have not resolved yet, that')
    console.log('explains why is_resolved=0 for most trades.')
    console.log('\nAlternative: If conditions ARE resolved but is_resolved field is not set,')
    console.log('we need to use market_resolutions_final as authoritative source instead.')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
