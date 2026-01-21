#!/usr/bin/env npx tsx
/**
 * Validate pm_wallet_copy_trading_metrics_v1 against PnL engine
 *
 * Spot-checks top wallets to ensure metrics are accurate.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'
import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1'

async function main() {
  console.log('🔍 Validating pm_wallet_copy_trading_metrics_v1\n')

  // Get top 10 wallets by expectancy
  const topWalletsResult = await clickhouse.query({
    query: `
      SELECT wallet, total_trades, total_pnl_usd, expectancy_pct
      FROM pm_wallet_copy_trading_metrics_v1
      WHERE total_trades >= 20
      ORDER BY expectancy_pct DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })
  const topWallets = await topWalletsResult.json() as any[]

  console.log('Comparing top 10 wallets by expectancy:\n')
  console.log('Wallet         | Trades | Table PnL   | Engine PnL  | Match?')
  console.log('-'.repeat(70))

  let matches = 0
  let total = 0

  for (const w of topWallets) {
    try {
      const engineResult = await getWalletPnLV1(w.wallet)
      const tablePnl = w.total_pnl_usd
      const enginePnl = engineResult.realized.pnl

      // Check if within 50% or $100 (whichever is larger)
      const tolerance = Math.max(Math.abs(enginePnl) * 0.5, 100)
      const isMatch = Math.abs(tablePnl - enginePnl) < tolerance ||
                      (tablePnl > 0 && enginePnl > 0) ||
                      (tablePnl < 0 && enginePnl < 0)

      const matchStr = isMatch ? '✅' : '❌'
      if (isMatch) matches++
      total++

      console.log(
        `${w.wallet.slice(0, 12)}.. | ` +
        `${String(w.total_trades).padStart(5)} | ` +
        `$${tablePnl.toFixed(0).padStart(9)} | ` +
        `$${enginePnl.toFixed(0).padStart(9)} | ` +
        `${matchStr}`
      )
    } catch (err: any) {
      console.log(`${w.wallet.slice(0, 12)}.. | Error: ${err.message.slice(0, 40)}`)
    }
  }

  console.log('-'.repeat(70))
  console.log(`\nMatch rate: ${matches}/${total} (${Math.round(matches/total*100)}%)`)

  // Summary stats
  console.log('\n📊 Table Summary:')
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_wallets,
        countIf(expectancy_pct > 0) as positive_expectancy,
        countIf(maker_pct <= 30) as taker_heavy,
        countIf(toDate(last_trade_time) >= today() - 3) as active_3d,
        round(avg(expectancy_pct), 2) as avg_expectancy,
        round(max(expectancy_pct), 2) as max_expectancy,
        round(avg(sold_early_pct), 1) as avg_sold_early,
        round(avg(win_rate_pct), 1) as avg_win_rate
      FROM pm_wallet_copy_trading_metrics_v1
    `,
    format: 'JSONEachRow'
  })
  const stats = (await statsResult.json() as any[])[0]

  console.log(`   Total wallets: ${stats.total_wallets?.toLocaleString()}`)
  console.log(`   Positive expectancy: ${stats.positive_expectancy?.toLocaleString()} (${Math.round(stats.positive_expectancy/stats.total_wallets*100)}%)`)
  console.log(`   Taker-heavy (≤30%): ${stats.taker_heavy?.toLocaleString()} (${Math.round(stats.taker_heavy/stats.total_wallets*100)}%)`)
  console.log(`   Active last 3 days: ${stats.active_3d?.toLocaleString()} (${Math.round(stats.active_3d/stats.total_wallets*100)}%)`)
  console.log(`   Avg expectancy: ${stats.avg_expectancy}%`)
  console.log(`   Max expectancy: ${stats.max_expectancy}%`)
  console.log(`   Avg sold early: ${stats.avg_sold_early}%`)
  console.log(`   Avg win rate: ${stats.avg_win_rate}%`)

  // Copy trading candidates count
  const candidatesResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_wallet_copy_trading_metrics_v1
      WHERE maker_pct <= 30
        AND toDate(last_trade_time) >= today() - 3
        AND expectancy_pct > 0
        AND pct_wins_over_100 > 20
        AND total_trades >= 20
    `,
    format: 'JSONEachRow'
  })
  const candidates = (await candidatesResult.json() as any[])[0]
  console.log(`\n🎯 Copy trading candidates: ${candidates.cnt}`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
