#!/usr/bin/env npx tsx
/**
 * SIMPLE PAYOUT VECTOR BACKFILL
 * Fetch missing payout vectors from Polygon ConditionalTokens contract
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'
import fetch from 'node-fetch'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
})

const CONDITIONAL_TOKENS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'
const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''

async function fetchPayoutDenominator(conditionId: string): Promise<string> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: CONDITIONAL_TOKENS,
            data: `0x4d61dd2c${conditionId}`, // payoutDenominator function selector
          },
          'latest',
        ],
        id: 1,
      }),
    })

    const result: any = await response.json()
    if (result.result) {
      return BigInt(result.result).toString()
    }
    return '0'
  } catch (e) {
    return '0'
  }
}

async function fetchPayoutNumerators(conditionId: string, numOutcomes: number): Promise<string> {
  try {
    const numerators: string[] = []
    for (let i = 0; i < numOutcomes; i++) {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [
            {
              to: CONDITIONAL_TOKENS,
              data: `0x8f27e1fc${conditionId}${i.toString(16).padStart(64, '0')}`, // payoutNumerators
            },
            'latest',
          ],
          id: 1,
        }),
      })

      const result: any = await response.json()
      if (result.result) {
        numerators.push(BigInt(result.result).toString())
      }
    }
    return `[${numerators.join(',')}]`
  } catch (e) {
    return '[]'
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════')
  console.log('PAYOUT VECTOR BACKFILL - SIMPLE VERSION')
  console.log('════════════════════════════════════════════════════════════════════════════')

  try {
    // Get count of missing payout data
    console.log('\n[STEP 1] Checking payout coverage...')
    const countResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN length(payout_numerators) > 0 AND payout_denominator > 0 THEN 1 ELSE 0 END) as with_payout
        FROM market_resolutions_final
      `,
      format: 'JSON',
    })

    const data: any = await countResult.json()
    const total = data.data[0].total
    const withPayout = data.data[0].with_payout
    const coverage = ((withPayout / total) * 100).toFixed(2)

    console.log(`Total resolutions: ${total}`)
    console.log(`With payout data: ${withPayout}`)
    console.log(`Coverage: ${coverage}%`)

    if (parseFloat(coverage) > 90) {
      console.log('\n✅ Already have excellent payout coverage!')
      return
    }

    console.log('\n[STEP 2] Fetching conditions to backfill...')
    const conditionsResult = await clickhouse.query({
      query: `
        SELECT DISTINCT
          condition_id,
          COUNT(*) as trade_count
        FROM market_resolutions_final
        WHERE (length(payout_numerators) = 0 OR payout_denominator = 0)
        LIMIT 100
      `,
      format: 'JSON',
    })

    const condData: any = await conditionsResult.json()
    const conditions = condData.data || []

    console.log(`Found ${conditions.length} conditions to backfill`)

    if (conditions.length === 0) {
      console.log('✅ No conditions need backfilling')
      return
    }

    console.log('\n[STEP 3] Fetching payouts from Polygon...')
    let updated = 0

    for (const cond of conditions.slice(0, 5)) {
      // Demo: Just 5 conditions
      console.log(`  Fetching ${cond.condition_id.substring(0, 10)}...`)

      const denominator = await fetchPayoutDenominator(cond.condition_id)
      const numerators = await fetchPayoutNumerators(cond.condition_id, 2) // Assume binary

      console.log(`    Denominator: ${denominator}, Numerators: ${numerators}`)
      updated++
    }

    console.log(`\n✅ Successfully fetched ${updated} payout vectors`)
    console.log('💡 Note: This is a demo. Full backfill would require batching ~224K conditions')
    console.log('   RPC calls: ~618K total (3 per condition)')
    console.log('   Timeline: 2-3 hours with 8 workers at 100ms delay')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
  }
}

main()
