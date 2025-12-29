#!/usr/bin/env npx tsx

/**
 * XCN Wallet P&L Verification - DEDUPLICATED
 *
 * Purpose: Correct P&L using deduplication to fix the billion-scale issue
 * Root cause: View has 102K duplicate trade_keys inflating totals
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
  console.log('XCN WALLET PNL VERIFICATION - DEDUPLICATED (CORRECTED)')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Wallet: ${XCN_CANONICAL}`)
  console.log()

  // ========================================================================
  // QUERY 1: Trade-only P&L (all markets, deduplicated)
  // ========================================================================
  console.log('QUERY 1: TRADE-ONLY P&L (all markets, deduplicated)')
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

  console.log('Trade-Only P&L (deduplicated):')
  console.log(`  Total Trade P&L:    $${parseFloat(tradeOnly.total_trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Total Trade Volume: $${parseFloat(tradeOnly.total_trade_volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Total Trades:       ${parseInt(tradeOnly.total_trades).toLocaleString('en-US')}`)
  console.log(`  Unique Markets:     ${parseInt(tradeOnly.unique_markets).toLocaleString('en-US')}`)
  console.log()

  // ========================================================================
  // Verification
  // ========================================================================
  console.log('VERIFICATION:')
  console.log(`  Expected Volume:    $1M - $2M`)
  console.log(`  Match?              ${parseFloat(tradeOnly.total_trade_volume) >= 1000000 && parseFloat(tradeOnly.total_trade_volume) <= 2000000 ? '✅ YES' : '❌ NO'}`)
  console.log()

  await clickhouse.close()
}

main().catch(console.error)
