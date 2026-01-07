/**
 * Edge Hunt v3 - Use Pre-Computed Metrics Only
 *
 * Fast approach: Use ONLY pm_copy_trading_metrics_v1
 * No additional queries per wallet
 *
 * @author Claude (Edge Detection Approach)
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { clickhouse } from '@/lib/clickhouse/client'

// System wallets to exclude
const SYSTEM_WALLETS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
  '0x0000000000000000000000000000000000000000',
]

async function runEdgeHunt() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗')
  console.log('║           EDGE DETECTION HUNT v3 - PRE-COMPUTED ONLY              ║')
  console.log('╠═══════════════════════════════════════════════════════════════════╣')
  console.log('║ Uses only pm_copy_trading_metrics_v1 - no per-wallet queries      ║')
  console.log('╚═══════════════════════════════════════════════════════════════════╝')
  console.log()

  // Get ALL candidates from pre-computed metrics
  // Use edge_ratio (already computed) as a proxy for skill
  // High win_rate + low avg_loss = good edge
  console.log('📊 Loading wallets from pm_copy_trading_metrics_v1...')

  const query = `
    SELECT
      wallet_address as wallet,
      realized_pnl,
      total_pnl,
      volume_usd,
      total_trades,
      positions_count,
      resolved_positions,
      win_count,
      loss_count,
      win_rate,
      avg_win_pct,
      avg_loss_pct,
      breakeven_wr,
      edge_ratio,
      pnl_confidence,
      external_sell_ratio,
      -- Win/Loss asymmetry (bigger wins than losses)
      abs(avg_win_pct) / NULLIF(abs(avg_loss_pct), 0) as win_loss_asymmetry,
      -- Estimate trades per day from total_trades (assume 90 day window)
      total_trades / 90.0 as trades_per_day
    FROM pm_copy_trading_metrics_v1
    WHERE
      -- Filters
      realized_pnl > 500                                    -- At least $500 realized profit
      AND positions_count >= 20                              -- Statistical significance
      AND win_rate > 0.5                                     -- Better than coin flip
      AND win_rate < 0.95                                    -- Not suspicious (arber)
      AND is_copyable = 1                                    -- Already passed copyability
      AND lower(pnl_confidence) IN ('high', 'medium')        -- Trust the data (lowercase!)
      AND wallet_address NOT IN (${SYSTEM_WALLETS.map((w) => `'${w}'`).join(',')})
      AND edge_ratio > 0                                     -- Has positive edge
      AND edge_ratio < 1000000                               -- Exclude infinity bugs
    ORDER BY realized_pnl DESC
    LIMIT 200
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })
  const wallets = (await result.json()) as any[]

  console.log(`Found ${wallets.length} candidate wallets`)
  console.log()

  // Score and rank
  interface ScoredWallet {
    rank: number
    wallet: string
    realized_pnl: number
    win_rate: number
    positions: number
    trades_per_day: number
    win_loss_asymmetry: number
    edge_ratio: number
    composite_score: number
  }

  const scored: ScoredWallet[] = []

  for (const w of wallets) {
    // My edge score formula:
    // 1. Higher win rate = better (but not too high - that's suspicious)
    // 2. Win/loss asymmetry (bigger wins than losses) = better
    // 3. Lower trades per day = more copyable
    // 4. Higher PnL = proven track record
    // 5. Edge ratio (win_rate / breakeven_wr) = measures skill

    const normalizedWinRate = Math.max(0, (w.win_rate - 0.5) * 2) // 0.5->0, 1.0->1
    const normalizedAsymmetry = Math.min(1, (w.win_loss_asymmetry || 1) / 3) // Cap at 3x
    const copyabilityScore = w.trades_per_day < 10 ? 1 : w.trades_per_day < 30 ? 0.5 : 0
    const normalizedPnl = Math.min(1, w.realized_pnl / 10000) // Cap at $10k
    const normalizedEdgeRatio = Math.min(1, (w.edge_ratio - 1) / 0.5) // 1.0->0, 1.5+->1

    // Weighted composite
    const compositeScore =
      0.25 * normalizedWinRate +
      0.25 * normalizedAsymmetry +
      0.2 * copyabilityScore +
      0.15 * normalizedPnl +
      0.15 * normalizedEdgeRatio

    scored.push({
      rank: 0,
      wallet: w.wallet,
      realized_pnl: parseFloat(w.realized_pnl),
      win_rate: parseFloat(w.win_rate),
      positions: parseInt(w.positions_count),
      trades_per_day: parseFloat(w.trades_per_day),
      win_loss_asymmetry: parseFloat(w.win_loss_asymmetry) || 1,
      edge_ratio: parseFloat(w.edge_ratio),
      composite_score: compositeScore,
    })
  }

  // Sort by composite score
  scored.sort((a, b) => b.composite_score - a.composite_score)
  scored.forEach((s, i) => (s.rank = i + 1))

  // Print leaderboard
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════╗')
  console.log('║                              EDGE DETECTION LEADERBOARD - TOP 30                               ║')
  console.log('╠════════════════════════════════════════════════════════════════════════════════════════════════╣')
  console.log('║ Rank │ Wallet                                     │ PnL       │ WinRate │ W/L   │ TPD  │ Score ║')
  console.log('╠══════╪════════════════════════════════════════════╪═══════════╪═════════╪═══════╪══════╪═══════╣')

  for (const s of scored.slice(0, 30)) {
    const row = [
      String(s.rank).padStart(4),
      s.wallet.padEnd(42),
      `$${s.realized_pnl.toFixed(0)}`.padStart(9),
      `${(s.win_rate * 100).toFixed(0)}%`.padStart(7),
      s.win_loss_asymmetry.toFixed(1).padStart(5),
      s.trades_per_day.toFixed(1).padStart(4),
      s.composite_score.toFixed(3).padStart(5),
    ].join(' │ ')
    console.log(`║ ${row} ║`)
  }

  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝')

  console.log()
  console.log('Legend: W/L = Win/Loss Asymmetry (higher = bigger wins than losses), TPD = Trades Per Day')
  console.log()

  // Save results
  const fs = await import('fs')
  const resultsPath = '/Users/scotty/Projects/Cascadian-app/scripts/experimental/results/edge-leaderboard.json'
  fs.mkdirSync('/Users/scotty/Projects/Cascadian-app/scripts/experimental/results', { recursive: true })
  fs.writeFileSync(resultsPath, JSON.stringify(scored, null, 2))
  console.log(`📁 Results saved to: ${resultsPath}`)

  // Top 5 for Playwright verification
  console.log()
  console.log('🎯 TOP 5 WALLETS FOR PLAYWRIGHT VERIFICATION:')
  for (const s of scored.slice(0, 5)) {
    console.log(`   ${s.rank}. ${s.wallet}`)
    console.log(`      PnL: $${s.realized_pnl.toFixed(0)} | Win Rate: ${(s.win_rate * 100).toFixed(0)}% | Trades/Day: ${s.trades_per_day.toFixed(1)}`)
    console.log(`      Polymarket: https://polymarket.com/profile/${s.wallet}`)
    console.log()
  }

  return scored
}

// Run
runEdgeHunt()
  .then((results) => {
    console.log(`✅ Hunt complete! Found ${results.length} copyable wallets.`)
    process.exit(0)
  })
  .catch((error) => {
    console.error('Hunt failed:', error)
    process.exit(1)
  })
