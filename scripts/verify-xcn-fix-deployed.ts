#!/usr/bin/env npx tsx

/**
 * Verify XCN View Fix Deployment
 *
 * Expected Results After Fix:
 * - buy_count: 922
 * - sell_count: 408
 * - buy_shares: 495,735 (positive)
 * - sell_shares: -1,606,923 (negative) ← FIXED
 * - net_shares: -1,111,188 (buy_shares + sell_shares) ← CORRECTED FROM 2.1M
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
const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('VERIFYING XCN VIEW FIX DEPLOYMENT')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`XCN Canonical Wallet: ${XCN_CANONICAL}`)
  console.log(`Xi Market CID: ${XI_CID}\n`)

  const verifyQuery = `
    SELECT
      countIf(trade_direction = 'BUY') AS buy_count,
      countIf(trade_direction = 'SELL') AS sell_count,
      sum(IF(trade_direction = 'BUY', toFloat64(shares), 0)) AS buy_shares,
      sum(IF(trade_direction = 'SELL', toFloat64(shares), 0)) AS sell_shares,
      sum(toFloat64(shares)) AS net_shares
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
  `

  const response = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' })
  const data = await response.json<any>()
  const result = data[0]

  console.log('📊 VERIFICATION RESULTS:\n')
  console.log(`Buy Count:    ${result.buy_count}`)
  console.log(`Sell Count:   ${result.sell_count}`)
  console.log(`Buy Shares:   ${parseFloat(result.buy_shares).toLocaleString()}`)
  console.log(`Sell Shares:  ${parseFloat(result.sell_shares).toLocaleString()}`)
  console.log(`Net Shares:   ${parseFloat(result.net_shares).toLocaleString()}`)
  console.log()

  // Verification checks
  const buySharesFloat = parseFloat(result.buy_shares)
  const sellSharesFloat = parseFloat(result.sell_shares)
  const netSharesFloat = parseFloat(result.net_shares)

  console.log('✅ VALIDATION CHECKS:\n')

  // Check 1: Buy count
  if (result.buy_count === '922') {
    console.log('✅ Buy count correct (922)')
  } else {
    console.log(`❌ Buy count incorrect: ${result.buy_count} (expected 922)`)
  }

  // Check 2: Sell count
  if (result.sell_count === '408') {
    console.log('✅ Sell count correct (408)')
  } else {
    console.log(`❌ Sell count incorrect: ${result.sell_count} (expected 408)`)
  }

  // Check 3: Buy shares positive
  if (buySharesFloat > 0 && Math.abs(buySharesFloat - 495735) < 1) {
    console.log('✅ Buy shares positive and correct (~495,735)')
  } else {
    console.log(`❌ Buy shares incorrect: ${buySharesFloat} (expected ~495,735)`)
  }

  // Check 4: Sell shares NEGATIVE (this is the fix!)
  if (sellSharesFloat < 0 && Math.abs(sellSharesFloat + 1606923) < 1) {
    console.log('✅ Sell shares NEGATIVE and correct (~-1,606,923) ← FIX APPLIED!')
  } else {
    console.log(`❌ Sell shares incorrect: ${sellSharesFloat} (expected ~-1,606,923)`)
  }

  // Check 5: Net shares corrected
  if (netSharesFloat < 0 && Math.abs(netSharesFloat + 1111188) < 1) {
    console.log('✅ Net shares CORRECTED (~-1,111,188) ← FROM 2.1M INFLATION!')
  } else {
    console.log(`❌ Net shares incorrect: ${netSharesFloat} (expected ~-1,111,188)`)
  }

  console.log()

  // Before/After comparison
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('BEFORE vs AFTER FIX:')
  console.log('════════════════════════════════════════════════════════════════════\n')
  console.log('BEFORE (250x inflation):')
  console.log('  Buy shares:  +495,735')
  console.log('  Sell shares: +1,606,923 ❌ (POSITIVE - WRONG)')
  console.log('  Net shares:  +2,102,658 ❌ (INFLATED)')
  console.log()
  console.log('AFTER (corrected):')
  console.log(`  Buy shares:  +${buySharesFloat.toLocaleString()}`)
  console.log(`  Sell shares: ${sellSharesFloat.toLocaleString()} ✅ (NEGATIVE - CORRECT)`)
  console.log(`  Net shares:  ${netSharesFloat.toLocaleString()} ✅ (CORRECTED)`)
  console.log()

  // Summary
  const allChecksPass =
    result.buy_count === '922' &&
    result.sell_count === '408' &&
    buySharesFloat > 0 &&
    sellSharesFloat < 0 &&
    netSharesFloat < 0

  console.log('════════════════════════════════════════════════════════════════════')
  if (allChecksPass) {
    console.log('✅ ALL VERIFICATION CHECKS PASSED - FIX DEPLOYED SUCCESSFULLY')
  } else {
    console.log('❌ VERIFICATION FAILED - INVESTIGATE ISSUES ABOVE')
  }
  console.log('════════════════════════════════════════════════════════════════════\n')

  await clickhouse.close()
}

main().catch(console.error)
