#!/usr/bin/env ts-node

/**
 * Data Sources and Ingestion Health Analysis
 *
 * This script systematically analyzes ClickHouse data to:
 * 1. Classify data sources (Goldsky, Flipside, Gamma, CLOB, ERC1155, API)
 * 2. Detect data quality issues and duplicates
 * 3. Analyze ingestion health with timestamp gaps
 * 4. Identify contradicting data between sources
 * 5. Determine canonical sources for each data type
 */

import { clickhouse } from './lib/clickhouse/client'

// Current date for comparison
const CURRENT_DATE = '2025-11-13'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

// Data source classification patterns
const SOURCE_PATTERNS = {
  'Goldsky': ['gs_', 'goldsky', '_gs', 'dome', '_dome'],
  'Flipside': ['flipside', 'fs_', 'blockchain', 'polygon'],
  'Gamma': ['gamma', 'gamma_markets', 'gamma_'],
  'CLOB': ['clob', 'fills', 'orders'],
  'ERC1155': ['erc1155', 'transfers', 'token'],
  'Manual/API': ['pm_', 'api_', 'manual', 'imported', 'ingested'],
  'Backup/Archive': ['backup', 'old_', 'archive', '_v2', '_v3', 'temp']
}

interface TableInfo {
  name: string
  database: string
  engine: string
  total_rows: number
  total_bytes: number
  readable_size: string
  source_type?: string
  max_timestamp?: string
  days_behind?: number
  has_duplicates?: boolean
  status: 'healthy' | 'stale' | 'empty' | 'error'
  primary_source?: boolean
}

interface DataSourceAnalysis {
  source: string
  tables: TableInfo[]
  totalRows: number
  maxTimestamp?: string
  healthStatus: 'healthy' | 'degraded' | 'critical' | 'unknown'
  canonical_table?: string
  issues: string[]
}

async function analyzeTableInventory(): Promise<TableInfo[]> {
  console.log('🔍 Analyzing ClickHouse table inventory...')

  try {
    // Get basic table information
    const result = await clickhouse.query({
      query: `
        SELECT
          database,
          name,
          engine,
          total_rows,
          total_bytes,
          formatReadableSize(total_bytes) as readable_size
        FROM system.tables
        WHERE database IN ('default', 'cascadian_clean', 'staging')
        ORDER BY database, total_bytes DESC
      `,
      format: 'JSONEachRow'
    })

    const tables = await result.json<TableInfo>() as TableInfo[]
    console.log(`📊 Found ${tables.length} tables across databases`)

    return tables
  } catch (error) {
    console.error('❌ Failed to get table inventory:', error)
    throw error
  }
}

function classifyDataSource(tableName: string, database: string): string {
  const fullName = `${database}.${tableName}`.toLowerCase()

  for (const [source, patterns] of Object.entries(SOURCE_PATTERNS)) {
    if (patterns.some(pattern => fullName.includes(pattern.toLowerCase()))) {
      return source
    }
  }

  // Default classification based on common patterns
  if (tableName.includes('market') || tableName.includes('resolution')) return 'Gamma/Market'
  if (tableName.includes('wallet') || tableName.includes('user')) return 'Identity'
  if (tableName.includes('pnl') || tableName.includes('profit')) return 'Analytics/Calculated'
  if (tableName.includes('fill') || tableName.includes('trade')) return 'Trading'
  if (tableName.includes('event') || tableName.includes('log')) return 'System/Logging'

  return 'Unknown'
}

