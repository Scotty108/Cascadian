#!/usr/bin/env tsx
/**
 * Build Token ID Cache from Existing Trades
 *
 * Extracts all unique token IDs from existing trades_raw data
 * and resolves them to condition_id + outcome mappings.
 * Saves to JSON file for fast lookups during bulk load.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'
import { resolveTokenId } from '@/lib/goldsky/client'

const CACHE_FILE = resolve(process.cwd(), 'runtime/token-id-cache.json')

interface TokenMapping {
  tokenId: string
  conditionId: string
  outcome: number
}

async function main() {
  console.log('🔧 Building Token ID Cache from Existing Trades\n')

  // Step 1: Extract unique token IDs from existing trades_raw
  console.log('📊 Querying unique token IDs from trades_raw...')

  const query = `
    SELECT DISTINCT condition_id
    FROM trades_raw
    WHERE condition_id != ''
    ORDER BY condition_id
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data = await result.json() as Array<{ condition_id: string }>
  const uniqueConditions = data.map(row => row.condition_id)

  console.log(`✅ Found ${uniqueConditions.length} unique condition IDs\n`)

  // Step 2: For conditions we already have, we don't need token IDs
  // The cache will be built as we process new trades
  // Just create an empty cache file for now

  const cache: Record<string, { condition: string; outcome: number }> = {}

  // Save cache
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))

  console.log(`✅ Token cache initialized at: ${CACHE_FILE}`)
  console.log(`📊 Cache will be populated during load process\n`)
}

main().catch(console.error)
