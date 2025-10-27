#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient as createClickHouseClient } from '@clickhouse/client'
import { fetchWalletPnL } from '../lib/goldsky/client'

const clickhouse = createClickHouseClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399

// Use the #1 ranked wallet
const TEST_WALLET = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'

async function debugInflation() {
  console.log('🔍 Debugging Enrichment P&L Inflation Bug\n')
  console.log(`Test wallet: ${TEST_WALLET}\n`)
  console.log('═'.repeat(70) + '\n')

  // Get our enriched trades
  const ourTradesQuery = `
    SELECT
      trade_id,
      market_id,
      condition_id,
      timestamp,
      side,
      entry_price,
      exit_price,
      shares,
      usd_value,
      outcome,
      pnl_gross,
      pnl_net,
      return_pct,
      fee_usd
    FROM trades_raw
    WHERE wallet_address = '${TEST_WALLET}'
      AND pnl_net != 0
    ORDER BY pnl_net DESC
    LIMIT 10
  `

  const ourResult = await clickhouse.query({
    query: ourTradesQuery,
    format: 'JSONEachRow',
  })
  const ourTrades: any[] = await ourResult.json()

  console.log('📊 OUR TOP 10 ENRICHED TRADES (highest P&L):\n')

  let totalOurPnl = 0
  ourTrades.forEach((trade, i) => {
    const pnl = parseFloat(trade.pnl_net)
    totalOurPnl += pnl

    console.log(`[${i + 1}] Trade: ${trade.trade_id.substring(0, 40)}...`)
    console.log(`    Side: ${trade.side}, Shares: ${parseFloat(trade.shares).toFixed(2)}`)
    console.log(`    Entry: $${parseFloat(trade.entry_price).toFixed(4)}, Exit: $${parseFloat(trade.exit_price || 0).toFixed(4)}`)
    console.log(`    Cost: $${parseFloat(trade.usd_value).toFixed(2)}`)
    console.log(`    Outcome: ${trade.outcome}`)
    console.log(`    PnL Gross: $${parseFloat(trade.pnl_gross).toFixed(2)}`)
    console.log(`    PnL Net: $${pnl.toFixed(2)} (${parseFloat(trade.return_pct).toFixed(2)}%)`)
    console.log(`    Fee: $${parseFloat(trade.fee_usd).toFixed(2)}`)

    // Manually calculate what P&L SHOULD be
    const shares = parseFloat(trade.shares)
    const entryPrice = parseFloat(trade.entry_price)
    const exitPrice = parseFloat(trade.exit_price || 0)
    const outcome = parseInt(trade.outcome)
    const side = trade.side

    let expectedPnl = 0
    if (side === 'YES') {
      // If bought YES and outcome=1 (YES won), payout is $1 per share
      // If bought YES and outcome=0 (NO won), payout is $0
      const payout = outcome === 1 ? 1 : 0
      expectedPnl = (payout - entryPrice) * shares
    } else {
      // If bought NO and outcome=0 (NO won), payout is $1 per share
      // If bought NO and outcome=1 (YES won), payout is $0
      const payout = outcome === 0 ? 1 : 0
      expectedPnl = (payout - entryPrice) * shares
    }

    console.log(`    ❓ Expected PnL (manual calc): $${expectedPnl.toFixed(2)}`)
    console.log(`    🚨 Difference: $${(pnl - expectedPnl).toFixed(2)} (${((pnl - expectedPnl) / Math.abs(expectedPnl) * 100).toFixed(1)}%)`)
    console.log()
  })

  console.log(`Total P&L from top 10 trades: $${totalOurPnl.toFixed(2)}\n`)

  // Now get Goldsky data
  console.log('═'.repeat(70))
  console.log('\n📊 GOLDSKY DATA:\n')

  const goldskyData = await fetchWalletPnL(TEST_WALLET)

  if (!goldskyData) {
    console.log('❌ No Goldsky data found')
    return
  }

  const goldskyPnlCorrected = goldskyData.totalRealizedPnl / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
  console.log(`Total Realized PnL (corrected): $${goldskyPnlCorrected.toFixed(2)}`)
  console.log(`Position Count: ${goldskyData.positionCount}\n`)

  // Show top 10 Goldsky positions
  const sortedPositions = goldskyData.positions
    .map((p: any) => ({
      ...p,
      correctedPnl: parseFloat(p.realizedPnl) / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6,
    }))
    .sort((a: any, b: any) => b.correctedPnl - a.correctedPnl)
    .slice(0, 10)

  console.log('Top 10 Goldsky positions (corrected):\n')
  sortedPositions.forEach((pos: any, i: number) => {
    console.log(`[${i + 1}] Token ID: ${pos.tokenId.substring(0, 40)}...`)
    console.log(`    Corrected PnL: $${pos.correctedPnl.toFixed(2)}`)
    console.log(`    Avg Price: ${parseFloat(pos.avgPrice) / 1e6}`)
    console.log(`    Amount: ${parseFloat(pos.amount) / 1e6}`)
    console.log()
  })

  console.log('═'.repeat(70))
  console.log('\n🎯 ANALYSIS:\n')

  // Get total counts from our enrichment
  const statsQuery = `
    SELECT
      COUNT(*) as total_trades,
      SUM(pnl_net) as total_pnl
    FROM trades_raw
    WHERE wallet_address = '${TEST_WALLET}'
      AND pnl_net != 0
  `

  const statsResult = await clickhouse.query({
    query: statsQuery,
    format: 'JSONEachRow',
  })
  const stats: any[] = await statsResult.json()

  console.log(`Our enrichment:`)
  console.log(`  - Total trades: ${stats[0].total_trades}`)
  console.log(`  - Total PnL: $${parseFloat(stats[0].total_pnl).toFixed(2)}`)
  console.log()
  console.log(`Goldsky:`)
  console.log(`  - Total positions: ${goldskyData.positionCount}`)
  console.log(`  - Total PnL: $${goldskyPnlCorrected.toFixed(2)}`)
  console.log()
  console.log(`Ratio: ${(parseFloat(stats[0].total_pnl) / goldskyPnlCorrected).toFixed(2)}x`)
}

debugInflation()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