async function checkTimestampHealth(tableName: string, database: string): Promise<{max_timestamp?: string, days_behind?: number}> {
  try {
    // Try to find timestamp fields
    const columnsResult = await clickhouse.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = '${database}' AND table = '${tableName}'
        AND (name LIKE '%timestamp%' OR name LIKE '%time%' OR name LIKE '%date%' OR name LIKE '%created%' OR name LIKE '%updated%')
        AND type LIKE '%DateTime%'
      `,
      format: 'JSONEachRow'
    })

    const timestampColumns = await columnsResult.json() as {name: string, type: string}[]

    if (!Array.isArray(timestampColumns) || timestampColumns.length === 0) {
      return {} // No timestamp columns found
    }

    // Use the first timestamp column
    const timestampColumn = timestampColumns[0].name

    const result = await clickhouse.query({
      query: `SELECT MAX(\`${timestampColumn}\`) as max_timestamp FROM \`${database}\`.\`${tableName}\``,
      format: 'JSONEachRow'
    })

    const maxData = await result.json() as {max_timestamp: string}[]
    if (!Array.isArray(maxData) || maxData.length === 0 || !maxData[0].max_timestamp) {
      return {}
    }

    const maxTimestamp = new Date(maxData[0].max_timestamp)
    const currentDate = new Date(CURRENT_DATE)
    const daysBehind = Math.floor((currentDate.getTime() - maxTimestamp.getTime()) / ONE_DAY_MS)

    return {
      max_timestamp: maxData[0].max_timestamp,
      days_behind: daysBehind
    }
  } catch (error) {
    // Table might not exist or no timestamp columns
    return {}
  }
}

async function detectDuplicateInfo(tables: TableInfo[]): Promise<TableInfo[]> {
  console.log('🔍 Detecting duplicate and versioned tables...')

  // Mark backup/versioned tables
  const processedTables = tables.map(table => {
    const tableName = table.name.toLowerCase()

    const isBackup = tableName.includes('backup') ||
                    tableName.includes('old_') ||
                    tableName.includes('temp') ||
                    tableName.includes('_v2') ||
                    tableName.includes('_v3') ||
                    tableName.includes('_bkp')

    return {
      ...table,
      has_duplicates: isBackup,
      status: table.total_rows === 0 ? 'empty' :
              table.total_rows > 0 ? 'healthy' : 'error'
    } as TableInfo
  })

  return processedTables
}

function prioritizeSourceTables(tablesBySource: Map<string, TableInfo[]>): Map<string, DataSourceAnalysis> {
  const analyses = new Map<string, DataSourceAnalysis>()

  for (const [source, tables] of tablesBySource) {
    const activeTables = tables.filter(t => !t.has_duplicates && t.total_rows > 0)

    let canonicalTable: TableInfo | undefined
    let healthStatus: 'healthy' | 'degraded' | 'critical' | 'unknown' = 'unknown'
    const issues: string[] = []

    if (activeTables.length === 0) {
      issues.push('No active production tables found')
      healthStatus = 'critical'
    } else {
      // Prioritize by row count and recency
      canonicalTable = activeTables.reduce((prev, current) => {
        if (!prev) return current
        if ((current.days_behind ?? 999) < (prev.days_behind ?? 999)) return current
        if (current.total_rows > prev.total_rows) return current
        return prev
      })

      // Assess health based on data freshness and volume
      const maxDaysBehind = Math.max(...activeTables.map(t => t.days_behind ?? 999))
      const totalRows = activeTables.reduce((sum, t) => sum + t.total_rows, 0)

      if (maxDaysBehind > 7) {
        healthStatus = 'critical'
        issues.push(`Data is ${maxDaysBehind} days behind`)
      } else if (maxDaysBehind > 3) {
        healthStatus = 'degraded'
        issues.push(`Data is ${maxDaysBehind} days behind`)
      } else if (totalRows > 0) {
        healthStatus = 'healthy'
      }
    }

    analyses.set(source, {
      source,
      tables,
      totalRows: activeTables.reduce((sum, t) => sum + t.total_rows, 0),
      maxTimestamp: canonicalTable?.max_timestamp,
      healthStatus,
      canonical_table: canonicalTable?.name,
      issues
    })
  }

  return analyses
}

