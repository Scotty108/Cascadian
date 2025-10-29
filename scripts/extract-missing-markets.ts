#!/usr/bin/env tsx
/**
 * Phase 0 Task 0.1: Extract missing market IDs
 * Find all market_ids in trades_raw that don't exist in markets_dim
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('📍 Phase 0 Task 0.1: Extract missing market IDs\n')

  // Query to find markets in trades_raw but not in markets_dim
  // Use NOT IN subquery since LEFT JOIN might not work as expected
  const query = `
    SELECT DISTINCT market_id
    FROM trades_raw
    WHERE market_id != ''
      AND market_id NOT IN (SELECT DISTINCT market_id FROM markets_dim)
    ORDER BY market_id
  `

  console.log('Running query to find missing markets...')
  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    request_timeout: 600000, // 10 minutes in milliseconds
    clickhouse_settings: {
      max_execution_time: 600, // 10 minutes in seconds
    }
  })

  const rows = await result.json<{ market_id: string }>()
  console.log(`✅ Found ${rows.length} missing market IDs`)

  // Write to JSONL
  const outputPath = resolve(process.cwd(), 'runtime/missing_market_ids.jsonl')
  const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + '\n'
  fs.writeFileSync(outputPath, jsonl)
  console.log(`✅ Wrote ${outputPath}`)

  // Log count
  console.log(`\n📊 Summary:`)
  console.log(`   Missing markets: ${rows.length}`)

  process.exit(0)
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
