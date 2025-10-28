#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  // Load enrichment map condition_ids
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const markets = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
  const seedConditionIds = new Set(markets.map((m: any) => m.condition_id))

  console.log(`Seed files have ${seedConditionIds.size} condition_ids\n`)

  // Get first 10 condition_ids from ClickHouse
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM condition_market_map
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })

  const rows = await result.json() as any[]
  console.log('First 10 condition_ids from ClickHouse condition_market_map:')
  for (const row of rows) {
    const inSeed = seedConditionIds.has(row.condition_id)
    console.log(`  ${row.condition_id} - ${inSeed ? '✅ IN SEED' : '❌ NOT IN SEED'}`)
  }

  // Check for overlap
  const chConditionIds = rows.map((r: any) => r.condition_id)
  const overlap = chConditionIds.filter((c: string) => seedConditionIds.has(c))
  console.log(`\nOverlap: ${overlap.length} / ${rows.length} (from this sample)`)
}

main()
