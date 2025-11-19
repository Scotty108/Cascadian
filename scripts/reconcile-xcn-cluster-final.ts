#!/usr/bin/env npx tsx

/**
 * Reconcile C2 vs C3 findings by analyzing wallet cluster at source table
 *
 * Objective: Confirm counts and signs for XCN wallet cluster (all executors + canonical)
 * at pm_trades_canonical_v3 level before view transformations
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
  console.log('XCN WALLET CLUSTER RECONCILIATION')
  console.log('════════════════════════════════════════════════════════════════════')
  console.log(`Canonical Wallet: ${XCN_CANONICAL}`)
  console.log(`Inflation CID: ${INFLATION_CID}`)
  console.log(`Xi CID: ${XI_CID}`)
  console.log('════════════════════════════════════════════════════════════════════\n')

  // Step 1: Get wallet cluster (all proxies/executors for canonical wallet)
  console.log('🔍 Step 1: Get wallet cluster from wallet_identity_map...\n')

  const clusterQuery = `
    SELECT
      user_eoa,
      proxy_wallet,
      canonical_wallet,
      fills_count
    FROM wallet_identity_map
    WHERE canonical_wallet = '${XCN_CANONICAL}'
  `

  const clusterResponse = await clickhouse.query({ query: clusterQuery, format: 'JSONEachRow' })
  const cluster = await clusterResponse.json<any>()

  console.log(`Found ${cluster.length} wallet mappings:`)
  cluster.forEach((row, i) => {
    console.log(`  ${i + 1}. EOA: ${row.user_eoa}`)
    console.log(`     Proxy: ${row.proxy_wallet}`)
    console.log(`     Fills: ${row.fills_count}`)
  })

  // Extract all wallet addresses (EOAs + proxies + canonical)
  const allWallets = new Set<string>()
  cluster.forEach(row => {
    allWallets.add(row.user_eoa.toLowerCase())
    allWallets.add(row.proxy_wallet.toLowerCase())
    allWallets.add(row.canonical_wallet.toLowerCase())
  })

  const walletList = Array.from(allWallets).map(w => `'${w}'`).join(', ')
  console.log(`\nTotal unique wallets in cluster: ${allWallets.size}`)

  // Step 2: Query source table for cluster trades in both CIDs
  console.log('\n🔍 Step 2: Query pm_trades_canonical_v3 for wallet cluster...\n')

  const sourceQuery = `
    SELECT
      lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) AS cid_norm,

      -- Buy metrics
      sum(IF(trade_direction = 'BUY', toFloat64(usd_value), 0)) AS cost_buy,
      sum(IF(trade_direction = 'BUY', toFloat64(shares), 0)) AS shares_buy,
      countIf(trade_direction = 'BUY') AS trades_buy,

      -- Sell metrics
      sum(IF(trade_direction = 'SELL', toFloat64(usd_value), 0)) AS cost_sell,
      sum(IF(trade_direction = 'SELL', toFloat64(shares), 0)) AS shares_sell,
      countIf(trade_direction = 'SELL') AS trades_sell,

      -- Net metrics
      sum(toFloat64(shares)) AS net_shares_raw,
      sum(IF(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares))) AS net_shares_corrected,
      sum(toFloat64(usd_value)) AS total_cost,

      -- Trade PnL (sells should reduce cost)
      sum(IF(trade_direction = 'SELL', toFloat64(usd_value), -toFloat64(usd_value))) AS trade_pnl,

      count() AS total_trades

    FROM pm_trades_canonical_v3
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) IN (
      lower('${INFLATION_CID}'),
      lower('${XI_CID}')
    )
    AND lower(wallet_address) IN (${walletList})
    GROUP BY cid_norm
    ORDER BY cid_norm
  `

  const sourceResponse = await clickhouse.query({ query: sourceQuery, format: 'JSONEachRow' })
  const sourceData = await sourceResponse.json<any>()

  console.log('Source Table Results:\n')
  console.log('═'.repeat(100))

  sourceData.forEach(row => {
    const marketName = row.cid_norm === INFLATION_CID.toLowerCase() ? 'INFLATION' : 'XI'

    console.log(`\n📊 ${marketName} Market (${row.cid_norm.substring(0, 16)}...)`)
    console.log('─'.repeat(100))
    console.log('\n  BUY TRADES:')
    console.log(`    Count: ${row.trades_buy}`)
    console.log(`    Shares: ${row.shares_buy}`)
    console.log(`    Cost (USD): ${row.cost_buy}`)

    console.log('\n  SELL TRADES:')
    console.log(`    Count: ${row.trades_sell}`)
    console.log(`    Shares: ${row.shares_sell}`)
    console.log(`    Cost (USD): ${row.cost_sell}`)

    console.log('\n  NET METRICS:')
    console.log(`    Total Trades: ${row.total_trades}`)
    console.log(`    Net Shares (raw sum): ${row.net_shares_raw}`)
    console.log(`    Net Shares (corrected): ${row.net_shares_corrected}`)
    console.log(`    Total Cost: ${row.total_cost}`)
    console.log(`    Trade PnL: ${row.trade_pnl}`)

    // Sign validation
    console.log('\n  🔍 SIGN VALIDATION:')

    const buySharesPositive = row.shares_buy >= 0
    const sellSharesSign = row.shares_sell
    const netSharesMatch = Math.abs(row.net_shares_raw - row.net_shares_corrected) < 0.01

    console.log(`    ✓ Buy shares positive? ${buySharesPositive ? '✅ YES' : '❌ NO'}`)
    console.log(`    ✓ Sell shares value: ${sellSharesSign} (should be negative)`)
    console.log(`    ✓ Net shares raw vs corrected match? ${netSharesMatch ? '✅ YES' : '❌ NO'}`)

    if (sellSharesSign > 0) {
      console.log(`    ⚠️  WARNING: Sell shares are POSITIVE (${sellSharesSign})`)
      console.log(`    ⚠️  This indicates sells are NOT stored with negative shares`)
      console.log(`    ⚠️  Sign correction needed in view or at ingestion`)
    }

    if (!netSharesMatch) {
      console.log(`    ⚠️  WARNING: Net shares mismatch`)
      console.log(`    ⚠️  Raw: ${row.net_shares_raw}`)
      console.log(`    ⚠️  Corrected: ${row.net_shares_corrected}`)
      console.log(`    ⚠️  Difference: ${row.net_shares_raw - row.net_shares_corrected}`)
    }
  })

  // Step 3: Sample individual trades to verify sign logic
  console.log('\n\n🔍 Step 3: Sample individual trades for sign verification...\n')

  const sampleQuery = `
    SELECT
      lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) AS cid_norm,
      wallet_address,
      transaction_hash,
      trade_direction,
      toFloat64(shares) AS shares,
      toFloat64(price) AS price,
      toFloat64(usd_value) AS usd_value,
      created_at
    FROM pm_trades_canonical_v3
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) IN (
      lower('${INFLATION_CID}'),
      lower('${XI_CID}')
    )
    AND lower(wallet_address) IN (${walletList})
    ORDER BY created_at DESC
    LIMIT 10
  `

  const sampleResponse = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' })
  const sampleData = await sampleResponse.json<any>()

  console.log('Sample Trades (Most Recent 10):\n')
  console.log('═'.repeat(100))

  sampleData.forEach((row, i) => {
    const marketName = row.cid_norm === INFLATION_CID.toLowerCase() ? 'INFLATION' : 'XI'
    const signOk = (row.trade_direction === 'BUY' && row.shares > 0) ||
                   (row.trade_direction === 'SELL' && row.shares < 0)

    console.log(`\n${i + 1}. ${marketName} - ${row.trade_direction}`)
    console.log(`   Wallet: ${row.wallet_address}`)
    console.log(`   TX: ${row.transaction_hash.substring(0, 16)}...`)
    console.log(`   Shares: ${row.shares} ${signOk ? '✅' : '❌ WRONG SIGN'}`)
    console.log(`   Price: ${row.price}`)
    console.log(`   USD Value: ${row.usd_value}`)
    console.log(`   Date: ${row.created_at}`)
  })

  // Step 4: Compare with view
  console.log('\n\n🔍 Step 4: Compare with vw_trades_canonical_with_canonical_wallet...\n')

  const viewQuery = `
    SELECT
      lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) AS cid_norm,

      sum(IF(trade_direction = 'BUY', toFloat64(usd_value), 0)) AS cost_buy,
      sum(IF(trade_direction = 'SELL', toFloat64(usd_value), 0)) AS cost_sell,
      sum(toFloat64(shares)) AS net_shares,
      count() AS total_trades

    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) IN (
      lower('${INFLATION_CID}'),
      lower('${XI_CID}')
    )
    AND lower(wallet_canonical) = lower('${XCN_CANONICAL}')
    GROUP BY cid_norm
    ORDER BY cid_norm
  `

  const viewResponse = await clickhouse.query({ query: viewQuery, format: 'JSONEachRow' })
  const viewData = await viewResponse.json<any>()

  console.log('View Results:\n')
  console.log('═'.repeat(100))

  if (viewData.length === 0) {
    console.log('❌ NO TRADES IN VIEW for canonical wallet')
    console.log('\nThis explains C3\'s findings!')
    console.log('The view is filtering out all trades for this wallet.')
  } else {
    viewData.forEach(row => {
      const marketName = row.cid_norm === INFLATION_CID.toLowerCase() ? 'INFLATION' : 'XI'
      console.log(`\n${marketName} Market:`)
      console.log(`  Total Trades: ${row.total_trades}`)
      console.log(`  Cost Buy: ${row.cost_buy}`)
      console.log(`  Cost Sell: ${row.cost_sell}`)
      console.log(`  Net Shares: ${row.net_shares}`)
    })
  }

  // Summary
  console.log('\n\n════════════════════════════════════════════════════════════════════')
  console.log('RECONCILIATION SUMMARY')
  console.log('════════════════════════════════════════════════════════════════════\n')

  const sourceInflation = sourceData.find(r => r.cid_norm === INFLATION_CID.toLowerCase())
  const sourceXi = sourceData.find(r => r.cid_norm === XI_CID.toLowerCase())
  const viewInflation = viewData.find(r => r.cid_norm === INFLATION_CID.toLowerCase())
  const viewXi = viewData.find(r => r.cid_norm === XI_CID.toLowerCase())

  console.log('SOURCE TABLE (pm_trades_canonical_v3):')
  console.log(`  Inflation: ${sourceInflation?.total_trades || 0} trades`)
  console.log(`  Xi: ${sourceXi?.total_trades || 0} trades`)

  console.log('\nVIEW (vw_trades_canonical_with_canonical_wallet):')
  console.log(`  Inflation: ${viewInflation?.total_trades || 0} trades`)
  console.log(`  Xi: ${viewXi?.total_trades || 0} trades`)

  if ((sourceInflation?.total_trades || 0) > 0 && !viewInflation) {
    console.log('\n❌ DISCREPANCY: Source has trades but view shows 0 for Inflation')
    console.log('   Root Cause: View is filtering out trades (likely wallet attribution issue)')
  }

  if ((sourceXi?.total_trades || 0) > 0 && !viewXi) {
    console.log('\n❌ DISCREPANCY: Source has trades but view shows 0 for Xi')
    console.log('   Root Cause: View is filtering out trades (likely wallet attribution issue)')
  }

  await clickhouse.close()
}

main().catch(console.error)
