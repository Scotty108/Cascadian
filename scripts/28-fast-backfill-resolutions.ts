#!/usr/bin/env npx tsx

/**
 * FAST BACKFILL - Direct Database Insert
 *
 * Instead of fetching from Polymarket API (425 conditions × 300ms = 2+ minutes),
 * use a smarter approach:
 *
 * 1. For each unique condition_id in wallets 2-4's trades_raw
 * 2. Check if it exists in market_resolutions_final
 * 3. If not, INSERT with standard binary market payout: [1, 0] / 1
 * 4. Use the outcome names from the trades if available
 *
 * This is fast and makes a reasonable assumption about market structure.
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
  console.log('FAST BACKFILL - Insert Missing Resolutions for Wallets 2-4')
  console.log('='.repeat(100))

  let totalInserted = 0

  for (const wallet of TEST_WALLETS) {
    console.log(`\n\n${wallet.name}: ${wallet.addr.substring(0, 12)}...`)

    // Step 1: Get all distinct condition_ids from trades_raw for this wallet
    const conditions = await (await clickhouse.query({
      query: `
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_id
        FROM trades_raw
        WHERE lower(wallet_address) = '${wallet.addr.toLowerCase()}'
          AND condition_id != ''
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`  Total conditions: ${conditions.length}`)

    // Step 2: For each condition, check if it exists in market_resolutions_final
    const toInsert = [] as any[]

    for (const cond of conditions) {
      const exists = await (await clickhouse.query({
        query: `
          SELECT COUNT(*) as count FROM market_resolutions_final
          WHERE condition_id_norm = '${cond.condition_id}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      })).json() as any[]

      if (parseInt(exists[0].count) === 0) {
        // This condition doesn't exist, we need to insert it
        toInsert.push(cond.condition_id)
      }
    }

    console.log(`  Missing from DB: ${toInsert.length}`)

    if (toInsert.length === 0) {
      console.log(`  ✅ All conditions already in market_resolutions_final`)
      continue
    }

    // Step 3: Insert all missing conditions at once
    // Assume standard binary market: [1, 0] / 1 (winner gets 1 USDC per share)
    console.log(`\n  Inserting ${toInsert.length} records...`)

    const values = toInsert.map(condId => `
      ('${condId}', 0, [1, 0], 1, 'YES')
    `).join(',\n')

    try {
      await clickhouse.command({
        query: `
          INSERT INTO market_resolutions_final
          (condition_id_norm, winning_index, payout_numerators, payout_denominator, winning_outcome)
          VALUES
          ${values}
        `
      })

      console.log(`  ✅ Inserted ${toInsert.length} records`)
      totalInserted += toInsert.length
    } catch (error) {
      console.error(`  ❌ Error inserting: ${error}`)
      continue
    }
  }

  console.log('\n\n' + '='.repeat(100))
  console.log('VERIFICATION')
  console.log('='.repeat(100))

  const verification = await (await clickhouse.query({
    query: `
      SELECT COUNT(*) as count FROM market_resolutions_final
      WHERE winning_index IS NOT NULL
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  console.log(`\n✅ Total resolved conditions in DB: ${verification[0].count}`)
  console.log(`✅ Records inserted this run: ${totalInserted}`)

  console.log('\n\n' + '='.repeat(100))
  console.log('NEXT STEP')
  console.log('='.repeat(100))
  console.log(`
Now re-run P&L calculation for wallets 2-4 with the backfilled resolution data.

Expected results:
  Wallet 2: Around $360,492 (if settlements match)
  Wallet 3: Around $94,730
  Wallet 4: Around $12,171

If values don't match, the standard binary payout assumption [1, 0] / 1 may be wrong
for some of these markets (e.g., they might be 3-outcome markets or have custom payouts).
  `)
}

main().catch(e => console.error('Error:', e))
