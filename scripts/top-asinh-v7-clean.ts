#!/usr/bin/env npx tsx
/**
 * V7 Clean: FIFO matching + Win distribution metrics + Clean wallet filter
 *
 * Improvements over V6:
 * - Filters for "clean" wallets (>=80% of buys are valid, not internal ops)
 * - Adds win distribution: pct_wins_over_100, pct_wins_over_500
 * - More reliable for copy trading simulation
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

  // Win quality - distribution based
  pct_wins_over_50: number   // % of wins that are >50% ROI
  pct_wins_over_100: number  // % of wins that are >100% ROI
  pct_wins_over_500: number  // % of wins that are >500% ROI
  median_win_roi_pct: number
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
  cleanliness_pct: number  // How clean the wallet is (% valid trades)
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
  console.log('🔧 V7 Clean: FIFO + Win Distribution + Clean Wallet Filter')
  console.log('')

  // Step 1: Get clean wallets (80%+ of trades are valid, not internal ops)
  console.log('🧹 Finding clean wallets (>=80% valid trades)...')
  const cleanWalletQuery = `
    SELECT
      wallet,
      countIf(abs(usdc_delta / nullIf(tokens_delta, 0)) BETWEEN 0.02 AND 0.98) as valid_buys,
      count() as total_buys,
      round(countIf(abs(usdc_delta / nullIf(tokens_delta, 0)) BETWEEN 0.02 AND 0.98) * 100.0 / count(), 1) as cleanliness_pct
    FROM pm_canonical_fills_v4
    WHERE tokens_delta > 0
      AND event_time >= now() - INTERVAL 30 DAY
      AND wallet != '0x0000000000000000000000000000000000000000'
    GROUP BY wallet
    HAVING valid_buys >= 5 AND valid_buys <= 5000  -- reasonable trade volume
      AND cleanliness_pct >= 80  -- 80%+ are real trades
  `
  const cleanResult = await clickhouse.query({ query: cleanWalletQuery, format: 'JSONEachRow' })
  const cleanWallets = new Map<string, number>()
  for (const row of await cleanResult.json() as {wallet: string, cleanliness_pct: number}[]) {
    cleanWallets.set(row.wallet, row.cleanliness_pct)
  }
  console.log(`   Found ${cleanWallets.size.toLocaleString()} clean wallets`)

  // Step 2: Filter for wallets with resolved trades
  console.log('📊 Filtering for wallets with resolved trades...')
  const walletQuery = `
    SELECT DISTINCT f.wallet
    FROM pm_canonical_fills_v4 f
    JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
    WHERE f.tokens_delta > 0
      AND f.event_time >= now() - INTERVAL 30 DAY
      AND f.wallet != '0x0000000000000000000000000000000000000000'
      AND abs(f.usdc_delta / f.tokens_delta) BETWEEN 0.02 AND 0.98
  `
  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' })
  const walletsWithTrades = new Set((await walletResult.json() as {wallet: string}[]).map(w => w.wallet))

  // Intersection: clean AND has resolved trades
  const targetWallets = [...cleanWallets.keys()].filter(w => walletsWithTrades.has(w))
  console.log(`   ${targetWallets.length.toLocaleString()} clean wallets with resolved trades`)
  console.log('')

  // Output file
  const outputPath = './data/top-asinh-v7-clean.jsonl'
  writeFileSync(outputPath, '')

  // Process in chunks
  const chunkSize = 500
  let totalProcessed = 0
  let totalWithScores = 0

  console.log(`📦 Processing in ${Math.ceil(targetWallets.length / chunkSize)} chunks...`)
  console.log('')

  for (let i = 0; i < targetWallets.length; i += chunkSize) {
    const chunk = targetWallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(targetWallets.length / chunkSize)
    const pct = Math.round((i / targetWallets.length) * 100)

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

        // Win distribution metrics
        const winRois = winningTrades.map(t => t.roi * 100) // Convert to %
        const pctWinsOver50 = wins > 0 ? Math.round(winRois.filter(r => r > 50).length / wins * 1000) / 10 : 0
        const pctWinsOver100 = wins > 0 ? Math.round(winRois.filter(r => r > 100).length / wins * 1000) / 10 : 0
        const pctWinsOver500 = wins > 0 ? Math.round(winRois.filter(r => r > 500).length / wins * 1000) / 10 : 0

        // Median win ROI
        const sortedWinRois = [...winRois].sort((a, b) => a - b)
        const medianWinRoi = wins > 0
          ? (wins % 2 === 0
            ? (sortedWinRois[wins / 2 - 1] + sortedWinRois[wins / 2]) / 2
            : sortedWinRois[Math.floor(wins / 2)])
          : 0

        // Average win/loss ROI
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
        const cleanlinessValue = cleanWallets.get(wallet) || 100
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
          pct_wins_over_50: pctWinsOver50,
          pct_wins_over_100: pctWinsOver100,
          pct_wins_over_500: pctWinsOver500,
          median_win_roi_pct: Math.round(medianWinRoi * 100) / 100,
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
          cleanliness_pct: cleanlinessValue,
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
  writeFileSync('./data/top-asinh-v7-final.json', JSON.stringify(results, null, 2))

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n💾 Saved ${results.length.toLocaleString()} results to ./data/top-asinh-v7-final.json`)
  console.log(`⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)

  // Print leaderboards
  console.log('\n' + '═'.repeat(140))
  console.log('TOP 20: TAKER-HEAVY (maker ≤30%) + HIGH WIN RATE (>50%) + BIG WINS (>50% of wins are 100%+ ROI)')
  console.log('═'.repeat(140))

  const takerHighWinBigWins = results.filter(r =>
    r.maker_pct <= 30 &&
    r.win_rate_pct > 50 &&
    r.pct_wins_over_100 > 50 &&
    r.trades >= 10
  ).slice(0, 20)

  console.log('Wallet          | Trades | Win%  | BigWin% | Med Win | Expect | Mkr% | Clean | Asinh')
  console.log('-'.repeat(140))

  takerHighWinBigWins.forEach((row, i) => {
    console.log(
      `#${String(i + 1).padStart(2)} ${row.wallet.slice(0, 10)}.. | ` +
      `${String(row.trades).padStart(5)} | ` +
      `${row.win_rate_pct.toFixed(1).padStart(5)}% | ` +
      `${row.pct_wins_over_100.toFixed(0).padStart(6)}% | ` +
      `${row.median_win_roi_pct.toFixed(0).padStart(7)}% | ` +
      `${row.expectancy_pct.toFixed(0).padStart(6)}% | ` +
      `${row.maker_pct.toFixed(0).padStart(4)}% | ` +
      `${row.cleanliness_pct.toFixed(0).padStart(5)}% | ` +
      `${row.asinh_score.toFixed(3).padStart(6)}`
    )
  })

  console.log('\n' + '═'.repeat(140))
  console.log('TOP 20: MIXED (maker 30-70%) + ACTIVE LAST 3 DAYS + POSITIVE EXPECTANCY')
  console.log('═'.repeat(140))

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const mixedActive = results.filter(r =>
    r.maker_pct > 30 && r.maker_pct < 70 &&
    r.last_trade > threeDaysAgo &&
    r.expectancy_pct > 0 &&
    r.trades >= 10
  ).slice(0, 20)

  console.log('Wallet          | Trades | Win%  | BigWin% | Med Win | Expect | Mkr% | Clean | Last Trade')
  console.log('-'.repeat(140))

  mixedActive.forEach((row, i) => {
    console.log(
      `#${String(i + 1).padStart(2)} ${row.wallet.slice(0, 10)}.. | ` +
      `${String(row.trades).padStart(5)} | ` +
      `${row.win_rate_pct.toFixed(1).padStart(5)}% | ` +
      `${row.pct_wins_over_100.toFixed(0).padStart(6)}% | ` +
      `${row.median_win_roi_pct.toFixed(0).padStart(7)}% | ` +
      `${row.expectancy_pct.toFixed(0).padStart(6)}% | ` +
      `${row.maker_pct.toFixed(0).padStart(4)}% | ` +
      `${row.cleanliness_pct.toFixed(0).padStart(5)}% | ` +
      `${row.last_trade}`
    )
  })

  // Summary stats
  console.log('\n' + '═'.repeat(80))
  console.log('SUMMARY STATISTICS')
  console.log('═'.repeat(80))
  console.log(`   Total clean wallets analyzed: ${results.length.toLocaleString()}`)
  console.log(`   Taker-heavy (maker ≤30%): ${results.filter(r => r.maker_pct <= 30).length.toLocaleString()}`)
  console.log(`   Mixed (30-70%): ${results.filter(r => r.maker_pct > 30 && r.maker_pct < 70).length.toLocaleString()}`)
  console.log(`   Maker-heavy (≥70%): ${results.filter(r => r.maker_pct >= 70).length.toLocaleString()}`)
  console.log(`   Active last 3 days: ${results.filter(r => r.last_trade > threeDaysAgo).length.toLocaleString()}`)
  console.log(`   Win rate >50%: ${results.filter(r => r.win_rate_pct > 50).length.toLocaleString()}`)
  console.log(`   >50% of wins are 100%+ ROI: ${results.filter(r => r.pct_wins_over_100 > 50).length.toLocaleString()}`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
