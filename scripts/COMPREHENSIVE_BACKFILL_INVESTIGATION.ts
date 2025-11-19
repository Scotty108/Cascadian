#!/usr/bin/env tsx
/**
 * COMPREHENSIVE BACKFILL INVESTIGATION
 *
 * Mission: Determine if we can backfill missing Polymarket trade data from existing ClickHouse tables
 *
 * Test Case: Wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad
 * - Current: 31 markets in vw_trades_canonical
 * - Polymarket Claims: 2,816 predictions
 * - Gap: ~2,785 markets missing
 *
 * Investigation Phases:
 * 1. Complete table inventory (all databases)
 * 2. Hunt for wallet data across all tables
 * 3. Data reconciliation and gap analysis
 * 4. Backfill feasibility assessment
 */

import { createClient } from '@clickhouse/client'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' })

const TARGET_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
const CANONICAL_VIEW = 'default.vw_trades_canonical'

// Connection setup
const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: 'default',
  request_timeout: 300000, // 5 minutes for large queries
})

interface TableInfo {
  database: string
  table: string
  engine: string
  total_rows: number
  total_bytes: number
  readable_size: string
  columns: ColumnInfo[]
}

interface ColumnInfo {
  name: string
  type: string
}

interface WalletCoverage {
  table: string
  total_rows: number
  unique_condition_ids: number
  unique_market_ids: number
  unique_token_ids: number
  earliest_timestamp: string | null
  latest_timestamp: string | null
  has_condition_id: boolean
  has_market_id: boolean
  has_token_id: boolean
  sample_data: any[]
}

const report: string[] = []

function log(message: string) {
  console.log(message)
  report.push(message)
}

function logSection(title: string) {
  const line = '='.repeat(80)
  log('')
  log(line)
  log(title)
  log(line)
  log('')
}

function logSubSection(title: string) {
  log('')
  log(`--- ${title} ---`)
  log('')
}

async function getAllDatabases(): Promise<string[]> {
  const result = await client.query({
    query: 'SELECT name FROM system.databases ORDER BY name',
    format: 'JSONEachRow',
  })
  const data = await result.json<{ name: string }>()
  return data.map(d => d.name)
}

async function getAllTables(database: string): Promise<TableInfo[]> {
  const result = await client.query({
    query: `
      SELECT
        database,
        name as table,
        engine,
        total_rows,
        total_bytes,
        formatReadableSize(total_bytes) as readable_size
      FROM system.tables
      WHERE database = '${database}'
        AND name NOT LIKE '.%'  -- Skip hidden tables
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  })

  const tables = await result.json<Omit<TableInfo, 'columns'>>()

  // Get columns for each table
  const tablesWithColumns: TableInfo[] = []
  for (const table of tables) {
    const colResult = await client.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = '${table.database}'
          AND table = '${table.table}'
        ORDER BY position
      `,
      format: 'JSONEachRow',
    })
    const columns = await colResult.json<ColumnInfo>()
    tablesWithColumns.push({ ...table, columns })
  }

  return tablesWithColumns
}

function hasWalletColumn(columns: ColumnInfo[]): boolean {
  const walletColumnNames = [
    'wallet', 'wallet_address', 'wallet_id', 'address', 'user_address',
    'from_address', 'to_address', 'trader', 'maker', 'taker'
  ]
  return columns.some(col =>
    walletColumnNames.some(wc => col.name.toLowerCase().includes(wc))
  )
}

function hasConditionIdColumn(columns: ColumnInfo[]): boolean {
  return columns.some(col =>
    col.name.toLowerCase().includes('condition_id') ||
    col.name.toLowerCase() === 'condition_id_norm'
  )
}

function hasMarketIdColumn(columns: ColumnInfo[]): boolean {
  return columns.some(col =>
    col.name.toLowerCase().includes('market_id') ||
    col.name.toLowerCase() === 'market'
  )
}

function hasTokenIdColumn(columns: ColumnInfo[]): boolean {
  return columns.some(col =>
    col.name.toLowerCase().includes('token_id') ||
    col.name.toLowerCase() === 'token_address'
  )
}

function hasTimestampColumn(columns: ColumnInfo[]): boolean {
  return columns.some(col =>
    col.name.toLowerCase().includes('timestamp') ||
    col.name.toLowerCase().includes('time') ||
    col.name.toLowerCase().includes('date')
  )
}

