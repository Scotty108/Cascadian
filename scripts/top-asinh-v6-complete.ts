#!/usr/bin/env npx tsx
/**
 * V6 Complete: FIFO matching + Win/Loss quality metrics
 *
 * Adds:
 * - avg_win_roi_pct: Average ROI on winning trades
 * - avg_loss_roi_pct: Average ROI on losing trades
 * - win_loss_ratio: avg_win / |avg_loss| (want > 1)
 * - expectancy_pct: (win_rate × avg_win) - (loss_rate × |avg_loss|)
 * - maker_pct: Percentage of trades as maker
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'
import { writeFileSync, appendFileSync, readFileSync } from 'fs'

interface WalletResult {
  wallet: string
  trades: number
  wins: number
  losses: number
  win_rate_pct: number

  // Win/Loss quality metrics
  avg_win_roi_pct: number
  avg_loss_roi_pct: number
  win_loss_ratio: number
  expectancy_pct: number

  // Core metrics
  asinh_score: number
  roi_per_trade_pct: number
  total_profit: number

  // Context
  markets_traded: number
  sold_early: number
  held_to_resolution: number
  maker_pct: number
  last_trade: string
}

interface Buy {
  wallet: string
  condition_id: string
  outcome_index: number
  entry_time: Date
  entry_price: number
  tokens: number
  resolution_price: number
  resolved_at: Date
  is_maker: number
}

interface Sell {
  time: Date
  price: number
  tokens: number
}

async function main() {
  const startTime = Date.now()
  console.log('🔧 V6 Complete: FIFO + Win/Loss Quality Metrics')
  console.log('')

  // Get target wallets
  console.log('📊 Querying target wallets...')
  const walletQuery = `
    SELECT wallet
    FROM pm_canonical_fills_v4 f
    JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
    WHERE f.tokens_delta > 0
      AND f.event_time >= now() - INTERVAL 30 DAY
      AND f.wallet != '0x0000000000000000000000000000000000000000'
      AND abs(f.usdc_delta / f.tokens_delta) BETWEEN 0.02 AND 0.98
    GROUP BY wallet
    HAVING count() >= 5 AND count() <= 10000 AND uniqExact(f.condition_id) >= 2
  `
  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' })
  const wallets = (await walletResult.json() as {wallet: string}[]).map(w => w.wallet)
  console.log(`   Found ${wallets.length.toLocaleString()} target wallets`)
  console.log('')

  // Output file
  const outputPath = './data/top-asinh-v6-complete.jsonl'
  writeFileSync(outputPath, '')

  // Process in chunks
  const chunkSize = 500
  let totalProcessed = 0
  let totalWithScores = 0

  console.log(`📦 Processing in ${Math.ceil(wallets.length / chunkSize)} chunks...`)
  console.log('')

  for (let i = 0; i < wallets.length; i += chunkSize) {
    const chunk = wallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(wallets.length / chunkSize)
    const pct = Math.round((i / wallets.length) * 100)

    process.stdout.write(`\r   Chunk ${chunkNum}/${totalChunks} (${pct}%) | Scored: ${totalWithScores.toLocaleString()}`)

    try {
      // Get buys with token amounts and maker flag
      const buysQuery = `
        SELECT
          f.wallet,
          f.condition_id,
          f.outcome_index,
          f.event_time as entry_time,
          abs(f.usdc_delta / f.tokens_delta) as entry_price,
          f.tokens_delta as tokens,
          toFloat64(JSONExtractInt(r.payout_numerators, f.outcome_index + 1) >= 1) as resolution_price,
          r.resolved_at,
          f.is_maker
        FROM pm_canonical_fills_v4 f
        JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
        WHERE f.tokens_delta > 0
          AND f.event_time >= now() - INTERVAL 30 DAY
          AND f.wallet IN (${walletList})
          AND abs(f.usdc_delta / f.tokens_delta) BETWEEN 0.02 AND 0.98
        ORDER BY f.wallet, f.condition_id, f.outcome_index, f.event_time
      `

      // Get sells with token amounts
      const sellsQuery = `
        SELECT
          wallet,
          condition_id,
          outcome_index,
          event_time as sell_time,
          abs(usdc_delta / tokens_delta) as sell_price,
          abs(tokens_delta) as tokens
        FROM pm_canonical_fills_v4
        WHERE tokens_delta < 0
          AND event_time >= now() - INTERVAL 30 DAY
          AND wallet IN (${walletList})
        ORDER BY wallet, condition_id, outcome_index, event_time
      `

      const [buysResult, sellsResult] = await Promise.all([
        clickhouse.query({ query: buysQuery, format: 'JSONEachRow' }),
        clickhouse.query({ query: sellsQuery, format: 'JSONEachRow' })
      ])

      const buysText = await buysResult.text()
      const sellsText = await sellsResult.text()

      interface RawBuy {
        wallet: string
        condition_id: string
        outcome_index: number
        entry_time: string
        entry_price: number
        tokens: number
        resolution_price: number
        resolved_at: string
        is_maker: number
      }

      interface RawSell {
        wallet: string
        condition_id: string
        outcome_index: number
        sell_time: string
        sell_price: number
        tokens: number
      }

      const rawBuys: RawBuy[] = buysText.trim().split('\n').filter(l => l).map(l => JSON.parse(l))
      const rawSells: RawSell[] = sellsText.trim().split('\n').filter(l => l).map(l => JSON.parse(l))

      // Build sells map: wallet:condition:outcome -> array of {time, price, tokens}
      const sellsMap = new Map<string, Sell[]>()
      for (const s of rawSells) {
        const key = `${s.wallet}:${s.condition_id}:${s.outcome_index}`
        if (!sellsMap.has(key)) sellsMap.set(key, [])
        sellsMap.get(key)!.push({
          time: new Date(s.sell_time),
          price: s.sell_price,
          tokens: s.tokens
        })
      }

      // Process buys with proper FIFO token matching
      const buys: Buy[] = rawBuys.map(b => ({
        wallet: b.wallet,
        condition_id: b.condition_id,
        outcome_index: b.outcome_index,
        entry_time: new Date(b.entry_time),
        entry_price: b.entry_price,
        tokens: b.tokens,
        resolution_price: b.resolution_price,
        resolved_at: new Date(b.resolved_at),
        is_maker: b.is_maker
      }))

      // Track sell consumption per position
      const sellConsumption = new Map<string, number>() // key -> index of first unconsumed sell

      interface TradeResult {
        wallet: string
        condition_id: string
        entry_time: Date
        roi: number
        soldEarly: boolean
        is_maker: number
      }

      const trades: TradeResult[] = []

      for (const buy of buys) {
        const key = `${buy.wallet}:${buy.condition_id}:${buy.outcome_index}`
        const sells = sellsMap.get(key) || []

        // Get or initialize consumption index for this position
        if (!sellConsumption.has(key)) sellConsumption.set(key, 0)
        let sellIdx = sellConsumption.get(key)!

        let remainingTokens = buy.tokens
        let totalExitValue = 0
        let tokensSoldEarly = 0

        // FIFO match: consume sells that occurred after this buy but before resolution
        while (remainingTokens > 0.0001 && sellIdx < sells.length) {
          const sell = sells[sellIdx]

          // Only use sells that are after entry and before resolution
          if (sell.time <= buy.entry_time) {
            sellIdx++
            continue
          }
          if (sell.time >= buy.resolved_at) {
            break
          }

          // How many tokens can this sell consume from this buy?
          const tokensToConsume = Math.min(remainingTokens, sell.tokens)

          totalExitValue += tokensToConsume * sell.price
          tokensSoldEarly += tokensToConsume
          remainingTokens -= tokensToConsume

          // Reduce sell's available tokens (for next buys)
          sell.tokens -= tokensToConsume

          // If this sell is fully consumed, move to next
          if (sell.tokens < 0.0001) {
            sellIdx++
          }
        }

        // Update consumption index
        sellConsumption.set(key, sellIdx)

        // Remaining tokens held to resolution
        if (remainingTokens > 0.0001) {
          totalExitValue += remainingTokens * buy.resolution_price
        }

        // Calculate weighted average exit price
        const avgExitPrice = totalExitValue / buy.tokens
        const roi = (avgExitPrice - buy.entry_price) / buy.entry_price

        trades.push({
          wallet: buy.wallet,
          condition_id: buy.condition_id,
          entry_time: buy.entry_time,
          roi,
          soldEarly: tokensSoldEarly > buy.tokens * 0.5, // >50% sold early counts as "sold early"
          is_maker: buy.is_maker
        })
      }

      // Aggregate by wallet
      const walletAgg = new Map<string, TradeResult[]>()
      for (const t of trades) {
        if (!walletAgg.has(t.wallet)) walletAgg.set(t.wallet, [])
        walletAgg.get(t.wallet)!.push(t)
      }

      for (const [wallet, walletTrades] of walletAgg) {
        if (walletTrades.length < 5) continue

        const numTrades = walletTrades.length
        const winningTrades = walletTrades.filter(t => t.roi > 0)
        const losingTrades = walletTrades.filter(t => t.roi <= 0)
        const wins = winningTrades.length
        const losses = losingTrades.length
        const winRate = Math.round((wins / numTrades) * 1000) / 10

        // Win/Loss quality metrics
        const avgWinRoi = wins > 0
          ? Math.round(winningTrades.reduce((sum, t) => sum + t.roi, 0) / wins * 10000) / 100
          : 0
        const avgLossRoi = losses > 0
          ? Math.round(Math.abs(losingTrades.reduce((sum, t) => sum + t.roi, 0) / losses) * 10000) / 100
          : 0
        const winLossRatio = avgLossRoi > 0
          ? Math.round(avgWinRoi / avgLossRoi * 100) / 100
          : (avgWinRoi > 0 ? 999 : 0)

        // Expectancy = (win_rate × avg_win) - (loss_rate × avg_loss)
        const expectancy = Math.round(
          ((wins / numTrades) * avgWinRoi - (losses / numTrades) * avgLossRoi) * 100
        ) / 100

        // Core metrics
        const asinhScore = Math.round(
          walletTrades.reduce((sum, t) => sum + Math.asinh(t.roi), 0) / numTrades * 10000
        ) / 10000
        const totalProfit = Math.round(walletTrades.reduce((sum, t) => sum + t.roi, 0) * 100) / 100
        const roiPerTrade = Math.round(totalProfit / numTrades * 10000) / 100

        // Context
        const markets = new Set(walletTrades.map(t => t.condition_id)).size
        const soldEarly = walletTrades.filter(t => t.soldEarly).length
        const heldToRes = numTrades - soldEarly
        const makerPct = Math.round(walletTrades.filter(t => t.is_maker === 1).length / numTrades * 1000) / 10
        const lastTrade = walletTrades.reduce(
          (max, t) => t.entry_time > max ? t.entry_time : max,
          new Date(0)
        ).toISOString().slice(0, 19).replace('T', ' ')

        const result: WalletResult = {
          wallet,
          trades: numTrades,
          wins,
          losses,
          win_rate_pct: winRate,
          avg_win_roi_pct: avgWinRoi,
          avg_loss_roi_pct: avgLossRoi,
          win_loss_ratio: winLossRatio,
          expectancy_pct: expectancy,
          asinh_score: asinhScore,
          roi_per_trade_pct: roiPerTrade,
          total_profit: totalProfit,
          markets_traded: markets,
          sold_early: soldEarly,
          held_to_resolution: heldToRes,
          maker_pct: makerPct,
          last_trade: lastTrade
        }
        appendFileSync(outputPath, JSON.stringify(result) + '\n')
        totalWithScores++
      }

      totalProcessed += chunk.length
    } catch (err: any) {
      console.error(`\n   ⚠️ Chunk ${chunkNum} error: ${err.message.slice(0, 100)}`)
    }
  }

  console.log(`\n   ✅ Processed ${totalProcessed.toLocaleString()} wallets, ${totalWithScores.toLocaleString()} with scores`)

  // Load and sort results
  console.log('\n📦 Sorting results...')
  const lines = readFileSync(outputPath, 'utf-8').trim().split('\n').filter(l => l)
  const results: WalletResult[] = lines.map(l => JSON.parse(l))
  results.sort((a, b) => b.asinh_score - a.asinh_score)

  // Save sorted JSON
  writeFileSync('./data/top-asinh-v6-final.json', JSON.stringify(results, null, 2))

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n💾 Saved ${results.length.toLocaleString()} results to ./data/top-asinh-v6-final.json`)
  console.log(`⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)

  // Print top 20 with new metrics
  console.log('\n' + '═'.repeat(120))
  console.log('TOP 20 WALLETS BY ASINH SCORE (V6 - With Win/Loss Quality)')
  console.log('═'.repeat(120))
  console.log('Wallet          | Trades | Win%  | AvgWin | AvgLoss | W/L Ratio | Expect | Asinh  | ROI/Trade')
  console.log('-'.repeat(120))

  results.slice(0, 20).forEach((row, i) => {
    console.log(
      `#${String(i+1).padStart(2)} ${row.wallet.slice(0,10)}.. | ` +
      `${String(row.trades).padStart(5)} | ` +
      `${row.win_rate_pct.toFixed(1).padStart(5)}% | ` +
      `${row.avg_win_roi_pct.toFixed(0).padStart(6)}% | ` +
      `${row.avg_loss_roi_pct.toFixed(0).padStart(6)}% | ` +
      `${row.win_loss_ratio.toFixed(1).padStart(9)}x | ` +
      `${row.expectancy_pct.toFixed(0).padStart(6)}% | ` +
      `${row.asinh_score.toFixed(3).padStart(6)} | ` +
      `${row.roi_per_trade_pct.toFixed(0).padStart(8)}%`
    )
  })

  // Summary stats
  console.log('\n' + '═'.repeat(80))
  console.log('QUALITY FILTER: Wallets where Avg Win > Avg Loss (W/L Ratio > 1)')
  console.log('═'.repeat(80))

  const qualityWallets = results.filter(r => r.win_loss_ratio > 1)
  console.log(`   ${qualityWallets.length.toLocaleString()} / ${results.length.toLocaleString()} wallets have W/L ratio > 1`)

  const top20Quality = qualityWallets.slice(0, 20)
  console.log('\nTop 20 by Asinh where W/L > 1:')
  top20Quality.forEach((row, i) => {
    console.log(
      `#${String(i+1).padStart(2)} ${row.wallet.slice(0,10)}.. | ` +
      `${String(row.trades).padStart(4)} trades | ` +
      `${row.win_rate_pct.toFixed(1)}% win | ` +
      `W/L: ${row.win_loss_ratio.toFixed(1)}x | ` +
      `Expect: ${row.expectancy_pct.toFixed(0)}% | ` +
      `Asinh: ${row.asinh_score.toFixed(3)}`
    )
  })
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
