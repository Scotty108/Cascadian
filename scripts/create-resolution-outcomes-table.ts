#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('🔧 Creating wallet_resolution_outcomes table\n')

  const sql = fs.readFileSync(
    resolve(process.cwd(), 'migrations/clickhouse/015_create_wallet_resolution_outcomes.sql'),
    'utf-8'
  )

  await clickhouse.command({ query: sql })
  console.log('✅ Table wallet_resolution_outcomes created\n')

  // Verify
  const result = await clickhouse.query({
    query: 'DESCRIBE TABLE wallet_resolution_outcomes',
    format: 'JSONEachRow'
  })

  const rows = await result.json() as any[]
  console.log('Table schema:')
  for (const row of rows) {
    console.log(`  ${row.name}: ${row.type}`)
  }
}

main()