function detectDataConflicts(analyses: Map<string, DataSourceAnalysis>): void {
  console.log('⚔️  Analyzing potential data conflicts...')

  // Look for overlapping data sources that might conflict
  const marketSources = ['Gamma', 'CLOB', 'ERC1155']
  const tradingSources = ['CLOB', 'ERC1155', 'Trading']
  const walletSources = ['Identity', 'Analytics/Calculated']

  // Check for overlapping market data
  const marketSourcesFound = Array.from(analyses.keys()).filter(source =>
    source.includes('Gamma') || source.includes('CLOB') || source.includes('Market') || source.includes('Trading')
  )

  if (marketSourcesFound.length > 1) {
    console.log(`⚠️  Multiple market data sources detected: ${marketSourcesFound.join(', ')}`)
  }

  // Check wallet identity conflicts
  const walletSourcesFound = Array.from(analyses.keys()).filter(source =>
    source.includes('Identity') || source.includes('Analytics')
  )

  if (walletSourcesFound.length > 1) {
    console.log(`⚠️  Multiple wallet tracking sources detected: ${walletSourcesFound.join(', ')}`)
  }
}

function generateReport(analyses: Map<string, DataSourceAnalysis>): string {
  const currentDate = new Date().toISOString()

  let report = `# Data Sources Overview Report\n\n`
  report += `**Generated:** ${currentDate}  \n`
  report += `**Analysis Date:** ${CURRENT_DATE}  \n\n`

  report += `## Executive Summary\n\n`

  // Overall health assessment
  const totalTables = Array.from(analyses.values()).reduce((sum, a) => sum + a.tables.length, 0)
  const healthySources = Array.from(analyses.values()).filter(a => a.healthStatus === 'healthy').length
  const criticalSources = Array.from(analyses.values()).filter(a => a.healthStatus === 'critical').length

  report += `- **Total Tables Analyzed:** ${totalTables}  \n`
  report += `- **Data Sources Identified:** ${analyses.size}  \n`
  report += `- **Healthy Sources:** ${healthySources}  \n`
  report += `- **Critical Issues:** ${criticalSources}  \n\n`

  // High-level recommendations
  if (criticalSources > 0) {
    report += `### ⚠️ Critical Issues Found\n\n`
    report += `Several data sources are experiencing critical issues including stale data and missing ingestion. Immediate attention required.\n\n`
  }

  report += `## Data Source Analysis by Category\n\n`

  // Group by health status and source type
  const sortedAnalyses = Array.from(analyses.values()).sort((a, b) => {
    const statusOrder = {'critical': 0, 'degraded': 1, 'unknown': 2, 'healthy': 3}
    return (statusOrder[a.healthStatus] || 2) - (statusOrder[b.healthStatus] || 2)
  })

  for (const analysis of sortedAnalyses) {
    const statusEmoji =
      analysis.healthStatus === 'healthy' ? '🟢' :
      analysis.healthStatus === 'degraded' ? '🟡' :
      analysis.healthStatus === 'critical' ? '🔴' : '⚪'

    report += `### ${statusEmoji} ${analysis.source}\n\n`
    report += `**Health Status:** ${analysis.healthStatus.toUpperCase()}  \n`
    report += `**Total Rows:** ${analysis.totalRows.toLocaleString()}  \n`

    if (analysis.maxTimestamp) {
      report += `**Latest Data:** ${analysis.maxTimestamp}  \n`
    }

    if (analysis.canonical_table) {
      report += `**Primary Table:** ${analysis.canonical_table}  \n`
    }

    if (analysis.issues.length > 0) {
      report += `**Issues:**\n`
      for (const issue of analysis.issues) {
        report += `- ${issue}  \n`
      }
    }

    // Table breakdown
    if (analysis.tables.length > 0) {
      report += `**Tables:**  \n`
      const activeTables = analysis.tables.filter(t => t.total_rows > 0)
      if (activeTables.length > 0) {
        for (const table of activeTables) {
          const daysBehindText = table.days_behind ? ` (${table.days_behind} days behind)` : ''
          report += `- \`${table.name}\`: ${table.total_rows.toLocaleString()} rows${daysBehindText}  \n`
        }
      }

      const backupTables = analysis.tables.filter(t => t.has_duplicates)
      if (backupTables.length > 0) {
        report += `**Backup/Versioned Tables:**  \n`
        for (const table of backupTables) {
          report += `- \`${table.name}\`: ${table.total_rows.toLocaleString()} rows  \n`
        }
      }
    }

    report += `\n`
  }

  report += `## Canonical Source Recommendations\n\n`

  // Recommend canonical sources
  const recommendations = [
    { type: 'Trading Data', source: 'CLOB', reason: 'Direct from Polymarket order matching system' },
    { type: 'Market Metadata', source: 'Gamma/Market', reason: 'Official market information and outcomes' },
    { type: 'Token Transfers', source: 'ERC1155', reason: 'On-chain blockchain data' },
    { type: 'P&L Analytics', source: 'Analytics/Calculated', reason: 'Derived from authoritative sources' }
  ]

  for (const rec of recommendations) {
    report += `- **${rec.type}:** ${rec.source} - ${rec.reason}  \n`
  }

  report += `\n## Critical Actions Required\n\n`

  const criticalIssues = Array.from(analyses.values())
    .filter(a => a.healthStatus === 'critical')
    .flatMap(a => a.issues)

  if (criticalIssues.length > 0) {
    for (const issue of criticalIssues) {
      report += `1. ${issue}  \n`
    }
  } else {
    report += `No critical issues detected. Continue monitoring ingestion health.  \n`
  }

  return report
}

