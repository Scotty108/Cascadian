/**
 * Check for Duplication in V3
 *
 * Individual markets are correct, but totals are wrong.
 * Check if markets are being duplicated or double-counted.
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const KNOWN_GOOD = 'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2' // ee3a38... should be $24,924.15

async function checkV3Duplication() {
  console.log('🔍 Check V3 Duplication\n')
  console.log('='.repeat(80))

  try {
    // Check 1: Count rows per market for test wallet
    console.log('\n1. Check row counts per market (test wallet)...\n')

    const rowCountsResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          count(*) AS row_count,
          sum(realized_pnl) AS total_pnl
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
        GROUP BY condition_id
        HAVING row_count > 1
        ORDER BY row_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const rowCounts = await rowCountsResult.json() as Array<{
      condition_id: string
      row_count: string
      total_pnl: number
    }>

    if (rowCounts.length > 0) {
      console.log('🚨 Found markets with MULTIPLE ROWS:\n')
      console.log('Condition (16)    | Rows | Total PnL')
      console.log('-'.repeat(50))
      rowCounts.forEach(r => {
        const cond = r.condition_id.slice(0, 16)
        const rows = parseInt(r.row_count).toString().padStart(4)
        const pnl = `$${r.total_pnl.toFixed(2)}`.padStart(12)
        console.log(`${cond} | ${rows} | ${pnl}`)
      })
    } else {
      console.log('✅ All markets have exactly 1 row (no duplication)')
    }

    // Check 2: Get ALL rows for known-good market
    console.log('\n' + '='.repeat(80))
    console.log('\n2. All rows for known-good market (ee3a38...)...\n')

    const knownGoodAllResult = await clickhouse.query({
      query: `
        SELECT *
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND condition_id = '${KNOWN_GOOD}'
      `,
      format: 'JSONEachRow'
    })
    const knownGoodAll = await knownGoodAllResult.json()

    console.log(`Found ${knownGoodAll.length} row(s):\n`)
    knownGoodAll.forEach((row: any, idx: number) => {
      console.log(`Row ${idx + 1}:`)
      console.log(`  Trade Cash: $${row.trade_cash.toFixed(2)}`)
      console.log(`  Resolution Cash: $${row.resolution_cash.toFixed(2)}`)
      console.log(`  Realized PnL: $${row.realized_pnl.toFixed(2)}`)
      console.log()
    })

    // Check 3: Compare sum from view vs direct query
    console.log('\n' + '='.repeat(80))
    console.log('\n3. Sum from view vs counting...\n')

    const sumResult = await clickhouse.query({
      query: `
        SELECT sum(realized_pnl) AS total
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const sumTotal = await sumResult.json() as Array<{ total: number }>

    const countResult = await clickhouse.query({
      query: `
        SELECT
          count(*) AS row_count,
          count(DISTINCT condition_id) AS unique_markets
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })
    const counts = await countResult.json() as Array<{
      row_count: string
      unique_markets: string
    }>

    console.log(`Total PnL (sum): $${sumTotal[0].total.toFixed(2)}`)
    console.log(`Row count: ${counts[0].row_count}`)
    console.log(`Unique markets: ${counts[0].unique_markets}`)

    const rowCount = parseInt(counts[0].row_count)
    const uniqueMarkets = parseInt(counts[0].unique_markets)

    if (rowCount === uniqueMarkets) {
      console.log('\n✅ Rows = Unique markets (no duplication)')
    } else {
      console.log(`\n🚨 ${rowCount} rows but only ${uniqueMarkets} unique markets!`)
      console.log(`   Duplication factor: ${(rowCount / uniqueMarkets).toFixed(2)}x`)
    }

    // Check 4: Sample markets with their individual PnL
    console.log('\n' + '='.repeat(80))
    console.log('\n4. Sample individual market PnLs...\n')

    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          realized_pnl
        FROM vw_pm_realized_pnl_v3
        WHERE wallet_address = '${TEST_WALLET}'
          AND is_resolved = 1
        ORDER BY abs(realized_pnl) DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const samples = await sampleResult.json() as Array<{
      condition_id: string
      realized_pnl: number
    }>

    let manualSum = 0
    console.log('Condition (16)    | PnL')
    console.log('-'.repeat(40))
    samples.forEach(s => {
      const cond = s.condition_id.slice(0, 16)
      const pnl = `$${s.realized_pnl.toFixed(2)}`.padStart(12)
      console.log(`${cond} | ${pnl}`)
      manualSum += s.realized_pnl
    })

    console.log('-'.repeat(40))
    console.log(`Top 10 sum: $${manualSum.toFixed(2)}`)

    console.log('\n' + '='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

checkV3Duplication()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
