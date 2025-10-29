#!/usr/bin/env tsx
/**
 * NUCLEAR OPTION V2: Use temp table + JOIN instead of giant CASE
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import fs from 'fs'

const LOOKUP_FILE = './data/market_id_lookup_results.jsonl'

async function nuclearBackfillV2() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  NUCLEAR BACKFILL V2: Using temp table + JOIN')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Load mappings
  console.log('📂 Loading condition→market mappings...')
  const mappings: Array<{condition_id: string, market_id: string}> = []

  if (fs.existsSync(LOOKUP_FILE)) {
    const lines = fs.readFileSync(LOOKUP_FILE, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const mapping = JSON.parse(line)
        if (mapping.condition_id && mapping.market_id) {
          mappings.push(mapping)
        }
      } catch (e) {
        // skip
      }
    }
  }

  console.log(`   ✅ Loaded ${mappings.length} mappings\n`)

  // Get current state
  console.log('📊 Checking current state...')
  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        countIf(market_id != '') as with_market_id,
        countIf(market_id = '' AND condition_id NOT LIKE 'token_%') as need_enrichment,
        COUNT(DISTINCT wallet_address) as total_wallets,
        COUNT(DISTINCT if(market_id != '', wallet_address, NULL)) as enriched_wallets
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  const beforeData = await beforeResult.json<any>()
  const before = beforeData[0]

  console.log(`   Total trades: ${before.total}`)
  console.log(`   With market_id: ${before.with_market_id} (${(before.with_market_id / before.total * 100).toFixed(2)}%)`)
  console.log(`   Need enrichment: ${before.need_enrichment}`)
  console.log(`   Total wallets: ${before.total_wallets}`)
  console.log(`   Enriched wallets: ${before.enriched_wallets}\n`)

  // Execute UPDATE in smaller batches to avoid query size limits
  console.log('💥 EXECUTING BATCHED UPDATES...\n')

  const BATCH_SIZE = 1000
  let updatesIssued = 0
  const startTime = Date.now()

  for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
    const batch = mappings.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(mappings.length / BATCH_SIZE)

    process.stdout.write(`   Batch ${batchNum}/${totalBatches} (${batch.length} mappings)...`)

    // Build VALUES for this batch
    const values = batch.map(m => `('${m.condition_id}', '${m.market_id}')`).join(',')

    try {
      // Use multiIf which is more efficient than CASE for ClickHouse
      const conditions = batch.map(m => `condition_id = '${m.condition_id}', '${m.market_id}'`).join(', ')

      await clickhouse.command({
        query: `
          ALTER TABLE trades_raw
          UPDATE market_id = multiIf(${conditions}, market_id)
          WHERE market_id = '' AND condition_id IN (${batch.map(m => `'${m.condition_id}'`).join(',')})
        `
      })

      updatesIssued++
      console.log(` ✅`)
    } catch (error) {
      console.log(` ❌ ${error instanceof Error ? error.message : error}`)
    }

    // Small delay to avoid overwhelming the database
    if (i % (BATCH_SIZE * 10) === 0) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n   Issued ${updatesIssued} batch updates in ${elapsed}s\n`)

  // Wait for mutations to apply
  console.log('⏳ Waiting 10s for mutations to apply...')
  await new Promise(resolve => setTimeout(resolve, 10000))

  // Get final state
  console.log('\n📊 Checking final state...')
  const afterResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        countIf(market_id != '') as with_market_id,
        countIf(market_id = '' AND condition_id NOT LIKE 'token_%') as still_need_enrichment,
        COUNT(DISTINCT wallet_address) as total_wallets,
        COUNT(DISTINCT if(market_id != '', wallet_address, NULL)) as enriched_wallets
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  const afterData = await afterResult.json<any>()
  const after = afterData[0]

  const enriched = after.with_market_id - before.with_market_id
  const newWallets = after.enriched_wallets - before.enriched_wallets

  console.log(`   Total trades: ${after.total}`)
  console.log(`   With market_id: ${after.with_market_id} (${(after.with_market_id / after.total * 100).toFixed(2)}%)`)
  console.log(`   Newly enriched trades: ${enriched}`)
  console.log(`   Still need enrichment: ${after.still_need_enrichment}`)
  console.log(`   Total wallets: ${after.total_wallets}`)
  console.log(`   Enriched wallets: ${after.enriched_wallets} (+${newWallets})\n`)

  console.log('═══════════════════════════════════════════════════════════')
  console.log('✅ NUCLEAR BACKFILL V2 COMPLETE!')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`   Enriched ${enriched} additional trades`)
  console.log(`   Added ${newWallets} wallets to enriched pool`)
  console.log(`   Total enriched wallets: ${after.enriched_wallets}`)
  console.log(`   Ready for metrics computation`)
  console.log('═══════════════════════════════════════════════════════════\n')
}

nuclearBackfillV2().catch(console.error)
