#!/usr/bin/env npx tsx

/**
 * Load Dome Orders to Staging + Three-Way Reconciliation
 *
 * Purpose:
 * 1. Load /tmp/dome_orders_xcn.json → stg_dome_orders_xcn
 * 2. Verify units (sum(shares_raw)/sum(shares_normalized) = 1e6)
 * 3. Aggregate Dome totals (ground truth)
 * 4. Reconcile:
 *    - Dome (staging table)
 *    - Source (pm_trades_canonical_v3, 12 executors)
 *    - View (vw_trades_canonical_with_canonical_wallet, canonical wallet)
 * 5. All three must match within ±10% cost/shares
 */

import { createClient } from '@clickhouse/client'
import fs from 'fs'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

// XCN canonical wallet and 12 executors
const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
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

// Two condition IDs we're reconciling
const INFLATION_CID = '93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620'
const XI_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('DOME ORDERS STAGING LOAD + THREE-WAY RECONCILIATION')
  console.log('════════════════════════════════════════════════════════════════════\n')

  // ========================================================================
  // STEP 1: Create staging table
  // ========================================================================
  console.log('Step 1: Creating staging table stg_dome_orders_xcn...')

  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS stg_dome_orders_xcn',
  })

  await clickhouse.command({
    query: `
      CREATE TABLE stg_dome_orders_xcn (
        tx_hash String,
        condition_id_norm_v3 String,
        side String,
        price Float64,
        shares_raw UInt64,
        shares_normalized Float64,
        user_wallet String,
        ts UInt64
      )
      ENGINE = Memory
    `,
  })

  console.log('✅ Staging table created\n')

  // ========================================================================
  // STEP 2: Load JSON data
  // ========================================================================
  console.log('Step 2: Loading Dome orders from /tmp/dome_orders_xcn.json...')

  const jsonPath = '/Users/scotty/Projects/Cascadian-app/tmp/dome_orders_xcn.json'
  const rawData = fs.readFileSync(jsonPath, 'utf-8')
  const parsed = JSON.parse(rawData)
  const orders = parsed[0]?.orders || []

  console.log(`Found ${orders.length} orders`)

  // Prepare rows for insertion
  const rows = orders.map((order: any) => {
    // Normalize condition_id (strip 0x, lowercase, expect 64 chars)
    const cid = order.condition_id.toLowerCase().replace(/^0x/, '')

    return {
      tx_hash: order.tx_hash,
      condition_id_norm_v3: cid,
      side: order.side,
      price: order.price,
      shares_raw: order.shares,
      shares_normalized: order.shares_normalized,
      user_wallet: order.user.toLowerCase(),
      ts: order.timestamp,
    }
  })

  // Insert in batches
  if (rows.length > 0) {
    await clickhouse.insert({
      table: 'stg_dome_orders_xcn',
      values: rows,
      format: 'JSONEachRow',
    })
  }

  console.log(`✅ Loaded ${rows.length} orders\n`)

  // ========================================================================
  // STEP 3: Verify units (shares_raw / shares_normalized = 1e6)
  // ========================================================================
  console.log('Step 3: Verifying units (shares_raw / shares_normalized = 1e6)...')

  const unitsQuery = `
    SELECT
      sum(shares_raw) AS total_shares_raw,
      sum(shares_normalized) AS total_shares_normalized,
      total_shares_raw / total_shares_normalized AS ratio
    FROM stg_dome_orders_xcn
  `

  const unitsResult = await clickhouse.query({
    query: unitsQuery,
    format: 'JSONEachRow',
  })
  const unitsData = await unitsResult.json<any>()
  const unitsRow = unitsData[0]

  console.log(`Total shares_raw: ${unitsRow.total_shares_raw}`)
  console.log(`Total shares_normalized: ${unitsRow.total_shares_normalized}`)
  console.log(`Ratio: ${unitsRow.ratio}`)

  if (Math.abs(unitsRow.ratio - 1_000_000) < 100) {
    console.log('✅ PASS: Ratio matches 1e6 (±100 tolerance)\n')
  } else {
    console.log('❌ FAIL: Ratio does not match 1e6\n')
    process.exit(1)
  }

  // ========================================================================
  // STEP 4: Aggregate Dome totals (GROUND TRUTH)
  // ========================================================================
  console.log('Step 4: Aggregating Dome totals per condition_id + user_wallet...')

  const domeAggQuery = `
    SELECT
      condition_id_norm_v3,
      user_wallet,
      sum(IF(side = 'BUY', shares_normalized, 0)) AS buy_shares,
      sum(IF(side = 'SELL', shares_normalized, 0)) AS sell_shares,
      sum(IF(side = 'BUY', shares_normalized, -shares_normalized)) AS net_shares,
      sum(IF(side = 'BUY', shares_normalized * price, 0)) AS cost_buy,
      sum(IF(side = 'SELL', shares_normalized * price, 0)) AS cost_sell,
      countIf(side = 'BUY') AS buy_count,
      countIf(side = 'SELL') AS sell_count,
      count() AS total_trades
    FROM stg_dome_orders_xcn
    GROUP BY condition_id_norm_v3, user_wallet
    ORDER BY condition_id_norm_v3, user_wallet
  `

  const domeAggResult = await clickhouse.query({
    query: domeAggQuery,
    format: 'JSONEachRow',
  })
  const domeAgg = await domeAggResult.json<any>()

  console.log(`✅ Aggregated ${domeAgg.length} rows (ground truth)\n`)

  // Show sample
  console.log('Sample Dome aggregations:')
  domeAgg.slice(0, 3).forEach((row: any) => {
    console.log(`  CID: ${row.condition_id_norm_v3.substring(0, 12)}...`)
    console.log(`  Wallet: ${row.user_wallet}`)
    console.log(`  Net shares: ${row.net_shares}`)
    console.log(`  Cost buy: $${row.cost_buy}`)
    console.log(`  Cost sell: $${row.cost_sell}`)
    console.log(`  Total trades: ${row.total_trades}`)
    console.log()
  })

  // ========================================================================
  // STEP 5: Reconcile SOURCE (pm_trades_canonical_v3)
  // ========================================================================
  console.log('Step 5: Querying SOURCE (pm_trades_canonical_v3, 12 executors)...')

  const executorList = XCN_EXECUTORS.map(a => `'${a}'`).join(', ')

  const sourceQuery = `
    SELECT
      lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) AS condition_id_norm_v3,
      sum(IF(trade_direction = 'BUY', shares, 0)) AS buy_shares,
      sum(IF(trade_direction = 'SELL', shares, 0)) AS sell_shares,
      sum(IF(trade_direction = 'BUY', shares, -shares)) AS net_shares,
      sum(IF(trade_direction = 'BUY', toFloat64(usd_value), 0)) AS cost_buy,
      sum(IF(trade_direction = 'SELL', toFloat64(usd_value), 0)) AS cost_sell,
      countIf(trade_direction = 'BUY') AS buy_count,
      countIf(trade_direction = 'SELL') AS sell_count,
      count() AS total_trades
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) IN (${executorList})
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) IN (
        '${INFLATION_CID}',
        '${XI_CID}'
      )
    GROUP BY condition_id_norm_v3
    ORDER BY condition_id_norm_v3
  `

  const sourceResult = await clickhouse.query({
    query: sourceQuery,
    format: 'JSONEachRow',
  })
  const sourceData = await sourceResult.json<any>()

  console.log(`✅ Queried ${sourceData.length} condition_ids from source\n`)

  console.log('Source aggregations:')
  sourceData.forEach((row: any) => {
    console.log(`  CID: ${row.condition_id_norm_v3.substring(0, 12)}...`)
    console.log(`  Net shares: ${row.net_shares}`)
    console.log(`  Cost buy: $${row.cost_buy}`)
    console.log(`  Cost sell: $${row.cost_sell}`)
    console.log(`  Total trades: ${row.total_trades}`)
    console.log()
  })

  // ========================================================================
  // STEP 6: Reconcile VIEW (vw_trades_canonical_with_canonical_wallet)
  // ========================================================================
  console.log('Step 6: Querying VIEW (vw_trades_canonical_with_canonical_wallet)...')

  const viewQuery = `
    SELECT
      lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) AS condition_id_norm_v3,
      sum(IF(trade_direction = 'BUY', shares, 0)) AS buy_shares,
      sum(IF(trade_direction = 'SELL', -shares, 0)) AS sell_shares,
      sum(shares) AS net_shares,
      sum(IF(trade_direction = 'BUY', toFloat64(usd_value), 0)) AS cost_buy,
      sum(IF(trade_direction = 'SELL', toFloat64(usd_value), 0)) AS cost_sell,
      countIf(trade_direction = 'BUY') AS buy_count,
      countIf(trade_direction = 'SELL') AS sell_count,
      count() AS total_trades
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(wallet_canonical) = lower('${XCN_CANONICAL}')
      AND lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) IN (
        '${INFLATION_CID}',
        '${XI_CID}'
      )
    GROUP BY condition_id_norm_v3
    ORDER BY condition_id_norm_v3
  `

  const viewResult = await clickhouse.query({
    query: viewQuery,
    format: 'JSONEachRow',
  })
  const viewData = await viewResult.json<any>()

  console.log(`✅ Queried ${viewData.length} condition_ids from view\n`)

  console.log('View aggregations:')
  viewData.forEach((row: any) => {
    console.log(`  CID: ${row.condition_id_norm_v3.substring(0, 12)}...`)
    console.log(`  Net shares: ${row.net_shares}`)
    console.log(`  Cost buy: $${row.cost_buy}`)
    console.log(`  Cost sell: $${row.cost_sell}`)
    console.log(`  Total trades: ${row.total_trades}`)
    console.log()
  })

  // ========================================================================
  // STEP 7: Three-Way Comparison
  // ========================================================================
  console.log('Step 7: Three-way comparison (Dome vs Source vs View)...')
  console.log('════════════════════════════════════════════════════════════════════\n')

  // Get Dome totals for XCN canonical wallet
  const domeTotals = domeAgg
    .filter((row: any) => row.user_wallet.toLowerCase() === XCN_CANONICAL.toLowerCase())
    .reduce((acc: any, row: any) => {
      const cid = row.condition_id_norm_v3
      if (!acc[cid]) {
        acc[cid] = {
          buy_shares: 0,
          sell_shares: 0,
          net_shares: 0,
          cost_buy: 0,
          cost_sell: 0,
          total_trades: 0,
        }
      }
      acc[cid].buy_shares += parseFloat(row.buy_shares)
      acc[cid].sell_shares += parseFloat(row.sell_shares)
      acc[cid].net_shares += parseFloat(row.net_shares)
      acc[cid].cost_buy += parseFloat(row.cost_buy)
      acc[cid].cost_sell += parseFloat(row.cost_sell)
      acc[cid].total_trades += parseInt(row.total_trades)
      return acc
    }, {})

  const cids = [INFLATION_CID, XI_CID]
  let allPass = true

  for (const cid of cids) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`Condition ID: ${cid.substring(0, 12)}...`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

    const dome = domeTotals[cid] || {
      net_shares: 0,
      cost_buy: 0,
      cost_sell: 0,
      total_trades: 0,
    }

    const source = sourceData.find((row: any) => row.condition_id_norm_v3 === cid) || {
      net_shares: 0,
      cost_buy: 0,
      cost_sell: 0,
      total_trades: 0,
    }

    const view = viewData.find((row: any) => row.condition_id_norm_v3 === cid) || {
      net_shares: 0,
      cost_buy: 0,
      cost_sell: 0,
      total_trades: 0,
    }

    console.log('DOME (ground truth):')
    console.log(`  Net shares:   ${dome.net_shares.toFixed(2)}`)
    console.log(`  Cost buy:     $${dome.cost_buy.toFixed(2)}`)
    console.log(`  Cost sell:    $${dome.cost_sell.toFixed(2)}`)
    console.log(`  Total trades: ${dome.total_trades}`)
    console.log()

    console.log('SOURCE (pm_trades_canonical_v3):')
    console.log(`  Net shares:   ${parseFloat(source.net_shares).toFixed(2)}`)
    console.log(`  Cost buy:     $${parseFloat(source.cost_buy).toFixed(2)}`)
    console.log(`  Cost sell:    $${parseFloat(source.cost_sell).toFixed(2)}`)
    console.log(`  Total trades: ${source.total_trades}`)
    console.log()

    console.log('VIEW (vw_trades_canonical_with_canonical_wallet):')
    console.log(`  Net shares:   ${parseFloat(view.net_shares).toFixed(2)}`)
    console.log(`  Cost buy:     $${parseFloat(view.cost_buy).toFixed(2)}`)
    console.log(`  Cost sell:    $${parseFloat(view.cost_sell).toFixed(2)}`)
    console.log(`  Total trades: ${view.total_trades}`)
    console.log()

    // Calculate deltas
    const deltaSourceShares = Math.abs(parseFloat(source.net_shares) - dome.net_shares)
    const deltaSourceCostBuy = Math.abs(parseFloat(source.cost_buy) - dome.cost_buy)
    const deltaSourceCostSell = Math.abs(parseFloat(source.cost_sell) - dome.cost_sell)

    const deltaViewShares = Math.abs(parseFloat(view.net_shares) - dome.net_shares)
    const deltaViewCostBuy = Math.abs(parseFloat(view.cost_buy) - dome.cost_buy)
    const deltaViewCostSell = Math.abs(parseFloat(view.cost_sell) - dome.cost_sell)

    const deltaSourceViewShares = Math.abs(parseFloat(source.net_shares) - parseFloat(view.net_shares))
    const deltaSourceViewCostBuy = Math.abs(parseFloat(source.cost_buy) - parseFloat(view.cost_buy))
    const deltaSourceViewCostSell = Math.abs(parseFloat(source.cost_sell) - parseFloat(view.cost_sell))

    console.log('DELTAS:')
    console.log(`  Source vs Dome:`)
    console.log(`    Net shares:  ${deltaSourceShares.toFixed(2)}`)
    console.log(`    Cost buy:    $${deltaSourceCostBuy.toFixed(2)}`)
    console.log(`    Cost sell:   $${deltaSourceCostSell.toFixed(2)}`)
    console.log()

    console.log(`  View vs Dome:`)
    console.log(`    Net shares:  ${deltaViewShares.toFixed(2)}`)
    console.log(`    Cost buy:    $${deltaViewCostBuy.toFixed(2)}`)
    console.log(`    Cost sell:   $${deltaViewCostSell.toFixed(2)}`)
    console.log()

    console.log(`  Source vs View:`)
    console.log(`    Net shares:  ${deltaSourceViewShares.toFixed(2)}`)
    console.log(`    Cost buy:    $${deltaSourceViewCostBuy.toFixed(2)}`)
    console.log(`    Cost sell:   $${deltaSourceViewCostSell.toFixed(2)}`)
    console.log()

    // Check ±10% tolerance
    const tolerance = 0.10

    const sourceSharesMatch = deltaSourceShares / Math.max(Math.abs(dome.net_shares), 1) < tolerance
    const sourceCostBuyMatch = deltaSourceCostBuy / Math.max(dome.cost_buy, 1) < tolerance
    const sourceCostSellMatch = deltaSourceCostSell / Math.max(dome.cost_sell, 1) < tolerance

    const viewSharesMatch = deltaViewShares / Math.max(Math.abs(dome.net_shares), 1) < tolerance
    const viewCostBuyMatch = deltaViewCostBuy / Math.max(dome.cost_buy, 1) < tolerance
    const viewCostSellMatch = deltaViewCostSell / Math.max(dome.cost_sell, 1) < tolerance

    const sourceViewSharesMatch = deltaSourceViewShares < 1
    const sourceViewCostBuyMatch = deltaSourceViewCostBuy < 0.01
    const sourceViewCostSellMatch = deltaSourceViewCostSell < 0.01

    console.log('VERIFICATION:')
    console.log(`  Source vs Dome within ±10%: ${sourceSharesMatch && sourceCostBuyMatch && sourceCostSellMatch ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`  View vs Dome within ±10%:   ${viewSharesMatch && viewCostBuyMatch && viewCostSellMatch ? '✅ PASS' : '❌ FAIL'}`)
    console.log(`  Source = View (exact):      ${sourceViewSharesMatch && sourceViewCostBuyMatch && sourceViewCostSellMatch ? '✅ PASS' : '❌ FAIL'}`)

    if (!sourceSharesMatch || !sourceCostBuyMatch || !sourceCostSellMatch ||
        !viewSharesMatch || !viewCostBuyMatch || !viewCostSellMatch ||
        !sourceViewSharesMatch || !sourceViewCostBuyMatch || !sourceViewCostSellMatch) {
      allPass = false
    }
  }

  console.log('\n════════════════════════════════════════════════════════════════════')
  console.log('SUMMARY')
  console.log('════════════════════════════════════════════════════════════════════\n')

  if (allPass) {
    console.log('✅ ALL CHECKS PASSED')
    console.log('✅ Dome = Source = View (within ±10%)')
    console.log('✅ Ready for C3 go signal\n')
    console.log('Next step: Hand C3 the following message:')
    console.log('"View rebuilt with overrides+scaling; empties=0; source=view=Dome on both CIDs."')
  } else {
    console.log('❌ RECONCILIATION FAILED')
    console.log('❌ Fix required before C3 handoff')
    console.log('\nPossible fixes:')
    console.log('  1. Apply 1e6 scaling in view if shares are off by 1,000,000x')
    console.log('  2. Ensure COALESCE(override.canonical_wallet, map.canonical_wallet, t.wallet_address)')
    console.log('  3. Confirm view joins wallet_identity_overrides (all 12 executors)')
    console.log('  4. Run scripts/verify-c3-handoff-checks.ts to confirm empties=0')
  }

  await clickhouse.close()
}

main().catch(console.error)
