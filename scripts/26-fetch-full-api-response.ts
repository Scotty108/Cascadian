#!/usr/bin/env npx tsx

/**
 * FETCH FULL API RESPONSE AND SAVE TO FILE
 *
 * Get complete API response for one condition from each wallet
 * to understand the full data structure including payout information
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import fetch from 'node-fetch'
import { writeFileSync } from 'fs'

async function fetchConditionData(conditionId: string) {
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
    return { success: false, data: null, error }
  }
}

async function main() {
  console.log('='.repeat(100))
  console.log('FETCH FULL API RESPONSE - Complete Data Structure Analysis')
  console.log('='.repeat(100))

  const samples = [
    {
      wallet: 'Wallet 2',
      addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
    },
    {
      wallet: 'Wallet 3',
      addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    },
  ]

  const allResponses = {} as any

  for (const sample of samples) {
    // Get first condition
    const conditions = await (await clickhouse.query({
      query: `
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_id,
          COUNT(*) as trade_count
        FROM trades_raw
        WHERE lower(wallet_address) = '${sample.addr.toLowerCase()}'
          AND condition_id != ''
        GROUP BY condition_id
        ORDER BY trade_count DESC
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (conditions.length === 0) continue

    const condId = conditions[0].condition_id
    console.log(`\n${sample.wallet}: Fetching ${condId.substring(0, 16)}...`)

    const apiData = await fetchConditionData(condId)

    if (apiData.success && apiData.data) {
      allResponses[sample.wallet] = {
        queryConditionId: condId,
        responseData: apiData.data,
      }
      console.log(`✅ Saved response for ${sample.wallet}`)
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // Save to file
  writeFileSync(
    'api-response-samples.json',
    JSON.stringify(allResponses, null, 2)
  )

  console.log('\n✅ Full responses saved to: api-response-samples.json')
  console.log('\nAnalyzing structure...')

  // Analyze the structure
  for (const [wallet, data] of Object.entries(allResponses)) {
    const responseData = (data as any).responseData
    console.log(`\n\n${wallet}:`)
    console.log(`  Top-level keys: ${Object.keys(responseData).join(', ')}`)

    if (Array.isArray(responseData.data) && responseData.data.length > 0) {
      const market = responseData.data[0]
      console.log(`  First market keys: ${Object.keys(market).join(', ')}`)

      if (Array.isArray(market.tokens) && market.tokens.length > 0) {
        console.log(`  First token keys: ${Object.keys(market.tokens[0]).join(', ')}`)
        console.log(`  First token value: ${JSON.stringify(market.tokens[0])}`)
      }

      // Check for payout-related fields
      const payoutFields = Object.keys(market).filter(k =>
        k.toLowerCase().includes('payout') ||
        k.toLowerCase().includes('payout_') ||
        k.toLowerCase().includes('numerator') ||
        k.toLowerCase().includes('denominator') ||
        k.toLowerCase().includes('payoutNumerators') ||
        k.toLowerCase().includes('settlement')
      )

      if (payoutFields.length > 0) {
        console.log(`  Payout-related fields: ${payoutFields.join(', ')}`)
      } else {
        console.log(`  ⚠️  No payout-related fields found in market object`)
      }

      // Check tokens structure
      console.log(`  Token count: ${market.tokens.length}`)
      console.log(`  Tokens with winner flag:`)
      market.tokens.forEach((t: any, i: number) => {
        console.log(`    [${i}] ${t.outcome}: winner=${t.winner}, price=${t.price}`)
      })
    }
  }

  console.log('\n\n' + '='.repeat(100))
  console.log('KEY FINDINGS')
  console.log('='.repeat(100))
  console.log(`
The Polymarket API /markets endpoint returns:
- Market metadata (question, outcomes, dates, etc.)
- List of tokens with:
  * outcome name (string)
  * price (current market price, 0-1)
  * winner flag (boolean, true for winning outcome)

Missing from this endpoint:
- Payout numerators
- Payout denominator
- Resolution timestamp

Next steps:
1. Check if different API endpoint has payout data
   - /markets/{id}/orderbook
   - /markets/{id}/history
   - /markets/{id}/payout
   - /markets/{id}/resolution

2. Or check if we need to query the blockchain directly
   - ConditionalTokens contract for payout vectors
   - FixedProductMarketMaker for resolution data

3. Or calculate payouts from market structure:
   - Uniform: payout = [1, 0] / 1 for winner
   - Custom: may be specified in market description/metadata
  `)
}

main().catch(e => console.error('Error:', e))
