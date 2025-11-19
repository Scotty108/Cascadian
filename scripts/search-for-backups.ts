#!/usr/bin/env npx tsx
/**
 * SEARCH FOR BACKUP TABLES
 * Look for any tables that might contain our lost data
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function searchForBackups() {
  const client = getClickHouseClient()

  console.log('\n🔍 Searching for backup tables...\n')

  try {
    // Check all tables in all databases
    console.log('=== All Tables Across All Databases ===')
    const tablesResult = await client.query({
      query: `
        SELECT
          database,
          name as table_name,
          total_rows,
          total_bytes
        FROM system.tables
        WHERE database != 'system'
          AND database != 'INFORMATION_SCHEMA'
          AND database != 'information_schema'
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow',
    })
    const tables = await tablesResult.json<any>()

    console.log('\nTables with >100K rows:')
    tables
      .filter((t: any) => t.total_rows > 100000)
      .forEach((t: any) => {
        console.log(`  ${t.database}.${t.table_name}: ${t.total_rows.toLocaleString()} rows`)
      })

    // Look for anything with 'erc1155' or 'transfer' or 'backup' in the name
    console.log('\n=== Tables with "erc1155", "transfer", or "backup" in name ===')
    const relevantTables = tables.filter((t: any) =>
      t.table_name.toLowerCase().includes('erc1155') ||
      t.table_name.toLowerCase().includes('transfer') ||
      t.table_name.toLowerCase().includes('backup') ||
      t.table_name.toLowerCase().includes('tmp_block')
    )

    relevantTables.forEach((t: any) => {
      console.log(`\n${t.database}.${t.table_name}:`)
      console.log(`  Rows: ${t.total_rows.toLocaleString()}`)
      console.log(`  Size: ${(t.total_bytes / 1024 / 1024).toFixed(2)} MB`)
    })

    // Check for detached partitions
    console.log('\n=== Checking for Detached Partitions ===')
    const detachedResult = await client.query({
      query: `
        SELECT
          database,
          table,
          name as partition_name,
          reason
        FROM system.detached_parts
        WHERE database != 'system'
      `,
      format: 'JSONEachRow',
    })
    const detached = await detachedResult.json<any>()

    if (detached.length > 0) {
      console.log('Found detached partitions:')
      detached.forEach((d: any) => {
        console.log(`  ${d.database}.${d.table} partition ${d.partition_name}: ${d.reason}`)
      })
    } else {
      console.log('No detached partitions found')
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message)
  } finally {
    await client.close()
  }
}

searchForBackups().catch(console.error)
