#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function check() {
  console.log('═'.repeat(100))
  console.log('DATA FRESHNESS CHECK: What data do we actually have?')
  console.log('═'.repeat(100))

  try {
    // Check date range
    console.log('\n[STEP 1] Time range of trades_raw')
    const rangeResult = await clickhouse.query({
      query: `
        SELECT
          MIN(timestamp) as earliest_trade,
          MAX(timestamp) as latest_trade,
          COUNT(*) as total_rows
        FROM trades_raw
      `
    })

    const rangeText = await rangeResult.text()
    let rangeData: any = { data: [] }
    try {
      rangeData = JSON.parse(rangeText)
    } catch {
      console.log('Response:', rangeText.substring(0, 300))
      return
    }

    if (rangeData.data && rangeData.data[0]) {
      const row = rangeData.data[0]
      console.log(`✅ Total rows: ${row.total_rows}`)
      console.log(`✅ Earliest trade: ${row.earliest_trade}`)
      console.log(`✅ Latest trade: ${row.latest_trade}`)
    }

    // Check condition_id distribution
    console.log('\n[STEP 2] Condition ID coverage by time period')
    const covResult = await clickhouse.query({
      query: `
        SELECT
          toDate(timestamp) as trade_date,
          COUNT(*) as total_trades,
          COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as has_condition_id,
          ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as pct_coverage
        FROM trades_raw
        GROUP BY toDate(timestamp)
        ORDER BY trade_date DESC
        LIMIT 30
      `
    })

    const covText = await covResult.text()
    let covData: any = { data: [] }
    try {
      covData = JSON.parse(covText)
    } catch {
      console.log('Response:', covText.substring(0, 300))
      return
    }

    console.log('\nDate Range Breakdown (Most Recent 30 days):')
    console.log('Date         | Total Trades | Has Condition ID | Coverage %')
    console.log('─'.repeat(65))

    if (covData.data && Array.isArray(covData.data)) {
      for (const row of covData.data.slice(0, 30)) {
        const date = row.trade_date || 'N/A'
        const total = row.total_trades || 0
        const has = row.has_condition_id || 0
        const pct = row.pct_coverage || 0
        const totalStr = String(total).padStart(12)
        const hasStr = String(has).padStart(16)
        console.log(`${date} | ${totalStr} | ${hasStr} | ${pct}%`)
      }
    }

    // Check unique wallets
    console.log('\n[STEP 3] How many unique wallets in our database?')
    const walletsResult = await clickhouse.query({
      query: `
        SELECT COUNT(DISTINCT wallet_address) as unique_wallets
        FROM trades_raw
      `
    })

    const walletsText = await walletsResult.text()
    let walletsData: any = { data: [] }
    try {
      walletsData = JSON.parse(walletsText)
    } catch {
      return
    }

    if (walletsData.data && walletsData.data[0]) {
      console.log(`✅ Unique wallets: ${walletsData.data[0].unique_wallets}`)
    }

    // The real question
    console.log('\n[STEP 4] THE CRITICAL INSIGHT')
    console.log('─'.repeat(100))
    console.log('If latest trade is from October/earlier, and the wallet we checked joined November 2025:')
    console.log('  → Our data is OUTDATED / NOT BEING UPDATED')
    console.log('  → The 77.4M "missing condition_id" trades are OLD data from BEFORE enrichment')
    console.log('  → We need a FRESH DATA IMPORT from Polymarket API, not blockchain recovery')
    console.log('')
    console.log('If latest trade is from November 2025:')
    console.log('  → Our data is current')
    console.log('  → The wallet should be in our database')
    console.log('  → There is a DATA PIPELINE / INTEGRATION problem')
    console.log('  → Trades are not being synced properly')

  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

check()
