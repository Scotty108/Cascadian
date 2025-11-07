#!/usr/bin/env npx tsx

/**
 * BACKFILL MISSING RESOLUTIONS
 *
 * Strategy: Fetch ALL conditions for wallets 2-4 from Polymarket API
 * For each condition, extract:
 * - condition_id (normalized)
 * - winning_index (from which token has winner=true)
 * - payout_numerators: Assume [1, 0] for binary markets (standard Polymarket)
 * - payout_denominator: 1
 *
 * Then INSERT into market_resolutions_final to backfill missing data
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import fetch from 'node-fetch'

const TEST_WALLETS = [
  { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', name: 'Wallet 2' },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', name: 'Wallet 3' },
  { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', name: 'Wallet 4' },
]

async function fetchConditionDataFromAPI(conditionId: string) {
  try {
    const endpoint = `https://clob.polymarket.com/markets?condition_id=${conditionId}`
    const response = await fetch(endpoint, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 5000,
    })

    if (response.ok) {
      const data = await response.json() as any
      return { success: true, data }
    }
    return { success: false, data: null }
  } catch (error) {
    return { success: false, data: null }
  }
}

function extractWinningIndex(tokens: any[]): number {
  // Find which token index is the winner
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].winner) {
      return i
    }
  }
  return -1
}

async function main() {
  console.log('='.repeat(100))
  console.log('BACKFILL MISSING RESOLUTIONS - Wallets 2-4')
  console.log('='.repeat(100))

  const collectionsToInsert = [] as any[]

  for (const wallet of TEST_WALLETS) {
    console.log(`\n\n📋 ${wallet.name}: ${wallet.addr.substring(0, 12)}...`)
    console.log('='.repeat(100))

    // Get ALL condition_ids for this wallet
    const conditions = await (await clickhouse.query({
      query: `
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_id
        FROM trades_raw
        WHERE lower(wallet_address) = '${wallet.addr.toLowerCase()}'
          AND condition_id != ''
        ORDER BY condition_id
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nFound ${conditions.length} total conditions for this wallet`)

    let foundInAPI = 0
    let alreadyInDB = 0
    let insertCount = 0

    for (const cond of conditions) {
      const condId = cond.condition_id

      // Check if already in market_resolutions_final
      const exists = await (await clickhouse.query({
        query: `
          SELECT COUNT(*) as count
          FROM market_resolutions_final
          WHERE condition_id_norm = '${condId}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      })).json() as any[]

      if (parseInt(exists[0].count) > 0) {
        alreadyInDB++
        continue
      }

      // Fetch from API
      const apiResult = await fetchConditionDataFromAPI(condId)

      if (apiResult.success && apiResult.data && Array.isArray(apiResult.data.data)) {
        const market = apiResult.data.data[0]

        if (market && Array.isArray(market.tokens)) {
          foundInAPI++

          // Extract data
          const winningIndex = extractWinningIndex(market.tokens)

          if (winningIndex >= 0) {
            // Standard binary market payout: [1, 0] / 1
            // Adjust based on actual token count
            const payoutNumerators = market.tokens.map((t: any, i: number) =>
              i === winningIndex ? 1 : 0
            )

            collectionsToInsert.push({
              condition_id_norm: condId,
              winning_index: winningIndex,
              payout_numerators: payoutNumerators,
              payout_denominator: 1,
              winning_outcome: market.tokens[winningIndex].outcome,
            })

            insertCount++
          }
        }
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 300))
    }

    console.log(`\n  Summary:`)
    console.log(`    Already in DB: ${alreadyInDB}`)
    console.log(`    Found on API: ${foundInAPI}`)
    console.log(`    Ready to insert: ${insertCount}`)
  }

  console.log('\n\n' + '='.repeat(100))
  console.log('INSERTION')
  console.log('='.repeat(100))

  if (collectionsToInsert.length === 0) {
    console.log('\n❌ No new records to insert')
    return
  }

  console.log(`\nInserting ${collectionsToInsert.length} records...`)

  // Build INSERT statement
  const values = collectionsToInsert.map(r => `
    ('${r.condition_id_norm}', ${r.winning_index}, [${r.payout_numerators.join(', ')}], ${r.payout_denominator}, '${r.winning_outcome}')
  `).join(',\n')

  const insertQuery = `
    INSERT INTO market_resolutions_final
    (condition_id_norm, winning_index, payout_numerators, payout_denominator, winning_outcome)
    VALUES
    ${values}
  `

  try {
    await clickhouse.command({
      query: insertQuery
    })

    console.log(`✅ Successfully inserted ${collectionsToInsert.length} records`)

    // Verify insertion
    const verification = await (await clickhouse.query({
      query: `
        SELECT COUNT(*) as count FROM market_resolutions_final
        WHERE winning_index IS NOT NULL
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nVerification: Total resolved conditions in DB: ${verification[0].count}`)
  } catch (error) {
    console.error('❌ Error inserting records:', error)
    process.exit(1)
  }

  console.log('\n\n' + '='.repeat(100))
  console.log('NEXT STEP')
  console.log('='.repeat(100))
  console.log(`
✅ Backfill complete!

Next: Re-run P&L calculation for wallets 2-4 with the new resolution data.
Expected: Wallets 2-4 should now show their P&L values ($360K, $94K, $12K)
  `)
}

main().catch(e => console.error('Error:', e))
