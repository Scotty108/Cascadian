#!/usr/bin/env tsx
/**
 * Delete placeholder token_* trades for wallets we're about to reload
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import fs from 'fs'

async function deletePlaceholderTrades() {
  console.log('🗑️  Deleting placeholder trades for wallets to reload...\n')

  // Read wallet list
  const wallets = fs.readFileSync('./runtime/placeholder_wallets_to_reload.txt', 'utf-8')
    .split('\n')
    .filter(Boolean)

  console.log(`   Found ${wallets.length} wallets to clean\n`)

  // Delete in batches to avoid query size limits
  const BATCH_SIZE = 1000
  let deleted = 0

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(wallets.length / BATCH_SIZE)

    process.stdout.write(`   Batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`)

    try {
      await clickhouse.command({
        query: `
          ALTER TABLE trades_raw
          DELETE WHERE wallet_address IN (${batch.map(w => `'${w}'`).join(',')})
            AND condition_id LIKE 'token_%'
        `
      })

      deleted++
      console.log(` ✅`)
    } catch (error) {
      console.log(` ❌ ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log(`\n✅ Issued ${deleted} deletion batches`)
  console.log(`⏳ Waiting 5s for deletions to apply...\n`)

  await new Promise(resolve => setTimeout(resolve, 5000))

  // Verify
  const result = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM trades_raw
      WHERE condition_id LIKE 'token_%'
    `,
    format: 'JSONEachRow'
  })
  const data = await result.json()

  console.log(`📊 Remaining placeholder trades: ${data[0].count}`)
  console.log(`✅ Ready to load real trades!\n`)
}

deletePlaceholderTrades().catch(console.error)
