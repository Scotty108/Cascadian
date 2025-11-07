#!/usr/bin/env npx tsx

/**
 * DEBUG: Investigate what condition_ids were recovered and what they match to
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('DEBUG: Recovered Condition IDs Analysis')
  console.log('='.repeat(100))

  // Check what condition_ids we recovered for Wallet 2
  console.log('\n[STEP 1] Sample recovered condition_ids for Wallet 2...')

  const wallet2_sample = await (await clickhouse.query({
    query: `
      SELECT
        trade_id,
        transaction_hash,
        condition_id,
        outcome_index,
        shares,
        entry_price,
        fee_usd,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
      FROM trades_raw
      WHERE lower(wallet_address) = '0x8e9eedf20dfa70956d49f608a205e402d9df38e4'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  console.log(`Found ${wallet2_sample.length} sample trades for Wallet 2:`)
  for (const row of wallet2_sample) {
    const hasId = row.condition_id && row.condition_id !== '' ? '✅' : '❌'
    console.log(`  ${hasId} condition_id: ${row.condition_id || '(empty)'} | outcome_index: ${row.outcome_index}`)
  }

  // Check what resolutions match
  console.log('\n[STEP 2] Check if recovered condition_ids match in market_resolutions_final...')

  for (const row of wallet2_sample) {
    if (row.condition_id && row.condition_id !== '') {
      const cond_norm = row.condition_id_norm
      const resolution = await (await clickhouse.query({
        query: `
          SELECT
            condition_id_norm,
            winning_index,
            payout_numerators,
            payout_denominator,
            outcome_count
          FROM market_resolutions_final
          WHERE condition_id_norm = '${cond_norm}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      })).json() as any[]

      if (resolution.length > 0) {
        const r = resolution[0]
        console.log(`\n  ✅ Wallet2 trade matched to resolution:`)
        console.log(`     condition_id_norm: ${r.condition_id_norm}`)
        console.log(`     winning_index: ${r.winning_index}`)
        console.log(`     payout_numerators: [${r.payout_numerators}]`)
        console.log(`     payout_denominator: ${r.payout_denominator}`)
        console.log(`     outcome_count: ${r.outcome_count}`)
        console.log(`     Trade outcome_index: ${row.outcome_index}`)

        // Calculate what the P&L should be
        if (row.outcome_index === parseInt(r.winning_index)) {
          const payout = r.payout_numerators[parseInt(row.outcome_index) + 1] / r.payout_denominator
          const settlement = row.shares * payout
          const cost = row.entry_price * row.shares
          const pnl = settlement - cost - row.fee_usd
          console.log(`     This trade WON: settlement=${settlement.toFixed(2)}, cost=${cost.toFixed(2)}, pnl=${pnl.toFixed(2)}`)
        } else {
          const cost = row.entry_price * row.shares
          const pnl = -cost - row.fee_usd
          console.log(`     This trade LOST: cost=${cost.toFixed(2)}, pnl=${pnl.toFixed(2)}`)
        }
      } else {
        console.log(`\n  ❌ condition_id_norm '${cond_norm}' NOT FOUND in market_resolutions_final`)
      }
    }
  }

  // Check Wallet 3
  console.log('\n\n[STEP 3] Sample for Wallet 3...')

  const wallet3_ids = await (await clickhouse.query({
    query: `
      SELECT
        condition_id,
        COUNT(*) as cnt,
        SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as with_ids
      FROM trades_raw
      WHERE lower(wallet_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      GROUP BY condition_id
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  console.log(`Top condition_ids for Wallet 3:`)
  for (const row of wallet3_ids) {
    console.log(`  condition_id: ${row.condition_id || '(empty)'} → ${row.cnt} trades`)
  }

  // Check condition_id format in recovered data
  console.log('\n\n[STEP 4] Condition ID format check...')

  const format_check = await (await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN condition_id LIKE '0x%' THEN 'Has 0x prefix'
          WHEN condition_id LIKE '%[A-F]%' THEN 'Has uppercase'
          ELSE 'Lowercase, no prefix'
        END as format,
        COUNT(*) as cnt
      FROM trades_raw
      WHERE condition_id != ''
      GROUP BY format
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  console.log('Condition ID formats:')
  for (const row of format_check) {
    console.log(`  ${row.format}: ${row.cnt} trades`)
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
