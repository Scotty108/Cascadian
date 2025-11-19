#!/usr/bin/env npx tsx

/**
 * Debug view mapping issue - why is verification returning 0 trades?
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

const XI_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
const XCN_EXECUTOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('DEBUG VIEW MAPPING ISSUE')
  console.log('════════════════════════════════════════════════════════════════════\n')

  // Check 1: Source table has data
  console.log('Check 1: Does source table have trades for executor?\n')
  const sourceQuery = `
    SELECT count() AS trades
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${XCN_EXECUTOR}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
  `
  const sourceResponse = await clickhouse.query({ query: sourceQuery, format: 'JSONEachRow' })
  const sourceData = await sourceResponse.json<any>()
  console.log(`Source table trades for executor: ${sourceData[0].trades}`)
  console.log()

  // Check 2: Wallet identity map
  console.log('Check 2: What does wallet_identity_map show?\n')
  const mapQuery = `
    SELECT *
    FROM wallet_identity_map
    WHERE lower(user_eoa) = lower('${XCN_EXECUTOR}')
       OR lower(proxy_wallet) = lower('${XCN_EXECUTOR}')
       OR lower(canonical_wallet) = lower('${XCN_CANONICAL}')
    LIMIT 10
  `
  const mapResponse = await clickhouse.query({ query: mapQuery, format: 'JSONEachRow' })
  const mapData = await mapResponse.json<any>()
  console.log(`Wallet identity map entries: ${mapData.length}`)
  mapData.forEach((row, i) => {
    console.log(`${i + 1}. EOA: ${row.user_eoa}`)
    console.log(`   Proxy: ${row.proxy_wallet}`)
    console.log(`   Canonical: ${row.canonical_wallet}`)
  })
  console.log()

  // Check 3: View query for executor wallet
  console.log('Check 3: What does view show for executor wallet?\n')
  const viewExecutorQuery = `
    SELECT count() AS trades, wallet_canonical, wallet_raw
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_raw) = lower('${XCN_EXECUTOR}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
    GROUP BY wallet_canonical, wallet_raw
  `
  const viewExecutorResponse = await clickhouse.query({
    query: viewExecutorQuery,
    format: 'JSONEachRow',
  })
  const viewExecutorData = await viewExecutorResponse.json<any>()
  console.log(`View trades for executor (raw): ${viewExecutorData.length} groups`)
  viewExecutorData.forEach((row, i) => {
    console.log(`${i + 1}. Raw: ${row.wallet_raw}`)
    console.log(`   Canonical: ${row.wallet_canonical}`)
    console.log(`   Trades: ${row.trades}`)
  })
  console.log()

  // Check 4: View query for canonical wallet
  console.log('Check 4: What does view show for canonical wallet?\n')
  const viewCanonicalQuery = `
    SELECT count() AS trades, wallet_canonical, wallet_raw
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
    GROUP BY wallet_canonical, wallet_raw
  `
  const viewCanonicalResponse = await clickhouse.query({
    query: viewCanonicalQuery,
    format: 'JSONEachRow',
  })
  const viewCanonicalData = await viewCanonicalResponse.json<any>()
  console.log(`View trades for canonical: ${viewCanonicalData.length} groups`)
  viewCanonicalData.forEach((row, i) => {
    console.log(`${i + 1}. Raw: ${row.wallet_raw}`)
    console.log(`   Canonical: ${row.wallet_canonical}`)
    console.log(`   Trades: ${row.trades}`)
  })
  console.log()

  // Check 5: Sample a few trades from view
  console.log('Check 5: Sample trades from view\n')
  const sampleQuery = `
    SELECT wallet_raw, wallet_canonical, trade_direction, shares, price
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_raw) = lower('${XCN_EXECUTOR}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
    LIMIT 5
  `
  const sampleResponse = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' })
  const sampleData = await sampleResponse.json<any>()
  console.log(`Sample trades: ${sampleData.length}`)
  sampleData.forEach((row, i) => {
    console.log(`${i + 1}. Direction: ${row.trade_direction}`)
    console.log(`   Shares: ${row.shares}`)
    console.log(`   Price: ${row.price}`)
    console.log(`   Raw wallet: ${row.wallet_raw}`)
    console.log(`   Canonical wallet: ${row.wallet_canonical}`)
  })

  await clickhouse.close()
}

main().catch(console.error)
