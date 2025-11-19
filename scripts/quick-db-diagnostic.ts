#!/usr/bin/env tsx
/**
 * Quick ClickHouse Database Diagnostic
 * Analyzes the current database state for architecture audit
 */

import { createClient } from '@clickhouse/client'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD!,
    database: process.env.CLICKHOUSE_DATABASE || 'default',
  })

  console.log('CASCADIAN DATABASE ARCHITECTURE AUDIT')
  console.log('=' .repeat(80))
  console.log()

  // 1. List all tables with row counts
  console.log('1. ALL TABLES AND ROW COUNTS')
  console.log('-'.repeat(80))
  const tablesResult = await client.query({
    query: `
      SELECT
        name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size,
        partition_key,
        sorting_key
      FROM system.tables
      WHERE database = currentDatabase()
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  })
  const tables = await tablesResult.json<any>()
  for (const table of tables) {
    const totalRows = table.total_rows !== null ? String(table.total_rows) : '0'
    const size = table.size || '0 B'
    console.log(`${table.name.padEnd(40)} ${totalRows.padStart(15)} rows  ${size.padStart(10)}  ${table.engine}`)
  }

  console.log()
  console.log('2. TRADES DATA STRUCTURE')
  console.log('-'.repeat(80))

  // Check for key tables
  const keyTables = ['trades_raw', 'pm_trades', 'trade_cashflows_v3', 'trades_canonical_v3']
  for (const tableName of keyTables) {
    try {
      const schemaResult = await client.query({
        query: `
          SELECT name, type
          FROM system.columns
          WHERE database = currentDatabase() AND table = '${tableName}'
          ORDER BY position
        `,
        format: 'JSONEachRow'
      })
      const columns = await schemaResult.json<any>()

      if (columns.length > 0) {
        console.log(`\nTable: ${tableName}`)
        for (const col of columns) {
          console.log(`  ${col.name.padEnd(30)} ${col.type}`)
        }
      }
    } catch (e) {
      console.log(`\nTable: ${tableName} - NOT FOUND`)
    }
  }

  console.log()
  console.log('3. P&L CALCULATION TABLES')
  console.log('-'.repeat(80))

  const pnlTables = [
    'wallet_pnl_summary_v2',
    'realized_pnl_by_market_v2',
    'trade_cashflows_v3',
    'wallet_resolution_outcomes'
  ]

  for (const tableName of pnlTables) {
    try {
      const result = await client.query({
        query: `SELECT COUNT(*) as count FROM ${tableName}`,
        format: 'JSONEachRow'
      })
      const data = await result.json<any>()
      console.log(`${tableName.padEnd(40)} ${data[0].count} rows`)
    } catch (e) {
      console.log(`${tableName.padEnd(40)} NOT FOUND`)
    }
  }

  console.log()
  console.log('4. MARKET RESOLUTION STATUS')
  console.log('-'.repeat(80))

  try {
    const resolutionResult = await client.query({
      query: `
        SELECT
          COUNT(*) as total_markets,
          SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) as resolved_markets,
          SUM(CASE WHEN is_resolved = 0 THEN 1 ELSE 0 END) as unresolved_markets
        FROM market_resolutions_final
      `,
      format: 'JSONEachRow'
    })
    const resolutionData = await resolutionResult.json<any>()
    console.log(`Total markets: ${resolutionData[0].total_markets}`)
    console.log(`Resolved: ${resolutionData[0].resolved_markets}`)
    console.log(`Unresolved: ${resolutionData[0].unresolved_markets}`)
  } catch (e) {
    console.log('market_resolutions_final table not found')
  }

  console.log()
  console.log('5. CATEGORIZATION STATUS')
  console.log('-'.repeat(80))

  try {
    const categoryResult = await client.query({
      query: `
        SELECT
          category,
          COUNT(*) as count
        FROM gamma_markets
        WHERE category != ''
        GROUP BY category
        ORDER BY count DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })
    const categories = await categoryResult.json<any>()
    for (const cat of categories) {
      console.log(`${cat.category.padEnd(30)} ${cat.count} markets`)
    }
  } catch (e) {
    console.log('gamma_markets table not found or no category data')
  }

  console.log()
  console.log('6. WALLET ANALYTICS')
  console.log('-'.repeat(80))

  try {
    // Count unique wallets from trades
    const walletResult = await client.query({
      query: `
        SELECT COUNT(DISTINCT wallet_address) as unique_wallets
        FROM trades_raw
      `,
      format: 'JSONEachRow'
    })
    const walletData = await walletResult.json<any>()
    console.log(`Unique wallets in trades_raw: ${walletData[0].unique_wallets}`)
  } catch (e) {
    console.log('Could not count wallets from trades_raw')
  }

  // Check wallet metrics tables
  const walletTables = ['wallet_metrics_complete', 'wallet_metrics_by_category']
  for (const tableName of walletTables) {
    try {
      const result = await client.query({
        query: `SELECT COUNT(*) as count FROM ${tableName}`,
        format: 'JSONEachRow'
      })
      const data = await result.json<any>()
      console.log(`${tableName.padEnd(40)} ${data[0].count} rows`)
    } catch (e) {
      console.log(`${tableName.padEnd(40)} NOT FOUND`)
    }
  }

  console.log()
  console.log('7. EVENT MAPPING')
  console.log('-'.repeat(80))

  const eventTables = [
    'pm_erc1155_flats',
    'pm_user_proxy_wallets',
    'condition_market_map',
    'ctf_token_map'
  ]

  for (const tableName of eventTables) {
    try {
      const result = await client.query({
        query: `SELECT COUNT(*) as count FROM ${tableName}`,
        format: 'JSONEachRow'
      })
      const data = await result.json<any>()
      console.log(`${tableName.padEnd(40)} ${data[0].count} rows`)
    } catch (e) {
      console.log(`${tableName.padEnd(40)} NOT FOUND`)
    }
  }

  console.log()
  console.log('=' .repeat(80))
  console.log('AUDIT COMPLETE')

  await client.close()
}

main().catch(console.error)
