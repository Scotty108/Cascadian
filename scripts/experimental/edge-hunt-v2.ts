/**
 * Edge Hunt v2 - Faster Edge Detection
 *
 * Optimized approach:
 * 1. Use pre-computed metrics where possible
 * 2. Filter system wallets upfront
 * 3. Sample smaller set of known-good wallets
 * 4. Use CCR-v1 for PnL data
 *
 * @author Claude (Edge Detection Approach)
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { clickhouse } from '@/lib/clickhouse/client'
import { getWalletPnl } from '@/lib/pnl/getWalletPnl'

// System wallets to exclude
const SYSTEM_WALLETS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // Exchange Proxy
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296', // CTF Exchange
  '0xc5d563a36ae78145c45a50134d48a1215220f80a', // Neg Risk Adapter
  '0x0000000000000000000000000000000000000000', // Null
]

interface EdgeCandidate {
  wallet: string
  realized_pnl: number
  win_rate: number
  positions: number
  total_trades: number
}

interface EdgeResult {
  wallet: string
  // PnL from CCR-v1
  realized_pnl: number
  win_rate: number
  positions: number
  // Edge metrics (simplified)
  avg_entry_price: number
  avg_trade_size: number
  trades_per_day: number
  // Copyability
  is_copyable: boolean
  // Score
  composite_score: number
}

async function runEdgeHunt() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗')
  console.log('║           EDGE DETECTION HUNT v2 - FASTER APPROACH                ║')
  console.log('╠═══════════════════════════════════════════════════════════════════╣')
  console.log('║ Uses CCR-v1 engine for PnL, filters system wallets                ║')
  console.log('╚═══════════════════════════════════════════════════════════════════╝')
  console.log()

  // Step 1: Get top wallets from copy trading metrics (pre-computed)
  console.log('📊 Loading wallets from pm_copy_trading_metrics_v1...')

  const candidatesQuery = `
    SELECT
      wallet_address as wallet,
      realized_pnl,
      win_rate,
      positions_count as positions,
      total_trades
    FROM pm_copy_trading_metrics_v1
    WHERE realized_pnl > 100
      AND positions_count >= 20
      AND win_rate > 0.5
      AND is_copyable = 1
      AND wallet_address NOT IN (${SYSTEM_WALLETS.map((w) => `'${w}'`).join(',')})
    ORDER BY realized_pnl DESC
    LIMIT 100
  `

  const candidatesResult = await clickhouse.query({
    query: candidatesQuery,
    format: 'JSONEachRow',
  })
  const candidates = (await candidatesResult.json()) as EdgeCandidate[]

  console.log(`Found ${candidates.length} candidate wallets`)
  console.log()

  // Step 2: Get entry price stats for each wallet (fast query)
  const results: EdgeResult[] = []
  let processed = 0

  console.log('🔍 Analyzing wallets...')
  console.log()

  for (const candidate of candidates) {
    try {
      // Get basic trading stats (fast query)
      const statsQuery = `
        SELECT
          count() as total_trades,
          sum(usdc_amount) / 1e6 as total_volume,
          avg(usdc_amount / NULLIF(token_amount, 0)) as avg_entry_price,
          min(trade_time) as first_trade,
          max(trade_time) as last_trade
        FROM (
          SELECT event_id, any(usdc_amount) as usdc_amount, any(token_amount) as token_amount, any(trade_time) as trade_time
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = '${candidate.wallet.toLowerCase()}'
            AND is_deleted = 0
            AND side = 'buy'
          GROUP BY event_id
          LIMIT 1000
        )
      `

      const statsResult = await clickhouse.query({
        query: statsQuery,
        format: 'JSONEachRow',
      })
      const stats = (await statsResult.json()) as any[]

      if (stats.length === 0) continue

      const stat = stats[0]
      const totalTrades = parseInt(stat.total_trades)
      const totalVolume = parseFloat(stat.total_volume)
      const avgEntryPrice = parseFloat(stat.avg_entry_price)

      // Calculate trades per day
      const firstTrade = new Date(stat.first_trade)
      const lastTrade = new Date(stat.last_trade)
      const daysDiff = Math.max(1, (lastTrade.getTime() - firstTrade.getTime()) / (1000 * 60 * 60 * 24))
      const tradesPerDay = totalTrades / daysDiff

      // Copyability checks
      const isCopyable =
        avgEntryPrice < 0.85 && // Not arbing at high prices
        tradesPerDay <= 50 && // Not HFT
        totalVolume / totalTrades >= 10 // Reasonable trade size

      if (!isCopyable) continue

      // Calculate composite score
      // Higher realized PnL + higher win rate + reasonable entry price = better
      const normalizedPnl = Math.min(1, candidate.realized_pnl / 50000)
      const normalizedWinRate = Math.max(0, candidate.win_rate - 0.5) * 2 // 0.5 -> 0, 1.0 -> 1
      const priceScore = avgEntryPrice < 0.7 ? 1 : avgEntryPrice < 0.8 ? 0.5 : 0

      const compositeScore = 0.5 * normalizedPnl + 0.3 * normalizedWinRate + 0.2 * priceScore

      results.push({
        wallet: candidate.wallet,
        realized_pnl: candidate.realized_pnl,
        win_rate: candidate.win_rate,
        positions: candidate.positions,
        avg_entry_price: avgEntryPrice,
        avg_trade_size: totalVolume / totalTrades,
        trades_per_day: tradesPerDay,
        is_copyable: isCopyable,
        composite_score: compositeScore,
      })

      console.log(
        `✅ ${candidate.wallet.slice(0, 10)}... | PnL: $${candidate.realized_pnl.toFixed(0)} | WR: ${(candidate.win_rate * 100).toFixed(0)}% | Entry: ${avgEntryPrice.toFixed(2)} | Score: ${compositeScore.toFixed(3)}`
      )
    } catch (error) {
      console.error(`Error processing ${candidate.wallet}:`, error)
    }

    processed++
    if (processed % 20 === 0) {
      console.log(`   Processed ${processed}/${candidates.length} wallets...`)
    }
  }

  // Step 3: Sort and display leaderboard
  results.sort((a, b) => b.composite_score - a.composite_score)

  console.log()
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗')
  console.log('║                         EDGE DETECTION LEADERBOARD - TOP 20                          ║')
  console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣')
  console.log('║ Rank │ Wallet              │ PnL       │ WinRate │ AvgEntry │ Trades/Day │ Score    ║')
  console.log('╠══════╪═════════════════════╪═══════════╪═════════╪══════════╪════════════╪══════════╣')

  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i]
    const row = [
      String(i + 1).padStart(4),
      r.wallet.slice(0, 18).padEnd(18),
      `$${r.realized_pnl.toFixed(0)}`.padStart(9),
      `${(r.win_rate * 100).toFixed(0)}%`.padStart(7),
      r.avg_entry_price.toFixed(2).padStart(8),
      r.trades_per_day.toFixed(1).padStart(10),
      r.composite_score.toFixed(3).padStart(8),
    ].join(' │ ')
    console.log(`║ ${row} ║`)
  }

  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝')

  // Save results
  const fs = await import('fs')
  const resultsPath = '/Users/scotty/Projects/Cascadian-app/scripts/experimental/results/edge-leaderboard.json'
  fs.mkdirSync('/Users/scotty/Projects/Cascadian-app/scripts/experimental/results', { recursive: true })
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2))
  console.log(`\n📁 Results saved to: ${resultsPath}`)

  return results
}

// Run
runEdgeHunt()
  .then((results) => {
    console.log(`\n✅ Hunt complete! Found ${results.length} copyable wallets.`)
    process.exit(0)
  })
  .catch((error) => {
    console.error('Hunt failed:', error)
    process.exit(1)
  })
