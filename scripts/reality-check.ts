#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function check() {
  const wallet = '0x8b15818077ab8a7f31012f16a97cd42de432e8d8'

  console.log('═'.repeat(100))
  console.log('REALITY CHECK: Wallet Activity')
  console.log('═'.repeat(100))
  console.log(`\nWallet: ${wallet}`)
  console.log('\n[STEP 1] Trades in our database for this wallet')
  console.log('─'.repeat(100))

  try {
    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(DISTINCT market_id) as unique_markets,
          SUM(usd_value) as total_usd_volume,
          COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as missing_condition_id,
          COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as has_condition_id
        FROM trades_raw
        WHERE LOWER(wallet_address) = LOWER('${wallet}')
      `
    })

    const tradesText = await tradesResult.text()
    let tradesData: any = { data: [] }
    try {
      tradesData = JSON.parse(tradesText)
    } catch {
      console.log('Raw response:', tradesText.substring(0, 500))
      return
    }

    if (tradesData.data && tradesData.data[0]) {
      const row = tradesData.data[0]
      console.log(`✅ Total trades in DB: ${row.total_trades}`)
      console.log(`✅ Unique markets: ${row.unique_markets}`)
      console.log(`✅ Total USD volume: $${parseFloat(row.total_usd_volume || 0).toFixed(2)}`)
      console.log(`✅ Trades WITH condition_id: ${row.has_condition_id}`)
      console.log(`✅ Trades WITHOUT condition_id: ${row.missing_condition_id}`)
    }

    // Get sample trades
    console.log('\n[STEP 2] Sample trades from this wallet')
    console.log('─'.repeat(100))

    const samplesResult = await clickhouse.query({
      query: `
        SELECT
          trade_id,
          market_id,
          condition_id,
          timestamp,
          side,
          shares,
          usd_value,
          outcome,
          transaction_hash
        FROM trades_raw
        WHERE LOWER(wallet_address) = LOWER('${wallet}')
        ORDER BY timestamp DESC
        LIMIT 20
      `
    })

    const samplesText = await samplesResult.text()
    let samplesData: any = { data: [] }
    try {
      samplesData = JSON.parse(samplesText)
    } catch {
      console.log('Failed to parse')
      return
    }

    if (samplesData.data && samplesData.data.length > 0) {
      console.log(`Found ${samplesData.data.length} trades:\n`)
      for (const trade of samplesData.data.slice(0, 5)) {
        const condId = trade.condition_id || 'EMPTY'
        console.log(`Trade ID: ${trade.trade_id}`)
        console.log(`  Market ID: ${trade.market_id}`)
        console.log(`  Condition ID: ${condId}`)
        console.log(`  Timestamp: ${trade.timestamp}`)
        console.log(`  Side: ${trade.side}`)
        console.log(`  Shares: ${trade.shares}`)
        console.log(`  USD Value: ${trade.usd_value}`)
        console.log(`  Outcome: ${trade.outcome}`)
        console.log(`  TX Hash: ${trade.transaction_hash}`)
        console.log()
      }
    } else {
      console.log(`⚠️  NO TRADES FOUND for this wallet in our database!`)
    }

    // Compare to Polymarket
    console.log('\n[STEP 3] What Polymarket shows for this wallet')
    console.log('─'.repeat(100))
    console.log('Polymarket Profile:')
    console.log('  Joined: Nov 2025')
    console.log('  All-Time P&L: $4.08')
    console.log('  Current Position Value: $53.42')
    console.log('')
    console.log('Open Position:')
    console.log('  Market: Will the Government shutdown end November 16 or later?')
    console.log('  Side: Yes')
    console.log('  Shares: 93.8')
    console.log('  Entry Price: 52¢')
    console.log('  Current Price: 57¢')
    console.log('  Current Value: $53.42')
    console.log('  Unrealized P&L: $4.36 (8.89%)')

    console.log('\n[STEP 4] The Critical Questions')
    console.log('─'.repeat(100))
    console.log('1. Did we find any trades for this wallet?')
    console.log('2. If yes: Do those trades have condition_ids?')
    console.log('3. Can we match the "Government shutdown" market?')
    console.log('4. If no trades found: Why is this wallet missing from our database?')
    console.log('5. Is this a recent wallet (Nov 2025) that we haven\'t indexed yet?')

  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

check()
