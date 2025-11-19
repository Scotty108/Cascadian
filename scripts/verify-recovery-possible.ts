#!/usr/bin/env npx tsx
/**
 * VERIFY: Can we actually recover condition_ids from other tables?
 * Test on wallet: 0x961b5ad4c66ec18d073c216054ddd42523336a1d
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function verify() {
  console.log('='.repeat(100))
  console.log('VERIFICATION: Can we recover missing condition_ids?')
  console.log('='.repeat(100))

  try {
    // Step 1: Get the 10 trades from this wallet that are MISSING condition_id
    const missingQuery = `
      SELECT DISTINCT
        t.transaction_hash,
        t.market_id,
        t.wallet_address
      FROM trades_raw t
      WHERE t.wallet_address = '0x961b5ad4c66ec18d073c216054ddd42523336a1d'
        AND (t.condition_id IS NULL OR t.condition_id = '')
      LIMIT 10;
    `

    console.log('\n📋 Step 1: Find trades with MISSING condition_id\n')
    const missingResult = await clickhouse.query({
      query: missingQuery,
      format: 'JSONEachRow'
    })
    const missingTrades = await missingResult.json()

    console.log(`Found ${missingTrades.length} trades with missing condition_id`)
    console.log(`Sample market_ids: ${missingTrades.map(t => t.market_id).slice(0, 3).join(', ')}\n`)

    // Step 2: Try to find these market_ids in api_ctf_bridge
    if (missingTrades.length > 0) {
      const marketIds = missingTrades.map(t => `'${t.market_id}'`).join(',')
      
      const bridgeQuery = `
        SELECT
          market_id,
          condition_id,
          COUNT(*) as count
        FROM api_ctf_bridge
        WHERE market_id IN (${marketIds})
        GROUP BY market_id, condition_id;
      `

      console.log('📋 Step 2: Check if api_ctf_bridge has these market_ids\n')
      try {
        const bridgeResult = await clickhouse.query({
          query: bridgeQuery,
          format: 'JSONEachRow'
        })
        const bridgeData = await bridgeResult.json()

        if (bridgeData.length > 0) {
          console.log(`✅ Found ${bridgeData.length} matches in api_ctf_bridge`)
          for (const row of bridgeData) {
            console.log(`   market_id: ${row.market_id} → condition_id: ${row.condition_id}`)
          }
        } else {
          console.log(`❌ NO MATCHES in api_ctf_bridge`)
        }
      } catch (e) {
        console.log(`⚠️ api_ctf_bridge query failed: ${(e as Error).message}`)
      }

      // Step 3: Try condition_market_map
      const condMapQuery = `
        SELECT
          market_id,
          condition_id_norm,
          COUNT(*) as count
        FROM condition_market_map
        WHERE market_id IN (${marketIds})
        GROUP BY market_id, condition_id_norm;
      `

      console.log('\n📋 Step 3: Check if condition_market_map has these market_ids\n')
      try {
        const condResult = await clickhouse.query({
          query: condMapQuery,
          format: 'JSONEachRow'
        })
        const condData = await condResult.json()

        if (condData.length > 0) {
          console.log(`✅ Found ${condData.length} matches in condition_market_map`)
          for (const row of condData) {
            console.log(`   market_id: ${row.market_id} → condition_id: ${row.condition_id_norm}`)
          }
        } else {
          console.log(`❌ NO MATCHES in condition_market_map`)
        }
      } catch (e) {
        console.log(`⚠️ condition_market_map query failed: ${(e as Error).message}`)
      }
    }

    console.log('\n' + '='.repeat(100))
    console.log('CONCLUSION')
    console.log('='.repeat(100))

  } catch (error) {
    console.error('Error:', error)
  }
}

verify()
