#!/usr/bin/env npx tsx

/**
 * FETCH & ANALYZE POLYMARKET API RESOLUTION DATA
 *
 * Now that we know the API has the data, fetch actual responses and extract:
 * - winning_index
 * - payout_numerators
 * - payout_denominator
 * - winning_outcome
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'
import fetch from 'node-fetch'

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
  console.log('FETCH & ANALYZE POLYMARKET API RESOLUTION DATA')
  console.log('='.repeat(100))

  // Get sample condition from each wallet
  const samples = [
    {
      wallet: 'Wallet 2 (0x8e9eef)',
      addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
    },
    {
      wallet: 'Wallet 3 (0xcce2b7)',
      addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    },
    {
      wallet: 'Wallet 4 (0x6770bf)',
      addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',
    },
  ]

  for (const sample of samples) {
    console.log(`\n\n📊 ${sample.wallet}`)
    console.log('='.repeat(100))

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

    if (conditions.length === 0) {
      console.log('No conditions found')
      continue
    }

    const condId = conditions[0].condition_id
    console.log(`\nCondition: ${condId}`)
    console.log(`Trades: ${conditions[0].trade_count}`)

    // Fetch data
    const apiData = await fetchConditionData(condId)

    if (!apiData.success || !apiData.data) {
      console.log('❌ Failed to fetch API data')
      continue
    }

    console.log(`\n✅ API Response received`)

    // Log full response for inspection
    console.log(`\nFull raw response (first 1500 chars):`)
    console.log(JSON.stringify(apiData.data, null, 2).substring(0, 1500))

    const markets = Array.isArray(apiData.data) ? apiData.data : [apiData.data]
    if (!markets || markets.length === 0) {
      console.log('\nNo markets data in response')
      console.log('Response type:', typeof apiData.data)
      console.log('Response:', apiData.data)
      continue
    }

    const market = markets[0]
    if (!market) {
      console.log('Market is null/undefined')
      continue
    }

    console.log(`\n\nKeys in market object:`)
    try {
      const keys = Object.keys(market)
      console.log(`  ${keys.join(', ')}`)
    } catch (e) {
      console.log('Error getting keys:', e)
      continue
    }

    console.log(`\n📋 Extracted Data:`)

    // Try to find resolution-related fields
    const fields = [
      'condition_id', 'conditionId', 'question_id', 'question',
      'winning_index', 'winningIndex', 'winning_outcome', 'winningOutcome',
      'payout_numerators', 'payoutNumerators',
      'payout_denominator', 'payoutDenominator',
      'outcome_0', 'outcome_1',
      'outcomes', 'resolvedAt', 'resolved', 'resolution',
      'timestamp', 'market_id', 'clob_tokens', 'events'
    ]

    for (const field of fields) {
      if (field in market) {
        console.log(`  ${field}: ${JSON.stringify(market[field])}`)
      }
    }

    // If it has nested structure, explore it
    console.log(`\nNested Objects:`)
    for (const key of Object.keys(market)) {
      const value = market[key]
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        console.log(`\n  ${key}:`)
        console.log(`    Keys: ${Object.keys(value).join(', ')}`)
        if (Object.keys(value).length <= 5) {
          console.log(`    Value: ${JSON.stringify(value, null, 2)}`)
        }
      }
    }

    // If it has clob_tokens or similar, explore those
    if (market.clob_tokens && Array.isArray(market.clob_tokens) && market.clob_tokens.length > 0) {
      console.log(`\n📦 clob_tokens (${market.clob_tokens.length} items):`)
      const token = market.clob_tokens[0]
      console.log(`  First token structure:`)
      console.log(`    ${JSON.stringify(token, null, 2)}`)
    }

    // Print full response (first 2000 chars) for inspection
    console.log(`\n📄 Full API Response (first market):`)
    console.log(JSON.stringify(market, null, 2).substring(0, 2000))
  }

  console.log('\n\n' + '='.repeat(100))
  console.log('NEXT STEPS')
  console.log('='.repeat(100))
  console.log(`
Once we understand the API response structure:
1. Map API fields to our database columns:
   - condition_id_norm (from condition_id)
   - winning_index (from API field)
   - payout_numerators (from API field)
   - payout_denominator (from API field)

2. Fetch ALL conditions for wallets 2-4 and backfill market_resolutions_final

3. Re-run P&L calculation for wallets 2-4

4. If wallets 2-4 show correct P&L, proceed with 900K wallet backfill
  `)
}

main().catch(e => console.error('Error:', e))
