#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

interface TableInfo {
  name: string
  engine: string
  total_rows: number
  total_bytes: number
  category: string
}

async function getAllTables(): Promise<TableInfo[]> {
  const result = await clickhouse.query({
    query: `
      SELECT
        name,
        engine,
        total_rows,
        total_bytes
      FROM system.tables
      WHERE database = 'default'
        AND name NOT LIKE '.%'
        AND name NOT LIKE 'system%'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  })

  return await result.json() as TableInfo[]
}

async function categorizeTable(tableName: string): Promise<string> {
  // Core raw data sources
  if (['erc1155_transfers', 'erc1155_transfers_staging', 'erc20_transfers', 'erc20_transfers_staging', 'pm_erc1155_flats', 'events_dim'].includes(tableName)) {
    return 'RAW_DATA_SOURCE'
  }

  // Canonical/deduplicated data
  if (tableName.includes('canonical') || tableName.includes('dedup') || tableName === 'trades_raw' || tableName === 'pm_trades') {
    return 'CANONICAL_TRADE_DATA'
  }

  // Market/condition metadata
  if (tableName.includes('market') && (tableName.includes('dim') || tableName.includes('metadata') || tableName.includes('map') || tableName.includes('catalog') || tableName.includes('outcome'))) {
    return 'MARKET_METADATA'
  }

  // Resolution data
  if (tableName.includes('resolution') || tableName.includes('gamma_') || tableName.includes('ctf_')) {
    return 'RESOLUTION_DATA'
  }

  // P&L calculations
  if (tableName.includes('pnl') || tableName.includes('wallet_') || tableName.includes('position') || tableName.includes('cashflow')) {
    return 'PNL_CALCULATION'
  }

  // Analytics/metrics
  if (tableName.includes('metric') || tableName.includes('analytics') || tableName.includes('category') || tableName.includes('candle') || tableName.includes('price') || tableName.includes('momentum') || tableName.includes('signal')) {
    return 'ANALYTICS_METRICS'
  }

  // Mapping/bridge tables
  if (tableName.includes('map') || tableName.includes('bridge') || tableName.includes('proxy')) {
    return 'MAPPING_TABLES'
  }

  // Operational/temporary
  if (tableName.includes('backup') || tableName.includes('old') || tableName.includes('temp') || tableName.includes('staging') || tableName.includes('checkpoint') || tableName.includes('migration') || tableName.includes('_v1') || tableName.includes('broken')) {
    return 'TECHNICAL_DEBT'
  }

  return 'OTHER'
}

async function analyzeTableDependencies(tableName: string): Promise<string[]> {
  try {
    // Get the CREATE VIEW statement if it's a view
    const result = await clickhouse.query({
      query: `SHOW CREATE TABLE ${tableName}`,
      format: 'TSVRaw'
    })

    const createStatement = await result.text()

    // Extract table names from the CREATE statement
    const tablePattern = /(?:FROM|JOIN)\s+(\w+)/gi
    const matches = [...createStatement.matchAll(tablePattern)]
    const dependencies = matches.map(m => m[1]).filter(t => t !== tableName)

    return [...new Set(dependencies)]
  } catch (err) {
    return []
  }
}

async function getTableColumns(tableName: string): Promise<string[]> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = 'default'
          AND table = '${tableName}'
        ORDER BY position
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })

    const cols = await result.json() as { name: string, type: string }[]
    return cols.map(c => `${c.name}: ${c.type}`)
  } catch {
    return []
  }
}

async function main() {
  console.log('=' .repeat(100))
  console.log('COMPREHENSIVE CLICKHOUSE TABLE AUDIT')
  console.log('=' .repeat(100))
  console.log()

  const tables = await getAllTables()
  console.log(`Total tables found: ${tables.length}\n`)

  // Categorize all tables
  const categorized = new Map<string, TableInfo[]>()

  for (const table of tables) {
    const category = await categorizeTable(table.name)
    if (!categorized.has(category)) {
      categorized.set(category, [])
    }
    categorized.get(category)!.push(table)
  }

  // Display by category
  const categoryOrder = [
    'RAW_DATA_SOURCE',
    'CANONICAL_TRADE_DATA',
    'MARKET_METADATA',
    'RESOLUTION_DATA',
    'PNL_CALCULATION',
    'ANALYTICS_METRICS',
    'MAPPING_TABLES',
    'TECHNICAL_DEBT',
    'OTHER'
  ]

  for (const category of categoryOrder) {
    const categoryTables = categorized.get(category) || []
    if (categoryTables.length === 0) continue

    console.log('\n' + '─'.repeat(100))
    console.log(`${category} (${categoryTables.length} tables)`)
    console.log('─'.repeat(100))

    // Sort by row count descending
    categoryTables.sort((a, b) => b.total_rows - a.total_rows)

    for (const table of categoryTables) {
      const rowCount = (table.total_rows || 0).toLocaleString()
      const size = ((table.total_bytes || 0) / 1024 / 1024).toFixed(2) + ' MB'

      console.log(`\n  ${table.name}`)
      console.log(`    Rows: ${rowCount.padStart(15)} | Engine: ${table.engine.padEnd(20)} | Size: ${size}`)
    }
  }

  // Summary statistics
  console.log('\n\n' + '='.repeat(100))
  console.log('SUMMARY STATISTICS')
  console.log('='.repeat(100))

  for (const [category, tables] of categorized) {
    const totalRows = tables.reduce((sum, t) => sum + (t.total_rows || 0), 0)
    const totalBytes = tables.reduce((sum, t) => sum + (t.total_bytes || 0), 0)
    const sizeMB = (totalBytes / 1024 / 1024).toFixed(2)

    console.log(`\n${category}:`)
    console.log(`  Tables: ${tables.length}`)
    console.log(`  Total Rows: ${totalRows.toLocaleString()}`)
    console.log(`  Total Size: ${sizeMB} MB`)
  }

  // Identify technical debt
  console.log('\n\n' + '='.repeat(100))
  console.log('TECHNICAL DEBT ANALYSIS')
  console.log('='.repeat(100))

  const debtTables = categorized.get('TECHNICAL_DEBT') || []
  const backups = debtTables.filter(t => t.name.includes('backup'))
  const olds = debtTables.filter(t => t.name.includes('_old') || t.name.includes('_v1'))
  const broken = debtTables.filter(t => t.name.includes('broken') || t.name.includes('bad'))
  const temps = debtTables.filter(t => t.name.includes('temp') || t.name.includes('staging'))

  console.log('\nBackup tables (can likely delete):')
  backups.forEach(t => console.log(`  - ${t.name} (${(t.total_rows || 0).toLocaleString()} rows)`))

  console.log('\nOld/versioned tables (consolidation candidates):')
  olds.forEach(t => console.log(`  - ${t.name} (${(t.total_rows || 0).toLocaleString()} rows)`))

  console.log('\nBroken tables (investigate & delete):')
  broken.forEach(t => console.log(`  - ${t.name} (${(t.total_rows || 0).toLocaleString()} rows)`))

  console.log('\nTemporary tables (verify usage & delete):')
  temps.forEach(t => console.log(`  - ${t.name} (${(t.total_rows || 0).toLocaleString()} rows)`))

  // Analyze P&L tables specifically
  console.log('\n\n' + '='.repeat(100))
  console.log('P&L TABLE ANALYSIS')
  console.log('='.repeat(100))

  const pnlTables = categorized.get('PNL_CALCULATION') || []

  console.log('\nAll P&L-related tables:')
  for (const table of pnlTables) {
    console.log(`\n  ${table.name} (${(table.total_rows || 0).toLocaleString()} rows)`)

    // Get column info
    const columns = await getTableColumns(table.name)
    if (columns.length > 0) {
      console.log('    Key columns:')
      columns.slice(0, 10).forEach(col => console.log(`      - ${col}`))
      if (columns.length > 10) {
        console.log(`      ... and ${columns.length - 10} more`)
      }
    }
  }

  console.log('\n\n' + '='.repeat(100))
  console.log('AUDIT COMPLETE')
  console.log('='.repeat(100))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
