#!/usr/bin/env npx tsx

/**
 * FORMAT MATCHING TEST
 *
 * Claude 3 hypothesis: condition_ids just need proper normalization to match
 *
 * Test: For each condition_id from wallets 2-4, try ALL possible format combinations
 * to find it in market_resolutions_final
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('FORMAT MATCHING TEST')
  console.log('Testing if condition_ids just need normalization')
  console.log('='.repeat(80))

  // Get ALL condition_ids from wallets 2-4
  const wallets = [
    '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',
  ]

  for (const wallet of wallets) {
    console.log(`\n\n📋 WALLET: ${wallet.substring(0, 12)}...`)
    console.log('='.repeat(80))

    const conditions = await (await clickhouse.query({
      query: `
        SELECT DISTINCT condition_id
        FROM trades_raw
        WHERE wallet_address = '${wallet}' AND condition_id != ''
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (conditions.length === 0) {
      console.log('No non-empty condition_ids found')
      continue
    }

    for (const cond of conditions) {
      const rawId = cond.condition_id
      console.log(`\nCondition from trades_raw: ${rawId.substring(0, 30)}...`)

      // Test different normalization formats
      const formats = [
        { name: 'Raw as-is', value: rawId },
        { name: 'Lowercase', value: rawId.toLowerCase() },
        { name: 'Remove 0x prefix + lowercase', value: rawId.replace(/^0x/i, '').toLowerCase() },
        { name: 'Uppercase', value: rawId.toUpperCase() },
        { name: 'Remove 0x + uppercase', value: rawId.replace(/^0x/i, '').toUpperCase() },
        { name: 'Add 0x prefix if missing', value: rawId.startsWith('0x') ? rawId : '0x' + rawId },
      ]

      let found = false

      for (const fmt of formats) {
        // Count matches in market_resolutions_final
        const result = await (await clickhouse.query({
          query: `
            SELECT COUNT(*) as count FROM market_resolutions_final
            WHERE condition_id_norm = '${fmt.value}'
            LIMIT 1
          `,
          format: 'JSONEachRow'
        })).json() as any[]

        const count = parseInt(result[0].count || 0)

        if (count > 0) {
          found = true
          console.log(`  ✅ FOUND with format: "${fmt.name}"`)
          console.log(`     Normalized value: ${fmt.value}`)
          console.log(`     Matches in market_resolutions_final: ${count}`)

          // Get the actual resolution data
          const resData = await (await clickhouse.query({
            query: `
              SELECT
                winning_index,
                payout_numerators,
                payout_denominator,
                winning_outcome
              FROM market_resolutions_final
              WHERE condition_id_norm = '${fmt.value}'
              LIMIT 1
            `,
            format: 'JSONEachRow'
          })).json() as any[]

          if (resData.length > 0) {
            const res = resData[0]
            console.log(`     Winning index: ${res.winning_index}`)
            console.log(`     Payout: [${res.payout_numerators}] / ${res.payout_denominator}`)
            console.log(`     Outcome: ${res.winning_outcome}`)
          }
          break
        }
      }

      if (!found) {
        console.log(`  ❌ NO MATCH found in market_resolutions_final`)
        console.log(`     Tried all 6 format variations - none matched`)
        console.log(`\n     Checking if it exists in market_resolutions instead...`)

        // Check market_resolutions with same formats
        let foundInMr = false
        for (const fmt of formats) {
          const result = await (await clickhouse.query({
            query: `
              SELECT COUNT(*) as count FROM market_resolutions
              WHERE condition_id = '${fmt.value}'
              LIMIT 1
            `,
            format: 'JSONEachRow'
          })).json() as any[]

          if (parseInt(result[0].count || 0) > 0) {
            foundInMr = true
            console.log(`     ✅ Found in market_resolutions with format: "${fmt.name}"`)
            break
          }
        }

        if (!foundInMr) {
          console.log(`     ❌ Also NOT in market_resolutions`)
          console.log(`     This condition_id genuinely doesn't exist in ANY resolution table`)
        }
      }
    }
  }

  console.log('\n\n' + '='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))

  // Final test: count how many wallet 2-4 condition_ids we can match with ANY format
  const allConditions = await (await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT condition_id) as total_conditions
      FROM trades_raw
      WHERE wallet_address IN (
        '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
        '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
        '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
      )
        AND condition_id != ''
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  console.log(`\nWallets 2-4 total conditions: ${allConditions[0].total_conditions}`)
  console.log('\nIf format-matching found ANY matches → problem is format/normalization')
  console.log('If format-matching found NO matches → need to query Polymarket API')
}

main().catch(e => console.error('Error:', e))
