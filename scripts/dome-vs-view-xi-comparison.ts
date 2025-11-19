#!/usr/bin/env npx tsx

/**
 * Dome vs View Xi Market Comparison
 *
 * Purpose: Run exact queries requested by user to verify Dome ground truth
 * matches our view within ±10% tolerance.
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
  console.log('DOME VS VIEW XI MARKET COMPARISON')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Xi CID: ${XI_CID}`)
  console.log(`XCN Wallet: ${XCN_CANONICAL}\n`)

  // ========================================================================
  // QUERY 1: Dome Ground Truth (Xi)
  // ========================================================================
  console.log('Query 1: Dome ground truth (Xi)...\n')

  const domeQuery = `
    WITH xi AS (
      SELECT *
      FROM stg_dome_orders_xcn
      WHERE condition_id_norm_v3 = '${XI_CID}'
    )
    SELECT
      sumIf(shares_normalized, side='BUY')  AS dome_shares_buy,
      sumIf(shares_normalized, side='SELL') AS dome_shares_sell,
      dome_shares_buy - dome_shares_sell    AS dome_net_shares,
      sumIf(shares_normalized * price, side='BUY')  AS dome_cost_buy,
      sumIf(shares_normalized * price, side='SELL') AS dome_cost_sell,
      dome_cost_sell - dome_cost_buy        AS dome_trade_pnl
    FROM xi
  `

  const domeResult = await clickhouse.query({
    query: domeQuery,
    format: 'JSONEachRow',
  })
  const domeData = await domeResult.json<any>()
  const dome = domeData[0]

  console.log('DOME GROUND TRUTH (Xi Market):')
  console.log(`  Shares Buy:    ${parseFloat(dome.dome_shares_buy).toFixed(2)}`)
  console.log(`  Shares Sell:   ${parseFloat(dome.dome_shares_sell).toFixed(2)}`)
  console.log(`  Net Shares:    ${parseFloat(dome.dome_net_shares).toFixed(2)}`)
  console.log(`  Cost Buy:      $${parseFloat(dome.dome_cost_buy).toFixed(2)}`)
  console.log(`  Cost Sell:     $${parseFloat(dome.dome_cost_sell).toFixed(2)}`)
  console.log(`  Trade P&L:     $${parseFloat(dome.dome_trade_pnl).toFixed(2)}`)
  console.log()

  // ========================================================================
  // QUERY 2: Canonical View (Xi, 12-wallet cluster)
  // ========================================================================
  console.log('Query 2: Canonical view (Xi, 12-wallet cluster via overrides)...\n')

  const viewQuery = `
    WITH xi AS (
      SELECT *
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = '${XI_CID}'
        AND lower(wallet_canonical) = lower('${XCN_CANONICAL}')
    )
    SELECT
      sumIf(shares, trade_direction='BUY')  AS view_shares_buy,
      sumIf(-shares, trade_direction='SELL') AS view_shares_sell,
      view_shares_buy - view_shares_sell     AS view_net_shares,
      sumIf(toFloat64(usd_value), trade_direction='BUY')  AS view_cost_buy,
      sumIf(toFloat64(usd_value), trade_direction='SELL') AS view_cost_sell,
      view_cost_sell - view_cost_buy         AS view_trade_pnl
    FROM xi
  `

  const viewResult = await clickhouse.query({
    query: viewQuery,
    format: 'JSONEachRow',
  })
  const viewData = await viewResult.json<any>()
  const view = viewData[0]

  console.log('VIEW (vw_trades_canonical_with_canonical_wallet):')
  console.log(`  Shares Buy:    ${parseFloat(view.view_shares_buy).toFixed(2)}`)
  console.log(`  Shares Sell:   ${parseFloat(view.view_shares_sell).toFixed(2)}`)
  console.log(`  Net Shares:    ${parseFloat(view.view_net_shares).toFixed(2)}`)
  console.log(`  Cost Buy:      $${parseFloat(view.view_cost_buy).toFixed(2)}`)
  console.log(`  Cost Sell:     $${parseFloat(view.view_cost_sell).toFixed(2)}`)
  console.log(`  Trade P&L:     $${parseFloat(view.view_trade_pnl).toFixed(2)}`)
  console.log()

  // ========================================================================
  // COMPARISON & TOLERANCE CHECK
  // ========================================================================
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('COMPARISON (Dome vs View)')
  console.log('════════════════════════════════════════════════════════════════════\n')

  const deltaSharesBuy = Math.abs(parseFloat(dome.dome_shares_buy) - parseFloat(view.view_shares_buy))
  const deltaSharesSell = Math.abs(parseFloat(dome.dome_shares_sell) - parseFloat(view.view_shares_sell))
  const deltaNetShares = Math.abs(parseFloat(dome.dome_net_shares) - parseFloat(view.view_net_shares))
  const deltaCostBuy = Math.abs(parseFloat(dome.dome_cost_buy) - parseFloat(view.view_cost_buy))
  const deltaCostSell = Math.abs(parseFloat(dome.dome_cost_sell) - parseFloat(view.view_cost_sell))
  const deltaTradePnL = Math.abs(parseFloat(dome.dome_trade_pnl) - parseFloat(view.view_trade_pnl))

  console.log('ABSOLUTE DELTAS:')
  console.log(`  Shares Buy:    ${deltaSharesBuy.toFixed(2)}`)
  console.log(`  Shares Sell:   ${deltaSharesSell.toFixed(2)}`)
  console.log(`  Net Shares:    ${deltaNetShares.toFixed(2)}`)
  console.log(`  Cost Buy:      $${deltaCostBuy.toFixed(2)}`)
  console.log(`  Cost Sell:     $${deltaCostSell.toFixed(2)}`)
  console.log(`  Trade P&L:     $${deltaTradePnL.toFixed(2)}`)
  console.log()

  // Calculate percentage deltas (±10% tolerance)
  const tolerance = 0.10

  const pctSharesBuy = deltaSharesBuy / Math.max(Math.abs(parseFloat(dome.dome_shares_buy)), 1)
  const pctSharesSell = deltaSharesSell / Math.max(Math.abs(parseFloat(dome.dome_shares_sell)), 1)
  const pctNetShares = deltaNetShares / Math.max(Math.abs(parseFloat(dome.dome_net_shares)), 1)
  const pctCostBuy = deltaCostBuy / Math.max(Math.abs(parseFloat(dome.dome_cost_buy)), 1)
  const pctCostSell = deltaCostSell / Math.max(Math.abs(parseFloat(dome.dome_cost_sell)), 1)
  const pctTradePnL = deltaTradePnL / Math.max(Math.abs(parseFloat(dome.dome_trade_pnl)), 1)

  console.log('PERCENTAGE DELTAS:')
  console.log(`  Shares Buy:    ${(pctSharesBuy * 100).toFixed(2)}%`)
  console.log(`  Shares Sell:   ${(pctSharesSell * 100).toFixed(2)}%`)
  console.log(`  Net Shares:    ${(pctNetShares * 100).toFixed(2)}%`)
  console.log(`  Cost Buy:      ${(pctCostBuy * 100).toFixed(2)}%`)
  console.log(`  Cost Sell:     ${(pctCostSell * 100).toFixed(2)}%`)
  console.log(`  Trade P&L:     ${(pctTradePnL * 100).toFixed(2)}%`)
  console.log()

  // Check ±10% tolerance
  const sharesBuyMatch = pctSharesBuy <= tolerance
  const sharesSellMatch = pctSharesSell <= tolerance
  const netSharesMatch = pctNetShares <= tolerance
  const costBuyMatch = pctCostBuy <= tolerance
  const costSellMatch = pctCostSell <= tolerance
  const tradePnLMatch = pctTradePnL <= tolerance

  console.log('MATCH STATUS (within ±10%):')
  console.log(`  Shares Buy:    ${sharesBuyMatch ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  Shares Sell:   ${sharesSellMatch ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  Net Shares:    ${netSharesMatch ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  Cost Buy:      ${costBuyMatch ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  Cost Sell:     ${costSellMatch ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  Trade P&L:     ${tradePnLMatch ? '✅ PASS' : '❌ FAIL'}`)
  console.log()

  const allMatch = sharesBuyMatch && sharesSellMatch && netSharesMatch &&
                   costBuyMatch && costSellMatch && tradePnLMatch

  console.log('════════════════════════════════════════════════════════════════════')
  console.log('FINAL VERDICT')
  console.log('════════════════════════════════════════════════════════════════════\n')

  if (allMatch) {
    console.log('✅ ALL METRICS MATCH WITHIN ±10%')
    console.log('✅ Dome ground truth = View (certified)')
    console.log('\n**C3 GO SIGNAL:**')
    console.log('View certified as production-ready. Dome vs View reconciliation complete.')
    console.log()
    console.log('Final Numbers:')
    console.log(`  Dome Net Shares:    ${parseFloat(dome.dome_net_shares).toFixed(2)}`)
    console.log(`  View Net Shares:    ${parseFloat(view.view_net_shares).toFixed(2)}`)
    console.log(`  Delta:              ${deltaNetShares.toFixed(2)} (${(pctNetShares * 100).toFixed(2)}%)`)
    console.log()
    console.log(`  Dome Cost Buy:      $${parseFloat(dome.dome_cost_buy).toFixed(2)}`)
    console.log(`  View Cost Buy:      $${parseFloat(view.view_cost_buy).toFixed(2)}`)
    console.log(`  Delta:              $${deltaCostBuy.toFixed(2)} (${(pctCostBuy * 100).toFixed(2)}%)`)
    console.log()
    console.log(`  Dome Cost Sell:     $${parseFloat(dome.dome_cost_sell).toFixed(2)}`)
    console.log(`  View Cost Sell:     $${parseFloat(view.view_cost_sell).toFixed(2)}`)
    console.log(`  Delta:              $${deltaCostSell.toFixed(2)} (${(pctCostSell * 100).toFixed(2)}%)`)
    console.log()
    console.log(`  Dome Trade P&L:     $${parseFloat(dome.dome_trade_pnl).toFixed(2)}`)
    console.log(`  View Trade P&L:     $${parseFloat(view.view_trade_pnl).toFixed(2)}`)
    console.log(`  Delta:              $${deltaTradePnL.toFixed(2)} (${(pctTradePnL * 100).toFixed(2)}%)`)
  } else {
    console.log('❌ METRICS DO NOT MATCH WITHIN ±10%')
    console.log('❌ Requires adjustment to scaling/COALESCE')
    console.log('\nFailing metrics:')
    if (!sharesBuyMatch) console.log(`  - Shares Buy: ${(pctSharesBuy * 100).toFixed(2)}% delta`)
    if (!sharesSellMatch) console.log(`  - Shares Sell: ${(pctSharesSell * 100).toFixed(2)}% delta`)
    if (!netSharesMatch) console.log(`  - Net Shares: ${(pctNetShares * 100).toFixed(2)}% delta`)
    if (!costBuyMatch) console.log(`  - Cost Buy: ${(pctCostBuy * 100).toFixed(2)}% delta`)
    if (!costSellMatch) console.log(`  - Cost Sell: ${(pctCostSell * 100).toFixed(2)}% delta`)
    if (!tradePnLMatch) console.log(`  - Trade P&L: ${(pctTradePnL * 100).toFixed(2)}% delta`)
    console.log('\nRecommended fixes:')
    console.log('  1. Check if shares need 1e6 scaling in view')
    console.log('  2. Verify COALESCE handling for canonical_wallet')
    console.log('  3. Confirm wallet_identity_overrides includes all executors')
  }

  await clickhouse.close()
}

main().catch(console.error)
