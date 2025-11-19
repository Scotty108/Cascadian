#!/usr/bin/env npx tsx

/**
 * Audit vw_trades_canonical_with_canonical_wallet inputs for xcnstrategy wallet
 *
 * Checks:
 * 1. Rows in pm_trades_canonical_v3 for problematic CIDs
 * 2. Wallet attribution (raw executor vs canonical)
 * 3. Sign/side/shares logic
 * 4. View behavior vs source tables
 */

import { createClient } from '@clickhouse/client'
import * as fs from 'fs'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

// Target wallet and problematic condition IDs
const XCN_WALLET_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const XCN_WALLET_REAL = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
const INFLATION_CID = '93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620' // no 0x
const XI_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1' // no 0x

interface AuditResult {
  check: string
  query: string
  result: any
  status: 'PASS' | 'FAIL' | 'INFO'
  notes: string
}

const results: AuditResult[] = []

async function auditCheck(check: string, query: string, expected?: (result: any) => boolean | string): Promise<void> {
  try {
    console.log(`\n🔍 ${check}...`)

    const response = await clickhouse.query({ query, format: 'JSONEachRow' })
    const data = await response.json<any>()

    let status: 'PASS' | 'FAIL' | 'INFO' = 'INFO'
    let notes = ''

    if (expected) {
      const outcome = expected(data)
      if (typeof outcome === 'boolean') {
        status = outcome ? 'PASS' : 'FAIL'
        notes = outcome ? 'Meets expectation' : 'Does not meet expectation'
      } else {
        status = outcome.includes('✅') ? 'PASS' : (outcome.includes('❌') ? 'FAIL' : 'INFO')
        notes = outcome
      }
    }

    results.push({ check, query, result: data, status, notes })

    console.log(`   Result count: ${Array.isArray(data) ? data.length : 1}`)
    if (Array.isArray(data) && data.length > 0) {
      console.log(`   Sample:`, JSON.stringify(data[0], null, 2).substring(0, 200))
    }
    console.log(`   Status: ${status} - ${notes}`)

  } catch (error: any) {
    console.log(`   ❌ ERROR: ${error.message}`)
    results.push({ check, query, result: null, status: 'FAIL', notes: `Query error: ${error.message}` })
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('XCN WALLET VIEW INPUT AUDIT')
  console.log('════════════════════════════════════════════════════════════════════')
  console.log(`EOA Wallet: ${XCN_WALLET_EOA}`)
  console.log(`Real Wallet: ${XCN_WALLET_REAL}`)
  console.log(`Inflation CID: ${INFLATION_CID}`)
  console.log(`Xi CID: ${XI_CID}`)
  console.log('════════════════════════════════════════════════════════════════════')

  // Check 1: pm_trades_canonical_v3 has Inflation market rows
  await auditCheck(
    'Check 1: Inflation market in pm_trades_canonical_v3',
    `
      SELECT
        count(*) as count,
        countDistinct(wallet_address) as unique_wallets,
        sum(toFloat64(shares)) as total_shares,
        sum(toFloat64(usd_value)) as total_volume_usd
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(market_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
    `,
    (data) => {
      const count = data[0]?.count || 0
      return count > 0
        ? `✅ Found ${count} trades for Inflation market`
        : `❌ FOUND 0 TRADES - MISSING IN pm_trades_canonical_v3`
    }
  )

  // Check 2: pm_trades_canonical_v3 has Xi market rows
  await auditCheck(
    'Check 2: Xi market in pm_trades_canonical_v3',
    `
      SELECT
        count(*) as count,
        countDistinct(wallet_address) as unique_wallets,
        sum(toFloat64(shares)) as total_shares,
        sum(toFloat64(usd_value)) as total_volume_usd
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(market_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
    `,
    (data) => {
      const count = data[0]?.count || 0
      return count > 0
        ? `✅ Found ${count} trades for Xi market`
        : `❌ FOUND 0 TRADES - MISSING IN pm_trades_canonical_v3`
    }
  )

  // Check 3: XCN wallet trades for Inflation market (pre-override)
  await auditCheck(
    'Check 3: XCN (EOA) trades in Inflation market',
    `
      SELECT
        count(*) as count,
        groupArray(transaction_hash) as tx_hashes,
        groupArray(trade_direction) as directions,
        groupArray(toFloat64(shares)) as shares
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(market_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
        AND lower(wallet_address) = lower('${XCN_WALLET_EOA}')
    `,
    (data) => {
      const count = data[0]?.count || 0
      return count > 0
        ? `✅ Found ${count} trades for EOA in Inflation market`
        : `❌ No trades for EOA - check if attributed to executor ${XCN_WALLET_REAL}`
    }
  )

  // Check 4: XCN wallet trades for Xi market (pre-override)
  await auditCheck(
    'Check 4: XCN (EOA) trades in Xi market',
    `
      SELECT
        count(*) as count,
        arraySlice(groupArray(transaction_hash), 1, 5) as sample_tx_hashes,
        arraySlice(groupArray(trade_direction), 1, 5) as sample_directions,
        arraySlice(groupArray(toFloat64(shares)), 1, 5) as sample_shares
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(market_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
        AND lower(wallet_address) = lower('${XCN_WALLET_EOA}')
    `,
    (data) => {
      const count = data[0]?.count || 0
      return count > 0
        ? `✅ Found ${count} trades for EOA in Xi market`
        : `❌ No trades for EOA - check if attributed to executor ${XCN_WALLET_REAL}`
    }
  )

  // Check 5: Real wallet (executor) trades in problematic markets
  await auditCheck(
    'Check 5: Real wallet (executor) trades in Inflation market',
    `
      SELECT
        count(*) as count,
        groupArray(transaction_hash) as tx_hashes,
        groupArray(trade_direction) as directions,
        groupArray(toFloat64(shares)) as shares
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(market_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
        AND lower(wallet_address) = lower('${XCN_WALLET_REAL}')
    `,
    (data) => {
      const count = data[0]?.count || 0
      return count > 0
        ? `⚠️ Found ${count} trades for REAL wallet (executor) - ATTRIBUTION ISSUE`
        : `✅ No trades for real wallet - correct`
    }
  )

  await auditCheck(
    'Check 6: Real wallet (executor) trades in Xi market',
    `
      SELECT
        count(*) as count,
        arraySlice(groupArray(transaction_hash), 1, 5) as sample_tx_hashes,
        arraySlice(groupArray(trade_direction), 1, 5) as sample_directions,
        arraySlice(groupArray(toFloat64(shares)), 1, 5) as sample_shares
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(market_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
        AND lower(wallet_address) = lower('${XCN_WALLET_REAL}')
    `,
    (data) => {
      const count = data[0]?.count || 0
      return count > 0
        ? `⚠️ Found ${count} trades for REAL wallet (executor) - ATTRIBUTION ISSUE`
        : `✅ No trades for real wallet - correct`
    }
  )

  // Check 7: Wallet identity map for XCN wallets
  await auditCheck(
    'Check 7: Wallet identity map for XCN',
    `
      SELECT
        user_eoa,
        proxy_wallet,
        canonical_wallet
      FROM wallet_identity_map
      WHERE lower(user_eoa) = lower('${XCN_WALLET_EOA}')
         OR lower(proxy_wallet) = lower('${XCN_WALLET_REAL}')
         OR lower(canonical_wallet) = lower('${XCN_WALLET_EOA}')
    `,
    (data) => {
      if (!Array.isArray(data) || data.length === 0) {
        return `❌ NO WALLET MAPPING FOUND - View cannot override attribution`
      }
      const hasCorrectMapping = data.some(row =>
        row.canonical_wallet?.toLowerCase() === XCN_WALLET_EOA.toLowerCase()
      )
      return hasCorrectMapping
        ? `✅ Found ${data.length} wallet mappings with correct canonical address`
        : `❌ Wallet mappings exist but canonical address is wrong`
    }
  )

  // Check 8: Sign/side logic audit - sample Xi trades
  await auditCheck(
    'Check 8: Sign/side logic audit (Xi market sample)',
    `
      SELECT
        transaction_hash,
        trade_direction,
        toFloat64(shares) as shares,
        toFloat64(price) as price,
        toFloat64(usd_value) as cost
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(market_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
      ORDER BY created_at DESC
      LIMIT 10
    `,
    (data) => {
      if (!Array.isArray(data) || data.length === 0) {
        return '❌ No Xi trades found for sign/side audit'
      }

      // Check for sign consistency
      const buys = data.filter(t => t.trade_direction === 'BUY')
      const sells = data.filter(t => t.trade_direction === 'SELL')

      const buySharesPositive = buys.every(t => t.shares > 0)
      const sellSharesNegative = sells.every(t => t.shares < 0)

      if (!buySharesPositive || !sellSharesNegative) {
        return `❌ SIGN ISSUE - Buys should be +shares, sells should be -shares`
      }

      return `✅ Sign/side logic correct: ${buys.length} buys (+shares), ${sells.length} sells (-shares)`
    }
  )

  // Check 9: vw_trades_canonical_with_canonical_wallet behavior
  await auditCheck(
    'Check 9: View behavior for XCN in Inflation market',
    `
      SELECT
        count(*) as count,
        groupArray(transaction_hash) as tx_hashes,
        groupArray(wallet_canonical) as canonical_wallets
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(replaceRegexpAll(market_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
        AND (
          lower(wallet_canonical) = lower('${XCN_WALLET_EOA}')
          OR lower(wallet_address) = lower('${XCN_WALLET_EOA}')
        )
    `,
    (data) => {
      const count = data[0]?.count || 0
      return count > 0
        ? `✅ View shows ${count} trades for XCN in Inflation market`
        : `❌ VIEW IS FILTERING OUT TRADES - Check view logic`
    }
  )

  await auditCheck(
    'Check 10: View behavior for XCN in Xi market',
    `
      SELECT
        count(*) as count,
        sum(toFloat64(shares)) as total_shares,
        arraySlice(groupArray(trade_direction), 1, 5) as sample_directions
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(replaceRegexpAll(market_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
        AND (
          lower(wallet_canonical) = lower('${XCN_WALLET_EOA}')
          OR lower(wallet_address) = lower('${XCN_WALLET_EOA}')
        )
    `,
    (data) => {
      const count = data[0]?.count || 0
      const totalShares = data[0]?.total_shares || 0

      if (count === 0) {
        return `❌ VIEW IS FILTERING OUT TRADES - Check view logic`
      }

      if (Math.abs(totalShares) > 20000) {
        return `⚠️ POSSIBLE 7x INFLATION - Total shares: ${totalShares} (expected ~8,400 based on API)`
      }

      return `✅ View shows ${count} trades, total_shares: ${totalShares}`
    }
  )

  // Summary
  console.log('\n════════════════════════════════════════════════════════════════════')
  console.log('AUDIT SUMMARY')
  console.log('════════════════════════════════════════════════════════════════════')

  const passing = results.filter(r => r.status === 'PASS').length
  const failing = results.filter(r => r.status === 'FAIL').length
  const info = results.filter(r => r.status === 'INFO').length

  console.log(`\n✅ PASS: ${passing}`)
  console.log(`❌ FAIL: ${failing}`)
  console.log(`ℹ️  INFO: ${info}`)

  console.log('\n🔴 FAILED CHECKS:')
  results
    .filter(r => r.status === 'FAIL')
    .forEach(r => {
      console.log(`   - ${r.check}`)
      console.log(`     ${r.notes}`)
    })

  // Export results
  const reportPath = '/tmp/xcn_view_audit_report.json'
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n📄 Full report saved to: ${reportPath}`)

  await clickhouse.close()
}

main().catch(console.error)
