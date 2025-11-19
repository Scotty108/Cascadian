#!/usr/bin/env npx tsx

/**
 * Verify root cause of 250x share inflation in Xi market for XCN wallet
 *
 * Expected: ~8,400 net shares
 * Actual: 2,103,693 net shares
 * Ratio: 250x
 *
 * Checking:
 * 1. Share units (raw vs display)
 * 2. Sign logic (buys+ sells-)
 * 3. Aggregation fanout (view vs source)
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
  console.log('XI MARKET SHARE INFLATION VERIFICATION')
  console.log('════════════════════════════════════════════════════════════════════')
  console.log(`Xi CID: ${XI_CID}`)
  console.log(`XCN Executor: ${XCN_EXECUTOR}`)
  console.log(`XCN Canonical: ${XCN_CANONICAL}`)
  console.log('\nExpected net shares: ~8,400')
  console.log('Actual net shares: 2,103,693')
  console.log('Inflation ratio: 250x')
  console.log('════════════════════════════════════════════════════════════════════\n')

  // Check 1: Sign Logic
  console.log('🔍 Check 1: Sign logic (are sells negative?)\n')

  const signQuery = `
    SELECT
      trade_direction,
      count() AS trades,
      sum(toFloat64(shares)) AS total_shares,
      avg(toFloat64(shares)) AS avg_shares,
      min(toFloat64(shares)) AS min_shares,
      max(toFloat64(shares)) AS max_shares,
      countIf(toFloat64(shares) > 0) AS positive_count,
      countIf(toFloat64(shares) < 0) AS negative_count
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${XCN_EXECUTOR}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
    GROUP BY trade_direction
    ORDER BY trade_direction
  `

  const signResponse = await clickhouse.query({ query: signQuery, format: 'JSONEachRow' })
  const signData = await signResponse.json<any>()

  signData.forEach(row => {
    console.log(`${row.trade_direction}:`)
    console.log(`  Total Trades: ${row.trades}`)
    console.log(`  Total Shares: ${row.total_shares}`)
    console.log(`  Avg Shares: ${row.avg_shares}`)
    console.log(`  Min Shares: ${row.min_shares}`)
    console.log(`  Max Shares: ${row.max_shares}`)
    console.log(`  Positive count: ${row.positive_count}`)
    console.log(`  Negative count: ${row.negative_count}`)

    if (row.trade_direction === 'BUY' && row.negative_count > 0) {
      console.log(`  ❌ BUY trades have negative shares!`)
    } else if (row.trade_direction === 'BUY') {
      console.log(`  ✅ BUY trades all positive`)
    }

    if (row.trade_direction === 'SELL' && row.positive_count > 0) {
      console.log(`  ❌ SELL trades have positive shares! (DOUBLE-NEGATIVE ISSUE)`)
    } else if (row.trade_direction === 'SELL') {
      console.log(`  ✅ SELL trades all negative`)
    }
    console.log()
  })

  // Check 2: Sample individual trades
  console.log('\n🔍 Check 2: Sample individual trades (first 5 buys, first 5 sells)\n')

  const sampleQuery = `
    SELECT
      trade_direction,
      toFloat64(shares) AS shares,
      toFloat64(price) AS price,
      toFloat64(usd_value) AS usd_value,
      transaction_hash
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${XCN_EXECUTOR}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
    ORDER BY trade_direction, created_at
    LIMIT 10
  `

  const sampleResponse = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' })
  const sampleData = await sampleResponse.json<any>()

  sampleData.forEach((row, i) => {
    const signOk = (row.trade_direction === 'BUY' && row.shares > 0) ||
                   (row.trade_direction === 'SELL' && row.shares < 0)
    console.log(`${i + 1}. ${row.trade_direction}:`)
    console.log(`   Shares: ${row.shares} ${signOk ? '✅' : '❌ WRONG SIGN'}`)
    console.log(`   Price: $${row.price}`)
    console.log(`   USD Value: $${row.usd_value}`)
    console.log(`   TX: ${row.transaction_hash.substring(0, 16)}...`)
  })

  // Check 3: Aggregation fanout (view vs source)
  console.log('\n\n🔍 Check 3: Aggregation fanout (view duplicating rows?)\n')

  const fanoutQuery = `
    SELECT
      'SOURCE' AS table_name,
      count() AS row_count,
      countDistinct(trade_id) AS unique_trades,
      sum(toFloat64(shares)) AS net_shares
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${XCN_EXECUTOR}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')

    UNION ALL

    SELECT
      'VIEW' AS table_name,
      count() AS row_count,
      countDistinct(trade_id) AS unique_trades,
      sum(toFloat64(shares)) AS net_shares
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
  `

  const fanoutResponse = await clickhouse.query({ query: fanoutQuery, format: 'JSONEachRow' })
  const fanoutData = await fanoutResponse.json<any>()

  fanoutData.forEach(row => {
    console.log(`${row.table_name}:`)
    console.log(`  Row Count: ${row.row_count}`)
    console.log(`  Unique Trades: ${row.unique_trades}`)
    console.log(`  Net Shares: ${row.net_shares}`)

    if (row.row_count > row.unique_trades) {
      console.log(`  ⚠️  FANOUT DETECTED: ${row.row_count - row.unique_trades} duplicate rows`)
    } else {
      console.log(`  ✅ No fanout`)
    }
  })

  // Check 4: Net shares calculation breakdown
  console.log('\n\n🔍 Check 4: Net shares calculation (buy - sell breakdown)\n')

  const netQuery = `
    SELECT
      countIf(trade_direction = 'BUY') AS buy_count,
      countIf(trade_direction = 'SELL') AS sell_count,
      sum(IF(trade_direction = 'BUY', toFloat64(shares), 0)) AS buy_shares,
      sum(IF(trade_direction = 'SELL', toFloat64(shares), 0)) AS sell_shares,
      sum(toFloat64(shares)) AS net_shares_raw,
      sum(IF(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares))) AS net_shares_corrected
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${XCN_EXECUTOR}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${XI_CID}')
  `

  const netResponse = await clickhouse.query({ query: netQuery, format: 'JSONEachRow' })
  const netData = await netResponse.json<any>()
  const net = netData[0]

  console.log('Buy Trades:')
  console.log(`  Count: ${net.buy_count}`)
  console.log(`  Shares: ${net.buy_shares}`)
  console.log()
  console.log('Sell Trades:')
  console.log(`  Count: ${net.sell_count}`)
  console.log(`  Shares: ${net.sell_shares} (should be negative)`)
  console.log()
  console.log('Net Calculation:')
  console.log(`  Raw sum(shares): ${net.net_shares_raw}`)
  console.log(`  Corrected (buy - sell): ${net.net_shares_corrected}`)
  console.log()

  if (parseFloat(net.sell_shares) > 0) {
    console.log('❌ CRITICAL ISSUE: Sell shares are POSITIVE!')
    console.log('   This means sells are stored with POSITIVE values')
    console.log('   The view needs to apply: IF(trade_direction=\'SELL\', -shares, shares)')
    console.log()
    console.log('   Current calculation: SUM(shares) = buys + sells = WRONG')
    console.log('   Should be: SUM(IF(direction=BUY, shares, -shares)) = buys - sells')
  } else {
    console.log('✅ Sell shares are negative - sign logic correct')
  }

  // Summary
  console.log('\n\n════════════════════════════════════════════════════════════════════')
  console.log('SUMMARY & ROOT CAUSE')
  console.log('════════════════════════════════════════════════════════════════════\n')

  const sellSharesPositive = parseFloat(net.sell_shares) > 0
  const fanout = fanoutData.find(r => r.table_name === 'VIEW')
  const hasFanout = fanout && fanout.row_count > fanout.unique_trades

  if (sellSharesPositive) {
    console.log('🚨 ROOT CAUSE: SELL SHARES STORED AS POSITIVE')
    console.log()
    console.log('Problem:')
    console.log('  - Sell trades have POSITIVE share values in database')
    console.log('  - Simple SUM(shares) adds buys AND sells together')
    console.log('  - Result: Massively inflated net shares')
    console.log()
    console.log('Fix Options:')
    console.log('  A) Update view to apply sign correction:')
    console.log('     SUM(IF(trade_direction = \'BUY\', shares, -shares)) AS net_shares')
    console.log()
    console.log('  B) Fix at ingestion (guardrail):')
    console.log('     Store sells with negative shares from the start')
    console.log()
    console.log('Evidence:')
    console.log(`  Buy shares: ${net.buy_shares}`)
    console.log(`  Sell shares (raw): ${net.sell_shares} (POSITIVE - WRONG)`)
    console.log(`  Net (raw): ${net.net_shares_raw} (buys + sells = INFLATED)`)
    console.log(`  Net (corrected): ${net.net_shares_corrected} (buys - |sells| = CORRECT)`)
  } else if (hasFanout) {
    console.log('🚨 ROOT CAUSE: VIEW JOIN FANOUT')
    console.log()
    console.log(`View has ${fanout.row_count} rows but only ${fanout.unique_trades} unique trades`)
    console.log('This causes shares to be counted multiple times')
  } else {
    console.log('✅ No obvious root cause found in checks 1-4')
    console.log('Need additional investigation')
  }

  await clickhouse.close()
}

main().catch(console.error)
