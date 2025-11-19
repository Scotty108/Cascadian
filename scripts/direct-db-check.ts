#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('DIRECT DATABASE VERIFICATION')
  console.log('='.repeat(80))
  console.log('')

  // 1. Check total wallets in trades_raw
  console.log('1. TOTAL WALLETS IN DATABASE:')
  const totalWallets = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw',
    format: 'JSONEachRow'
  })
  const total: any = await totalWallets.json()
  console.log('   Total distinct wallets:', total[0].count.toLocaleString())

  // 2. Check wallets with resolved trades
  console.log('')
  console.log('2. WALLETS WITH RESOLVED TRADES:')
  const resolvedWallets = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT wallet_address) as count
      FROM trades_raw
      WHERE is_resolved = 1
    `,
    format: 'JSONEachRow'
  })
  const resolved: any = await resolvedWallets.json()
  console.log('   Wallets with >=1 resolved trade:', resolved[0].count.toLocaleString())

  // 3. Manually calculate P&L for a few wallets
  console.log('')
  console.log('3. MANUAL P&L CALCULATION FOR SAMPLE WALLETS:')
  const sampleWallets = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet_address
      FROM trades_raw
      WHERE is_resolved = 1
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const samples: any = await sampleWallets.json()

  for (const sample of samples) {
    const wallet = sample.wallet_address

    // Get all resolved trades
    const trades = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          SUM(pnl_net) as total_pnl,
          SUM(CASE WHEN pnl_net > 0 THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN pnl_net < 0 THEN 1 ELSE 0 END) as losses
        FROM trades_raw
        WHERE wallet_address = '${wallet}'
          AND is_resolved = 1
      `,
      format: 'JSONEachRow'
    })

    const tradeData: any = await trades.json()
    const pnl = parseFloat(tradeData[0].total_pnl || '0')

    console.log(`   ${wallet.slice(0, 12)}...`)
    console.log(`     Trades: ${tradeData[0].trade_count}, Wins: ${tradeData[0].wins}, Losses: ${tradeData[0].losses}`)
    console.log(`     Total P&L: $${pnl.toFixed(2)}`)
  }

  // 4. Check metrics table coverage
  console.log('')
  console.log('4. METRICS TABLE COVERAGE:')
  const metricsCount = await clickhouse.query({
    query: `
      SELECT
        window,
        COUNT(DISTINCT wallet_address) as wallet_count
      FROM wallet_metrics_complete
      GROUP BY window
      ORDER BY window
    `,
    format: 'JSONEachRow'
  })
  const metrics: any = await metricsCount.json()

  for (const row of metrics) {
    console.log(`   ${row.window}: ${row.wallet_count.toLocaleString()} wallets`)
  }

  // 5. Check P&L distribution
  console.log('')
  console.log('5. P&L DISTRIBUTION (lifetime):')
  const pnlDist = await clickhouse.query({
    query: `
      SELECT
        quantile(0.25)(metric_9_net_pnl_usd) as p25,
        quantile(0.50)(metric_9_net_pnl_usd) as p50,
        quantile(0.75)(metric_9_net_pnl_usd) as p75,
        min(metric_9_net_pnl_usd) as min_pnl,
        max(metric_9_net_pnl_usd) as max_pnl,
        avg(metric_9_net_pnl_usd) as avg_pnl
      FROM wallet_metrics_complete
      WHERE window = 'lifetime'
    `,
    format: 'JSONEachRow'
  })
  const dist: any = await pnlDist.json()

  console.log(`   Min: $${parseFloat(dist[0].min_pnl).toFixed(2)}`)
  console.log(`   25th percentile: $${parseFloat(dist[0].p25).toFixed(2)}`)
  console.log(`   Median: $${parseFloat(dist[0].p50).toFixed(2)}`)
  console.log(`   75th percentile: $${parseFloat(dist[0].p75).toFixed(2)}`)
  console.log(`   Max: $${parseFloat(dist[0].max_pnl).toFixed(2)}`)
  console.log(`   Average: $${parseFloat(dist[0].avg_pnl).toFixed(2)}`)

  // 6. Sample a winning trade and check if P&L is correct
  console.log('')
  console.log('6. SAMPLE TRADE VERIFICATION:')
  const winningTrade = await clickhouse.query({
    query: `
      SELECT
        trade_id,
        wallet_address,
        side,
        outcome,
        shares,
        usd_value,
        pnl_net,
        condition_id
      FROM trades_raw
      WHERE is_resolved = 1
        AND outcome = 1
        AND side = 'NO'
      LIMIT 1
    `,
    format: 'JSONEachRow'
  })

  const trade: any = await winningTrade.json()
  if (trade[0]) {
    const t = trade[0]
    console.log(`   Trade: ${t.trade_id.slice(0, 12)}...`)
    console.log(`   Wallet: ${t.wallet_address.slice(0, 12)}...`)
    console.log(`   Side: ${t.side}, Outcome: ${t.outcome} (${t.side} ${t.outcome === 1 ? 'WON' : 'LOST'})`)
    console.log(`   Shares: ${t.shares}, Cost: $${parseFloat(t.usd_value).toFixed(2)}`)
    console.log(`   Recorded P&L: $${parseFloat(t.pnl_net).toFixed(2)}`)

    // Manual calculation
    const payout = parseFloat(t.shares) * 1.0  // Winners get $1 per share
    const cost = parseFloat(t.usd_value)
    const fee = cost * 0.002
    const correctPnl = payout - cost - fee

    console.log(`   MANUAL CALC: Payout=$${payout.toFixed(2)} - Cost=$${cost.toFixed(2)} - Fee=$${fee.toFixed(2)} = $${correctPnl.toFixed(2)}`)

    if (Math.abs(parseFloat(t.pnl_net) - correctPnl) > 0.01) {
      console.log(`   ⚠️  ERROR: P&L mismatch! Off by $${(correctPnl - parseFloat(t.pnl_net)).toFixed(2)}`)
    } else {
      console.log(`   ✅ P&L calculation is correct`)
    }
  }

  console.log('')
  console.log('='.repeat(80))
}

main()
