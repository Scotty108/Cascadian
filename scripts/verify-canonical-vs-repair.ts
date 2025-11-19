#!/usr/bin/env npx tsx

/**
 * Verify discrepancy: why does repair view have data when canonical table doesn't?
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

const INFLATION_CID = '93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620'
const XI_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('CANONICAL vs REPAIR VIEW DISCREPANCY CHECK')
  console.log('════════════════════════════════════════════════════════════════════\n')

  // Check pm_trades_canonical_v3 directly (all conditions, not just v3)
  console.log('🔍 Check 1: pm_trades_canonical_v3 using ALL condition_id columns...\n')

  const checks = [
    { name: 'condition_id_norm_v3', column: 'condition_id_norm_v3' },
    { name: 'condition_id_norm_v2', column: 'condition_id_norm_v2' },
    { name: 'condition_id_norm_orig', column: 'condition_id_norm_orig' },
  ]

  for (const check of checks) {
    console.log(`  Checking ${check.name}...`)

    const query = `
      SELECT
        countIf(lower(replaceRegexpAll(${check.column}, '^0x', '')) = lower('${INFLATION_CID}')) as inflation,
        countIf(lower(replaceRegexpAll(${check.column}, '^0x', '')) = lower('${XI_CID}')) as xi
      FROM pm_trades_canonical_v3
    `

    const response = await clickhouse.query({ query, format: 'JSONEachRow' })
    const data = await response.json<any>()
    const row = data[0]

    console.log(`    Inflation: ${row.inflation}`)
    console.log(`    Xi: ${row.xi}`)
  }

  // Check repair view
  console.log('\n🔍 Check 2: vw_trades_canonical_xcn_repaired...\n')

  const repairQuery = `
    SELECT
      countIf(lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')) as inflation,
      countIf(lower(replaceRegexpAll(condition_id_norm_v2, '^0x', '')) = lower('${INFLATION_CID}')) as inflation_v2,
      countIf(lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')) as xi,
      countIf(lower(replaceRegexpAll(condition_id_norm_v2, '^0x', '')) = lower('${XI_CID}')) as xi_v2
    FROM vw_trades_canonical_xcn_repaired
  `

  const repairResponse = await clickhouse.query({ query: repairQuery, format: 'JSONEachRow' })
  const repairData = await repairResponse.json<any>()
  const repairRow = repairData[0]

  console.log(`  Using condition_id_norm_v3:`)
  console.log(`    Inflation: ${repairRow.inflation}`)
  console.log(`    Xi: ${repairRow.xi}`)
  console.log(`  Using condition_id_norm_v2:`)
  console.log(`    Inflation: ${repairRow.inflation_v2}`)
  console.log(`    Xi: ${repairRow.xi_v2}`)

  // Sample some trades from repair view to see which column has data
  console.log('\n🔍 Check 3: Sample trades from repair view (Inflation market)...\n')

  const sampleQuery = `
    SELECT
      transaction_hash,
      wallet_address,
      wallet_address_fixed,
      condition_id_norm_v3,
      condition_id_norm_v2,
      condition_id_norm_orig,
      shares,
      usd_value
    FROM vw_trades_canonical_xcn_repaired
    WHERE lower(replaceRegexpAll(condition_id_norm_v2, '^0x', '')) = lower('${INFLATION_CID}')
    LIMIT 5
  `

  const sampleResponse = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' })
  const sampleData = await sampleResponse.json<any>()

  console.log(`  Found ${sampleData.length} sample trades:`)
  sampleData.forEach((row, i) => {
    console.log(`\n  Trade ${i + 1}:`)
    console.log(`    Transaction: ${row.transaction_hash}`)
    console.log(`    Wallet (original): ${row.wallet_address}`)
    console.log(`    Wallet (fixed): ${row.wallet_address_fixed}`)
    console.log(`    CID v3: ${row.condition_id_norm_v3 || 'NULL'}`)
    console.log(`    CID v2: ${row.condition_id_norm_v2 || 'NULL'}`)
    console.log(`    CID orig: ${row.condition_id_norm_orig || 'NULL'}`)
    console.log(`    Shares: ${row.shares}`)
    console.log(`    USD Value: ${row.usd_value}`)
  })

  await clickhouse.close()
}

main().catch(console.error)
