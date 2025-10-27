#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient as createClickHouseClient } from '@clickhouse/client'

const clickhouse = createClickHouseClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function checkEnrichmentStatus() {
  console.log('🔍 Checking trade enrichment status...\n')

  // Check total trades
  const totalQuery = `SELECT count() as total FROM trades_raw`
  const totalResult = await clickhouse.query({
    query: totalQuery,
    format: 'JSONEachRow',
  })
  const total = await totalResult.json() as Array<{ total: string }>
  console.log(`📊 Total trades: ${parseInt(total[0].total).toLocaleString()}`)

  // Check enriched trades (pnl_net != 0)
  const enrichedQuery = `SELECT count() as enriched FROM trades_raw WHERE pnl_net != 0`
  const enrichedResult = await clickhouse.query({
    query: enrichedQuery,
    format: 'JSONEachRow',
  })
  const enriched = await enrichedResult.json() as Array<{ enriched: string }>
  const enrichedCount = parseInt(enriched[0].enriched)
  console.log(`✅ Enriched trades: ${enrichedCount.toLocaleString()}`)

  // Check trades with outcome
  const outcomeQuery = `SELECT count() as with_outcome FROM trades_raw WHERE outcome IS NOT NULL`
  const outcomeResult = await clickhouse.query({
    query: outcomeQuery,
    format: 'JSONEachRow',
  })
  const withOutcome = await outcomeResult.json() as Array<{ with_outcome: string }>
  const outcomeCount = parseInt(withOutcome[0].with_outcome)
  console.log(`🎯 Trades with outcome: ${outcomeCount.toLocaleString()}`)

  const totalCount = parseInt(total[0].total)
  const enrichmentPct = totalCount > 0 ? ((enrichedCount / totalCount) * 100).toFixed(2) : '0.00'
  console.log(`\n📈 Enrichment rate: ${enrichmentPct}%`)

  if (enrichedCount > 0) {
    console.log('\n✅ PATH B ENRICHMENT IS MAKING PROGRESS!')
    console.log('   Top 50 wallet validation can proceed...\n')

    // Get sample of enriched trades
    const sampleQuery = `
      SELECT
        wallet_address,
        market_id,
        side,
        shares,
        entry_price,
        exit_price,
        outcome,
        pnl_gross,
        pnl_net,
        return_pct
      FROM trades_raw
      WHERE pnl_net != 0
      LIMIT 5
    `
    const sampleResult = await clickhouse.query({
      query: sampleQuery,
      format: 'JSONEachRow',
    })
    const samples = await sampleResult.json() as any

    console.log('Sample enriched trades:')
    samples.forEach((trade: any, i: number) => {
      console.log(`\n[${i + 1}] ${trade.wallet_address.substring(0, 10)}...`)
      console.log(`    Side: ${trade.side}, Shares: ${trade.shares}`)
      console.log(`    Entry: $${parseFloat(trade.entry_price).toFixed(4)}, Exit: $${parseFloat(trade.exit_price || 0).toFixed(4)}`)
      console.log(`    Outcome: ${trade.outcome}, PnL: $${parseFloat(trade.pnl_net).toFixed(2)} (${parseFloat(trade.return_pct).toFixed(2)}%)`)
    })
  } else {
    console.log('\n⏳ Waiting for Path B enrichment to complete...')
    console.log('   No enriched trades found yet (all pnl_net = 0)\n')
  }
}

checkEnrichmentStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
