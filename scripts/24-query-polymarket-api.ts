#!/usr/bin/env npx tsx

/**
 * POLYMARKET API QUERY - Find Missing Resolution Data
 *
 * Strategy: Since wallets 2-4's condition_ids don't exist in market_resolutions_final,
 * query the Polymarket API directly to find the resolution data for those conditions.
 *
 * API docs: https://docs.polymarket.com/
 * Market endpoint: GET /markets/{conditionId}
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import fetch from 'node-fetch'

const TEST_WALLETS = [
  { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', name: 'Wallet 2', expected: 360492 },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', name: 'Wallet 3', expected: 94730 },
  { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', name: 'Wallet 4', expected: 12171 },
]

async function queryPolymarketAPI(conditionId: string) {
  try {
    // Try multiple API endpoints
    const endpoints = [
      `https://clob.polymarket.com/markets?condition_id=${conditionId}`,
      `https://api.polymarket.com/markets?condition_id=${conditionId}`,
      `https://polymarket.com/api/markets?condition_id=${conditionId}`,
    ]

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 5000,
        })

        if (response.ok) {
          const data = await response.json() as any
          return { success: true, endpoint, data }
        }
      } catch (e) {
        // Try next endpoint
      }
    }

    return { success: false, endpoint: null, data: null }
  } catch (error) {
    return { success: false, endpoint: null, data: null, error: error }
  }
}

async function main() {
  console.log('='.repeat(100))
  console.log('POLYMARKET API QUERY - Find Missing Resolution Data')
  console.log('='.repeat(100))

  for (const wallet of TEST_WALLETS) {
    console.log(`\n\n📋 ${wallet.name}: ${wallet.addr.substring(0, 12)}...`)
    console.log('='.repeat(100))

    // Step 1: Get all condition_ids for this wallet from trades_raw
    const conditions = await (await clickhouse.query({
      query: `
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_id,
          COUNT(*) as trade_count
        FROM trades_raw
        WHERE lower(wallet_address) = '${wallet.addr.toLowerCase()}'
          AND condition_id != ''
        GROUP BY condition_id
        ORDER BY trade_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nFound ${conditions.length} conditions for this wallet`)
    console.log('Querying Polymarket API for top 10 conditions...\n')

    let foundCount = 0
    let apiErrorCount = 0

    for (const cond of conditions) {
      const condId = cond.condition_id
      console.log(`\n  Condition: ${condId.substring(0, 32)}...`)
      console.log(`    Trades: ${cond.trade_count}`)

      // Try to query Polymarket API
      const apiResult = await queryPolymarketAPI(condId)

      if (apiResult.success && apiResult.data) {
        foundCount++
        console.log(`    ✅ FOUND on Polymarket API`)
        console.log(`    Endpoint: ${apiResult.endpoint}`)

        // Log structure of returned data
        if (Array.isArray(apiResult.data) && apiResult.data.length > 0) {
          const market = apiResult.data[0]
          console.log(`    Structure:`)
          console.log(`      - Markets in response: ${apiResult.data.length}`)
          if (market.condition_id) console.log(`      - condition_id: ${market.condition_id}`)
          if (market.outcomes) console.log(`      - outcomes: ${JSON.stringify(market.outcomes)}`)
          if (market.winning_outcome) console.log(`      - winning_outcome: ${market.winning_outcome}`)
          if (market.resolution) console.log(`      - resolution: ${market.resolution}`)
          if (market.resolvedAt) console.log(`      - resolvedAt: ${market.resolvedAt}`)
        }
      } else {
        apiErrorCount++
        console.log(`    ❌ NOT FOUND or API error`)
        console.log(`    Tried 3 endpoints, all failed or returned no data`)
      }

      // Rate limit: be nice to the API
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    console.log(`\n  Summary for ${wallet.name}:`)
    console.log(`    Found on API: ${foundCount}/${conditions.length}`)
    console.log(`    API failures: ${apiErrorCount}/${conditions.length}`)
  }

  console.log('\n\n' + '='.repeat(100))
  console.log('ANALYSIS')
  console.log('='.repeat(100))

  console.log(`
If Polymarket API has the data:
  → Data definitely exists on-chain (matches UI)
  → Need to fetch and backfill market_resolutions_final
  → Then wallets 2-4 P&L will calculate correctly

If Polymarket API doesn't have the data:
  → Data may be stored differently (check market listing instead of by condition_id)
  → Or those markets genuinely never resolved
  → Or UI shows something different (mark-to-market vs realized P&L)

Next steps:
  1. Analyze API response structure
  2. If data found: Backfill market_resolutions_final
  3. Re-run P&L calculation for wallets 2-4
  4. Proceed with 900K wallet backfill
  `)
}

main().catch(e => console.error('Error:', e))
