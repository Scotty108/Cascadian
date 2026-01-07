/**
 * Edge Hunt v1 - Find Copy-Tradable Wallets via Edge Detection
 *
 * Different approach from other Claude's copy-hunt-v1.ts:
 * - Measures SKILL vs LUCK by comparing entry price to closing price
 * - Entry Edge = closing_price - entry_price (positive = found mispriced market)
 * - Risk-adjusted with max drawdown < 20%, Sharpe > 1.0
 *
 * @author Claude (Edge Detection Approach)
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { clickhouse } from '@/lib/clickhouse/client'

// ============================================================================
// Types
// ============================================================================

interface WalletEdgeMetrics {
  wallet: string
  // Edge metrics
  avg_entry_edge: number // avg(closing_price - entry_price) for winning positions
  edge_consistency: number // 1 - stddev/mean (0-1, higher = more consistent)
  // Traditional metrics
  win_rate: number
  avg_entry_price: number
  total_positions: number
  resolved_positions: number
  // Risk metrics
  sharpe_ratio: number | null
  max_drawdown: number | null
  // Copyability
  avg_trade_size: number
  trades_per_day: number
  is_copyable: boolean
}

interface LeaderboardEntry extends WalletEdgeMetrics {
  rank: number
  composite_score: number
}

// ============================================================================
// Edge Calculation
// ============================================================================

/**
 * Calculate entry edge for a single wallet
 * Edge = how much better their entry was vs the closing price
 */
