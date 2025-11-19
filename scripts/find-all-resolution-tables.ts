#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('🔍 SEARCHING FOR ALL RESOLUTION-RELATED TABLES\n')
  console.log('=' .repeat(80))

  // Get all databases
  const dbResult = await clickhouse.query({
    query: 'SHOW DATABASES',
    format: 'JSONEachRow'
  })
  const databases = await dbResult.json<{ name: string }>()
  console.log(`\n📊 Found ${databases.length} databases\n`)

  const resolutionTables: Array<{
    database: string
    table: string
    engine: string
    total_rows: number
    size: string
  }> = []

  // Search each database for resolution-related tables
  for (const db of databases) {
    const dbName = db.name
    if (dbName === 'system' || dbName === 'information_schema' || dbName === 'INFORMATION_SCHEMA') {
      continue
    }

    try {
      const tableResult = await clickhouse.query({
        query: `
          SELECT
            database,
            name,
            engine,
            total_rows,
            formatReadableSize(total_bytes) as size
          FROM system.tables
          WHERE database = '${dbName}'
            AND (
              lower(name) LIKE '%resolution%'
              OR lower(name) LIKE '%payout%'
              OR lower(name) LIKE '%outcome%'
              OR lower(name) LIKE '%winner%'
              OR lower(name) LIKE '%market_resolution%'
            )
          ORDER BY total_rows DESC
        `,
        format: 'JSONEachRow'
      })

      const tables = await tableResult.json<{
        database: string
        name: string
        engine: string
        total_rows: number
        size: string
      }>()

      resolutionTables.push(...tables)
    } catch (error) {
      console.log(`⚠️  Skipped database ${dbName}:`, (error as Error).message)
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('📋 RESOLUTION-RELATED TABLES FOUND')
  console.log('='.repeat(80) + '\n')

  if (resolutionTables.length === 0) {
    console.log('❌ NO RESOLUTION TABLES FOUND!\n')
    return
  }

  resolutionTables.sort((a, b) => b.total_rows - a.total_rows)

  for (const table of resolutionTables) {
    const tableName = (table as any).name || table.table || 'unknown'
    console.log(`\n📦 ${table.database}.${tableName}`)
    console.log(`   Engine: ${table.engine}`)
    console.log(`   Rows: ${table.total_rows.toLocaleString()}`)
    console.log(`   Size: ${table.size}`)
  }

  console.log('\n' + '='.repeat(80))
  console.log('🔎 DETAILED SCHEMA FOR KEY TABLES')
  console.log('='.repeat(80))

  // Get schema for market_resolutions_final
  const keyTables = [
    'market_resolutions_final',
    'wallet_resolution_outcomes',
    'market_resolutions',
    'resolutions_norm'
  ]

  for (const tableName of keyTables) {
    const found = resolutionTables.find(t => {
      const name = (t as any).name || t.table
      return name === tableName
    })
    if (!found) continue

    const actualTableName = (found as any).name || found.table
    console.log(`\n\n📋 Schema for ${found.database}.${actualTableName}:`)
    console.log('-'.repeat(80))

    try {
      const schemaResult = await clickhouse.query({
        query: `DESCRIBE TABLE ${found.database}.${actualTableName}`,
        format: 'JSONEachRow'
      })

      const schema = await schemaResult.json<{
        name: string
        type: string
        default_type: string
        default_expression: string
        comment: string
      }>()

      console.log('\nColumns:')
      for (const col of schema) {
        console.log(`  ${col.name.padEnd(25)} ${col.type.padEnd(30)} ${col.comment || ''}`)
      }

      // Get sample data
      console.log('\nSample Data (first 3 rows):')
      const sampleResult = await clickhouse.query({
        query: `SELECT * FROM ${found.database}.${actualTableName} LIMIT 3`,
        format: 'JSONEachRow'
      })

      const samples = await sampleResult.json()
      console.log(JSON.stringify(samples, null, 2))

    } catch (error) {
      console.log(`   ⚠️  Could not get schema: ${(error as Error).message}`)
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('✅ SCAN COMPLETE')
  console.log('='.repeat(80))

  // Summary
  console.log('\n📊 SUMMARY:')
  console.log(`   Total resolution tables found: ${resolutionTables.length}`)
  console.log(`   Tables with data (rows > 0): ${resolutionTables.filter(t => t.total_rows > 0).length}`)
  const largestName = (resolutionTables[0] as any)?.name || resolutionTables[0]?.table || 'N/A'
  const largestRows = resolutionTables[0]?.total_rows?.toLocaleString() || '0'
  console.log(`   Largest table: ${largestName} (${largestRows} rows)`)

  // Check if market_resolutions_final exists
  const mrfExists = resolutionTables.find(t => {
    const name = (t as any).name || t.table
    return name === 'market_resolutions_final'
  })
  if (mrfExists) {
    const name = (mrfExists as any).name || mrfExists.table
    console.log(`\n✅ ${name} EXISTS in database: ${mrfExists.database}`)
    console.log(`   Rows: ${mrfExists.total_rows.toLocaleString()}`)
    console.log(`   Size: ${mrfExists.size}`)
  } else {
    console.log(`\n❌ market_resolutions_final DOES NOT EXIST`)
  }

  console.log('\n')
}

main().catch(console.error)
