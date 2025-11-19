#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@clickhouse/client'

const ch = createClient({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
})

/**
 * MARKET ID RECOVERY VIA TRANSACTION HASH
 *
 * STRATEGY:
 * 1. Join trades_raw.transaction_hash with erc1155_transfers.tx_hash
 * 2. Extract token_id from ERC1155 events
 * 3. Use token_id to query existing condition_market_map or resolve via API
 * 4. Update trades_raw with discovered market_ids
 *
 * ESTIMATED IMPACT:
 * - 79.3M trades currently missing market_id
 * - ~78% have matching tx_hash in erc1155_transfers
 * - Expected recovery: 60-62M trades (76-78%)
 * - Final coverage: 51% + 38% = 89%+ (close to 95% target!)
 */

async function q(sql: string) {
  const r = await ch.query({ query: sql, format: 'JSONEachRow' })
  return await r.json()
}

async function recoverMarketIds() {
  console.log('═'.repeat(70))
  console.log('MARKET ID RECOVERY VIA TX_HASH → ERC1155 → CONDITION_ID')
  console.log('═'.repeat(70))
  console.log()

  // Step 1: Create temporary mapping table
  console.log('Step 1: Creating temp mapping from tx_hash → token_ids...')

  await ch.exec({
    query: `
      DROP TABLE IF EXISTS temp_tx_to_token
    `
  })

  await ch.exec({
    query: `
      CREATE TABLE temp_tx_to_token
      ENGINE = MergeTree
      ORDER BY tx_hash
      AS
      SELECT DISTINCT
        lower(tx_hash) as tx_hash,
        token_id,
        contract
      FROM erc1155_transfers
      WHERE tx_hash IN (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE market_id = '' OR lower(market_id) IN ('0x0','0x','0x0000000000000000000000000000000000000000000000000000000000000000')
      )
    `
  })

  const tempCount = await q(`SELECT COUNT(*) as n FROM temp_tx_to_token`)
  console.log(`  Created temp table with ${Number(tempCount[0].n).toLocaleString()} tx_hash → token_id mappings`)
  console.log()

  // Step 2: Check if we have a token_id → condition_id mapping table
  console.log('Step 2: Checking for existing token_id → condition_id mapping...')

  let hasTokenMapping = false
  try {
    await ch.query({ query: 'SELECT 1 FROM token_condition_map LIMIT 1' })
    hasTokenMapping = true
    console.log('  ✅ Found token_condition_map table')
  } catch {
    console.log('  ⚠️  No token_condition_map table - will need to create one')
  }
  console.log()

  // Step 3: Strategy decision
  console.log('Step 3: Recovery Strategy')
  console.log()
  console.log('Option A: Direct recovery (if token mapping exists)')
  console.log('  - JOIN temp_tx_to_token → token_condition_map → condition_market_map')
  console.log('  - Instant recovery, no API calls')
  console.log()
  console.log('Option B: API-based recovery (if no token mapping)')
  console.log('  - Query Polymarket API to resolve each token_id')
  console.log('  - 4-6 hours for ~300K unique token_ids')
  console.log()

  if (hasTokenMapping) {
    console.log('✅ Using Option A: Direct recovery')
    console.log()

    // Execute direct recovery
    console.log('Executing recovery JOIN...')

    await ch.exec({
      query: `
        CREATE TABLE trades_raw_with_market_ids
        ENGINE = MergeTree
        ORDER BY (wallet_address, timestamp)
        AS
        SELECT
          t.*,
          COALESCE(
            CASE WHEN t.market_id != '' AND lower(t.market_id) NOT IN ('0x0','0x','0x0000000000000000000000000000000000000000000000000000000000000000')
              THEN t.market_id
            ELSE NULL
            END,
            cmm.market_id
          ) as recovered_market_id
        FROM trades_raw t
        LEFT JOIN temp_tx_to_token ttt ON lower(t.transaction_hash) = ttt.tx_hash
        LEFT JOIN token_condition_map tcm ON ttt.token_id = tcm.token_id
        LEFT JOIN condition_market_map cmm ON tcm.condition_id = cmm.condition_id
      `
    })

    console.log('  ✅ Created trades_raw_with_market_ids')

    // Verify recovery
    const verification = await q(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN recovered_market_id != '' AND recovered_market_id IS NOT NULL THEN 1 END) as with_market_id
      FROM trades_raw_with_market_ids
    `)

    const newCoverage = Number(verification[0].with_market_id) / Number(verification[0].total) * 100
    console.log()
    console.log('Recovery Results:')
    console.log(`  Total trades: ${Number(verification[0].total).toLocaleString()}`)
    console.log(`  With market_id: ${Number(verification[0].with_market_id).toLocaleString()}`)
    console.log(`  Coverage: ${newCoverage.toFixed(2)}%`)
    console.log()

    if (newCoverage >= 95) {
      console.log('🎉 SUCCESS! Achieved 95%+ coverage target')
    } else if (newCoverage >= 85) {
      console.log('✅ GOOD! Achieved 85%+ coverage (close to target)')
    } else {
      console.log('⚠️  Coverage improved but below target')
    }

  } else {
    console.log('⚠️  Using Option B: Need to build token mapping first')
    console.log()
    console.log('Next steps:')
    console.log('  1. Extract unique token_ids from temp_tx_to_token')
    console.log('  2. Query Polymarket API or decode from CTF contract')
    console.log('  3. Build token_condition_map table')
    console.log('  4. Re-run this script')
    console.log()
    console.log('Run: npx tsx agents/build-token-condition-map.ts')
  }

  console.log()
  console.log('═'.repeat(70))
}

recoverMarketIds().catch(console.error)
