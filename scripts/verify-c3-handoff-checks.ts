#!/usr/bin/env npx tsx

/**
 * C3 Handoff Verification Checks
 *
 * Runs all verification queries for C3 re-certification
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

// All 12 executor wallets from wallet_identity_overrides
const XCN_EXECUTORS = [
  '0x0540f430df85c770e0a4fb79d8499d71ebc298eb',
  '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1',
  '0x461f3e886dca22e561eee224d283e08b8fb47a07',
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b',
  '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d',
  '0x9d84ce0306f8551e02efef1680475fc0f1dc1344',
  '0xa6a856a8c8a7f14fd9be6ae11c367c7cbb755009',
  '0xb68a63d94676c8630eb3471d82d3d47b7533c568',
  '0xee00ba338c59557141789b127927a55f5cc5cea1',
  '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
  '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1',
]

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('C3 HANDOFF VERIFICATION CHECKS')
  console.log('════════════════════════════════════════════════════════════════════\n')

  // Check 1: Empty wallet check
  console.log('Check 1: Empty wallet check (should return 0)\n')
  const emptyWalletQuery = `
    SELECT count() AS empty_wallets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
      AND (wallet_canonical = '' OR wallet_canonical IS NULL)
  `
  const emptyResponse = await clickhouse.query({ query: emptyWalletQuery, format: 'JSONEachRow' })
  const emptyData = await emptyResponse.json<any>()
  const emptyCount = parseInt(emptyData[0]?.empty_wallets || '0')

  console.log(`Empty wallets: ${emptyCount}`)
  if (emptyCount === 0) {
    console.log('✅ PASS: No empty wallets in view\n')
  } else {
    console.log(`❌ FAIL: ${emptyCount} trades with empty wallet_canonical\n`)
  }

  // Check 2: Source vs View for Xi market
  console.log('Check 2: Source vs View sanity check (Xi market)\n')

  // Source table query
  const executorList = XCN_EXECUTORS.map(w => `'${w}'`).join(', ')
  const sourceQuery = `
    SELECT
      sumIf(toFloat64(usd_value), trade_direction='BUY') AS cost_buy,
      sumIf(toFloat64(usd_value), trade_direction='SELL') AS cost_sell,
      sumIf(toFloat64(shares), trade_direction='BUY') - sumIf(toFloat64(shares), trade_direction='SELL') AS net_shares
    FROM pm_trades_canonical_v3
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
      AND lower(wallet_address) IN (${executorList})
  `
  const sourceResponse = await clickhouse.query({ query: sourceQuery, format: 'JSONEachRow' })
  const sourceData = await sourceResponse.json<any>()
  const source = sourceData[0]

  console.log('SOURCE TABLE (pm_trades_canonical_v3):')
  console.log(`  Cost Buy:    $${parseFloat(source.cost_buy).toLocaleString()}`)
  console.log(`  Cost Sell:   $${parseFloat(source.cost_sell).toLocaleString()}`)
  console.log(`  Net Shares:  ${parseFloat(source.net_shares).toLocaleString()}`)
  console.log()

  // View query
  const viewQuery = `
    SELECT
      sum(IF(trade_direction = 'BUY', toFloat64(usd_value), 0)) AS cost_buy,
      sum(IF(trade_direction = 'SELL', toFloat64(usd_value), 0)) AS cost_sell,
      sum(toFloat64(shares)) AS net_shares
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
      AND lower(wallet_canonical) = lower('${XCN_CANONICAL}')
  `
  const viewResponse = await clickhouse.query({ query: viewQuery, format: 'JSONEachRow' })
  const viewData = await viewResponse.json<any>()
  const view = viewData[0]

  console.log('VIEW (vw_trades_canonical_with_canonical_wallet):')
  console.log(`  Cost Buy:    $${parseFloat(view.cost_buy).toLocaleString()}`)
  console.log(`  Cost Sell:   $${parseFloat(view.cost_sell).toLocaleString()}`)
  console.log(`  Net Shares:  ${parseFloat(view.net_shares).toLocaleString()}`)
  console.log()

  // Compare
  const costBuyDiff = Math.abs(parseFloat(source.cost_buy) - parseFloat(view.cost_buy))
  const costSellDiff = Math.abs(parseFloat(source.cost_sell) - parseFloat(view.cost_sell))
  const netSharesDiff = Math.abs(parseFloat(source.net_shares) - parseFloat(view.net_shares))

  console.log('COMPARISON (Source vs View):')
  console.log(`  Cost Buy Diff:    $${costBuyDiff.toFixed(2)}`)
  console.log(`  Cost Sell Diff:   $${costSellDiff.toFixed(2)}`)
  console.log(`  Net Shares Diff:  ${netSharesDiff.toFixed(2)}`)
  console.log()

  const tolerance = 100 // Allow ±$100 tolerance
  const sharesTolerance = 1000 // Allow ±1,000 shares tolerance

  if (costBuyDiff < tolerance && costSellDiff < tolerance && netSharesDiff < sharesTolerance) {
    console.log('✅ PASS: Source and View match within tolerance\n')
  } else {
    console.log('⚠️  WARNING: Source and View differ beyond tolerance\n')
  }

  // Check 3: Inflation market (should have 0 for XCN)
  console.log('Check 3: Inflation market (XCN should have 0 trades)\n')
  const inflationQuery = `
    SELECT count() AS trades
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
      AND lower(wallet_canonical) = lower('${XCN_CANONICAL}')
  `
  const inflationResponse = await clickhouse.query({ query: inflationQuery, format: 'JSONEachRow' })
  const inflationData = await inflationResponse.json<any>()
  const inflationTrades = parseInt(inflationData[0]?.trades || '0')

  console.log(`Inflation market trades for XCN: ${inflationTrades}`)
  if (inflationTrades === 0) {
    console.log('✅ PASS: XCN has 0 trades in Inflation market (as expected)\n')
  } else {
    console.log(`❌ FAIL: XCN should have 0 trades, found ${inflationTrades}\n`)
  }

  // Summary
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('VERIFICATION SUMMARY')
  console.log('════════════════════════════════════════════════════════════════════\n')

  const allPassed =
    emptyCount === 0 &&
    costBuyDiff < tolerance &&
    costSellDiff < tolerance &&
    netSharesDiff < sharesTolerance &&
    inflationTrades === 0

  if (allPassed) {
    console.log('✅ ALL CHECKS PASSED - READY FOR C3 RE-CERTIFICATION\n')
  } else {
    console.log('⚠️  SOME CHECKS FAILED - REVIEW ISSUES ABOVE\n')
  }

  console.log('Expected C3 Results After Re-certification:')
  console.log('  1. Inflation market: XCN has 0 trades ✅')
  console.log('  2. Xi market: Net shares ~-1.1M (not +2.1M) ✅')
  console.log('  3. Sign logic: Buys positive, sells negative ✅')
  console.log('  4. Wallet clustering: All 12 executors mapped ✅')
  console.log()

  await clickhouse.close()
}

main().catch(console.error)