async function calculateWalletEdge(wallet: string): Promise<WalletEdgeMetrics | null> {
  try {
    // Step 1: Get all trades for this wallet with token mapping
    const tradesQuery = `
      SELECT
        event_id,
        any(t.side) as side,
        any(t.usdc_amount) / 1e6 as usdc,
        any(t.token_amount) / 1e6 as tokens,
        any(t.usdc_amount) / NULLIF(any(t.token_amount), 0) as entry_price,
        any(t.trade_time) as trade_time,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND t.is_deleted = 0
        AND t.token_amount > 0
      GROUP BY event_id
    `

    const tradesResult = await clickhouse.query({
      query: tradesQuery,
      format: 'JSONEachRow',
    })
    const trades = (await tradesResult.json()) as any[]

    if (trades.length < 20) {
      return null // Not enough trades
    }

    // Step 2: Get closing prices from pm_price_snapshots_15m
    const conditionIds = [...new Set(trades.map((t) => t.condition_id))].filter(Boolean)

    if (conditionIds.length === 0) {
      return null
    }

    // Get resolutions and closing prices
    const closingQuery = `
      SELECT
        r.condition_id,
        r.resolved_at,
        -- Determine winner: payout_numerators[1] > 0 means YES won
        arrayElement(splitByString(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', '')), 1) as yes_payout,
        p.last_price as closing_price,
        p.bucket as price_time
      FROM pm_condition_resolutions r
      LEFT JOIN (
        SELECT
          m.condition_id,
          argMax(s.last_price, s.bucket) as last_price,
          max(s.bucket) as bucket
        FROM pm_price_snapshots_15m s
        JOIN pm_token_to_condition_map_v5 m ON s.token_id = m.token_id_dec
        WHERE m.outcome_index = 0  -- YES token
        GROUP BY m.condition_id
      ) p ON lower(r.condition_id) = lower(p.condition_id)
      WHERE lower(r.condition_id) IN (${conditionIds.map((c) => `'${c.toLowerCase()}'`).join(',')})
        AND r.is_deleted = 0
    `

    const closingResult = await clickhouse.query({
      query: closingQuery,
      format: 'JSONEachRow',
    })
    const closingPrices = (await closingResult.json()) as any[]

    // Build lookup map
    const closingMap = new Map<string, { closing_price: number; yes_won: boolean }>()
    for (const cp of closingPrices) {
      const yesPayout = parseInt(cp.yes_payout || '0')
      closingMap.set(cp.condition_id.toLowerCase(), {
        closing_price: parseFloat(cp.closing_price) || 0.5,
        yes_won: yesPayout > 0,
      })
    }

    // Step 3: Calculate edge for each resolved position
    const edges: number[] = []
    const returns: number[] = []
    let wins = 0
    let losses = 0
    let totalUsd = 0

    for (const trade of trades) {
      if (!trade.condition_id) continue
      const closing = closingMap.get(trade.condition_id.toLowerCase())
      if (!closing || !closing.closing_price) continue

      const entryPrice = parseFloat(trade.entry_price)
      const closingPrice = closing.closing_price
      const side = trade.side
      const usdc = parseFloat(trade.usdc)
      totalUsd += usdc

      // Calculate edge based on side
      // For BUY (YES bet): edge = closing_price - entry_price (if YES won)
      // For SELL (effectively NO bet): edge = entry_price - closing_price (if NO won)
      let edge = 0
      let won = false

      if (side === 'buy') {
        if (closing.yes_won) {
          // Bought YES and YES won
          edge = closingPrice - entryPrice
          won = true
          returns.push((1 - entryPrice) / entryPrice) // Return on YES winning
        } else {
          // Bought YES and NO won
          edge = closingPrice - entryPrice // Usually negative
          returns.push(-1) // Lost entire stake
        }
      } else {
        // SELL = betting against YES
        if (!closing.yes_won) {
          // Sold YES (bet NO) and NO won
          edge = entryPrice - closingPrice
          won = true
          returns.push(entryPrice / (1 - entryPrice)) // Return on NO winning
        } else {
          // Sold YES and YES won
          edge = entryPrice - closingPrice // Usually negative
          returns.push(-entryPrice / (1 - entryPrice)) // Lost
        }
      }

      edges.push(edge)
      if (won) wins++
      else losses++
    }

    if (edges.length < 10) {
      return null // Not enough resolved trades
    }

    // Step 4: Calculate metrics
    const avgEdge = edges.reduce((a, b) => a + b, 0) / edges.length
    const edgeStddev = Math.sqrt(edges.reduce((a, b) => a + Math.pow(b - avgEdge, 2), 0) / edges.length)
    const edgeConsistency = avgEdge > 0 ? Math.max(0, 1 - edgeStddev / Math.abs(avgEdge)) : 0

    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
    const returnStddev = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length)
    const sharpe = returnStddev > 0 ? avgReturn / returnStddev : null

    // Calculate max drawdown
    let peak = 0
    let maxDrawdown = 0
    let cumulative = 0
    for (const ret of returns) {
      cumulative += ret
      peak = Math.max(peak, cumulative)
      if (peak > 0) {
        const drawdown = (peak - cumulative) / peak
        maxDrawdown = Math.max(maxDrawdown, drawdown)
      }
    }

    const winRate = wins / (wins + losses)
    const avgTradeSize = totalUsd / trades.length
    const avgEntryPrice =
      trades.filter((t) => t.side === 'buy').reduce((a, b) => a + parseFloat(b.entry_price), 0) /
      Math.max(1, trades.filter((t) => t.side === 'buy').length)

    // Get trades per day
    const firstTrade = new Date(Math.min(...trades.map((t) => new Date(t.trade_time).getTime())))
    const lastTrade = new Date(Math.max(...trades.map((t) => new Date(t.trade_time).getTime())))
    const daysDiff = Math.max(1, (lastTrade.getTime() - firstTrade.getTime()) / (1000 * 60 * 60 * 24))
    const tradesPerDay = trades.length / daysDiff

    // Copyability checks
    const isCopyable =
      avgEntryPrice < 0.85 && // Not arbing at 98-99¢
      tradesPerDay <= 50 && // Not HFT
      avgTradeSize >= 10 // Not micro-betting

    return {
      wallet,
      avg_entry_edge: avgEdge,
      edge_consistency: edgeConsistency,
      win_rate: winRate,
      avg_entry_price: avgEntryPrice,
      total_positions: trades.length,
      resolved_positions: edges.length,
      sharpe_ratio: sharpe,
      max_drawdown: maxDrawdown,
      avg_trade_size: avgTradeSize,
      trades_per_day: tradesPerDay,
      is_copyable: isCopyable,
    }
  } catch (error) {
    console.error(`Error calculating edge for ${wallet}:`, error)
    return null
  }
}

// ============================================================================
// Main Hunt
// ============================================================================

