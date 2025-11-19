#!/usr/bin/env npx tsx
/**
 * CHECK BACKUP TABLE SCHEMA
 * Understand what fields are available in the backup table
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkBackupSchema() {
  const client = getClickHouseClient()

  try {
    console.log('\n🔍 CHECKING BACKUP TABLE SCHEMA\n')

    // List all PnL-related tables
    const tablesResult = await client.query({
      query: `
        SELECT
          name,
          engine,
          total_rows,
          formatReadableSize(total_bytes) as size
        FROM system.tables
        WHERE database = 'default'
          AND (name LIKE '%pnl%' OR name LIKE '%backup%')
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    })
    const tables = await tablesResult.json<any>()

    console.log('All PnL/backup tables:')
    tables.forEach((t: any) => {
      console.log(`  - ${t.name} (${t.engine}): ${parseInt(t.total_rows).toLocaleString()} rows, ${t.size}`)
    })
    console.log('')

    // Get schema for vw_wallet_pnl_calculated_backup if it exists
    const backupExists = tables.some((t: any) => t.name === 'vw_wallet_pnl_calculated_backup')

    if (backupExists) {
      console.log('\n📋 Schema for vw_wallet_pnl_calculated_backup:\n')

      const schemaResult = await client.query({
        query: `DESCRIBE TABLE vw_wallet_pnl_calculated_backup`,
        format: 'JSONEachRow'
      })
      const schema = await schemaResult.json<any>()

      schema.forEach((col: any) => {
        console.log(`  ${col.name}: ${col.type}`)
      })

      // Sample 5 rows
      console.log('\n📊 Sample 5 rows:\n')
      const sampleResult = await client.query({
        query: `SELECT * FROM vw_wallet_pnl_calculated_backup LIMIT 5`,
        format: 'JSONEachRow'
      })
      const sample = await sampleResult.json<any>()

      sample.forEach((row: any, idx: number) => {
        console.log(`Row ${idx + 1}:`)
        Object.keys(row).forEach(key => {
          console.log(`  ${key}: ${row[key]}`)
        })
        console.log('')
      })
    }

    // Check realized_pnl_by_market_final schema
    console.log('\n📋 Schema for realized_pnl_by_market_final:\n')

    const prodSchemaResult = await client.query({
      query: `DESCRIBE TABLE realized_pnl_by_market_final`,
      format: 'JSONEachRow'
    })
    const prodSchema = await prodSchemaResult.json<any>()

    prodSchema.forEach((col: any) => {
      console.log(`  ${col.name}: ${col.type}`)
    })

    // Sample 5 rows
    console.log('\n📊 Sample 5 rows:\n')
    const prodSampleResult = await client.query({
      query: `SELECT * FROM realized_pnl_by_market_final LIMIT 5`,
      format: 'JSONEachRow'
    })
    const prodSample = await prodSampleResult.json<any>()

    prodSample.forEach((row: any, idx: number) => {
      console.log(`Row ${idx + 1}:`)
      Object.keys(row).forEach(key => {
        console.log(`  ${key}: ${row[key]}`)
      })
      console.log('')
    })

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
  } finally {
    await client.close()
  }
}

checkBackupSchema()
