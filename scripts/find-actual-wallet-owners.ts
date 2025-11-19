#!/usr/bin/env npx tsx

/**
 * Find which wallets actually own the Inflation + Xi trades
 * to understand the attribution discrepancy
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
const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('FIND ACTUAL WALLET OWNERS FOR INFLATION + XI TRADES')
  console.log('════════════════════════════════════════════════════════════════════\n')

  // Find wallet distribution for Inflation market
  console.log('🔍 Inflation Market Wallet Distribution:\n')

  const inflationQuery = `
    SELECT
      wallet_address,
      count() AS trades,
      sum(toFloat64(usd_value)) AS total_volume,
      countIf(trade_direction = 'BUY') AS buys,
      countIf(trade_direction = 'SELL') AS sells
    FROM pm_trades_canonical_v3
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
    GROUP BY wallet_address
    ORDER BY trades DESC
    LIMIT 20
  `

  const inflationResponse = await clickhouse.query({ query: inflationQuery, format: 'JSONEachRow' })
  const inflationData = await inflationResponse.json<any>()

  console.log(`Total unique wallets: ${inflationData.length}`)
  console.log('Top wallets:\n')

  inflationData.forEach((row, i) => {
    const isXcn = row.wallet_address.toLowerCase() === XCN_CANONICAL.toLowerCase()
    console.log(`${i + 1}. ${row.wallet_address} ${isXcn ? '⭐ XCN CANONICAL' : ''}`)
    console.log(`   Trades: ${row.trades} (${row.buys} buys, ${row.sells} sells)`)
    console.log(`   Volume: $${row.total_volume}`)
  })

  // Find wallet distribution for Xi market
  console.log('\n\n🔍 Xi Market Wallet Distribution:\n')

  const xiQuery = `
    SELECT
      wallet_address,
      count() AS trades,
      sum(toFloat64(usd_value)) AS total_volume,
      countIf(trade_direction = 'BUY') AS buys,
      countIf(trade_direction = 'SELL') AS sells
    FROM pm_trades_canonical_v3
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
    GROUP BY wallet_address
    ORDER BY trades DESC
    LIMIT 20
  `

  const xiResponse = await clickhouse.query({ query: xiQuery, format: 'JSONEachRow' })
  const xiData = await xiResponse.json<any>()

  console.log(`Total unique wallets: ${xiData.length}`)
  console.log('Top wallets:\n')

  xiData.forEach((row, i) => {
    const isXcn = row.wallet_address.toLowerCase() === XCN_CANONICAL.toLowerCase()
    console.log(`${i + 1}. ${row.wallet_address} ${isXcn ? '⭐ XCN CANONICAL' : ''}`)
    console.log(`   Trades: ${row.trades} (${row.buys} buys, ${row.sells} sells)`)
    console.log(`   Volume: $${row.total_volume}`)
  })

  // Check if these wallets are in wallet_identity_map
  console.log('\n\n🔍 Check wallet_identity_map for top wallets:\n')

  const topWallets = [
    ...inflationData.slice(0, 3).map(r => r.wallet_address),
    ...xiData.slice(0, 3).map(r => r.wallet_address),
  ]

  for (const wallet of topWallets) {
    const mapQuery = `
      SELECT
        user_eoa,
        proxy_wallet,
        canonical_wallet
      FROM wallet_identity_map
      WHERE lower(user_eoa) = lower('${wallet}')
         OR lower(proxy_wallet) = lower('${wallet}')
         OR lower(canonical_wallet) = lower('${wallet}')
    `

    const mapResponse = await clickhouse.query({ query: mapQuery, format: 'JSONEachRow' })
    const mapData = await mapResponse.json<any>()

    if (mapData.length > 0) {
      console.log(`✅ ${wallet}:`)
      mapData.forEach(row => {
        console.log(`   EOA: ${row.user_eoa}`)
        console.log(`   Proxy: ${row.proxy_wallet}`)
        console.log(`   Canonical: ${row.canonical_wallet}`)
      })
    } else {
      console.log(`❌ ${wallet}: Not in wallet_identity_map`)
    }
  }

  // Check what the view sees for these markets
  console.log('\n\n🔍 View attribution for top source wallets:\n')

  const viewCheckQuery = `
    SELECT
      wallet_raw,
      wallet_canonical,
      lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) AS cid_norm,
      count() AS trades
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) IN (
      lower('${INFLATION_CID}'),
      lower('${XI_CID}')
    )
    GROUP BY wallet_raw, wallet_canonical, cid_norm
    ORDER BY trades DESC
    LIMIT 20
  `

  const viewCheckResponse = await clickhouse.query({ query: viewCheckQuery, format: 'JSONEachRow' })
  const viewCheckData = await viewCheckResponse.json<any>()

  console.log('View shows:')
  viewCheckData.forEach((row, i) => {
    const market = row.cid_norm === INFLATION_CID.toLowerCase() ? 'Inflation' : 'Xi'
    console.log(`${i + 1}. ${market}:`)
    console.log(`   Raw wallet: ${row.wallet_raw}`)
    console.log(`   Canonical wallet: ${row.wallet_canonical}`)
    console.log(`   Trades: ${row.trades}`)
  })

  await clickhouse.close()
}

main().catch(console.error)
