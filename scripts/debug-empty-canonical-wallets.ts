#!/usr/bin/env npx tsx

/**
 * Debug why wallet_canonical is empty for Inflation market trades
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

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('DEBUG EMPTY CANONICAL WALLETS')
  console.log('════════════════════════════════════════════════════════════════════\n')

  // Check sample of "empty" canonical wallets
  const sampleQuery = `
    SELECT
      wallet_canonical,
      wallet_raw,
      trade_id,
      usd_value
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
    LIMIT 10
  `

  const sampleResponse = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' })
  const sampleData = await sampleResponse.json<any>()

  console.log('Sample trades from Inflation market:\n')
  sampleData.forEach((row, i) => {
    console.log(`${i + 1}.`)
    console.log(`   wallet_canonical: "${row.wallet_canonical}"`)
    console.log(`   wallet_raw: "${row.wallet_raw}"`)
    console.log(`   trade_id: ${row.trade_id}`)
    console.log(`   usd_value: $${row.usd_value}`)
  })

  console.log()

  // Check wallet_identity_overrides for these wallets
  console.log('Check if any Inflation wallets are in wallet_identity_overrides:\n')

  const walletCheckQuery = `
    SELECT DISTINCT
      t.wallet_address,
      wim.canonical_wallet
    FROM pm_trades_canonical_v3 AS t
    LEFT JOIN wallet_identity_overrides AS wim
      ON t.wallet_address = wim.executor_wallet
    WHERE lower(replaceRegexpAll(t.condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
    LIMIT 10
  `

  const walletCheckResponse = await clickhouse.query({
    query: walletCheckQuery,
    format: 'JSONEachRow',
  })
  const walletCheckData = await walletCheckResponse.json<any>()

  walletCheckData.forEach((row, i) => {
    console.log(`${i + 1}. ${row.wallet_address}`)
    console.log(`   canonical: ${row.canonical_wallet || 'NULL (not in overrides)'}`)
  })

  await clickhouse.close()
}

main().catch(console.error)