async function queryWalletInTable(
  database: string,
  table: string,
  columns: ColumnInfo[]
): Promise<WalletCoverage | null> {
  try {
    // Find wallet column
    const walletCol = columns.find(col =>
      ['wallet', 'wallet_address', 'wallet_id', 'address', 'user_address'].includes(col.name.toLowerCase())
    )

    if (!walletCol) {
      return null
    }

    // Build query based on available columns
    const conditionIdCol = columns.find(col => col.name.toLowerCase().includes('condition_id'))
    const marketIdCol = columns.find(col => col.name.toLowerCase().includes('market_id'))
    const tokenIdCol = columns.find(col => col.name.toLowerCase().includes('token_id'))
    const timestampCol = columns.find(col =>
      col.name.toLowerCase().includes('timestamp') ||
      col.name.toLowerCase().includes('time') ||
      col.name.toLowerCase().includes('block_time')
    )

    const query = `
      SELECT
        COUNT(*) as total_rows,
        ${conditionIdCol ? `COUNT(DISTINCT ${conditionIdCol.name}) as unique_condition_ids,` : '0 as unique_condition_ids,'}
        ${marketIdCol ? `COUNT(DISTINCT ${marketIdCol.name}) as unique_market_ids,` : '0 as unique_market_ids,'}
        ${tokenIdCol ? `COUNT(DISTINCT ${tokenIdCol.name}) as unique_token_ids,` : '0 as unique_token_ids,'}
        ${timestampCol ? `MIN(${timestampCol.name}) as earliest_timestamp,` : 'NULL as earliest_timestamp,'}
        ${timestampCol ? `MAX(${timestampCol.name}) as latest_timestamp` : 'NULL as latest_timestamp'}
      FROM ${database}.${table}
      WHERE lower(${walletCol.name}) = lower('${TARGET_WALLET}')
    `

    const result = await client.query({ query, format: 'JSONEachRow' })
    const data = await result.json<any>()

    if (data.length === 0 || data[0].total_rows === 0) {
      return null
    }

    // Get sample data
    const sampleQuery = `
      SELECT *
      FROM ${database}.${table}
      WHERE lower(${walletCol.name}) = lower('${TARGET_WALLET}')
      LIMIT 3
    `
    const sampleResult = await client.query({ query: sampleQuery, format: 'JSONEachRow' })
    const sampleData = await sampleResult.json<any>()

    return {
      table: `${database}.${table}`,
      total_rows: parseInt(data[0].total_rows),
      unique_condition_ids: parseInt(data[0].unique_condition_ids),
      unique_market_ids: parseInt(data[0].unique_market_ids),
      unique_token_ids: parseInt(data[0].unique_token_ids),
      earliest_timestamp: data[0].earliest_timestamp,
      latest_timestamp: data[0].latest_timestamp,
      has_condition_id: !!conditionIdCol,
      has_market_id: !!marketIdCol,
      has_token_id: !!tokenIdCol,
      sample_data: sampleData,
    }
  } catch (error) {
    log(`⚠️ Error querying ${database}.${table}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return null
  }
}

async function getCanonicalCoverage(): Promise<WalletCoverage> {
  const query = `
    SELECT
      COUNT(*) as total_rows,
      COUNT(DISTINCT condition_id_norm) as unique_condition_ids,
      COUNT(DISTINCT market_id_norm) as unique_market_ids,
      0 as unique_token_ids,
      MIN(timestamp) as earliest_timestamp,
      MAX(timestamp) as latest_timestamp
    FROM ${CANONICAL_VIEW}
    WHERE lower(wallet_address_norm) = lower('${TARGET_WALLET}')
  `

  const result = await client.query({ query, format: 'JSONEachRow' })
  const data = await result.json<any>()

  return {
    table: CANONICAL_VIEW,
    total_rows: parseInt(data[0].total_rows),
    unique_condition_ids: parseInt(data[0].unique_condition_ids),
    unique_market_ids: parseInt(data[0].unique_market_ids),
    unique_token_ids: 0,
    earliest_timestamp: data[0].earliest_timestamp,
    latest_timestamp: data[0].latest_timestamp,
    has_condition_id: true,
    has_market_id: true,
    has_token_id: false,
    sample_data: [],
  }
}

async function findMissingMarkets(
  canonicalConditionIds: string[],
  otherTable: string,
  conditionIdColumn: string
): Promise<string[]> {
  try {
    const query = `
      SELECT DISTINCT ${conditionIdColumn} as condition_id
      FROM ${otherTable}
      WHERE lower(condition_id) NOT IN (${canonicalConditionIds.map(id => `lower('${id}')`).join(',')})
        AND ${conditionIdColumn} != ''
        AND ${conditionIdColumn} NOT LIKE '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 1000
    `

    const result = await client.query({ query, format: 'JSONEachRow' })
    const data = await result.json<{ condition_id: string }>()
    return data.map(d => d.condition_id)
  } catch (error) {
    log(`⚠️ Error finding missing markets: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return []
  }
}

async function main() {
  logSection('COMPREHENSIVE BACKFILL INVESTIGATION')
  log(`Target Wallet: ${TARGET_WALLET}`)
  log(`Investigation Date: ${new Date().toISOString()}`)
  log('')

  // PHASE 1: Complete Table Inventory
  logSection('PHASE 1: COMPLETE TABLE INVENTORY')

  const databases = await getAllDatabases()
  log(`Found ${databases.length} databases: ${databases.join(', ')}`)
  log('')

  const allTables: TableInfo[] = []

  for (const database of databases) {
    if (database === 'system' || database === 'INFORMATION_SCHEMA' || database === 'information_schema') {
      continue // Skip system databases
    }

    logSubSection(`Database: ${database}`)
    const tables = await getAllTables(database)
    log(`Found ${tables.length} tables`)
    log('')

    for (const table of tables) {
      allTables.push(table)

      const walletCol = hasWalletColumn(table.columns)
      const conditionIdCol = hasConditionIdColumn(table.columns)
      const marketIdCol = hasMarketIdColumn(table.columns)
      const tokenIdCol = hasTokenIdColumn(table.columns)
      const timestampCol = hasTimestampColumn(table.columns)

      log(`Table: ${database}.${table.table}`)
      log(`  Engine: ${table.engine}`)

      // Handle views (they have null row counts)
      if (table.engine === 'View') {
        log(`  Type: View (row count not available)`)
      } else {
        log(`  Rows: ${table.total_rows?.toLocaleString() || 'N/A'}`)
        log(`  Size: ${table.readable_size || 'N/A'}`)
      }

      log(`  Columns (${table.columns.length}): ${table.columns.map(c => c.name).join(', ')}`)
      log(`  Has Wallet Column: ${walletCol ? '✅' : '❌'}`)
      log(`  Has Condition ID: ${conditionIdCol ? '✅' : '❌'}`)
      log(`  Has Market ID: ${marketIdCol ? '✅' : '❌'}`)
      log(`  Has Token ID: ${tokenIdCol ? '✅' : '❌'}`)
      log(`  Has Timestamp: ${timestampCol ? '✅' : '❌'}`)
      log('')
    }
  }

  log(`Total tables across all databases: ${allTables.length}`)
  log('')

  // PHASE 2: Hunt for Wallet Data
  logSection('PHASE 2: HUNT FOR WALLET DATA ACROSS ALL TABLES')

  const walletCoverageResults: WalletCoverage[] = []

  // First, get canonical coverage
  log('Querying canonical view...')
  const canonicalCoverage = await getCanonicalCoverage()
  walletCoverageResults.push(canonicalCoverage)

  log(`Canonical View (${CANONICAL_VIEW}):`)
  log(`  Total Rows: ${canonicalCoverage.total_rows.toLocaleString()}`)
  log(`  Unique Condition IDs: ${canonicalCoverage.unique_condition_ids.toLocaleString()}`)
  log(`  Unique Market IDs: ${canonicalCoverage.unique_market_ids.toLocaleString()}`)
  log(`  Date Range: ${canonicalCoverage.earliest_timestamp} to ${canonicalCoverage.latest_timestamp}`)
  log('')

  // Query all tables with wallet columns (skip views since they query underlying tables)
  const tablesWithWallets = allTables.filter(t =>
    hasWalletColumn(t.columns) && t.engine !== 'View'
  )
  log(`Found ${tablesWithWallets.length} tables with wallet columns (excluding views)`)
  log('')

  for (const table of tablesWithWallets) {
    log(`Searching ${table.database}.${table.table}...`)
    const coverage = await queryWalletInTable(table.database, table.table, table.columns)

    if (coverage) {
      walletCoverageResults.push(coverage)
      log(`  ✅ FOUND DATA`)
      log(`     Total Rows: ${coverage.total_rows.toLocaleString()}`)
      log(`     Unique Condition IDs: ${coverage.unique_condition_ids.toLocaleString()}`)
      log(`     Unique Market IDs: ${coverage.unique_market_ids.toLocaleString()}`)
      log(`     Unique Token IDs: ${coverage.unique_token_ids.toLocaleString()}`)
      log(`     Date Range: ${coverage.earliest_timestamp} to ${coverage.latest_timestamp}`)
    } else {
      log(`  ❌ No data found`)
    }
    log('')
  }

  // PHASE 3: Data Reconciliation
  logSection('PHASE 3: DATA RECONCILIATION & GAP ANALYSIS')

  // Sort by unique condition IDs
  walletCoverageResults.sort((a, b) => b.unique_condition_ids - a.unique_condition_ids)

  log('Coverage Summary (sorted by unique condition IDs):')
  log('')

  for (const coverage of walletCoverageResults) {
    log(`${coverage.table}:`)
    log(`  Rows: ${coverage.total_rows.toLocaleString()}`)
    log(`  Markets (condition_id): ${coverage.unique_condition_ids.toLocaleString()}`)
    log(`  Markets (market_id): ${coverage.unique_market_ids.toLocaleString()}`)
    log(`  Token IDs: ${coverage.unique_token_ids.toLocaleString()}`)
    log(`  Date Range: ${coverage.earliest_timestamp} to ${coverage.latest_timestamp}`)
    log('')
  }

  // Find the table with most coverage
  const bestTable = walletCoverageResults.filter(c => c.table !== CANONICAL_VIEW)
    .reduce((best, current) =>
      current.unique_condition_ids > best.unique_condition_ids ? current : best
    , walletCoverageResults[0])

  log(`Best Coverage Table: ${bestTable.table}`)
  log(`  Markets: ${bestTable.unique_condition_ids.toLocaleString()}`)
  log(`  Gap vs Polymarket (2,816): ${2816 - bestTable.unique_condition_ids} markets`)
  log(`  Gap vs Canonical (${canonicalCoverage.unique_condition_ids}): ${bestTable.unique_condition_ids - canonicalCoverage.unique_condition_ids} additional markets`)
  log('')

  // PHASE 4: Backfill Feasibility
  logSection('PHASE 4: BACKFILL FEASIBILITY ASSESSMENT')

  const canBackfill = bestTable.unique_condition_ids > canonicalCoverage.unique_condition_ids
  const backfillGain = bestTable.unique_condition_ids - canonicalCoverage.unique_condition_ids
  const percentageGain = (backfillGain / 2816 * 100).toFixed(1)

  log(`Can we backfill from existing tables? ${canBackfill ? '✅ YES' : '❌ NO'}`)
  log('')

  if (canBackfill) {
    log(`Backfill Potential:`)
    log(`  Source Table: ${bestTable.table}`)
    log(`  Additional Markets: ${backfillGain.toLocaleString()}`)
    log(`  Percentage of Polymarket Gap: ${percentageGain}%`)
    log(`  New Total: ${bestTable.unique_condition_ids.toLocaleString()} markets`)
    log(`  Remaining Gap: ${2816 - bestTable.unique_condition_ids} markets (${((2816 - bestTable.unique_condition_ids) / 2816 * 100).toFixed(1)}%)`)
    log('')

    log(`Sample Data from ${bestTable.table}:`)
    log(JSON.stringify(bestTable.sample_data, null, 2))
    log('')

    log('RECOMMENDED NEXT STEPS:')
    log('1. Analyze data quality in source table')
    log('2. Design JOIN strategy to merge with canonical view')
    log('3. Test on small sample (10-100 markets)')
    log('4. Execute full backfill')
    log('5. Validate results')
  } else {
    log('No existing table has more coverage than canonical view.')
    log('External API backfill is required.')
  }

  // Save report
  logSection('SAVING REPORT')

  const reportPath = './BACKFILL_INVESTIGATION_REPORT.md'

  const markdown = `# Backfill Investigation Report

## Executive Summary

**Investigation Date:** ${new Date().toISOString()}
**Target Wallet:** ${TARGET_WALLET}
**Current Coverage:** ${canonicalCoverage.unique_condition_ids} markets in ${CANONICAL_VIEW}
**Polymarket Claims:** 2,816 predictions
**Gap:** ${2816 - canonicalCoverage.unique_condition_ids} markets missing

**Can we backfill from existing tables?** ${canBackfill ? '✅ YES' : '❌ NO'}
${canBackfill ? `**Backfill Potential:** ${backfillGain} additional markets (${percentageGain}% of gap)` : '**Conclusion:** External API required'}

---

## Complete Table Inventory

### Databases
${databases.filter(d => !['system', 'INFORMATION_SCHEMA', 'information_schema'].includes(d)).map(db => `- ${db}`).join('\n')}

### Tables by Database

${allTables.map(t => `
#### ${t.database}.${t.table}
- **Engine:** ${t.engine}
- **Rows:** ${t.engine === 'View' ? 'N/A (View)' : (t.total_rows?.toLocaleString() || 'N/A')}
- **Size:** ${t.engine === 'View' ? 'N/A (View)' : (t.readable_size || 'N/A')}
- **Columns:** ${t.columns.length}
  - ${t.columns.map(c => `${c.name} (${c.type})`).join(', ')}
- **Has Wallet Column:** ${hasWalletColumn(t.columns) ? '✅' : '❌'}
- **Has Condition ID:** ${hasConditionIdColumn(t.columns) ? '✅' : '❌'}
- **Has Market ID:** ${hasMarketIdColumn(t.columns) ? '✅' : '❌'}
- **Has Token ID:** ${hasTokenIdColumn(t.columns) ? '✅' : '❌'}
- **Has Timestamp:** ${hasTimestampColumn(t.columns) ? '✅' : '❌'}
`).join('\n')}

---

## Wallet Coverage Analysis

### Tables Containing Wallet ${TARGET_WALLET}

${walletCoverageResults.map(c => `
#### ${c.table}
- **Total Rows:** ${c.total_rows.toLocaleString()}
- **Unique Condition IDs:** ${c.unique_condition_ids.toLocaleString()}
- **Unique Market IDs:** ${c.unique_market_ids.toLocaleString()}
- **Unique Token IDs:** ${c.unique_token_ids.toLocaleString()}
- **Date Range:** ${c.earliest_timestamp} to ${c.latest_timestamp}
- **Has Condition ID Column:** ${c.has_condition_id ? '✅' : '❌'}
- **Has Market ID Column:** ${c.has_market_id ? '✅' : '❌'}
- **Has Token ID Column:** ${c.has_token_id ? '✅' : '❌'}
`).join('\n')}

---

## Gap Analysis

**Canonical View:** ${canonicalCoverage.unique_condition_ids} markets
**Best Alternative:** ${bestTable.unique_condition_ids} markets (${bestTable.table})
**Gap:** ${bestTable.unique_condition_ids - canonicalCoverage.unique_condition_ids} additional markets

**Polymarket Target:** 2,816 markets
**Remaining Gap:** ${2816 - bestTable.unique_condition_ids} markets (${((2816 - bestTable.unique_condition_ids) / 2816 * 100).toFixed(1)}%)

---

## Backfill Feasibility

${canBackfill ? `
### ✅ BACKFILL POSSIBLE

**Source Table:** ${bestTable.table}
**Additional Markets:** ${backfillGain}
**Coverage Improvement:** ${percentageGain}%

#### Sample Data from Source Table

\`\`\`json
${JSON.stringify(bestTable.sample_data, null, 2)}
\`\`\`

#### Recommended Backfill Strategy

1. **Data Quality Check**
   - Verify condition_ids are valid (not 0x000...)
   - Check for duplicates
   - Validate timestamps

2. **JOIN Strategy**
   - Normalize condition_id in both tables
   - Use LEFT JOIN to find missing markets
   - Preserve canonical data, add new records

3. **SQL Pattern**
\`\`\`sql
CREATE OR REPLACE VIEW default.vw_trades_canonical_EXPANDED AS
SELECT * FROM ${CANONICAL_VIEW}
UNION ALL
SELECT
  -- Map columns from ${bestTable.table}
  tx_hash,
  block_timestamp,
  lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
  ...
FROM ${bestTable.table} source
LEFT JOIN ${CANONICAL_VIEW} canonical
  ON lower(replaceAll(source.condition_id, '0x', '')) = canonical.condition_id_norm
  AND lower(source.wallet) = canonical.wallet_address_norm
WHERE canonical.condition_id_norm IS NULL
  AND source.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND source.wallet = '${TARGET_WALLET}'
\`\`\`

4. **Validation**
   - Test on 10 markets
   - Verify no duplicates
   - Check PnL calculations

5. **Execution**
   - Run full backfill
   - Monitor row counts
   - Validate final coverage

` : `
### ❌ EXTERNAL API REQUIRED

No existing table has significantly more coverage than the canonical view.

**Options:**
1. Query Polymarket API for wallet positions
2. Query blockchain directly for ERC1155 transfers
3. Use third-party data providers (Dune, Flipside)

**Recommended Approach:**
Use Polymarket's REST API to fetch wallet positions:
- Endpoint: \`GET /positions?wallet=${TARGET_WALLET}\`
- Expected: ~2,816 markets
- Processing: Map to condition_ids and backfill
`}

---

## Recommended Next Steps

${canBackfill ? `
1. ✅ **Backfill from ${bestTable.table}**
   - Gain ${backfillGain} markets immediately
   - Reduces gap from ${2816 - canonicalCoverage.unique_condition_ids} to ${2816 - bestTable.unique_condition_ids} markets

2. 🔄 **API Backfill for Remaining ${2816 - bestTable.unique_condition_ids} Markets**
   - Query Polymarket API
   - Fill final gap

3. ✅ **Validate & Deploy**
   - Run comprehensive tests
   - Deploy to production
` : `
1. 🔄 **Query Polymarket API**
   - Fetch all ${2816 - canonicalCoverage.unique_condition_ids} missing markets
   - Map to condition_ids

2. ✅ **Backfill Canonical View**
   - Insert missing data
   - Validate coverage

3. ✅ **Deploy to Production**
   - Run comprehensive tests
   - Monitor data quality
`}

---

## Data Quality Issues

- **0x000... Condition IDs:** Present in some tables (filter these out)
- **Blank Fields:** Some tables have NULL/empty condition_ids
- **Duplicate Rows:** May exist across multiple tables
- **ID Format Inconsistency:** Mix of 0x-prefixed and raw hex

---

## Confidence Assessment

- **Coverage Confidence:** ${bestTable.unique_condition_ids > 1000 ? 'HIGH' : bestTable.unique_condition_ids > 100 ? 'MEDIUM' : 'LOW'}
- **Data Quality:** ${bestTable.has_condition_id && bestTable.has_market_id ? 'HIGH' : bestTable.has_condition_id ? 'MEDIUM' : 'LOW'}
- **Backfill Feasibility:** ${canBackfill && backfillGain > 100 ? 'HIGH' : canBackfill ? 'MEDIUM' : 'LOW'}

---

**Generated:** ${new Date().toISOString()}
**Script:** COMPREHENSIVE_BACKFILL_INVESTIGATION.ts
`

  fs.writeFileSync(reportPath, markdown)
  log(`✅ Report saved to ${reportPath}`)
  log('')

  // Also save raw data as JSON
  const jsonPath = './BACKFILL_INVESTIGATION_DATA.json'
  fs.writeFileSync(jsonPath, JSON.stringify({
    investigation_date: new Date().toISOString(),
    target_wallet: TARGET_WALLET,
    canonical_coverage: canonicalCoverage,
    all_tables: allTables,
    wallet_coverage: walletCoverageResults,
    best_table: bestTable,
    can_backfill: canBackfill,
    backfill_gain: backfillGain,
    percentage_gain: parseFloat(percentageGain),
  }, null, 2))

  log(`✅ Raw data saved to ${jsonPath}`)
  log('')

  logSection('INVESTIGATION COMPLETE')
  log(`Analyzed ${allTables.length} tables across ${databases.length} databases`)
  log(`Found wallet data in ${walletCoverageResults.length} tables`)
  log(`Best coverage: ${bestTable.table} with ${bestTable.unique_condition_ids} markets`)
  log(`Backfill feasible: ${canBackfill ? 'YES' : 'NO'}`)

  await client.close()
}

main().catch(console.error)
