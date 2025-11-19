#!/usr/bin/env npx tsx

/**
 * XCN P&L with Remaining 12 Executors
 *
 * After removing bad executor 0x4bfb...82e
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
  console.log('XCN WALLET P&L (With Remaining 12 Executors)')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Canonical Wallet: ${XCN_CANONICAL}`)
  console.log('(After removing bad executor 0x4bfb...82e)')
  console.log()

  // ========================================================================
  // Current executor list
  // ========================================================================
  console.log('CURRENT EXECUTOR MAPPINGS:')
  console.log('─'.repeat(80))
  console.log()

  const executors = await clickhouse.query({
    query: `
      SELECT
        executor_wallet,
        source,
        created_at
      FROM wallet_identity_overrides
      WHERE canonical_wallet = '${XCN_CANONICAL}'
      ORDER BY created_at
    `,
    format: 'JSONEachRow',
  })
  const executorData = await executors.json<any>()

  executorData.forEach((row, i) => {
    console.log(`${i + 1}. ${row.executor_wallet}`)
    console.log(`   Source: ${row.source}`)
    console.log(`   Added: ${row.created_at}\n`)
  })

  console.log(`Total executors: ${executorData.length}`)
  console.log()

  // ========================================================================
  // P&L with current executors
  // ========================================================================
  console.log('TRADE-ONLY P&L (with current executors):')
  console.log('─'.repeat(80))
  console.log()

  const tradeOnlyQuery = `
    WITH base AS (
      SELECT
        trade_key,
        trade_direction,
        toFloat64(usd_value) AS usd_value,
        condition_id_norm_v3 AS cid
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_canonical = '${XCN_CANONICAL}'
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

  console.log('Results:')
  console.log(`  Total Trade P&L:    $${parseFloat(tradeOnly.total_trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Total Trade Volume: $${parseFloat(tradeOnly.total_trade_volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Total Trades:       ${parseInt(tradeOnly.total_trades).toLocaleString('en-US')}`)
  console.log(`  Unique Markets:     ${parseInt(tradeOnly.unique_markets).toLocaleString('en-US')}`)
  console.log()

  // ========================================================================
  // Per-executor breakdown
  // ========================================================================
  console.log('PER-EXECUTOR BREAKDOWN:')
  console.log('─'.repeat(80))
  console.log()

  const perExecutor = await clickhouse.query({
    query: `
      SELECT
        wallet_raw,
        count() AS trades,
        sum(toFloat64(usd_value)) AS volume
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_canonical = '${XCN_CANONICAL}'
        AND condition_id_norm_v3 != ''
      GROUP BY wallet_raw
      ORDER BY volume DESC
    `,
    format: 'JSONEachRow',
  })
  const perExecutorData = await perExecutor.json<any>()

  perExecutorData.forEach((row, i) => {
    console.log(`${i + 1}. ${row.wallet_raw}`)
    console.log(`   Trades: ${parseInt(row.trades).toLocaleString()}`)
    console.log(`   Volume: $${parseFloat(row.volume).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`)
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
