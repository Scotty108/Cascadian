#!/usr/bin/env npx tsx

/**
 * VERIFY CONDITION ID GAP
 *
 * Check: Do the normalized condition IDs from Wallet 2-4 trades
 * actually exist in market_resolutions_final?
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('='.repeat(100))
  console.log('VERIFY CONDITION ID GAP')
  console.log('Do Wallets 2-4 condition IDs actually exist in resolutions table?')
  console.log('='.repeat(100))

  try {
    // Get unique normalized condition IDs from each wallet
    console.log('\n[STEP 1] Get unique normalized condition IDs per wallet')

    const conditionIds = await (await clickhouse.query({
      query: `
        SELECT DISTINCT
          t.wallet_address,
          lower(replaceAll(t.condition_id, '0x', '')) as normalized_id,
          COUNT() OVER (PARTITION BY t.wallet_address) as total_unique_conditions
        FROM trades_raw t
        WHERE t.wallet_address IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        LIMIT 100
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const walletGroups = new Map<string, string[]>()
    for (const row of conditionIds) {
      const wallet = row.wallet_address
      if (!walletGroups.has(wallet)) walletGroups.set(wallet, [])
      walletGroups.get(wallet)!.push(row.normalized_id)
    }

    console.log('\n  Condition IDs to check:')
    for (const [wallet, ids] of walletGroups) {
      console.log(`    ${wallet.substring(0, 12)}...: ${ids.length} unique conditions`)
    }

    // Check if each wallet's conditions exist in market_resolutions_final
    for (const [wallet, ids] of walletGroups) {
      if (ids.length === 0) continue

      const idList = ids.map(id => `'${id}'`).join(',')

      const result = await (await clickhouse.query({
        query: `
          SELECT
            COUNT() as total_to_check,
            countIf(condition_id_norm IN (${idList})) as found_in_resolutions,
            COUNT() - countIf(condition_id_norm IN (${idList})) as missing
          FROM market_resolutions_final
        `,
        format: 'JSONEachRow'
      })).json() as any[]

      const r = result[0]
      console.log(`\n  ${wallet.substring(0, 12)}...`)
      console.log(`    Checking for match in market_resolutions_final:`)
      console.log(`      Found: ${r.found_in_resolutions}`)
      console.log(`      Missing: ${r.missing}`)
    }

    // Get a sample missing ID and search for it
    console.log('\n[STEP 2] Deep dive: sample condition ID from Wallet 3')

    const sample = await (await clickhouse.query({
      query: `
        SELECT DISTINCT
          lower(replaceAll(t.condition_id, '0x', '')) as normalized_id
        FROM trades_raw t
        WHERE t.wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (sample.length > 0) {
      const sampleId = sample[0].normalized_id
      console.log(`\n  Sample condition ID: ${sampleId}`)

      // Try different variations to find it
      const variations = [
        sampleId,
        sampleId.toLowerCase(),
        sampleId.toUpperCase(),
        '0x' + sampleId,
        sampleId.padStart(64, '0'),
        sampleId.slice(0, 64),
      ]

      console.log(`\n  Searching for this ID in market_resolutions_final...`)

      for (const variation of variations) {
        const results = await (await clickhouse.query({
          query: `
            SELECT COUNT() as found
            FROM market_resolutions_final
            WHERE condition_id_norm = '${variation}'
            LIMIT 1
          `,
          format: 'JSONEachRow'
        })).json() as any[]

        const found = results[0]?.found || 0
        if (found > 0) {
          console.log(`  ✅ FOUND with variation: ${variation}`)
          break
        }
      }
    }

    console.log('\n' + '='.repeat(100))
    console.log('CONCLUSION')
    console.log('='.repeat(100))
    console.log(`\nThe issue is likely: Condition IDs from Wallets 2-4 don't exist in market_resolutions_final`)
    console.log('This could mean:')
    console.log('  1. These wallets traded on markets that never resolved')
    console.log('  2. The data was never backfilled for these wallets')
    console.log('  3. Their condition_id format is different from Wallet 1')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
