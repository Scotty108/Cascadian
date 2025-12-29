#!/usr/bin/env npx tsx

/**
 * Complete XCN Wallet PnL Verification
 *
 * Purpose: Produce verifiable numbers for wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
 *
 * Steps:
 * 1. Sample trades for on-chain/UI verification
 * 2. Per-market PnL components
 * 3. Overall realized PnL (with resolutions)
 * 4. Trade-only PnL (sanity check)
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
  console.log('XCN WALLET PNL VERIFICATION - COMPLETE ANALYSIS')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Wallet: ${XCN_CANONICAL}`)
  console.log()

  // ========================================================================
  // STEP 1: Sample Trades for On-Chain/UI Verification
  // ========================================================================
  console.log('STEP 1: SAMPLE TRADES (First 20 for verification)')
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
      substring(condition_id_norm_v3, 1, 16) || '...' AS cid_short
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

  console.log('Sample Trades (for Polygonscan + Polymarket UI verification):')
  console.log()
  console.table(sampleData)
  console.log()

  // ========================================================================
  // STEP 2: Per-Market PnL Components
  // ========================================================================
  console.log('STEP 2: PER-MARKET PNL COMPONENTS')
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
      count() AS trade_count
    FROM trades
    GROUP BY cid
    ORDER BY cid
  `

  const perMarketResult = await clickhouse.query({
    query: perMarketQuery,
    format: 'JSONEachRow',
  })
  const perMarketData = await perMarketResult.json<any>()

  console.log('Per-Market Aggregates:')
  console.log()
  console.table(perMarketData)
  console.log()

  // ========================================================================
  // STEP 3: Overall Realized PnL (with resolutions)
  // ========================================================================
  console.log('STEP 3: OVERALL REALIZED PNL (using market_resolutions)')
  console.log('─'.repeat(80))
  console.log()

  const realizedPnLQuery = `
    WITH trades AS (
      SELECT
        cid_norm AS cid,
        sumIf(toFloat64(shares), trade_direction='BUY')  AS shares_buy,
        sumIf(-toFloat64(shares), trade_direction='SELL') AS shares_sell,
        shares_buy + shares_sell               AS net_shares,
        sumIf(toFloat64(usd_value), trade_direction='BUY')  AS cost_buy,
        sumIf(toFloat64(usd_value), trade_direction='SELL') AS proceeds_sell
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
      GROUP BY cid
    )
    SELECT
      sum(proceeds_sell - cost_buy + net_shares * toFloat64(r.payout_yes)) AS total_realized_pnl,
      count() AS total_markets,
      countIf(r.payout_yes IS NOT NULL) AS markets_with_resolution
    FROM trades t
    LEFT JOIN market_resolutions r
      ON lower(replaceRegexpAll(t.cid, '^0x', '')) = lower(replaceRegexpAll(r.condition_id_norm_v3, '^0x', ''))
  `

  const realizedResult = await clickhouse.query({
    query: realizedPnLQuery,
    format: 'JSONEachRow',
  })
  const realizedData = await realizedResult.json<any>()

  console.log('Realized P&L Summary:')
  console.log(`  Total Realized P&L:        $${parseFloat(realizedData[0].total_realized_pnl).toFixed(2)}`)
  console.log(`  Total Markets Traded:      ${realizedData[0].total_markets}`)
  console.log(`  Markets with Resolution:   ${realizedData[0].markets_with_resolution}`)
  console.log()

  // ========================================================================
  // STEP 4: Trade-Only PnL (Sanity Check)
  // ========================================================================
  console.log('STEP 4: TRADE-ONLY PNL (sanity check, no resolutions)')
  console.log('─'.repeat(80))
  console.log()

  const tradePnLQuery = `
    SELECT
      sum(if(trade_direction='SELL', toFloat64(usd_value), -toFloat64(usd_value))) AS total_trade_pnl,
      sumIf(toFloat64(usd_value), trade_direction='BUY') AS total_cost_buy,
      sumIf(toFloat64(usd_value), trade_direction='SELL') AS total_proceeds_sell,
      count() AS total_trades
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
  `

  const tradePnLResult = await clickhouse.query({
    query: tradePnLQuery,
    format: 'JSONEachRow',
  })
  const tradePnLData = await tradePnLResult.json<any>()

  console.log('Trade-Only P&L (proceeds - cost, no settlement):')
  console.log(`  Total Trade P&L:     $${parseFloat(tradePnLData[0].total_trade_pnl).toFixed(2)}`)
  console.log(`  Total Cost (Buy):    $${parseFloat(tradePnLData[0].total_cost_buy).toFixed(2)}`)
  console.log(`  Total Proceeds (Sell): $${parseFloat(tradePnLData[0].total_proceeds_sell).toFixed(2)}`)
  console.log(`  Total Trades:        ${tradePnLData[0].total_trades}`)
  console.log()

  // ========================================================================
  // STEP 5: Check for Missing Resolutions
  // ========================================================================
  console.log('STEP 5: MARKETS WITHOUT RESOLUTIONS')
  console.log('─'.repeat(80))
  console.log()

  const missingResolutionsQuery = `
    WITH trades AS (
      SELECT DISTINCT
        cid_norm AS cid
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
    )
    SELECT
      substring(t.cid, 1, 16) || '...' AS cid_short,
      t.cid AS condition_id_full
    FROM trades t
    LEFT JOIN market_resolutions r
      ON lower(replaceRegexpAll(t.cid, '^0x', '')) = lower(replaceRegexpAll(r.condition_id_norm_v3, '^0x', ''))
    WHERE r.payout_yes IS NULL
    ORDER BY t.cid
  `

  const missingResult = await clickhouse.query({
    query: missingResolutionsQuery,
    format: 'JSONEachRow',
  })
  const missingData = await missingResult.json<any>()

  if (missingData.length > 0) {
    console.log(`Found ${missingData.length} markets without resolution data:`)
    console.log()
    console.table(missingData)
  } else {
    console.log('✅ All markets have resolution data')
  }
  console.log()

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('SUMMARY & DELIVERABLES')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log('✅ STEP 1: Sample trades provided (20 rows for verification)')
  console.log('✅ STEP 2: Per-market aggregates calculated')
  console.log(`✅ STEP 3: Total Realized P&L = $${parseFloat(realizedData[0].total_realized_pnl).toFixed(2)}`)
  console.log(`✅ STEP 4: Trade-Only P&L = $${parseFloat(tradePnLData[0].total_trade_pnl).toFixed(2)}`)
  console.log()

  console.log('VERIFICATION CHECKLIST:')
  console.log('1. Pick 2-3 tx_hash values from Step 1 output')
  console.log('2. Check Polygonscan for timestamp/amounts')
  console.log('3. Verify in Polymarket "Trade History" tab')
  console.log('4. Compare realized P&L vs trade-only P&L')
  console.log()

  console.log('RESOLUTION COVERAGE:')
  console.log(`  Markets Traded:        ${realizedData[0].total_markets}`)
  console.log(`  Markets with Resolution: ${realizedData[0].markets_with_resolution}`)
  console.log(`  Missing Resolutions:   ${missingData.length}`)
  console.log()

  await clickhouse.close()
}

main().catch(console.error)
