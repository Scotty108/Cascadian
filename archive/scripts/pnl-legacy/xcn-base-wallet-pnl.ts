#!/usr/bin/env npx tsx

/**
 * XCN Base Wallet P&L - No Executors
 *
 * Calculate P&L for base wallet only (wallet_raw = XCN address)
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

const XCN_BASE = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('XCN BASE WALLET P&L (No Executors)')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Base Wallet: ${XCN_BASE}`)
  console.log()

  // ========================================================================
  // QUERY 1: Trade-only P&L (base wallet only, deduplicated)
  // ========================================================================
  console.log('QUERY 1: TRADE-ONLY P&L (base wallet only, no executors)')
  console.log('─'.repeat(80))
  console.log()

  const tradeOnlyQuery = `
    WITH base AS (
      SELECT
        trade_key,
        trade_direction,
        toFloat64(usd_value) AS usd_value,
        condition_id_norm_v3 AS cid
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${XCN_BASE}')
        AND condition_id_norm_v3 != ''
    ),
    deduped AS (
      SELECT
        trade_key,
        any(trade_direction) AS trade_direction,
        any(usd_value) AS usd_value,
        any(cid) AS cid
      FROM base
      GROUP BY trade_key
    )
    SELECT
      sum(usd_value * if(trade_direction='SELL', 1, -1)) AS total_trade_pnl,
      sum(usd_value) AS total_trade_volume,
      count() AS total_trades,
      uniq(cid) AS unique_markets
    FROM deduped
  `

  const tradeOnlyResult = await clickhouse.query({
    query: tradeOnlyQuery,
    format: 'JSONEachRow',
  })
  const tradeOnlyData = await tradeOnlyResult.json<any>()
  const tradeOnly = tradeOnlyData[0]

  console.log('Trade-Only P&L (base wallet only):')
  console.log(`  Total Trade P&L:    $${parseFloat(tradeOnly.total_trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Total Trade Volume: $${parseFloat(tradeOnly.total_trade_volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Total Trades:       ${parseInt(tradeOnly.total_trades).toLocaleString('en-US')}`)
  console.log(`  Unique Markets:     ${parseInt(tradeOnly.unique_markets).toLocaleString('en-US')}`)
  console.log()

  // ========================================================================
  // Sample Trades
  // ========================================================================
  console.log('SAMPLE TRADES (first 10 for verification):')
  console.log('─'.repeat(80))
  console.log()

  const sampleQuery = `
    SELECT
      toDateTime(timestamp) AS ts,
      trade_direction,
      toFloat64(shares) AS shares,
      toFloat64(price) AS price,
      toFloat64(usd_value) AS usd_value,
      substring(transaction_hash, 1, 20) || '...' AS tx,
      substring(condition_id_norm_v3, 1, 16) || '...' AS cid_short
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${XCN_BASE}')
      AND condition_id_norm_v3 != ''
    ORDER BY timestamp ASC
    LIMIT 10
  `

  const sampleResult = await clickhouse.query({
    query: sampleQuery,
    format: 'JSONEachRow',
  })
  const sampleData = await sampleResult.json<any>()

  sampleData.forEach((row, i) => {
    console.log(`${i + 1}. ${row.ts} | ${row.trade_direction}`)
    console.log(`   Shares: ${parseFloat(row.shares).toFixed(2)} @ $${parseFloat(row.price).toFixed(4)}`)
    console.log(`   Value: $${parseFloat(row.usd_value).toFixed(2)}`)
    console.log(`   TX: ${row.tx}`)
    console.log(`   CID: ${row.cid_short}\n`)
  })

  // ========================================================================
  // Verification
  // ========================================================================
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('VERIFICATION')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log('Expected: Volume ~$1-2M, P&L ~$80-100K')
  const volumeMatch = parseFloat(tradeOnly.total_trade_volume) >= 1000000 && parseFloat(tradeOnly.total_trade_volume) <= 2000000
  const pnlMatch = Math.abs(parseFloat(tradeOnly.total_trade_pnl)) >= 50000 && Math.abs(parseFloat(tradeOnly.total_trade_pnl)) <= 200000

  console.log(`  Volume match?  ${volumeMatch ? '✅ YES' : '❌ NO'}`)
  console.log(`  P&L range?     ${pnlMatch ? '✅ YES' : '❌ NO'}`)
  console.log()

  await clickhouse.close()
}

main().catch(console.error)
