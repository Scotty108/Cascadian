#!/usr/bin/env npx tsx

/**
 * Investigate Inflation Market Data Gap
 *
 * Purpose: Dome shows 65 Inflation market trades for XCN, but our DB has 0.
 * This script checks if Inflation market exists in our DB at all.
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

const INFLATION_CID = '93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620'
const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('INFLATION MARKET DATA GAP INVESTIGATION')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Inflation CID: ${INFLATION_CID}`)
  console.log(`XCN Wallet: ${XCN_CANONICAL}\n`)

  // ========================================================================
  // STEP 1: Check if Inflation market exists in pm_trades_canonical_v3
  // ========================================================================
  console.log('Step 1: Checking if Inflation market exists in pm_trades_canonical_v3 (ANY wallet)...')

  const existsQuery = `
    SELECT
      count() AS total_trades,
      uniq(wallet_address) AS unique_wallets,
      sum(toFloat64(usd_value)) AS total_volume,
      min(timestamp) AS first_trade,
      max(timestamp) AS last_trade
    FROM pm_trades_canonical_v3
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
  `

  const existsResult = await clickhouse.query({
    query: existsQuery,
    format: 'JSONEachRow',
  })
  const existsData = await existsResult.json<any>()
  const existsRow = existsData[0]

  if (existsRow.total_trades > 0) {
    console.log(`✅ Inflation market EXISTS in our DB`)
    console.log(`   Total trades: ${existsRow.total_trades}`)
    console.log(`   Unique wallets: ${existsRow.unique_wallets}`)
    console.log(`   Total volume: $${existsRow.total_volume}`)
    console.log(`   First trade: ${existsRow.first_trade}`)
    console.log(`   Last trade: ${existsRow.last_trade}\n`)
  } else {
    console.log(`❌ Inflation market DOES NOT EXIST in our DB`)
    console.log(`   Total trades: 0`)
    console.log(`   This is a data ingestion/backfill issue\n`)
  }

  // Declare executorData in outer scope for summary section
  let executorData: any[] = []

  // ========================================================================
  // STEP 2: Check for XCN wallet specifically
  // ========================================================================
  if (existsRow.total_trades > 0) {
    console.log('Step 2: Checking for XCN wallet in Inflation market...')

    const xcnQuery = `
      SELECT
        wallet_address,
        count() AS trades,
        sum(toFloat64(shares)) AS total_shares,
        sum(toFloat64(usd_value)) AS total_cost
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
      GROUP BY wallet_address
      ORDER BY trades DESC
      LIMIT 20
    `

    const xcnResult = await clickhouse.query({
      query: xcnQuery,
      format: 'JSONEachRow',
    })
    const xcnData = await xcnResult.json<any>()

    console.log(`Top 20 wallets in Inflation market:`)
    xcnData.forEach((row: any, idx: number) => {
      const isXCN = row.wallet_address.toLowerCase() === XCN_CANONICAL.toLowerCase()
      console.log(`  ${idx + 1}. ${row.wallet_address} ${isXCN ? '← XCN CANONICAL' : ''}`)
      console.log(`     Trades: ${row.trades}`)
      console.log(`     Shares: ${row.total_shares}`)
      console.log(`     Cost: $${row.total_cost}`)
    })

    const xcnRow = xcnData.find((row: any) => row.wallet_address.toLowerCase() === XCN_CANONICAL.toLowerCase())

    if (xcnRow) {
      console.log(`\n✅ XCN wallet FOUND in Inflation market`)
      console.log(`   Trades: ${xcnRow.trades}`)
    } else {
      console.log(`\n❌ XCN wallet NOT FOUND in Inflation market`)
      console.log(`   This suggests XCN's Inflation trades are using executor wallets`)
    }

    // ========================================================================
    // STEP 3: Check XCN executors in Inflation market
    // ========================================================================
    console.log('\n\nStep 3: Checking XCN executor wallets in Inflation market...')

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

    const executorList = XCN_EXECUTORS.map(a => `'${a}'`).join(', ')

    const executorQuery = `
      SELECT
        wallet_address,
        count() AS trades,
        sum(toFloat64(shares)) AS total_shares,
        sum(toFloat64(usd_value)) AS total_cost
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
        AND lower(wallet_address) IN (${executorList})
      GROUP BY wallet_address
      ORDER BY trades DESC
    `

    const executorResult = await clickhouse.query({
      query: executorQuery,
      format: 'JSONEachRow',
    })
    executorData = await executorResult.json<any>()

    if (executorData.length > 0) {
      console.log(`✅ XCN executor wallets FOUND in Inflation market`)
      console.log(`   ${executorData.length} executors with trades:\n`)

      executorData.forEach((row: any) => {
        console.log(`   ${row.wallet_address}`)
        console.log(`     Trades: ${row.trades}`)
        console.log(`     Shares: ${row.total_shares}`)
        console.log(`     Cost: $${row.total_cost}`)
      })

      const totalExecutorTrades = executorData.reduce((sum: number, row: any) => sum + parseInt(row.trades), 0)
      console.log(`\n   Total executor trades: ${totalExecutorTrades}`)
      console.log(`   Dome reported: 65 trades`)
      console.log(`   Match: ${totalExecutorTrades === 65 ? '✅ EXACT' : `❌ DIFF (${totalExecutorTrades - 65})`}`)
    } else {
      console.log(`❌ XCN executor wallets NOT FOUND in Inflation market`)
      console.log(`   This means we're missing Inflation trades entirely`)
    }
  }

  // ========================================================================
  // STEP 4: Check view
  // ========================================================================
  console.log('\n\nStep 4: Checking view (vw_trades_canonical_with_canonical_wallet)...')

  const viewQuery = `
    SELECT count() AS trades
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = lower('${INFLATION_CID}')
      AND lower(wallet_canonical) = lower('${XCN_CANONICAL}')
  `

  const viewResult = await clickhouse.query({
    query: viewQuery,
    format: 'JSONEachRow',
  })
  const viewData = await viewResult.json<any>()
  const viewRow = viewData[0]

  console.log(`View trades for XCN canonical wallet: ${viewRow.trades}`)

  if (viewRow.trades === 0) {
    console.log(`✅ View matches our finding (0 trades)`)
  } else {
    console.log(`⚠️  View has ${viewRow.trades} trades (unexpected)`)
  }

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('\n\n════════════════════════════════════════════════════════════════════')
  console.log('SUMMARY')
  console.log('════════════════════════════════════════════════════════════════════\n')

  if (existsRow.total_trades === 0) {
    console.log('❌ ROOT CAUSE: Inflation market trades NOT in our DB')
    console.log('\nPossible reasons:')
    console.log('  1. Backfill script filtered out Inflation market')
    console.log('  2. Market not in our coverage scope')
    console.log('  3. Condition ID mismatch preventing data ingestion')
    console.log('  4. Source data (ERC1155/CLOB) missing for this market')
    console.log('\nNext steps:')
    console.log('  1. Check backfill script filters/coverage')
    console.log('  2. Verify condition ID normalization')
    console.log('  3. Check ERC1155/CLOB source tables')
    console.log('  4. Re-run backfill for Inflation market if needed')
  } else if (executorData.length === 0) {
    console.log('❌ ROOT CAUSE: XCN executor wallets missing Inflation trades')
    console.log('\nInflation market exists in DB, but XCN has no trades.')
    console.log('This could mean:')
    console.log('  1. XCN wallet used different executors for Inflation trades')
    console.log('  2. Dome API is showing trades for a different wallet')
    console.log('  3. wallet_identity_overrides incomplete for Inflation period')
  } else {
    console.log('✅ Data exists in source table')
    console.log('✅ View correctly shows 0 (if executors have 0)')
    console.log('\nIf executors have trades but view shows 0:')
    console.log('  - Check wallet_identity_overrides mapping')
    console.log('  - Verify view definition includes all executors')
  }

  await clickhouse.close()
}

main().catch(console.error)