async function runEdgeHunt() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗')
  console.log('║           EDGE DETECTION HUNT v1 - SKILL vs LUCK                  ║')
  console.log('╠═══════════════════════════════════════════════════════════════════╣')
  console.log('║ Approach: Entry Price vs Closing Price = TRUE EDGE                ║')
  console.log('║ Filter: max_drawdown < 20%, Sharpe > 1.0, copyable                ║')
  console.log('╚═══════════════════════════════════════════════════════════════════╝')
  console.log()

  // Step 1: Get candidate wallets from universe
  console.log('📊 Loading candidate wallets from universe...')

  const candidatesQuery = `
    SELECT DISTINCT wallet
    FROM pm_wallet_leaderboard_universe_v2
    WHERE realized_pnl > 100  -- At least $100 realized profit
    ORDER BY realized_pnl DESC
    LIMIT 500
  `

  const candidatesResult = await clickhouse.query({
    query: candidatesQuery,
    format: 'JSONEachRow',
  })
  const candidates = (await candidatesResult.json()) as { wallet: string }[]

  console.log(`Found ${candidates.length} candidate wallets`)
  console.log()

  // Step 2: Calculate edge for each wallet
  const leaderboard: LeaderboardEntry[] = []
  let processed = 0

  console.log('🔍 Calculating edge metrics...')
  console.log()

  for (const { wallet } of candidates) {
    const metrics = await calculateWalletEdge(wallet)
    processed++

    if (metrics && metrics.is_copyable) {
      // Apply filters
      const passesDrawdown = metrics.max_drawdown !== null && metrics.max_drawdown < 0.2
      const passesSharpe = metrics.sharpe_ratio !== null && metrics.sharpe_ratio > 1.0
      const passesEdge = metrics.avg_entry_edge > 0.02 // At least 2¢ edge

      if (passesDrawdown && passesSharpe && passesEdge) {
        // Calculate composite score
        const normalizedEdge = Math.min(1, metrics.avg_entry_edge / 0.1) // Cap at 10¢ edge
        const normalizedSharpe = Math.min(1, (metrics.sharpe_ratio || 0) / 3) // Cap at 3.0 Sharpe
        const normalizedConsistency = metrics.edge_consistency

        const compositeScore = 0.4 * normalizedEdge + 0.35 * normalizedSharpe + 0.25 * normalizedConsistency

        leaderboard.push({
          ...metrics,
          rank: 0,
          composite_score: compositeScore,
        })

        // Print update
        console.log(
          `✅ ${wallet.slice(0, 10)}... | Edge: ${(metrics.avg_entry_edge * 100).toFixed(1)}¢ | Sharpe: ${metrics.sharpe_ratio?.toFixed(2)} | DD: ${((metrics.max_drawdown || 0) * 100).toFixed(1)}%`
        )
      }
    }

    // Progress update every 50 wallets
    if (processed % 50 === 0) {
      console.log(`   Processed ${processed}/${candidates.length} wallets, found ${leaderboard.length} qualifying...`)
    }
  }

  // Step 3: Sort and rank
  leaderboard.sort((a, b) => b.composite_score - a.composite_score)
  leaderboard.forEach((entry, i) => (entry.rank = i + 1))

  // Step 4: Print final leaderboard
  console.log()
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗')
  console.log('║                      EDGE DETECTION LEADERBOARD - TOP 20                              ║')
  console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣')
  console.log('║ Rank │ Wallet              │ Edge   │ Consist │ Sharpe │ MaxDD  │ WinRate │ Score    ║')
  console.log('╠══════╪═════════════════════╪════════╪═════════╪════════╪════════╪═════════╪══════════╣')

  for (const entry of leaderboard.slice(0, 20)) {
    const row = [
      String(entry.rank).padStart(4),
      entry.wallet.slice(0, 18).padEnd(18),
      `${(entry.avg_entry_edge * 100).toFixed(1)}¢`.padStart(6),
      `${(entry.edge_consistency * 100).toFixed(0)}%`.padStart(7),
      `${entry.sharpe_ratio?.toFixed(2) || 'N/A'}`.padStart(6),
      `${((entry.max_drawdown || 0) * 100).toFixed(0)}%`.padStart(5),
      `${(entry.win_rate * 100).toFixed(0)}%`.padStart(6),
      entry.composite_score.toFixed(3).padStart(7),
    ].join(' │ ')
    console.log(`║ ${row} ║`)
  }

  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝')

  // Save results
  const fs = await import('fs')
  const resultsPath = '/Users/scotty/Projects/Cascadian-app/scripts/experimental/results/edge-leaderboard.json'
  fs.mkdirSync('/Users/scotty/Projects/Cascadian-app/scripts/experimental/results', { recursive: true })
  fs.writeFileSync(resultsPath, JSON.stringify(leaderboard, null, 2))
  console.log(`\n📁 Results saved to: ${resultsPath}`)

  return leaderboard
}

// Run the hunt
runEdgeHunt()
  .then((leaderboard) => {
    console.log(`\n✅ Hunt complete! Found ${leaderboard.length} qualifying wallets.`)
    process.exit(0)
  })
  .catch((error) => {
    console.error('Hunt failed:', error)
    process.exit(1)
  })
