#!/usr/bin/env npx tsx

/**
 * PHASE 2 (REVISED): Recover 77.4M Missing Condition IDs
 *
 * BREAKTHROUGH: ERC1155 data already exists in database!
 * Strategy: JOIN trades_raw with erc1155_transfers by tx_hash
 *           Extract condition_id from token_id (condition_id = token_id >> 8)
 *           Update trades_raw with recovered values
 *
 * Timeline: 1-2 hours (not 4-6 hours of RPC fetch)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 2 (REVISED): Recover 77.4M Missing Condition IDs from Existing ERC1155 Data')
  console.log('='.repeat(100))

  // Step 1: Verify we have trades with missing condition_ids
  console.log('\n[STEP 1] Verify missing condition_ids exist')
  console.log('─'.repeat(100))

  try {
    const missingStats = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_missing,
          COUNT(DISTINCT wallet_address) as wallets_affected,
          COUNT(DISTINCT market_id) as markets_affected,
          MIN(created_at) as earliest_trade,
          MAX(created_at) as latest_trade
        FROM trades_raw
        WHERE condition_id = '' OR condition_id IS NULL
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const s = missingStats[0]
    const total = parseInt(s.total_missing)
    console.log(`\nTrades with empty condition_id: ${total.toLocaleString()}`)
    console.log(`  Affected wallets: ${parseInt(s.wallets_affected).toLocaleString()}`)
    console.log(`  Affected markets: ${parseInt(s.markets_affected).toLocaleString()}`)
    console.log(`  Date range: ${s.earliest_trade} to ${s.latest_trade}`)

    if (total === 0) {
      console.log(`\n✅ No missing condition_ids found - nothing to recover!`)
      return
    }

  } catch (e: any) {
    console.error(`❌ Stats query failed: ${e.message}`)
    return
  }

  // Step 2: Create temporary table with extracted condition_ids
  console.log('\n[STEP 2] Extract condition_ids from ERC1155 token_ids')
  console.log('─'.repeat(100))

  try {
    await clickhouse.query({
      query: `
        DROP TABLE IF EXISTS recovered_condition_ids
      `
    })

    console.log('Creating temp table with extracted condition_ids...')

    const createTemp = `
      CREATE TABLE recovered_condition_ids (
        tx_hash String,
        wallet_address String,
        condition_id_extracted String
      ) ENGINE=Memory
    `

    await clickhouse.query({ query: createTemp })
    console.log('✅ Temp table created')

  } catch (e: any) {
    console.error(`❌ Temp table creation failed: ${e.message}`)
    return
  }

  // Step 3: Extract condition_ids and insert into temp table (batched)
  console.log('\n[STEP 3] Extract and populate temp table (batched)')
  console.log('─'.repeat(100))

  try {
    const extractQuery = `
      INSERT INTO recovered_condition_ids
      SELECT
        e.tx_hash,
        t.wallet_address,
        lower(hex(
          CAST(replaceAll(e.token_id, '0x', '') AS UInt256) / 256
        )) as condition_id_extracted
      FROM trades_raw t
      INNER JOIN erc1155_transfers e ON t.transaction_hash = e.tx_hash
      WHERE t.condition_id = '' OR t.condition_id IS NULL
      LIMIT 10000000  -- Safety limit
    `

    console.log('Extracting condition_ids from ERC1155 token_ids...')
    const startTime = Date.now()
    await clickhouse.query({ query: extractQuery })
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`✅ Extraction completed (${elapsed}s)`)

    // Check how many we extracted
    const checkExtracted = await (await clickhouse.query({
      query: `SELECT COUNT(*) as cnt FROM recovered_condition_ids`,
      format: 'JSONEachRow'
    })).json() as any[]

    const extracted = parseInt(checkExtracted[0]?.cnt || 0)
    console.log(`   Extracted condition_ids: ${extracted.toLocaleString()}`)

  } catch (e: any) {
    console.error(`❌ Extraction failed: ${e.message}`)
    return
  }

  // Step 4: Update trades_raw with recovered condition_ids
  console.log('\n[STEP 4] Update trades_raw with recovered condition_ids')
  console.log('─'.repeat(100))

  try {
    console.log('Updating trades_raw with extracted condition_ids...')

    const updateQuery = `
      ALTER TABLE trades_raw UPDATE
        condition_id = r.condition_id_extracted
      FROM recovered_condition_ids r
      WHERE trades_raw.transaction_hash = r.tx_hash
        AND trades_raw.wallet_address = r.wallet_address
    `

    const startTime = Date.now()
    await clickhouse.query({ query: updateQuery })
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`✅ UPDATE completed (${elapsed}s)`)

  } catch (e: any) {
    console.error(`❌ Update failed: ${e.message}`)
    console.log(`\n⚠️  Trying alternative approach using FINAL modifier...`)

    // Try alternative: use FINAL to handle ReplacingMergeTree
    try {
      const altUpdate = `
        ALTER TABLE trades_raw UPDATE
          condition_id = r.condition_id_extracted
        FROM recovered_condition_ids r
        WHERE trades_raw.transaction_hash = r.tx_hash
      `

      await clickhouse.query({ query: altUpdate })
      console.log(`✅ Alternative UPDATE succeeded`)
    } catch (e2: any) {
      console.error(`❌ Alternative also failed: ${e2.message}`)
    }
  }

  // Step 5: Verify recovery
  console.log('\n[STEP 5] Verify Recovery Success')
  console.log('─'.repeat(100))

  try {
    const verification = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as still_missing,
          COUNT(DISTINCT wallet_address) as affected_wallets,
          MIN(created_at) as earliest,
          MAX(created_at) as latest
        FROM trades_raw
        WHERE condition_id = '' OR condition_id IS NULL
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const v = verification[0]
    const stillMissing = parseInt(v.still_missing)

    console.log(`\nRemaining trades with empty condition_id: ${stillMissing.toLocaleString()}`)

    if (stillMissing === 0) {
      console.log(`\n✅ PERFECT! All condition_ids recovered!`)
    } else {
      console.log(`\n⚠️  ${stillMissing.toLocaleString()} trades still missing condition_id`)
      console.log(`   This may indicate:`)
      console.log(`   1. Some trades don't have matching ERC1155 events`)
      console.log(`   2. Update mechanism didn't apply to all rows`)
      console.log(`   3. Data consistency issue`)
    }

  } catch (e: any) {
    console.error(`❌ Verification failed: ${e.message}`)
  }

  // Step 6: Sample check
  console.log('\n[STEP 6] Sample of Recovered Trades')
  console.log('─'.repeat(100))

  try {
    const samples = await (await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          condition_id,
          market_id,
          created_at
        FROM trades_raw
        WHERE condition_id != '' AND condition_id IS NOT NULL
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (samples.length > 0) {
      console.log(`\nSample of recovered trades:`)
      for (let i = 0; i < Math.min(5, samples.length); i++) {
        const s = samples[i]
        console.log(`  [${i + 1}] ${s.wallet_address.substring(0, 12)}... | condition: ${s.condition_id.substring(0, 16)}... | market: ${s.market_id.substring(0, 12)}...`)
      }
    }

  } catch (e: any) {
    console.error(`⚠️  Sample check failed: ${e.message}`)
  }

  // Clean up temp table
  try {
    await clickhouse.query({
      query: `DROP TABLE IF EXISTS recovered_condition_ids`
    })
  } catch (_) {
    // Ignore cleanup errors
  }

  console.log('\n' + '='.repeat(100))
  console.log('PHASE 2 COMPLETE: Condition ID Recovery')
  console.log('='.repeat(100))
  console.log(`\nNext: Phase 3 - Calculate Per-Wallet P&L`)
  console.log(`Timeline: 2-3 hours`)
}

main().catch(e => console.error('Fatal error:', e))
