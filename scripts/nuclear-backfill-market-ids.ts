#!/usr/bin/env tsx
/**
 * NUCLEAR OPTION: Backfill market_id for ALL trades in ONE query
 *
 * Instead of 50k individual UPDATEs (which create mutations),
 * we use a single ALTER TABLE with a dictionary lookup
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import fs from 'fs'

const LOOKUP_FILE = './data/market_id_lookup_results.jsonl'

async function nuclearBackfill() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  NUCLEAR BACKFILL: market_id for ALL trades')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Load mappings
  console.log('📂 Loading condition→market mappings...')
  const mappings = new Map<string, string>()

  if (fs.existsSync(LOOKUP_FILE)) {
    const lines = fs.readFileSync(LOOKUP_FILE, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const mapping = JSON.parse(line)
        if (mapping.condition_id && mapping.market_id) {
          mappings.set(mapping.condition_id, mapping.market_id)
        }
      } catch (e) {
        // skip
      }
    }
  }

  console.log(`   ✅ Loaded ${mappings.size} mappings\n`)

  // Get current state
  console.log('📊 Checking current state...')
  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        countIf(market_id != '') as with_market_id,
        countIf(market_id = '' AND condition_id NOT LIKE 'token_%') as need_enrichment
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  const beforeData = await beforeResult.json<any>()
  const before = beforeData[0]

  console.log(`   Total trades: ${before.total}`)
  console.log(`   With market_id: ${before.with_market_id} (${(before.with_market_id / before.total * 100).toFixed(2)}%)`)
  console.log(`   Need enrichment: ${before.need_enrichment}\n`)

  // Create temporary dictionary for fast lookup
  console.log('🔧 Creating temporary lookup dictionary...')

  // Build case statement for all mappings
  const caseStatements = Array.from(mappings.entries())
    .map(([conditionId, marketId]) => `WHEN '${conditionId}' THEN '${marketId}'`)
    .join('\n        ')

  console.log('   ✅ Dictionary ready\n')

  // Execute single nuclear update
  console.log('💥 EXECUTING NUCLEAR UPDATE (this may take 30-60 seconds)...\n')

  const updateQuery = `
    ALTER TABLE trades_raw
    UPDATE market_id = CASE condition_id
      ${caseStatements}
      ELSE market_id
    END
    WHERE market_id = '' AND condition_id NOT LIKE 'token_%'
  `

  const startTime = Date.now()

  try {
    await clickhouse.command({ query: updateQuery })
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`   ✅ Update complete in ${elapsed}s\n`)
  } catch (error) {
    console.error('   ❌ Update failed:', error)
    throw error
  }

  // Wait for mutation to apply
  console.log('⏳ Waiting for mutation to apply...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Get final state
  console.log('\n📊 Checking final state...')
  const afterResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        countIf(market_id != '') as with_market_id,
        countIf(market_id = '' AND condition_id NOT LIKE 'token_%') as still_need_enrichment
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  const afterData = await afterResult.json<any>()
  const after = afterData[0]

  const enriched = after.with_market_id - before.with_market_id

  console.log(`   Total trades: ${after.total}`)
  console.log(`   With market_id: ${after.with_market_id} (${(after.with_market_id / after.total * 100).toFixed(2)}%)`)
  console.log(`   Newly enriched: ${enriched}`)
  console.log(`   Still need enrichment: ${after.still_need_enrichment}\n`)

  // Get wallet count
  const walletsResult = await clickhouse.query({
    query: `SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw WHERE market_id != ''`,
    format: 'JSONEachRow'
  })
  const walletsData = await walletsResult.json<any>()

  console.log('═══════════════════════════════════════════════════════════')
  console.log('✅ NUCLEAR BACKFILL COMPLETE!')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`   Enriched ${enriched} additional trades`)
  console.log(`   Total enriched wallets: ${walletsData[0].count}`)
  console.log(`   Ready for metrics computation`)
  console.log('═══════════════════════════════════════════════════════════\n')
}

nuclearBackfill().catch(console.error)
