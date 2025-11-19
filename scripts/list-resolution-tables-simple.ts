#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('🔍 LISTING ALL RESOLUTION-RELATED TABLES\n')

  const result = await clickhouse.query({
    query: `
      SELECT
        database,
        name as table_name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE (
        lower(name) LIKE '%resolution%'
        OR lower(name) LIKE '%payout%'
        OR lower(name) LIKE '%outcome%'
        OR lower(name) LIKE '%winner%'
      )
      AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  })

  const tables = await result.json<{
    database: string
    table_name: string
    engine: string
    total_rows: number
    size: string
  }>()

  console.log(`Found ${tables.length} resolution-related tables:\n`)
  console.log('='.repeat(100))
  console.log('DATABASE'.padEnd(20) + 'TABLE NAME'.padEnd(40) + 'ROWS'.padEnd(15) + 'SIZE'.padEnd(15) + 'ENGINE')
  console.log('='.repeat(100))

  for (const table of tables) {
    const rows = table.total_rows !== null ? table.total_rows.toLocaleString() : 'N/A'
    const size = table.size || 'N/A'
    console.log(
      table.database.padEnd(20) +
      table.table_name.padEnd(40) +
      rows.padEnd(15) +
      size.padEnd(15) +
      table.engine
    )
  }

  console.log('='.repeat(100))

  // Check for market_resolutions_final specifically
  const mrf = tables.find(t => t.table_name === 'market_resolutions_final')
  if (mrf) {
    console.log(`\n✅ FOUND: market_resolutions_final`)
    console.log(`   Database: ${mrf.database}`)
    console.log(`   Rows: ${mrf.total_rows.toLocaleString()}`)
    console.log(`   Size: ${mrf.size}`)
    console.log(`   Engine: ${mrf.engine}`)

    // Get schema
    console.log('\n📋 Schema:')
    const schemaResult = await clickhouse.query({
      query: `DESCRIBE TABLE ${mrf.database}.${mrf.table_name}`,
      format: 'JSONEachRow'
    })
    const schema = await schemaResult.json<{ name: string; type: string }>()
    for (const col of schema) {
      console.log(`   ${col.name.padEnd(30)} ${col.type}`)
    }

    // Get sample
    console.log('\n📊 Sample data (2 rows):')
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          winning_index,
          winning_outcome,
          source
        FROM ${mrf.database}.${mrf.table_name}
        LIMIT 2
      `,
      format: 'JSONEachRow'
    })
    const samples = await sampleResult.json()
    console.log(JSON.stringify(samples, null, 2))
  } else {
    console.log('\n❌ market_resolutions_final NOT FOUND')
  }

  // Also check for other key tables
  console.log('\n\n🔍 Checking for other key tables:')
  const keyTables = ['wallet_resolution_outcomes', 'market_resolutions', 'resolutions_norm']
  for (const tableName of keyTables) {
    const found = tables.find(t => t.table_name === tableName)
    if (found) {
      console.log(`   ✅ ${tableName}: ${found.total_rows.toLocaleString()} rows in ${found.database}`)
    } else {
      console.log(`   ❌ ${tableName}: NOT FOUND`)
    }
  }

  console.log('\n')
}

main().catch(console.error)
