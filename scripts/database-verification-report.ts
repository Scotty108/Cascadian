#!/usr/bin/env tsx

/**
 * Database Schema & Quality Verification Script
 *
 * Mission: Verify Main Claude's claims about condition_id coverage
 * Runtime: ~2-3 minutes
 *
 * Claims to verify:
 * 1. vw_trades_canonical: 157M rows, 80.1M valid condition_ids
 * 2. trades_raw_enriched_final: 166M rows, 86M valid condition_ids
 * 3. trade_direction_assignments: 129.6M rows with complete wallets
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

interface VerificationResult {
  table: string
  claimed_rows?: number
  actual_rows?: number
  claimed_valid_condition_ids?: number
  actual_valid_condition_ids?: number
  coverage_pct?: number
  unique_condition_ids?: number
  data_quality_score?: number
  status: 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_FOUND'
  issues: string[]
}

const results: VerificationResult[] = []

async function tableExists(tableName: string): Promise<boolean> {
  try {
    const result = await clickhouse.query({
      query: `SELECT count() as cnt FROM system.tables WHERE database = currentDatabase() AND name = '${tableName}'`,
      format: 'JSONEachRow',
    })
    const data = await result.json<{ cnt: string }>()
    return Number(data[0]?.cnt || 0) > 0
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error)
    return false
  }
}

async function getTableSchema(tableName: string): Promise<string[]> {
  try {
    const result = await clickhouse.query({
      query: `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = '${tableName}' ORDER BY name`,
      format: 'JSONEachRow',
    })
    const data = await result.json<{ name: string }>()
    return data.map(row => row.name)
  } catch (error) {
    console.error(`Error getting schema for ${tableName}:`, error)
    return []
  }
}

async function verifyVwTradesCanonical() {
  console.log('\n=== VERIFYING vw_trades_canonical ===')

  const tableName = 'vw_trades_canonical'
  const claimed_rows = 157_000_000
  const claimed_valid_ids = 80_100_000

  const result: VerificationResult = {
    table: tableName,
    claimed_rows,
    claimed_valid_condition_ids: claimed_valid_ids,
    status: 'FAIL',
    issues: [],
  }

  // Check existence
  if (!(await tableExists(tableName))) {
    result.issues.push('Table does not exist')
    results.push(result)
    console.log('❌ Table not found')
    return
  }

  // Check schema
  const columns = await getTableSchema(tableName)
  console.log(`Columns found: ${columns.join(', ')}`)

  const requiredColumns = ['condition_id_norm', 'outcome_index', 'trade_direction', 'wallet_address_norm']
  const missingColumns = requiredColumns.filter(col => !columns.includes(col))
  if (missingColumns.length > 0) {
    result.issues.push(`Missing columns: ${missingColumns.join(', ')}`)
  }

  // Row count
  try {
    const rowCountResult = await clickhouse.query({
      query: `SELECT count() as total FROM ${tableName}`,
      format: 'JSONEachRow',
    })
    const rowData = await rowCountResult.json<{ total: string }>()
    result.actual_rows = Number(rowData[0].total)
    console.log(`Total rows: ${result.actual_rows.toLocaleString()} (claimed: ${claimed_rows.toLocaleString()})`)

    const rowDiff = Math.abs((result.actual_rows - claimed_rows) / claimed_rows * 100)
    if (rowDiff > 5) {
      result.issues.push(`Row count off by ${rowDiff.toFixed(1)}%`)
    }
  } catch (error) {
    result.issues.push(`Failed to count rows: ${error}`)
  }

  // Condition ID quality
  try {
    const qualityResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          countIf(condition_id_norm != '' AND condition_id_norm != concat('0x', repeat('0',64)) AND condition_id_norm != repeat('0',64)) as valid_condition_ids,
          uniqExact(condition_id_norm) as unique_condition_ids,
          round(valid_condition_ids / total_rows * 100, 2) as coverage_pct
        FROM ${tableName}
      `,
      format: 'JSONEachRow',
    })
    const qualityData = await qualityResult.json<{
      total_rows: string
      valid_condition_ids: string
      unique_condition_ids: string
      coverage_pct: string
    }>()

    result.actual_valid_condition_ids = Number(qualityData[0].valid_condition_ids)
    result.unique_condition_ids = Number(qualityData[0].unique_condition_ids)
    result.coverage_pct = Number(qualityData[0].coverage_pct)

    console.log(`Valid condition_ids: ${result.actual_valid_condition_ids.toLocaleString()} (claimed: ${claimed_valid_ids.toLocaleString()})`)
    console.log(`Unique condition_ids: ${result.unique_condition_ids.toLocaleString()}`)
    console.log(`Coverage: ${result.coverage_pct}%`)

    const validDiff = Math.abs((result.actual_valid_condition_ids - claimed_valid_ids) / claimed_valid_ids * 100)
    if (validDiff > 10) {
      result.issues.push(`Valid condition_id count off by ${validDiff.toFixed(1)}%`)
    }
  } catch (error) {
    result.issues.push(`Failed to analyze condition_id quality: ${error}`)
  }

  // Data quality red flags
  try {
    const redFlagsResult = await clickhouse.query({
      query: `
        SELECT
          countIf(wallet_address_norm = '0x00000000000050ba7c429821e6d66429452ba168') as bad_wallet_count,
          round(bad_wallet_count / count() * 100, 2) as bad_wallet_pct,
          countIf(market_id IN ('12', '0x12')) as bad_market_count,
          round(bad_market_count / count() * 100, 2) as bad_market_pct,
          countIf(condition_id_norm = repeat('0', 64) OR condition_id_norm = concat('0x', repeat('0', 64))) as zero_condition_count,
          round(zero_condition_count / count() * 100, 2) as zero_condition_pct
        FROM ${tableName}
      `,
      format: 'JSONEachRow',
    })
    const redFlags = await redFlagsResult.json<{
      bad_wallet_count: string
      bad_wallet_pct: string
      bad_market_count: string
      bad_market_pct: string
      zero_condition_count: string
      zero_condition_pct: string
    }>()

    console.log(`\nData Quality Red Flags:`)
    console.log(`  Bad wallet (0x000...50ba): ${Number(redFlags[0].bad_wallet_count).toLocaleString()} (${redFlags[0].bad_wallet_pct}%)`)
    console.log(`  Bad market_id (12/0x12): ${Number(redFlags[0].bad_market_count).toLocaleString()} (${redFlags[0].bad_market_pct}%)`)
    console.log(`  Zero condition_ids: ${Number(redFlags[0].zero_condition_count).toLocaleString()} (${redFlags[0].zero_condition_pct}%)`)

    const badWalletPct = Number(redFlags[0].bad_wallet_pct)
    const badMarketPct = Number(redFlags[0].bad_market_pct)
    const zeroConditionPct = Number(redFlags[0].zero_condition_pct)

    if (badWalletPct > 1) result.issues.push(`${badWalletPct}% bad wallets`)
    if (badMarketPct > 1) result.issues.push(`${badMarketPct}% bad market_ids`)
    if (zeroConditionPct > 5) result.issues.push(`${zeroConditionPct}% zero condition_ids`)

    // Calculate data quality score (0-100)
    result.data_quality_score = Math.max(0, 100 - badWalletPct - badMarketPct - zeroConditionPct)
  } catch (error) {
    result.issues.push(`Failed to check red flags: ${error}`)
  }

  // Determine status
  if (result.issues.length === 0) {
    result.status = 'PASS'
    console.log('✅ PASS')
  } else if (result.coverage_pct && result.coverage_pct > 70) {
    result.status = 'PARTIAL'
    console.log('⚠️  PARTIAL')
  } else {
    console.log('❌ FAIL')
  }

  results.push(result)
}

async function verifyTradesRawEnrichedFinal() {
  console.log('\n=== VERIFYING trades_raw_enriched_final ===')

  const tableName = 'trades_raw_enriched_final'
  const claimed_rows = 166_000_000
  const claimed_valid_ids = 86_000_000

  const result: VerificationResult = {
    table: tableName,
    claimed_rows,
    claimed_valid_condition_ids: claimed_valid_ids,
    status: 'FAIL',
    issues: [],
  }

  if (!(await tableExists(tableName))) {
    result.issues.push('Table does not exist')
    results.push(result)
    console.log('❌ Table not found')
    return
  }

  const columns = await getTableSchema(tableName)
  console.log(`Columns found: ${columns.join(', ')}`)

  const requiredColumns = ['condition_id', 'transaction_hash', 'wallet_address']
  const missingColumns = requiredColumns.filter(col => !columns.includes(col))
  if (missingColumns.length > 0) {
    result.issues.push(`Missing columns: ${missingColumns.join(', ')}`)
  }

  // Row count
  try {
    const rowCountResult = await clickhouse.query({
      query: `SELECT count() as total FROM ${tableName}`,
      format: 'JSONEachRow',
    })
    const rowData = await rowCountResult.json<{ total: string }>()
    result.actual_rows = Number(rowData[0].total)
    console.log(`Total rows: ${result.actual_rows.toLocaleString()} (claimed: ${claimed_rows.toLocaleString()})`)

    const rowDiff = Math.abs((result.actual_rows - claimed_rows) / claimed_rows * 100)
    if (rowDiff > 5) {
      result.issues.push(`Row count off by ${rowDiff.toFixed(1)}%`)
    }
  } catch (error) {
    result.issues.push(`Failed to count rows: ${error}`)
  }

  // Condition ID quality (checking both formats)
  try {
    const qualityResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          countIf(condition_id != '' AND condition_id != concat('0x', repeat('0',64)) AND condition_id != repeat('0',64)) as valid_condition_ids,
          uniqExact(condition_id) as unique_condition_ids,
          round(valid_condition_ids / total_rows * 100, 2) as coverage_pct
        FROM ${tableName}
      `,
      format: 'JSONEachRow',
    })
    const qualityData = await qualityResult.json<{
      total_rows: string
      valid_condition_ids: string
      unique_condition_ids: string
      coverage_pct: string
    }>()

    result.actual_valid_condition_ids = Number(qualityData[0].valid_condition_ids)
    result.unique_condition_ids = Number(qualityData[0].unique_condition_ids)
    result.coverage_pct = Number(qualityData[0].coverage_pct)

    console.log(`Valid condition_ids: ${result.actual_valid_condition_ids.toLocaleString()} (claimed: ${claimed_valid_ids.toLocaleString()})`)
    console.log(`Unique condition_ids: ${result.unique_condition_ids.toLocaleString()}`)
    console.log(`Coverage: ${result.coverage_pct}%`)

    const validDiff = Math.abs((result.actual_valid_condition_ids - claimed_valid_ids) / claimed_valid_ids * 100)
    if (validDiff > 10) {
      result.issues.push(`Valid condition_id count off by ${validDiff.toFixed(1)}%`)
    }
  } catch (error) {
    result.issues.push(`Failed to analyze condition_id quality: ${error}`)
  }

  // Determine status
  if (result.issues.length === 0) {
    result.status = 'PASS'
    console.log('✅ PASS')
  } else if (result.coverage_pct && result.coverage_pct > 70) {
    result.status = 'PARTIAL'
    console.log('⚠️  PARTIAL')
  } else {
    console.log('❌ FAIL')
  }

  results.push(result)
}

async function verifyTradeDirectionAssignments() {
  console.log('\n=== VERIFYING trade_direction_assignments ===')

  const tableName = 'trade_direction_assignments'
  const claimed_rows = 129_600_000

  const result: VerificationResult = {
    table: tableName,
    claimed_rows,
    status: 'FAIL',
    issues: [],
  }

  if (!(await tableExists(tableName))) {
    result.issues.push('Table does not exist')
    results.push(result)
    console.log('❌ Table not found')
    return
  }

  const columns = await getTableSchema(tableName)
  console.log(`Columns found: ${columns.join(', ')}`)

  const requiredColumns = ['condition_id_norm', 'wallet_address', 'tx_hash', 'direction']
  const missingColumns = requiredColumns.filter(col => !columns.includes(col))
  if (missingColumns.length > 0) {
    result.issues.push(`Missing columns: ${missingColumns.join(', ')}`)
  }

  // Row count
  try {
    const rowCountResult = await clickhouse.query({
      query: `SELECT count() as total FROM ${tableName}`,
      format: 'JSONEachRow',
    })
    const rowData = await rowCountResult.json<{ total: string }>()
    result.actual_rows = Number(rowData[0].total)
    console.log(`Total rows: ${result.actual_rows.toLocaleString()} (claimed: ${claimed_rows.toLocaleString()})`)

    const rowDiff = Math.abs((result.actual_rows - claimed_rows) / claimed_rows * 100)
    if (rowDiff > 5) {
      result.issues.push(`Row count off by ${rowDiff.toFixed(1)}%`)
    }
  } catch (error) {
    result.issues.push(`Failed to count rows: ${error}`)
  }

  // Check completeness (wallets, tx_hashes)
  try {
    const completenessResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          countIf(wallet_address != '') as has_wallet,
          countIf(tx_hash != '') as has_tx_hash,
          countIf(condition_id_norm != '' AND condition_id_norm != concat('0x', repeat('0',64)) AND condition_id_norm != repeat('0',64)) as has_condition_id,
          round(has_wallet / total_rows * 100, 2) as wallet_pct,
          round(has_tx_hash / total_rows * 100, 2) as tx_hash_pct,
          round(has_condition_id / total_rows * 100, 2) as condition_id_pct
        FROM ${tableName}
      `,
      format: 'JSONEachRow',
    })
    const completeness = await completenessResult.json<{
      total_rows: string
      has_wallet: string
      has_tx_hash: string
      has_condition_id: string
      wallet_pct: string
      tx_hash_pct: string
      condition_id_pct: string
    }>()

    console.log(`\nCompleteness:`)
    console.log(`  Wallet address: ${Number(completeness[0].has_wallet).toLocaleString()} (${completeness[0].wallet_pct}%)`)
    console.log(`  TX hash: ${Number(completeness[0].has_tx_hash).toLocaleString()} (${completeness[0].tx_hash_pct}%)`)
    console.log(`  Condition ID: ${Number(completeness[0].has_condition_id).toLocaleString()} (${completeness[0].condition_id_pct}%)`)

    result.coverage_pct = Number(completeness[0].condition_id_pct)
    result.actual_valid_condition_ids = Number(completeness[0].has_condition_id)

    const walletPct = Number(completeness[0].wallet_pct)
    const txHashPct = Number(completeness[0].tx_hash_pct)

    if (walletPct < 95) result.issues.push(`Only ${walletPct}% have wallet addresses`)
    if (txHashPct < 95) result.issues.push(`Only ${txHashPct}% have tx_hashes`)
  } catch (error) {
    result.issues.push(`Failed to check completeness: ${error}`)
  }

  // Determine status
  if (result.issues.length === 0) {
    result.status = 'PASS'
    console.log('✅ PASS')
  } else if (result.coverage_pct && result.coverage_pct > 70) {
    result.status = 'PARTIAL'
    console.log('⚠️  PARTIAL')
  } else {
    console.log('❌ FAIL')
  }

  results.push(result)
}

async function checkTableOverlap() {
  console.log('\n=== CHECKING TABLE OVERLAP ===')

  const vwExists = await tableExists('vw_trades_canonical')
  const tdaExists = await tableExists('trade_direction_assignments')

  if (!vwExists || !tdaExists) {
    console.log('⚠️  Cannot check overlap - one or both tables missing')
    return
  }

  try {
    // Check tx_hash overlap
    const overlapResult = await clickhouse.query({
      query: `
        WITH
          vw_txs AS (SELECT DISTINCT transaction_hash FROM vw_trades_canonical WHERE transaction_hash != ''),
          tda_txs AS (SELECT DISTINCT tx_hash FROM trade_direction_assignments WHERE tx_hash != '')
        SELECT
          (SELECT count() FROM vw_txs) as vw_unique_txs,
          (SELECT count() FROM tda_txs) as tda_unique_txs,
          (SELECT count() FROM vw_txs WHERE transaction_hash IN (SELECT tx_hash FROM tda_txs)) as overlap_count,
          (SELECT count() FROM vw_txs WHERE transaction_hash NOT IN (SELECT tx_hash FROM tda_txs)) as vw_only_count,
          (SELECT count() FROM tda_txs WHERE tx_hash NOT IN (SELECT transaction_hash FROM vw_txs)) as tda_only_count
      `,
      format: 'JSONEachRow',
    })
    const overlap = await overlapResult.json<{
      vw_unique_txs: string
      tda_unique_txs: string
      overlap_count: string
      vw_only_count: string
      tda_only_count: string
    }>()

    const vwTxs = Number(overlap[0].vw_unique_txs)
    const tdaTxs = Number(overlap[0].tda_unique_txs)
    const overlapCount = Number(overlap[0].overlap_count)
    const vwOnly = Number(overlap[0].vw_only_count)
    const tdaOnly = Number(overlap[0].tda_only_count)

    console.log(`vw_trades_canonical unique tx_hashes: ${vwTxs.toLocaleString()}`)
    console.log(`trade_direction_assignments unique tx_hashes: ${tdaTxs.toLocaleString()}`)
    console.log(`Overlap: ${overlapCount.toLocaleString()} (${(overlapCount / Math.max(vwTxs, tdaTxs) * 100).toFixed(1)}%)`)
    console.log(`VW only: ${vwOnly.toLocaleString()}`)
    console.log(`TDA only: ${tdaOnly.toLocaleString()}`)

    if (vwOnly > vwTxs * 0.1 || tdaOnly > tdaTxs * 0.1) {
      console.log('⚠️  Tables are complementary (>10% unique data in each)')
    } else {
      console.log('✅ Tables are mostly redundant (<10% unique data)')
    }
  } catch (error) {
    console.error('❌ Failed to check overlap:', error)
  }
}

async function generateFinalReport() {
  console.log('\n' + '='.repeat(80))
  console.log('DATABASE VERIFICATION FINAL REPORT')
  console.log('='.repeat(80))

  let totalScore = 0
  let maxScore = 0

  for (const result of results) {
    console.log(`\n${result.table}:`)
    console.log(`  Status: ${result.status}`)

    if (result.actual_rows !== undefined) {
      console.log(`  Rows: ${result.actual_rows.toLocaleString()} (claimed: ${result.claimed_rows?.toLocaleString() || 'N/A'})`)
    }

    if (result.actual_valid_condition_ids !== undefined) {
      console.log(`  Valid condition_ids: ${result.actual_valid_condition_ids.toLocaleString()} (claimed: ${result.claimed_valid_condition_ids?.toLocaleString() || 'N/A'})`)
    }

    if (result.coverage_pct !== undefined) {
      console.log(`  Coverage: ${result.coverage_pct}%`)
    }

    if (result.data_quality_score !== undefined) {
      console.log(`  Data Quality Score: ${result.data_quality_score.toFixed(1)}/100`)
      totalScore += result.data_quality_score
      maxScore += 100
    }

    if (result.issues.length > 0) {
      console.log(`  Issues:`)
      result.issues.forEach(issue => console.log(`    - ${issue}`))
    } else {
      console.log(`  Issues: None`)
    }
  }

  // Overall recommendation
  console.log('\n' + '='.repeat(80))
  console.log('RECOMMENDATION:')
  console.log('='.repeat(80))

  const passCount = results.filter(r => r.status === 'PASS').length
  const partialCount = results.filter(r => r.status === 'PARTIAL').length
  const failCount = results.filter(r => r.status === 'FAIL').length

  console.log(`\nTable Status Summary:`)
  console.log(`  ✅ PASS: ${passCount}`)
  console.log(`  ⚠️  PARTIAL: ${partialCount}`)
  console.log(`  ❌ FAIL: ${failCount}`)

  if (maxScore > 0) {
    const overallScore = (totalScore / maxScore) * 100
    console.log(`\nOverall Data Quality: ${overallScore.toFixed(1)}/100`)
  }

  // Determine recommendation
  if (passCount === 3) {
    console.log('\n✅ PROCEED WITH PHASE 1')
    console.log('All tables verified. Main Claude\'s analysis is accurate.')
  } else if (passCount + partialCount >= 2) {
    console.log('\n⚠️  PROCEED WITH CAUTION')
    console.log('Most claims verified, but some data quality issues detected.')
    console.log('Recommend: Proceed with Phase 1 but monitor data quality closely.')
  } else {
    console.log('\n❌ DO NOT PROCEED')
    console.log('Main Claude\'s analysis is significantly flawed.')
    console.log('Recommend: Re-evaluate recovery strategy before investing 4-6 hours.')
  }

  // Export results as JSON
  console.log('\n' + '='.repeat(80))
  console.log('Detailed results saved to: database-verification-results.json')
}

async function main() {
  console.log('Starting database verification...\n')

  try {
    await verifyVwTradesCanonical()
    await verifyTradesRawEnrichedFinal()
    await verifyTradeDirectionAssignments()
    await checkTableOverlap()
    await generateFinalReport()

    // Write JSON report
    const fs = require('fs')
    fs.writeFileSync(
      'database-verification-results.json',
      JSON.stringify(results, null, 2)
    )

    console.log('\n✅ Verification complete!')
  } catch (error) {
    console.error('❌ Verification failed:', error)
    process.exit(1)
  }
}

main()
