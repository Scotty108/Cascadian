/**
 * Simulate Copy Trading Returns - 2 Week Backtest
 *
 * For each top wallet, calculate what $1 per trade would have returned
 * if we had copy-traded them over the last 14 days.
 *
 * @author Claude (Edge Detection Approach)
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { clickhouse } from '@/lib/clickhouse/client'

// Top wallets from our edge detection hunt
const TOP_WALLETS = [
  { rank: 4, wallet: '0x4044798f1d60d92369c86cf5b6f1e497e2818de5', note: 'GOLDMINE - all copyable entries' },
  { rank: 1, wallet: '0x1e62e1e8ab58b631ebca23f3027e94df0e36dad4', note: '@isunou - 83% WR but high entry' },
  { rank: 2, wallet: '0xc4a08effa3ff5056f96e0e051c7c8d8e19d47a3d', note: 'High W/L asymmetry' },
  { rank: 3, wallet: '0xd52ee3a3f8ff7ac23e636ff47da4ef58d6b01ccc', note: 'High edge ratio' },
  { rank: 5, wallet: '0x78d0f71aa3e3cc6e9db56e41e58bb07c3763fa64', note: 'Check entry prices' },
]

interface Trade {
  event_id: string
  side: string
  usdc: number
  tokens: number
  entry_price: number
  trade_time: string
  token_id: string
}

interface SimulationResult {
  wallet: string
  note: string
  total_trades: number
  copyable_trades: number
  total_invested: number
  total_return: number
  roi_percent: number
  wins: number
  losses: number
  pending: number
  avg_entry_price: number
  trades_detail: {
    side: string
    entry_price: number
    usdc: number
    trade_time: string
    status: string
    pnl?: number
  }[]
}

async function getWalletTrades(wallet: string): Promise<Trade[]> {
  // Subquery: dedupe first, then filter by time
  const query = `
    SELECT * FROM (
      SELECT
        event_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(usdc_amount) / NULLIF(any(token_amount), 0) as entry_price,
        any(trade_time) as trade_time,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
      GROUP BY event_id
    )
    WHERE trade_time >= now() - INTERVAL 14 DAY
    ORDER BY trade_time ASC
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  return await result.json() as Trade[]
}

async function getTokenResolutions(tokenIds: string[]): Promise<Map<string, { resolved: boolean, winning_outcome: number }>> {
  if (tokenIds.length === 0) return new Map()

  // Get token -> condition mapping and resolution status
  const query = `
    SELECT
      m.token_id_dec as token_id,
      m.condition_id,
      m.outcome_index,
      r.payout_numerators,
      r.resolved_at,
      CASE
        WHEN r.resolved_at IS NULL THEN 'pending'
        ELSE 'resolved'
      END as status
    FROM pm_token_to_condition_map_v5 m
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
    WHERE m.token_id_dec IN (${tokenIds.map(t => `'${t}'`).join(',')})
  `

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' })
    const rows = await result.json() as any[]

    const resolutions = new Map<string, { resolved: boolean, winning_outcome: number }>()
    for (const row of rows) {
      const payouts = row.payout_numerators?.replace(/[\[\]]/g, '').split(',').map(Number) || []
      const winningOutcome = payouts.indexOf(Math.max(...payouts))
      resolutions.set(row.token_id, {
        resolved: row.status === 'resolved',
        winning_outcome: winningOutcome
      })
    }
    return resolutions
  } catch (e) {
    console.error('Error getting resolutions:', e)
    return new Map()
  }
}

async function simulateWallet(wallet: string, note: string): Promise<SimulationResult> {
  const trades = await getWalletTrades(wallet)

  // Get resolutions for all tokens
  const tokenIds = [...new Set(trades.map(t => t.token_id))]
  const resolutions = await getTokenResolutions(tokenIds)

  let copyable_trades = 0
  let total_invested = 0
  let total_return = 0
  let wins = 0
  let losses = 0
  let pending = 0
  let sum_entry_price = 0
  const trades_detail: SimulationResult['trades_detail'] = []

  for (const trade of trades) {
    const entry_price = parseFloat(String(trade.entry_price))

    // Skip if entry price > 85¢ (not copyable due to 12s delay)
    if (entry_price > 0.85) {
      trades_detail.push({
        side: trade.side,
        entry_price,
        usdc: parseFloat(String(trade.usdc)),
        trade_time: trade.trade_time,
        status: 'skipped (>85¢)'
      })
      continue
    }

    copyable_trades++
    sum_entry_price += entry_price

    // $1 equal-weight per trade
    const investment = 1.0
    total_invested += investment

    const resolution = resolutions.get(trade.token_id)

    if (!resolution || !resolution.resolved) {
      pending++
      trades_detail.push({
        side: trade.side,
        entry_price,
        usdc: parseFloat(String(trade.usdc)),
        trade_time: trade.trade_time,
        status: 'pending'
      })
      continue
    }

    // Calculate PnL
    // For BUY: if outcome_index matches winning_outcome, we won
    // Token is YES token (outcome_index = 0) by convention for most tokens
    // If winning_outcome = 0, YES won, BUY wins
    // If winning_outcome = 1, NO won, SELL wins

    const isBuy = trade.side === 'buy'
    const yesWon = resolution.winning_outcome === 0

    let pnl = 0
    if (isBuy) {
      if (yesWon) {
        // Bought YES, YES won: payout = $1, cost = entry_price
        pnl = (1.0 / entry_price) * investment - investment
        wins++
      } else {
        // Bought YES, NO won: payout = $0
        pnl = -investment
        losses++
      }
    } else {
      // SELL = betting against YES
      if (!yesWon) {
        // Sold YES (bet NO), NO won: payout = (1 - entry_price) worth
        pnl = ((1.0 - entry_price) / entry_price) * investment
        wins++
      } else {
        // Sold YES, YES won: loss
        pnl = -investment
        losses++
      }
    }

    total_return += pnl
    trades_detail.push({
      side: trade.side,
      entry_price,
      usdc: parseFloat(String(trade.usdc)),
      trade_time: trade.trade_time,
      status: yesWon ? (isBuy ? 'WIN' : 'LOSS') : (isBuy ? 'LOSS' : 'WIN'),
      pnl
    })
  }

  const roi_percent = total_invested > 0 ? (total_return / total_invested) * 100 : 0
  const avg_entry_price = copyable_trades > 0 ? sum_entry_price / copyable_trades : 0

  return {
    wallet,
    note,
    total_trades: trades.length,
    copyable_trades,
    total_invested,
    total_return,
    roi_percent,
    wins,
    losses,
    pending,
    avg_entry_price,
    trades_detail
  }
}

async function runSimulation() {
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗')
  console.log('║           COPY TRADING SIMULATION - 14 DAY BACKTEST ($1 PER TRADE)                   ║')
  console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣')
  console.log('║ Rules: Skip trades >85¢ (12s delay), $1 equal-weight per copyable trade              ║')
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝')
  console.log()

  const results: SimulationResult[] = []

  for (const { rank, wallet, note } of TOP_WALLETS) {
    console.log(`\n📊 Simulating Wallet #${rank}: ${wallet.slice(0, 10)}... (${note})`)

    try {
      const result = await simulateWallet(wallet, note)
      results.push(result)

      console.log(`   Trades: ${result.total_trades} total, ${result.copyable_trades} copyable`)
      console.log(`   Results: ${result.wins} wins, ${result.losses} losses, ${result.pending} pending`)
      console.log(`   Invested: $${result.total_invested.toFixed(2)} | Return: $${result.total_return.toFixed(2)}`)
      console.log(`   ROI: ${result.roi_percent >= 0 ? '+' : ''}${result.roi_percent.toFixed(1)}%`)
      console.log(`   Avg Entry: ${(result.avg_entry_price * 100).toFixed(0)}¢`)
    } catch (error) {
      console.error(`   ERROR: ${error}`)
    }
  }

  // Sort by ROI
  results.sort((a, b) => b.roi_percent - a.roi_percent)

  // Print leaderboard
  console.log()
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════╗')
  console.log('║                              SIMULATION LEADERBOARD - 14 DAY ROI                                          ║')
  console.log('╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════╣')
  console.log('║ Rank │ Wallet              │ Trades │ W/L/P       │ Invested │ Return   │ ROI      │ AvgEntry ║')
  console.log('╠══════╪═════════════════════╪════════╪═════════════╪══════════╪══════════╪══════════╪══════════╣')

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const row = [
      String(i + 1).padStart(4),
      r.wallet.slice(0, 18).padEnd(18),
      String(r.copyable_trades).padStart(6),
      `${r.wins}/${r.losses}/${r.pending}`.padStart(11),
      `$${r.total_invested.toFixed(0)}`.padStart(8),
      `$${r.total_return.toFixed(2)}`.padStart(8),
      `${r.roi_percent >= 0 ? '+' : ''}${r.roi_percent.toFixed(1)}%`.padStart(8),
      `${(r.avg_entry_price * 100).toFixed(0)}¢`.padStart(8),
    ].join(' │ ')
    console.log(`║ ${row} ║`)
  }

  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════╝')

  // Show trade details for top performer
  if (results.length > 0) {
    const top = results[0]
    console.log()
    console.log(`📋 TOP PERFORMER TRADE DETAILS: ${top.wallet.slice(0, 18)}...`)
    console.log(`   Note: ${top.note}`)
    console.log()

    const resolved = top.trades_detail.filter(t => t.status !== 'pending' && !t.status.includes('skipped'))
    for (const t of resolved.slice(0, 10)) {
      const pnlStr = t.pnl !== undefined ? `$${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` : ''
      console.log(`   ${t.status.padEnd(8)} | ${t.side.padEnd(4)} @ ${(t.entry_price * 100).toFixed(0)}¢ | ${pnlStr.padStart(7)} | ${t.trade_time}`)
    }
  }

  // Save results
  const fs = await import('fs')
  const resultsPath = '/Users/scotty/Projects/Cascadian-app/scripts/experimental/results/simulation-results.json'
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2))
  console.log(`\n📁 Full results saved to: ${resultsPath}`)

  return results
}

runSimulation()
  .then(() => {
    console.log('\n✅ Simulation complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Simulation failed:', error)
    process.exit(1)
  })
