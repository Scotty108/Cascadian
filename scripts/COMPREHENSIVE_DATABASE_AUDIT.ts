#!/usr/bin/env tsx

/**
 * COMPREHENSIVE DATABASE AUDIT FOR RESOLUTION/PAYOUT DATA
 *
 * Mission: Find ANY possible source of resolution data we might have missed
 * Target: Solve 24.8% coverage problem (56,575 / 227,838 markets)
 *
 * Investigation Areas:
 * 1. Complete table inventory (ALL tables)
 * 2. Resolution/outcome/payout/winner data sources
 * 3. Pattern analysis of existing payout coverage
 * 4. Alternative inference methods (prices, redemptions)
 * 5. Wallet-level coverage analysis
 * 6. Hidden views and staging tables
 */

import * as dotenv from 'dotenv'
import { getClickHouseClient } from './lib/clickhouse/client'

// Load environment variables
dotenv.config({ path: '.env.local' })

const client = getClickHouseClient()

interface TableInfo {
  database: string
  name: string
  engine: string
  total_rows: string
  total_bytes: string
  metadata_modification_time: string
}

interface ColumnInfo {
  database: string
  table: string
  name: string
  type: string
  comment: string
}

interface ViewInfo {
  database: string
  name: string
  as_select: string
  engine: string
}

