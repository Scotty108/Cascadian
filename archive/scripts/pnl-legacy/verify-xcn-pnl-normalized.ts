#!/usr/bin/env npx tsx

/**
 * XCN Wallet P&L Verification - NORMALIZED (Corrected)
 *
 * Purpose: Get realistic P&L numbers using normalized fields (usd_norm, shares_norm)
 * Excludes orphan trades and uses proper scaling
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
  console.log('XCN WALLET PNL VERIFICATION - NORMALIZED (CORRECTED)')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Wallet: ${XCN_CANONICAL}`)
  console.log()

  // ========================================================================
  // QUERY 1: Trade-only P&L (all markets, normalized)
  // ========================================================================
  console.log('QUERY 1: TRADE-ONLY P&L (all markets, normalized fields)')
  console.log('─'.repeat(80))
  console.log()

  const tradeOnlyQuery = `
    SELECT
      sum(usd_norm * (trade_direction='SELL') - usd_norm * (trade_direction='BUY')) AS total_trade_pnl,
      sum(usd_norm) AS total_trade_volume,
      count() AS total_trades,
      uniq(cid_norm) AS unique_markets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_CANONICAL}'
  `

  const tradeOnlyResult = await clickhouse.query({
    query: tradeOnlyQuery,
    format: 'JSONEachRow',
  })
  const tradeOnlyData = await tradeOnlyResult.json<any>()
  const tradeOnly = tradeOnlyData[0]

  console.log('Trade-Only P&L (normalized):')
  console.log(`  Total Trade P&L:    $${parseFloat(tradeOnly.total_trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Total Trade Volume: $${parseFloat(tradeOnly.total_trade_volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Total Trades:       ${parseInt(tradeOnly.total_trades).toLocaleString('en-US')}`)
  console.log(`  Unique Markets:     ${parseInt(tradeOnly.unique_markets).toLocaleString('en-US')}`)
  console.log()

  // ========================================================================
  // QUERY 2: Realized P&L on resolved markets only (normalized)
  // ========================================================================
  console.log('QUERY 2: REALIZED P&L (resolved markets only, normalized)')
  console.log('─'.repeat(80))
  console.log()

  const realizedQuery = `
    WITH t AS (
      SELECT
        cid_norm,
        sumIf(shares_norm, trade_direction='BUY')  AS shares_buy,
        sumIf(shares_norm, trade_direction='SELL') AS shares_sell,
        shares_buy - shares_sell                   AS net_shares,
        sumIf(usd_norm, trade_direction='BUY')     AS cost_buy,
        sumIf(usd_norm, trade_direction='SELL')    AS proceeds_sell
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_canonical = '${XCN_CANONICAL}'
      GROUP BY cid_norm
    )
    SELECT
      sum(proceeds_sell - cost_buy + net_shares * r.payout_yes) AS realized_pnl_resolved,
      sum(cost_buy + proceeds_sell) AS trade_volume_resolved,
      count() AS markets_resolved,
      sum(cost_buy) AS total_cost_resolved,
      sum(proceeds_sell) AS total_proceeds_resolved,
      sum(net_shares * r.payout_yes) AS settlement_pnl
    FROM t
    JOIN market_resolutions r
      ON t.cid_norm = r.condition_id_norm_v3
  `

  const realizedResult = await clickhouse.query({
    query: realizedQuery,
    format: 'JSONEachRow',
  })
  const realizedData = await realizedResult.json<any>()
  const realized = realizedData[0]

  console.log('Realized P&L (resolved markets only):')
  console.log(`  Realized P&L:        $${parseFloat(realized.realized_pnl_resolved).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Trade Volume:        $${parseFloat(realized.trade_volume_resolved).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Markets Resolved:    ${parseInt(realized.markets_resolved).toLocaleString('en-US')}`)
  console.log()
  console.log('  Breakdown:')
  console.log(`    Cost (Buy):        $${parseFloat(realized.total_cost_resolved).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`    Proceeds (Sell):   $${parseFloat(realized.total_proceeds_resolved).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`    Settlement P&L:    $${parseFloat(realized.settlement_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log()

  // ========================================================================
  // QUERY 3: Unrealized P&L on open markets (for context)
  // ========================================================================
  console.log('QUERY 3: UNREALIZED P&L (open/unresolved markets)')
  console.log('─'.repeat(80))
  console.log()

  const unrealizedQuery = `
    WITH t AS (
      SELECT
        cid_norm,
        sumIf(shares_norm, trade_direction='BUY')  AS shares_buy,
        sumIf(shares_norm, trade_direction='SELL') AS shares_sell,
        shares_buy - shares_sell                   AS net_shares,
        sumIf(usd_norm, trade_direction='BUY')     AS cost_buy,
        sumIf(usd_norm, trade_direction='SELL')    AS proceeds_sell
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_canonical = '${XCN_CANONICAL}'
      GROUP BY cid_norm
    )
    SELECT
      sum(proceeds_sell - cost_buy) AS unrealized_trade_pnl,
      sum(cost_buy) AS total_cost_open,
      sum(proceeds_sell) AS total_proceeds_open,
      count() AS markets_open,
      sum(abs(net_shares)) AS total_open_exposure_shares
    FROM t
    LEFT JOIN market_resolutions r
      ON t.cid_norm = r.condition_id_norm_v3
    WHERE r.condition_id_norm_v3 IS NULL
  `

  const unrealizedResult = await clickhouse.query({
    query: unrealizedQuery,
    format: 'JSONEachRow',
  })
  const unrealizedData = await unrealizedResult.json<any>()
  const unrealized = unrealizedData[0]

  console.log('Unrealized P&L (open markets, no MTM):')
  console.log(`  Unrealized Trade P&L: $${parseFloat(unrealized.unrealized_trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Open Markets:         ${parseInt(unrealized.markets_open).toLocaleString('en-US')}`)
  console.log(`  Cost (Open):          $${parseFloat(unrealized.total_cost_open).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Proceeds (Open):      $${parseFloat(unrealized.total_proceeds_open).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Open Exposure (shares): ${parseFloat(unrealized.total_open_exposure_shares).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log()

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('SUMMARY')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log('KEY NUMBERS (Normalized):')
  console.log(`  1. Trade-Only P&L (all markets):        $${parseFloat(tradeOnly.total_trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  2. Realized P&L (resolved markets):     $${parseFloat(realized.realized_pnl_resolved).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  3. Unrealized P&L (open, no MTM):       $${parseFloat(unrealized.unrealized_trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log()

  console.log('VERIFICATION:')
  console.log(`  Total Trade Volume:     $${parseFloat(tradeOnly.total_trade_volume).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  console.log(`  Expected Range:         $1M - $2M (per user)`)
  console.log(`  Match UI Range?         ${parseFloat(tradeOnly.total_trade_volume) >= 1000000 && parseFloat(tradeOnly.total_trade_volume) <= 2000000 ? '✅ YES' : '❌ NO'}`)
  console.log()

  console.log('NOTE: Unrealized P&L does not include mark-to-market on open positions.')
  console.log('For full MTM, need to join open positions with current market prices.')
  console.log()

  await clickhouse.close()
}

main().catch(console.error)
