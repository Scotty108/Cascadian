#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@clickhouse/client'
import { resolveTokenId } from '../lib/goldsky/client'

const ch = createClient({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
})

/**
 * BUILD TOKEN → CONDITION MAPPING
 *
 * Queries Goldsky subgraph for each unique token_id from erc1155_transfers
 * and builds a mapping table for market_id recovery.
 *
 * ESTIMATED TIME: 1-2 hours for ~150K unique token_ids
 * (50ms per query + backoff/retry logic)
 */

async function q(sql: string) {
  const r = await ch.query({ query: sql, format: 'JSONEachRow' })
  return await r.json()
}

interface TokenMapping {
  token_id: string
  condition_id: string
  outcome_index: number
}

async function buildTokenConditionMap() {
  console.log('═'.repeat(70))
  console.log('BUILDING TOKEN → CONDITION MAPPING VIA GOLDSKY')
  console.log('═'.repeat(70))
  console.log()

  // Step 1: Get unique token_ids from temp table
  console.log('Step 1: Extracting unique token_ids...')

  const tokenIds = await q(`
    SELECT DISTINCT token_id
    FROM temp_tx_to_token
    WHERE token_id != '0x0'
      AND token_id != '0'
      AND length(token_id) > 10
    ORDER BY token_id
  `)

  console.log(`  Found ${tokenIds.length.toLocaleString()} unique token_ids to resolve`)
  console.log()

  // Step 2: Create token_condition_map table
  console.log('Step 2: Creating token_condition_map table...')

  await ch.exec({
    query: `
      CREATE TABLE IF NOT EXISTS token_condition_map (
        token_id String,
        condition_id String,
        outcome_index UInt8
      )
      ENGINE = MergeTree
      ORDER BY token_id
    `
  })

  console.log('  ✅ Table ready')
  console.log()

  // Step 3: Check for existing mappings (resume capability)
  const existing = await q(`SELECT COUNT(*) as n FROM token_condition_map`)
  const existingCount = Number(existing[0].n)

  if (existingCount > 0) {
    console.log(`  Found ${existingCount.toLocaleString()} existing mappings`)
    console.log('  Will skip already-resolved token_ids')
    console.log()
  }

  // Step 4: Load existing mappings into Set for quick lookup
  const existingTokenIds = new Set<string>()
  if (existingCount > 0) {
    const existingData = await q(`SELECT DISTINCT token_id FROM token_condition_map`)
    existingData.forEach((row: any) => existingTokenIds.add(row.token_id))
  }

  // Step 5: Resolve token_ids via Goldsky
  console.log('Step 3: Resolving token_ids via Goldsky subgraph...')
  console.log(`  Total to process: ${tokenIds.length.toLocaleString()}`)
  console.log(`  Already resolved: ${existingCount.toLocaleString()}`)
  console.log(`  Remaining: ${(tokenIds.length - existingCount).toLocaleString()}`)
  console.log()

  const batchSize = 100 // Insert every 100 mappings
  const batch: TokenMapping[] = []
  let resolved = 0
  let failed = 0
  let skipped = 0

  const startTime = Date.now()

  for (let i = 0; i < tokenIds.length; i++) {
    const tokenId = tokenIds[i].token_id

    // Skip if already resolved
    if (existingTokenIds.has(tokenId)) {
      skipped++
      continue
    }

    // Resolve via Goldsky
    const tokenInfo = await resolveTokenId(tokenId)

    if (tokenInfo && tokenInfo.condition) {
      batch.push({
        token_id: tokenId,
        condition_id: tokenInfo.condition.id,
        outcome_index: parseInt(tokenInfo.outcomeIndex),
      })
      resolved++
    } else {
      failed++
    }

    // Insert batch
    if (batch.length >= batchSize) {
      await ch.insert({
        table: 'token_condition_map',
        values: batch,
        format: 'JSONEachRow',
      })
      batch.length = 0 // Clear batch
    }

    // Progress update every 100 tokens
    if ((i + 1) % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000
      const rate = (resolved + failed + skipped) / elapsed
      const remaining = tokenIds.length - (i + 1)
      const etaSeconds = remaining / rate
      const etaMinutes = (etaSeconds / 60).toFixed(1)

      console.log(`  Progress: ${i + 1}/${tokenIds.length} | Resolved: ${resolved} | Failed: ${failed} | Skipped: ${skipped} | ETA: ${etaMinutes}min`)
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    await ch.insert({
      table: 'token_condition_map',
      values: batch,
      format: 'JSONEachRow',
    })
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  console.log()
  console.log('═'.repeat(70))
  console.log('COMPLETE')
  console.log('═'.repeat(70))
  console.log(`  Resolved: ${resolved.toLocaleString()}`)
  console.log(`  Failed: ${failed.toLocaleString()}`)
  console.log(`  Skipped (already exist): ${skipped.toLocaleString()}`)
  console.log(`  Total time: ${totalTime} minutes`)
  console.log()

  // Verify final count
  const finalCount = await q(`SELECT COUNT(*) as n FROM token_condition_map`)
  console.log(`  Total mappings in table: ${Number(finalCount[0].n).toLocaleString()}`)
  console.log()
  console.log('Next step: Run recovery script')
  console.log('  npx tsx agents/recover-market-ids-via-tx-hash.ts')
  console.log()
}

buildTokenConditionMap().catch(console.error)