async function main() {
  console.log('🚀 Starting comprehensive data source analysis...')
  console.log(`📅 Analysis date: ${CURRENT_DATE}`)

  try {
    // Step 1: Get basic table inventory
    const tables = await analyzeTableInventory()

    // Step 2: Classify data sources
    console.log('🏷️  Classifying data sources...')
    const tablesWithSource = tables.map(table => ({
      ...table,
      source_type: classifyDataSource(table.name, table.database)
    }))

    // Step 3: Check data freshness
    console.log('⏰ Checking data freshness for all tables...')
    const enrichedTables = await Promise.all(
      tablesWithSource.map(async table => {
        const health = await checkTimestampHealth(table.name, table.database)
        return {
          ...table,
          max_timestamp: health.max_timestamp,
          days_behind: health.days_behind
        }
      })
    )

    // Step 4: Detect duplicates and backups
    const processedTables = await detectDuplicateInfo(enrichedTables)

    // Step 5: Group by source
    const tablesBySource = new Map<string, TableInfo[]>()
    for (const table of processedTables) {
      const source = table.source_type || 'Unknown'
      if (!tablesBySource.has(source)) {
        tablesBySource.set(source, [])
      }
      tablesBySource.get(source)!.push(table)
    }

    // Step 6: Prioritize and analyze
    const analyses = prioritizeSourceTables(tablesBySource)

    // Step 7: Detect conflicts
    detectDataConflicts(analyses)

    // Step 8: Generate comprehensive report
    const report = generateReport(analyses)

    // Write report
    require('fs').writeFileSync('/Users/scotty/Projects/Cascadian-app/DATA_SOURCES_OVERVIEW.md', report)

    console.log('✅ Data source analysis complete!')
    console.log(`📄 Report written to DATA_SOURCES_OVERVIEW.md`)
    console.log(`📊 Summary: ${tables.length} tables, ${analyses.size} data sources classified`)

    // Quick stats
    const allIssues = Array.from(analyses.values()).flatMap(a => a.issues)
    console.log(`🚨 Issues detected: ${allIssues.length}`)
    console.log(`🟢 Healthy sources: ${Array.from(analyses.values()).filter(a => a.healthStatus === 'healthy').length}`)
    console.log(`🔴 Critical sources: ${Array.from(analyses.values()).filter(a => a.healthStatus === 'critical').length}`)

  } catch (error) {
    console.error('❌ Analysis failed:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch(console.error)
}

export { analyzeTableInventory, classifyDataSource, checkTimestampHealth }