async function run() {
  console.log('='.repeat(100))
  console.log('COMPREHENSIVE DATABASE AUDIT - RESOLUTION DATA DISCOVERY')
  console.log('='.repeat(100))
  console.log()

  // ==================================================================================
  // PHASE 1: COMPLETE TABLE INVENTORY
  // ==================================================================================
  console.log('PHASE 1: COMPLETE TABLE INVENTORY')
  console.log('-'.repeat(100))

  const allTablesResult = await client.query({
    query: `
      SELECT
        database,
        name,
        engine,
        formatReadableQuantity(total_rows) as total_rows,
        formatReadableSize(total_bytes) as total_bytes,
        metadata_modification_time
      FROM system.tables
      WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
      ORDER BY database, name
    `,
    format: 'JSONEachRow'
  })

  const allTables = await allTablesResult.json<TableInfo>()

  console.log(`Total tables found: ${allTables.length}`)
  console.log()

  // Group by database
  const tablesByDb = allTables.reduce((acc, table) => {
    if (!acc[table.database]) acc[table.database] = []
    acc[table.database].push(table)
    return acc
  }, {} as Record<string, TableInfo[]>)

  for (const [db, tables] of Object.entries(tablesByDb)) {
    console.log(`\nDatabase: ${db} (${tables.length} tables)`)
    console.log('-'.repeat(80))
    for (const table of tables) {
      const rows = table.total_rows || '0'
      console.log(`  ${table.name.padEnd(50)} ${table.engine.padEnd(20)} ${rows.padStart(12)} rows`)
    }
  }

  // ==================================================================================
  // PHASE 2: RESOLUTION-RELATED TABLE HUNT
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PHASE 2: RESOLUTION-RELATED TABLE HUNT')
  console.log('-'.repeat(100))

  const resolutionKeywords = [
    'resolution', 'resolve', 'outcome', 'winner', 'payout',
    'settle', 'result', 'final', 'gamma', 'market_status'
  ]

  const suspectTables = allTables.filter(table =>
    resolutionKeywords.some(keyword =>
      table.name.toLowerCase().includes(keyword)
    )
  )

  console.log(`\nFound ${suspectTables.length} tables with resolution-related names:\n`)

  for (const table of suspectTables) {
    console.log(`\n📊 ${table.database}.${table.name}`)
    console.log(`   Engine: ${table.engine} | Rows: ${table.total_rows} | Size: ${table.total_bytes}`)
    console.log(`   Last modified: ${table.metadata_modification_time}`)

    // Get schema for this table
    const schemaResult = await client.query({
      query: `
        SELECT name, type, comment
        FROM system.columns
        WHERE database = '${table.database}'
          AND table = '${table.name}'
        ORDER BY position
      `,
      format: 'JSONEachRow'
    })

    const schema = await schemaResult.json<ColumnInfo>()
    console.log(`   Columns (${schema.length}):`)

    // Highlight important columns
    const importantColumns = schema.filter(col =>
      col.name.toLowerCase().includes('condition_id') ||
      col.name.toLowerCase().includes('payout') ||
      col.name.toLowerCase().includes('outcome') ||
      col.name.toLowerCase().includes('winner') ||
      col.name.toLowerCase().includes('numerator') ||
      col.name.toLowerCase().includes('denominator') ||
      col.type.includes('Array')
    )

    if (importantColumns.length > 0) {
      console.log('   🔥 IMPORTANT COLUMNS:')
      for (const col of importantColumns) {
        console.log(`      • ${col.name.padEnd(40)} ${col.type}`)
      }
    }

    // Show first 3 columns regardless
    for (const col of schema.slice(0, 3)) {
      if (!importantColumns.find(ic => ic.name === col.name)) {
        console.log(`      - ${col.name.padEnd(40)} ${col.type}`)
      }
    }
  }

  // ==================================================================================
  // PHASE 3: COVERAGE PATTERN ANALYSIS
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PHASE 3: COVERAGE PATTERN ANALYSIS')
  console.log('-'.repeat(100))

  console.log('\nAnalyzing the 56,575 markets that DO have payout vectors...\n')

  // Find the main resolution table
  const resolutionTables = [
    'market_resolutions_final',
    'gamma_resolved',
    'staging_resolutions_union',
    'resolution_candidates'
  ]

  for (const tableName of resolutionTables) {
    try {
      const tableExists = allTables.find(t => t.name === tableName)
      if (!tableExists) {
        console.log(`⚠️  Table ${tableName} not found`)
        continue
      }

      console.log(`\n📊 Analyzing: ${tableName}`)
      console.log('-'.repeat(80))

      // Total count
      const countResult = await client.query({
        query: `SELECT count() as total FROM ${tableName}`,
        format: 'JSONEachRow'
      })
      const countData = await countResult.json<{total: string}>()
      console.log(`Total records: ${countData[0].total}`)

      // Check if has payout columns
      const hasPayoutResult = await client.query({
        query: `
          SELECT
            countIf(payout_numerators IS NOT NULL AND length(payout_numerators) > 0) as with_payout,
            countIf(payout_numerators IS NULL OR length(payout_numerators) = 0) as without_payout
          FROM ${tableName}
        `,
        format: 'JSONEachRow'
      })
      const payoutData = await hasPayoutResult.json<{with_payout: string, without_payout: string}>()
      console.log(`  With payout vectors: ${payoutData[0].with_payout}`)
      console.log(`  Without payout vectors: ${payoutData[0].without_payout}`)

      // Date range analysis
      const dateRangeResult = await client.query({
        query: `
          SELECT
            min(end_date_iso) as earliest,
            max(end_date_iso) as latest,
            dateDiff('day', min(end_date_iso), max(end_date_iso)) as days_span
          FROM ${tableName}
          WHERE end_date_iso IS NOT NULL
        `,
        format: 'JSONEachRow'
      })
      const dateRange = await dateRangeResult.json<{earliest: string, latest: string, days_span: string}>()
      console.log(`\n  Date range: ${dateRange[0].earliest} to ${dateRange[0].latest}`)
      console.log(`  Span: ${dateRange[0].days_span} days`)

      // Coverage by year
      const yearCoverageResult = await client.query({
        query: `
          SELECT
            toYear(end_date_iso) as year,
            count() as total_markets,
            countIf(payout_numerators IS NOT NULL AND length(payout_numerators) > 0) as with_payout,
            round(countIf(payout_numerators IS NOT NULL AND length(payout_numerators) > 0) * 100.0 / count(), 2) as payout_pct
          FROM ${tableName}
          WHERE end_date_iso IS NOT NULL
          GROUP BY year
          ORDER BY year DESC
        `,
        format: 'JSONEachRow'
      })
      const yearCoverage = await yearCoverageResult.json<{year: string, total_markets: string, with_payout: string, payout_pct: string}>()

      console.log('\n  Coverage by Year:')
      console.log('  ' + '-'.repeat(70))
      console.log('    Year    Total Markets    With Payouts    Coverage %')
      console.log('  ' + '-'.repeat(70))
      for (const row of yearCoverage) {
        console.log(`    ${row.year}    ${row.total_markets.padStart(13)}    ${row.with_payout.padStart(12)}    ${row.payout_pct.padStart(9)}%`)
      }

      // Event category analysis (if column exists)
      try {
        const categoryCoverageResult = await client.query({
          query: `
            SELECT
              event_category,
              count() as total_markets,
              countIf(payout_numerators IS NOT NULL AND length(payout_numerators) > 0) as with_payout,
              round(countIf(payout_numerators IS NOT NULL AND length(payout_numerators) > 0) * 100.0 / count(), 2) as payout_pct
            FROM ${tableName}
            WHERE event_category IS NOT NULL
            GROUP BY event_category
            ORDER BY total_markets DESC
            LIMIT 20
          `,
          format: 'JSONEachRow'
        })
        const categoryCoverage = await categoryCoverageResult.json<{event_category: string, total_markets: string, with_payout: string, payout_pct: string}>()

        console.log('\n  Coverage by Event Category (Top 20):')
        console.log('  ' + '-'.repeat(80))
        console.log('    Category              Total Markets    With Payouts    Coverage %')
        console.log('  ' + '-'.repeat(80))
        for (const row of categoryCoverage) {
          console.log(`    ${row.event_category.padEnd(20)} ${row.total_markets.padStart(13)}    ${row.with_payout.padStart(12)}    ${row.payout_pct.padStart(9)}%`)
        }
      } catch (e) {
        console.log('  ⚠️  event_category column not found in this table')
      }

    } catch (error) {
      console.log(`❌ Error analyzing ${tableName}: ${error}`)
    }
  }

  // ==================================================================================
  // PHASE 4: ALTERNATIVE DATA SOURCE EXPLORATION
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PHASE 4: ALTERNATIVE DATA SOURCE EXPLORATION')
  console.log('-'.repeat(100))

  console.log('\n🔍 Strategy 1: Infer winners from final token prices')
  console.log('-'.repeat(80))

  // Check if we have price candle data
  const priceTables = allTables.filter(t =>
    t.name.toLowerCase().includes('candle') ||
    t.name.toLowerCase().includes('price') ||
    t.name.toLowerCase().includes('midprice')
  )

  if (priceTables.length > 0) {
    console.log(`\nFound ${priceTables.length} price-related tables:`)
    for (const table of priceTables) {
      console.log(`  • ${table.database}.${table.name} (${table.total_rows} rows)`)
    }

    // Try to find markets with final prices near $1 or $0
    console.log('\nLooking for markets with definitive final prices ($0.95+ or $0.05-)...')

    for (const priceTable of priceTables.slice(0, 2)) { // Check first 2 tables
      try {
        const definitePricesResult = await client.query({
          query: `
            SELECT
              count(DISTINCT condition_id) as markets_with_clear_winners
            FROM ${priceTable.name}
            WHERE (close_price >= 0.95 OR close_price <= 0.05)
              AND timestamp >= now() - INTERVAL 30 DAY
          `,
          format: 'JSONEachRow'
        })
        const definitePrices = await definitePricesResult.json<{markets_with_clear_winners: string}>()
        console.log(`  ${priceTable.name}: ${definitePrices[0].markets_with_clear_winners} markets with clear winners in last 30 days`)
      } catch (e) {
        console.log(`  ⚠️  Could not analyze ${priceTable.name}`)
      }
    }
  } else {
    console.log('⚠️  No price candle tables found')
  }

  console.log('\n🔍 Strategy 2: Detect resolutions from ERC1155 redemption patterns')
  console.log('-'.repeat(80))

  // Check for ERC1155 transfer tables
  const erc1155Tables = allTables.filter(t =>
    t.name.toLowerCase().includes('erc1155') ||
    t.name.toLowerCase().includes('transfer')
  )

  if (erc1155Tables.length > 0) {
    console.log(`\nFound ${erc1155Tables.length} ERC1155/transfer tables:`)
    for (const table of erc1155Tables) {
      console.log(`  • ${table.database}.${table.name} (${table.total_rows} rows)`)

      // Look for redemption patterns (transfers from users to zero address)
      try {
        const redemptionResult = await client.query({
          query: `
            SELECT
              count(DISTINCT token_id) as tokens_with_redemptions,
              count() as total_redemptions
            FROM ${table.name}
            WHERE to_address = '0x0000000000000000000000000000000000000000'
            LIMIT 1
          `,
          format: 'JSONEachRow'
        })
        const redemptions = await redemptionResult.json<{tokens_with_redemptions: string, total_redemptions: string}>()
        console.log(`    Redemptions found: ${redemptions[0].total_redemptions} (${redemptions[0].tokens_with_redemptions} unique tokens)`)
      } catch (e) {
        console.log(`    ⚠️  Could not analyze redemptions`)
      }
    }
  } else {
    console.log('⚠️  No ERC1155 transfer tables found')
  }

  console.log('\n🔍 Strategy 3: Check gamma_markets or API snapshot tables')
  console.log('-'.repeat(80))

  const gammaTables = allTables.filter(t =>
    t.name.toLowerCase().includes('gamma')
  )

  if (gammaTables.length > 0) {
    console.log(`\nFound ${gammaTables.length} gamma-related tables:`)
    for (const table of gammaTables) {
      console.log(`  • ${table.database}.${table.name} (${table.total_rows} rows)`)

      // Get schema to see if there are outcome fields
      const schemaResult = await client.query({
        query: `
          SELECT name, type
          FROM system.columns
          WHERE database = '${table.database}'
            AND table = '${table.name}'
            AND (
              name ILIKE '%outcome%' OR
              name ILIKE '%winner%' OR
              name ILIKE '%result%' OR
              name ILIKE '%payout%'
            )
        `,
        format: 'JSONEachRow'
      })
      const outcomeColumns = await schemaResult.json<{name: string, type: string}>()

      if (outcomeColumns.length > 0) {
        console.log(`    🔥 Found outcome-related columns:`)
        for (const col of outcomeColumns) {
          console.log(`       • ${col.name} (${col.type})`)
        }
      }
    }
  }

  // ==================================================================================
  // PHASE 5: WALLET-LEVEL COVERAGE ANALYSIS
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PHASE 5: WALLET-LEVEL COVERAGE ANALYSIS')
  console.log('-'.repeat(100))

  // Sample wallets to analyze
  const sampleWallets = [
    '0x4ce7d9c30e3c7f428c44255090a036e0a0d773a2',
    '0xb48ee0b9867f31a491fa7ed5dae9c2e50e8cc2a8',
    '0x7d28c42f6d583bb5adf8bb13d3e3a84e32b34fdd',
    '0x2f123456789abcdef123456789abcdef12345678', // example
    '0x3f123456789abcdef123456789abcdef12345678'  // example
  ]

  console.log('\nAnalyzing coverage for sample wallets...\n')

  // Find tables with wallet positions
  const positionTables = allTables.filter(t =>
    t.name.toLowerCase().includes('position') ||
    t.name.toLowerCase().includes('wallet') ||
    t.name.toLowerCase().includes('trade')
  )

  if (positionTables.length > 0) {
    console.log(`Found ${positionTables.length} position/wallet/trade tables to check:\n`)

    for (const table of positionTables.slice(0, 5)) { // Check first 5
      console.log(`\n📊 ${table.name}`)

      for (const wallet of sampleWallets.slice(0, 3)) { // Check first 3 wallets
        try {
          const walletCoverageResult = await client.query({
            query: `
              SELECT
                count(DISTINCT condition_id) as total_positions,
                count(DISTINCT condition_id) as positions_checked
              FROM ${table.name}
              WHERE wallet_address = '${wallet}'
            `,
            format: 'JSONEachRow'
          })
          const coverage = await walletCoverageResult.json<{total_positions: string, positions_checked: string}>()

          if (parseInt(coverage[0].total_positions) > 0) {
            console.log(`  ${wallet}: ${coverage[0].total_positions} positions`)
          }
        } catch (e) {
          // Table might not have wallet_address column
        }
      }
    }
  }

  // ==================================================================================
  // PHASE 6: HIDDEN VIEWS AND STAGING TABLES
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PHASE 6: HIDDEN VIEWS AND STAGING TABLES')
  console.log('-'.repeat(100))

  console.log('\nSearching for views that might union resolution sources...\n')

  const views = allTables.filter(t =>
    t.engine === 'View' ||
    t.name.toLowerCase().includes('_view') ||
    t.name.toLowerCase().includes('vw_')
  )

  console.log(`Found ${views.length} views:\n`)

  for (const view of views) {
    console.log(`\n🔍 ${view.database}.${view.name}`)

    try {
      const viewDefResult = await client.query({
        query: `
          SELECT as_select
          FROM system.tables
          WHERE database = '${view.database}'
            AND name = '${view.name}'
        `,
        format: 'JSONEachRow'
      })
      const viewDef = await viewDefResult.json<{as_select: string}>()

      if (viewDef[0] && viewDef[0].as_select) {
        const sql = viewDef[0].as_select

        // Check if mentions resolution-related keywords
        const hasResolutionLogic = resolutionKeywords.some(kw =>
          sql.toLowerCase().includes(kw)
        )

        if (hasResolutionLogic) {
          console.log('   🔥 CONTAINS RESOLUTION LOGIC!')
          console.log('   Definition preview:')
          console.log('   ' + sql.substring(0, 300).replace(/\n/g, '\n   '))
          if (sql.length > 300) console.log('   ... (truncated)')
        }
      }
    } catch (e) {
      console.log('   ⚠️  Could not retrieve view definition')
    }
  }

  // ==================================================================================
  // PHASE 7: SQL FILE ANALYSIS
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('PHASE 7: REPOSITORY SQL FILE SCAN')
  console.log('-'.repeat(100))

  console.log('\nSQL files that might create resolution tables:')
  console.log('  (Check: COMPREHENSIVE_DATABASE_AUDIT.ts output for file paths)')
  console.log('  Key files found in earlier glob:')
  console.log('    • create-unified-resolutions-view.sql')
  console.log('    • payout-vector-views.sql')
  console.log('    • phase1-sql-views.sql')
  console.log('    • COVERAGE_ANALYSIS_QUERIES.sql')
  console.log('    • migrations/clickhouse/015_create_wallet_resolution_outcomes.sql')

  // ==================================================================================
  // FINAL SUMMARY
  // ==================================================================================
  console.log('\n\n' + '='.repeat(100))
  console.log('🎯 AUDIT COMPLETE - KEY FINDINGS SUMMARY')
  console.log('='.repeat(100))

  console.log('\n✅ TODO: Review output above for:')
  console.log('   1. Any NEW tables not previously explored')
  console.log('   2. Coverage gaps by year/category (systematic patterns)')
  console.log('   3. Alternative data sources (prices, redemptions)')
  console.log('   4. Views with resolution union logic')
  console.log('   5. Wallets with high coverage (>80%) for leaderboards')

  console.log('\n💡 Next steps based on findings:')
  console.log('   • Investigate high-coverage categories for backfill priority')
  console.log('   • Explore price-based winner inference for recent markets')
  console.log('   • Check ERC1155 redemptions as resolution signal')
  console.log('   • Review view definitions for missed data sources')

  await client.close()
}

run().catch(console.error)
