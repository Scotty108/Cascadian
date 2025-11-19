#!/usr/bin/env npx tsx

/**
 * XCN Wallet P&L Verification - Simplified Version
 *
 * Purpose: Produce verifiable numbers for wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
 * Provides: Sample trades, per-market aggregates, trade-only P&L
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('XCN WALLET PNL VERIFICATION')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Wallet: ${XCN_CANONICAL}`)
  console.log()

  // ========================================================================
  // STEP 1: Sample Trades (20 rows for verification)
  // ========================================================================
  console.log('STEP 1: SAMPLE TRADES (for Polygonscan + Polymarket UI verification)')
  console.log('─'.repeat(80))
  console.log()

  const sampleQuery = `
    SELECT
      timestamp AS ts,
      trade_direction,
      toFloat64(shares) AS shares,
      toFloat64(usd_value) AS usd_value,
      toFloat64(price) AS price,
      transaction_hash,
      substring(cid_norm, 1, 16) || '...' AS cid_short
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
    ORDER BY timestamp ASC
    LIMIT 20
  `

  const sampleResult = await clickhouse.query({
    query: sampleQuery,
    format: 'JSONEachRow',
  })
  const sampleData = await sampleResult.json<any>()

  console.log('First 20 trades:')
  sampleData.forEach((row, i) => {
    console.log(`\n${i + 1}. ${row.ts} | ${row.trade_direction} | ${parseFloat(row.shares).toFixed(2)} shares @ $${parseFloat(row.price).toFixed(4)}`)
    console.log(`   Value: $${parseFloat(row.usd_value).toFixed(2)} | TX: ${row.transaction_hash}`)
    console.log(`   CID: ${row.cid_short}`)
  })
  console.log()

  // ========================================================================
  // STEP 2: Per-Market Aggregates (top 20 markets)
  // ========================================================================
  console.log('STEP 2: PER-MARKET PNL COMPONENTS (top 20 by volume)')
  console.log('─'.repeat(80))
  console.log()

  const perMarketQuery = `
    WITH trades AS (
      SELECT
        cid_norm AS cid,
        trade_direction,
        toFloat64(shares) AS shares,
        toFloat64(usd_value) AS usd_value
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
    )
    SELECT
      substring(cid, 1, 16) || '...' AS cid_short,
      cid AS condition_id_full,
      sumIf(shares, trade_direction='BUY')  AS shares_buy,
      sumIf(-shares, trade_direction='SELL') AS shares_sell,
      shares_buy + shares_sell               AS net_shares,
      sumIf(usd_value, trade_direction='BUY')  AS cost_buy,
      sumIf(usd_value, trade_direction='SELL') AS proceeds_sell,
      proceeds_sell - cost_buy               AS trade_pnl,
      count() AS trade_count
    FROM trades
    GROUP BY cid
    ORDER BY (cost_buy + proceeds_sell) DESC
    LIMIT 20
  `

  const perMarketResult = await clickhouse.query({
    query: perMarketQuery,
    format: 'JSONEachRow',
  })
  const perMarketData = await perMarketResult.json<any>()

  console.log('Top 20 markets by volume:\n')
  perMarketData.forEach((row, i) => {
    console.log(`${i + 1}. ${row.cid_short}`)
    console.log(`   Trades: ${row.trade_count} | Net Shares: ${parseFloat(row.net_shares).toFixed(2)}`)
    console.log(`   Buy: $${parseFloat(row.cost_buy).toFixed(2)} | Sell: $${parseFloat(row.proceeds_sell).toFixed(2)}`)
    console.log(`   Trade P&L: $${parseFloat(row.trade_pnl).toFixed(2)}\n`)
  })

  // ========================================================================
  // STEP 3: Overall Trade P&L Summary
  // ========================================================================
  console.log('STEP 3: OVERALL TRADE PNL SUMMARY')
  console.log('─'.repeat(80))
  console.log()

  const tradePnLQuery = `
    SELECT
      sum(if(trade_direction='SELL', toFloat64(usd_value), -toFloat64(usd_value))) AS total_trade_pnl,
      sumIf(toFloat64(usd_value), trade_direction='BUY') AS total_cost_buy,
      sumIf(toFloat64(usd_value), trade_direction='SELL') AS total_proceeds_sell,
      sumIf(toFloat64(shares), trade_direction='BUY') AS total_shares_buy,
      sumIf(-toFloat64(shares), trade_direction='SELL') AS total_shares_sell,
      count() AS total_trades,
      uniq(cid_norm) AS unique_markets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
  `

  const tradePnLResult = await clickhouse.query({
    query: tradePnLQuery,
    format: 'JSONEachRow',
  })
  const tradePnLData = await tradePnLResult.json<any>()
  const pnl = tradePnLData[0]

  console.log('TRADE-ONLY P&L (proceeds - costs, no settlement):')
  console.log(`  Total Trade P&L:       $${parseFloat(pnl.total_trade_pnl).toFixed(2)}`)
  console.log(`  Total Cost (Buy):      $${parseFloat(pnl.total_cost_buy).toFixed(2)}`)
  console.log(`  Total Proceeds (Sell): $${parseFloat(pnl.total_proceeds_sell).toFixed(2)}`)
  console.log()
  console.log(`  Total Shares Bought:   ${parseFloat(pnl.total_shares_buy).toFixed(2)}`)
  console.log(`  Total Shares Sold:     ${parseFloat(pnl.total_shares_sell).toFixed(2)}`)
  console.log()
  console.log(`  Total Trades:          ${pnl.total_trades}`)
  console.log(`  Unique Markets:        ${pnl.unique_markets}`)
  console.log()

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('DELIVERABLES SUMMARY')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log('✅ STEP 1: Sample trades (20 rows with tx_hash for verification)')
  console.log('✅ STEP 2: Per-market aggregates (top 20 markets by volume)')
  console.log('✅ STEP 3: Total trade P&L summary')
  console.log()

  console.log('KEY NUMBERS FOR VERIFICATION:')
  console.log(`  Total Trade P&L: $${parseFloat(pnl.total_trade_pnl).toFixed(2)}`)
  console.log(`  Total Trades: ${pnl.total_trades}`)
  console.log(`  Unique Markets: ${pnl.unique_markets}`)
  console.log()

  console.log('VERIFICATION CHECKLIST:')
  console.log('1. Pick 2-3 transaction hashes from Step 1')
  console.log('2. Check Polygonscan for timestamp/amounts')
  console.log('3. Verify in Polymarket "Trade History" tab')
  console.log('4. Compare trade P&L numbers with on-chain/UI data')
  console.log()

  console.log('NOTE: Full realized P&L (with market resolutions/settlements) requires')
  console.log('additional joins with resolution tables and is not included in this report.')
  console.log()

  await clickhouse.close()
}

main().catch(console.error)
