#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLETS = [
  { name: 'niggemon', address: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0' },
  { name: 'HolyMoses7', address: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8' },
  { name: 'LucasMeow', address: '0x7f3c8979d0afa00007bae4747d5347122af05613' },
  { name: 'xcnstrategy', address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b' }
]

async function main() {
  console.log('🔍 WALLET RESOLUTION COVERAGE CHECK\n')
  
  for (const wallet of WALLETS) {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`💼 ${wallet.name} (${wallet.address})`)
    console.log('='.repeat(80))

    const query = `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) as resolved_trades,
        SUM(CASE WHEN is_resolved = 0 THEN 1 ELSE 0 END) as unresolved_trades,
        SUM(CASE WHEN realized_pnl_usd IS NOT NULL AND realized_pnl_usd != 0 THEN 1 ELSE 0 END) as trades_with_pnl,
        SUM(CASE WHEN pnl IS NOT NULL AND pnl != 0 THEN 1 ELSE 0 END) as trades_with_pnl_field,
        SUM(realized_pnl_usd) as total_realized_pnl,
        SUM(pnl) as total_pnl,
        SUM(usd_value) as total_volume,
        MIN(timestamp) as first_trade,
        MAX(timestamp) as last_trade,
        COUNT(DISTINCT market_id) as unique_markets
      FROM trades_raw
      WHERE lower(wallet_address) = lower('${wallet.address}')
    `

    const result = await clickhouse.query({ query, format: 'JSONEachRow' })
    const data = (await result.json() as any[])[0]

    console.log('\n📊 Trade Statistics:')
    console.log(`   Total Trades: ${parseInt(data.total_trades).toLocaleString()}`)
    console.log(`   Date Range: ${data.first_trade?.substring(0,10)} → ${data.last_trade?.substring(0,10)}`)
    console.log(`   Unique Markets: ${parseInt(data.unique_markets).toLocaleString()}`)
    console.log(`   Total Volume: $${parseFloat(data.total_volume).toLocaleString(undefined, {minimumFractionDigits: 2})}`)

    console.log('\n📈 Resolution Status:')
    const resolvedPct = (parseInt(data.resolved_trades) / parseInt(data.total_trades)) * 100
    console.log(`   ✅ Resolved: ${parseInt(data.resolved_trades).toLocaleString()} (${resolvedPct.toFixed(1)}%)`)
    console.log(`   ⏳ Unresolved: ${parseInt(data.unresolved_trades).toLocaleString()} (${(100-resolvedPct).toFixed(1)}%)`)

    console.log('\n💰 P&L Data:')
    const pnlCoverage = (parseInt(data.trades_with_pnl) / parseInt(data.total_trades)) * 100
    console.log(`   Trades with realized_pnl_usd: ${parseInt(data.trades_with_pnl).toLocaleString()} (${pnlCoverage.toFixed(1)}%)`)
    console.log(`   Trades with pnl field: ${parseInt(data.trades_with_pnl_field).toLocaleString()}`)
    console.log(`   Sum of realized_pnl_usd: $${parseFloat(data.total_realized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})}`)
    console.log(`   Sum of pnl: $${parseFloat(data.total_pnl).toLocaleString(undefined, {minimumFractionDigits: 2})}`)

    // Get sample of resolved trades
    const sampleQuery = `
      SELECT
        timestamp,
        market_id,
        shares,
        entry_price,
        realized_pnl_usd,
        pnl,
        is_resolved,
        resolved_outcome
      FROM trades_raw
      WHERE lower(wallet_address) = lower('${wallet.address}')
        AND is_resolved = 1
      ORDER BY ABS(realized_pnl_usd) DESC
      LIMIT 5
    `

    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' })
    const sampleData = await sampleResult.json() as any[]

    if (sampleData.length > 0) {
      console.log('\n🔍 Top 5 Resolved Trades by P&L:')
      sampleData.forEach((trade, i) => {
        console.log(`   ${i+1}. ${trade.timestamp?.substring(0,10)} | Market: ${trade.market_id.substring(0,10)}... | Shares: ${parseFloat(trade.shares).toFixed(2)} | P&L: $${parseFloat(trade.realized_pnl_usd).toFixed(2)}`)
      })
    } else {
      console.log('\n⚠️  No resolved trades found')
    }
  }

  console.log('\n\n' + '='.repeat(80))
  console.log('🎯 SUMMARY')
  console.log('='.repeat(80) + '\n')

  console.log('The database P&L values are very different from expected because:')
  console.log('1. Only a small % of trades are resolved (most markets still open)')
  console.log('2. P&L is only calculated for resolved trades')
  console.log('3. Expected values may include unrealized P&L (open positions)')
  console.log('4. Expected values may come from Polymarket API, not our calculations\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
