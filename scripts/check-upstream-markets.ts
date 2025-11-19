#!/usr/bin/env npx tsx

/**
 * Check if missing XCN markets exist in upstream tables
 *
 * Purpose: Determine if the ingestion gap is:
 * - Type A: Data exists in clob_fills/trades_raw but dropped by canonicalization
 * - Type B: Data never ingested from API
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

// Target markets (bare 64-char hex, no 0x)
const INFLATION_CID = '93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620'
const XI_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
const XCN_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

interface UpstreamResult {
  table: string
  inflation_count: string
  xi_count: string
  xcn_inflation_count?: string
  xcn_xi_count?: string
  status: 'FOUND' | 'MISSING' | 'ERROR'
  notes: string
}

const results: UpstreamResult[] = []

async function checkTable(
  tableName: string,
  conditionIdColumn: string,
  walletColumn?: string
): Promise<void> {
  try {
    console.log(`\n🔍 Checking ${tableName}...`)

    // Check total counts for each market
    const query = `
      SELECT
        countIf(lower(replaceRegexpAll(${conditionIdColumn}, '^0x', '')) = lower('${INFLATION_CID}')) as inflation_count,
        countIf(lower(replaceRegexpAll(${conditionIdColumn}, '^0x', '')) = lower('${XI_CID}')) as xi_count
        ${walletColumn ? `,
        countIf(lower(replaceRegexpAll(${conditionIdColumn}, '^0x', '')) = lower('${INFLATION_CID}')
                AND lower(${walletColumn}) = lower('${XCN_WALLET}')) as xcn_inflation_count,
        countIf(lower(replaceRegexpAll(${conditionIdColumn}, '^0x', '')) = lower('${XI_CID}')
                AND lower(${walletColumn}) = lower('${XCN_WALLET}')) as xcn_xi_count` : ''}
      FROM ${tableName}
    `

    const response = await clickhouse.query({ query, format: 'JSONEachRow' })
    const data = await response.json<any>()
    const row = data[0]

    const inflationCount = parseInt(row.inflation_count || '0')
    const xiCount = parseInt(row.xi_count || '0')
    const xcnInflationCount = row.xcn_inflation_count ? parseInt(row.xcn_inflation_count) : undefined
    const xcnXiCount = row.xcn_xi_count ? parseInt(row.xcn_xi_count) : undefined

    console.log(`  Inflation market: ${inflationCount} rows`)
    console.log(`  Xi market: ${xiCount} rows`)
    if (walletColumn) {
      console.log(`  XCN wallet (Inflation): ${xcnInflationCount} rows`)
      console.log(`  XCN wallet (Xi): ${xcnXiCount} rows`)
    }

    const status: 'FOUND' | 'MISSING' = (inflationCount > 0 || xiCount > 0) ? 'FOUND' : 'MISSING'
    const notes = status === 'FOUND'
      ? `Found ${inflationCount} Inflation + ${xiCount} Xi trades`
      : 'Both markets missing from this table'

    results.push({
      table: tableName,
      inflation_count: inflationCount.toString(),
      xi_count: xiCount.toString(),
      xcn_inflation_count: xcnInflationCount?.toString(),
      xcn_xi_count: xcnXiCount?.toString(),
      status,
      notes,
    })

  } catch (error: any) {
    console.log(`  ❌ ERROR: ${error.message}`)
    results.push({
      table: tableName,
      inflation_count: '0',
      xi_count: '0',
      status: 'ERROR',
      notes: `Query error: ${error.message}`,
    })
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('UPSTREAM TABLES CHECK - MISSING XCN MARKETS')
  console.log('════════════════════════════════════════════════════════════════════')
  console.log(`Inflation CID: ${INFLATION_CID}`)
  console.log(`Xi CID: ${XI_CID}`)
  console.log(`XCN Wallet: ${XCN_WALLET}`)
  console.log('════════════════════════════════════════════════════════════════════')

  // Check various upstream tables
  // (adjust column names based on actual schema)

  // Check clob_fills
  await checkTable('clob_fills', 'condition_id', 'wallet_address')

  // Check trades_raw
  await checkTable('trades_raw', 'condition_id', 'wallet_address')

  // Check pm_trades (pre-canonical)
  await checkTable('pm_trades', 'condition_id_norm_v3', 'wallet_address')

  // Check if repair views have the data
  await checkTable('vw_trades_canonical_xcn_repaired', 'condition_id_norm_v3', 'wallet_address')

  // Summary
  console.log('\n════════════════════════════════════════════════════════════════════')
  console.log('SUMMARY')
  console.log('════════════════════════════════════════════════════════════════════')

  const foundInAny = results.some(r => r.status === 'FOUND')

  if (foundInAny) {
    console.log('\n✅ DATA FOUND IN UPSTREAM TABLES')
    console.log('\nGap Type: TYPE A - Canonicalization dropping data')
    console.log('Root Cause: pm_trades → pm_trades_canonical_v3 pipeline issue')
    console.log('Solution: Fix canonicalization logic, rebuild canonical table')

    console.log('\nTables with data:')
    results
      .filter(r => r.status === 'FOUND')
      .forEach(r => {
        console.log(`  ✅ ${r.table}: ${r.inflation_count} Inflation + ${r.xi_count} Xi`)
      })

  } else {
    console.log('\n❌ DATA MISSING FROM ALL UPSTREAM TABLES')
    console.log('\nGap Type: TYPE B - Initial ingestion gap')
    console.log('Root Cause: CLOB API backfill never captured these markets')
    console.log('Solution: Targeted backfill from Polymarket CLOB API')
  }

  console.log('\nDetailed Results:')
  console.table(results.map(r => ({
    Table: r.table,
    'Inflation': r.inflation_count,
    'Xi': r.xi_count,
    'XCN (Inflation)': r.xcn_inflation_count || 'N/A',
    'XCN (Xi)': r.xcn_xi_count || 'N/A',
    Status: r.status,
  })))

  // Export results
  const reportPath = '/tmp/upstream_markets_check.json'
  const fs = await import('fs')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n📄 Full report saved to: ${reportPath}`)

  await clickhouse.close()
}

main().catch(console.error)
