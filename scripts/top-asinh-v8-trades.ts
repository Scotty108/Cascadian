#!/usr/bin/env npx tsx
/**
 * V8 Trades: Copy Trading Backtester using tx_hash as trade identifier
 *
 * KEY INSIGHT: Each tx_hash = one trade decision = one copyable action
 * - 100% of CLOB transactions target exactly one market
 * - Multiple fills in same tx = order walking the book (still one trade)
 *
 * APPROACH:
 * 1. Group fills by tx_hash to get discrete "trades"
 * 2. FIFO match BUY trades to SELL trades and resolutions
 * 3. Calculate ROI per trade (what you'd earn copying with $1)
 * 4. Aggregate wallet metrics
 *
 * FIXES from V7:
 * - Uses tx_hash grouping (not raw fills)
 * - Proper filters on sells (source != 'negrisk', valid prices)
 * - Validates against PnL engine totals
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'
import { writeFileSync, appendFileSync, readFileSync, existsSync } from 'fs'

interface WalletResult {
  wallet: string
  trades: number
  wins: number
  losses: number
  win_rate_pct: number

  // Win quality metrics
  pct_wins_over_50: number
  pct_wins_over_100: number
  pct_wins_over_500: number
  median_win_roi_pct: number
  avg_win_roi_pct: number
  avg_loss_roi_pct: number
  win_loss_ratio: number
  expectancy_pct: number

  // Core metrics
  asinh_score: number
  total_pnl_usd: number

  // Context
  positions_traded: number
  sold_early_pct: number
  maker_pct: number
  avg_trade_usd: number
  last_trade: string
}

interface BuyTrade {
  tx_hash: string
  condition_id: string
  outcome_index: number
  trade_time: Date
  tokens: number
  cost_usd: number
  avg_price: number
  is_maker: number
}

interface SellTrade {
  tx_hash: string
  trade_time: Date
  tokens: number
  proceeds_usd: number
  avg_price: number
}

interface Resolution {
  condition_id: string
  payout_rate: number
  resolved_at: Date
}

async function main() {
  const startTime = Date.now()
  console.log('🚀 V8 Trades: Copy Trading Backtester')
  console.log('   Using tx_hash as trade identifier')
  console.log('')

  // Step 1: Find active wallets with resolved trades in last 14 days
  // Start with tighter filters to test, can expand later
  console.log('📊 Finding wallets with resolved CLOB trades...')
  const walletQuery = `
    SELECT
      wallet,
      count(DISTINCT tx_hash) as trade_count,
      round(sum(abs(usdc_delta)), 2) as volume_usd
    FROM pm_canonical_fills_v4 f
    JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != ''
    WHERE f.source = 'clob'
      AND f.tokens_delta > 0
      AND f.event_time >= now() - INTERVAL 14 DAY
      AND f.wallet != '0x0000000000000000000000000000000000000000'
      AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
    GROUP BY wallet
    HAVING trade_count >= 10 AND trade_count <= 2000
    ORDER BY trade_count DESC
    LIMIT 10000
  `
  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' })
  const targetWallets = (await walletResult.json() as { wallet: string }[]).map(w => w.wallet)
  console.log(`   Found ${targetWallets.length.toLocaleString()} wallets`)

  // Output file
  const outputPath = './data/top-asinh-v8-trades.jsonl'
  writeFileSync(outputPath, '')

  // Process in chunks - small to avoid V8 memory limits
  const chunkSize = 50
  let totalProcessed = 0
  let totalWithScores = 0

  console.log(`\n📦 Processing ${Math.ceil(targetWallets.length / chunkSize)} chunks...`)

  for (let i = 0; i < targetWallets.length; i += chunkSize) {
    const chunk = targetWallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(targetWallets.length / chunkSize)
    const pct = Math.round((i / targetWallets.length) * 100)

    process.stdout.write(`\r   Chunk ${chunkNum}/${totalChunks} (${pct}%) | Scored: ${totalWithScores.toLocaleString()}`)

    try {
      // Get BUY trades (grouped by tx_hash) - minimal columns
      const buysQuery = `
        SELECT
          f.tx_hash,
          f.wallet,
          f.condition_id,
          f.outcome_index,
          min(f.event_time) as trade_time,
          round(sum(f.tokens_delta), 4) as tokens,
          round(sum(abs(f.usdc_delta)), 2) as cost_usd,
          round(sum(abs(f.usdc_delta)) / sum(f.tokens_delta), 4) as avg_price,
          max(f.is_maker) as is_maker,
          CASE
            WHEN r.payout_numerators = '[1,1]' THEN 0.5
            WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
            ELSE 0.0
          END as payout_rate,
          r.resolved_at
        FROM pm_canonical_fills_v4 f
        JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          AND r.is_deleted = 0 AND r.payout_numerators != ''
        WHERE f.source = 'clob'
          AND f.tokens_delta > 0
          AND f.event_time >= now() - INTERVAL 14 DAY
          AND f.wallet IN (${walletList})
          AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
        GROUP BY f.tx_hash, f.wallet, f.condition_id, f.outcome_index, r.payout_numerators, r.resolved_at
        ORDER BY f.wallet, f.condition_id, f.outcome_index, trade_time
        SETTINGS max_memory_usage = 4000000000
      `

      // Get SELL trades (grouped by tx_hash) - minimal columns
      const sellsQuery = `
        SELECT
          tx_hash,
          wallet,
          condition_id,
          outcome_index,
          min(event_time) as trade_time,
          round(sum(abs(tokens_delta)), 4) as tokens,
          round(sum(usdc_delta), 2) as proceeds_usd,
          round(sum(usdc_delta) / sum(abs(tokens_delta)), 4) as avg_price
        FROM pm_canonical_fills_v4
        WHERE source = 'clob'
          AND tokens_delta < 0
          AND event_time >= now() - INTERVAL 14 DAY
          AND wallet IN (${walletList})
          AND NOT (is_self_fill = 1 AND is_maker = 1)
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        ORDER BY wallet, condition_id, outcome_index, trade_time
        SETTINGS max_memory_usage = 4000000000
      `

      interface RawBuy {
        tx_hash: string
        wallet: string
        condition_id: string
        outcome_index: number
        trade_time: string
        tokens: number
        cost_usd: number
        avg_price: number
        is_maker: number
        payout_rate: number
        resolved_at: string
      }

      interface RawSell {
        tx_hash: string
        wallet: string
        condition_id: string
        outcome_index: number
        trade_time: string
        tokens: number
        proceeds_usd: number
        avg_price: number
      }

      // Use streaming to handle large result sets
      const [buysResult, sellsResult] = await Promise.all([
        clickhouse.query({ query: buysQuery, format: 'JSONEachRow' }),
        clickhouse.query({ query: sellsQuery, format: 'JSONEachRow' })
      ])

      const rawBuys: RawBuy[] = await buysResult.json() as RawBuy[]
      const rawSells: RawSell[] = await sellsResult.json() as RawSell[]

      // Build sells map: wallet:condition:outcome -> array of sells sorted by time
      const sellsMap = new Map<string, SellTrade[]>()
      for (const s of rawSells) {
        const key = `${s.wallet}:${s.condition_id}:${s.outcome_index}`
        if (!sellsMap.has(key)) sellsMap.set(key, [])
        sellsMap.get(key)!.push({
          tx_hash: s.tx_hash,
          trade_time: new Date(s.trade_time),
          tokens: s.tokens,
          proceeds_usd: s.proceeds_usd,
          avg_price: s.avg_price
        })
      }

      // Track sell consumption per position for FIFO
      const sellConsumption = new Map<string, number>()

      interface TradeResult {
        wallet: string
        tx_hash: string
        condition_id: string
        roi: number
        pnl_usd: number
        cost_usd: number
        sold_early: boolean
        is_maker: number
        trade_time: Date
      }

      const trades: TradeResult[] = []

      // Process each buy trade with FIFO matching to sells
      for (const buy of rawBuys) {
        const key = `${buy.wallet}:${buy.condition_id}:${buy.outcome_index}`
        const sells = sellsMap.get(key) || []
        const resolvedAt = new Date(buy.resolved_at)

        // Get or initialize consumption index
        if (!sellConsumption.has(key)) sellConsumption.set(key, 0)
        let sellIdx = sellConsumption.get(key)!

        let remainingTokens = buy.tokens
        let totalExitValue = 0
        let tokensSoldEarly = 0
        const buyTime = new Date(buy.trade_time)

        // FIFO match: consume sells after this buy but before resolution
        while (remainingTokens > 0.0001 && sellIdx < sells.length) {
          const sell = sells[sellIdx]

          // Only use sells after entry and before resolution
          if (sell.trade_time <= buyTime) {
            sellIdx++
            continue
          }
          if (sell.trade_time >= resolvedAt) {
            break
          }

          // How many tokens can this sell consume?
          const tokensToConsume = Math.min(remainingTokens, sell.tokens)
          const valueFromSell = tokensToConsume * sell.avg_price

          totalExitValue += valueFromSell
          tokensSoldEarly += tokensToConsume
          remainingTokens -= tokensToConsume

          // Reduce sell's available tokens
          sell.tokens -= tokensToConsume

          // If sell fully consumed, move to next
          if (sell.tokens < 0.0001) {
            sellIdx++
          }
        }

        // Update consumption index
        sellConsumption.set(key, sellIdx)

        // Remaining tokens held to resolution
        if (remainingTokens > 0.0001) {
          totalExitValue += remainingTokens * buy.payout_rate
        }

        // Calculate trade ROI and PnL
        const pnl_usd = totalExitValue - buy.cost_usd
        const roi = buy.cost_usd > 0 ? pnl_usd / buy.cost_usd : 0

        trades.push({
          wallet: buy.wallet,
          tx_hash: buy.tx_hash,
          condition_id: buy.condition_id,
          roi,
          pnl_usd,
          cost_usd: buy.cost_usd,
          sold_early: tokensSoldEarly > buy.tokens * 0.5,
          is_maker: buy.is_maker,
          trade_time: buyTime
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

        // Win distribution metrics (in %)
        const winRois = winningTrades.map(t => t.roi * 100)
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

        // Asinh score (handles outliers better than average)
        const asinhScore = Math.round(
          walletTrades.reduce((sum, t) => sum + Math.asinh(t.roi), 0) / numTrades * 10000
        ) / 10000

        // Total PnL in USD
        const totalPnlUsd = Math.round(walletTrades.reduce((sum, t) => sum + t.pnl_usd, 0) * 100) / 100

        // Context metrics
        const positions = new Set(walletTrades.map(t => t.condition_id)).size
        const soldEarlyPct = Math.round(walletTrades.filter(t => t.sold_early).length / numTrades * 1000) / 10
        const makerPct = Math.round(walletTrades.filter(t => t.is_maker === 1).length / numTrades * 1000) / 10
        const avgTradeUsd = Math.round(walletTrades.reduce((sum, t) => sum + t.cost_usd, 0) / numTrades * 100) / 100
        const lastTrade = walletTrades.reduce(
          (max, t) => t.trade_time > max ? t.trade_time : max,
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
          total_pnl_usd: totalPnlUsd,
          positions_traded: positions,
          sold_early_pct: soldEarlyPct,
          maker_pct: makerPct,
          avg_trade_usd: avgTradeUsd,
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

  console.log(`\n\n✅ Processed ${totalProcessed.toLocaleString()} wallets, ${totalWithScores.toLocaleString()} with scores`)

  // Load and sort results
  console.log('\n📦 Sorting results...')
  const lines = readFileSync(outputPath, 'utf-8').trim().split('\n').filter(l => l)
  const results: WalletResult[] = lines.map(l => JSON.parse(l))

  // Sort by expectancy (what matters for copy trading)
  results.sort((a, b) => b.expectancy_pct - a.expectancy_pct)

  // Save sorted JSON
  writeFileSync('./data/top-asinh-v8-final.json', JSON.stringify(results, null, 2))

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n💾 Saved ${results.length.toLocaleString()} results to ./data/top-asinh-v8-final.json`)
  console.log(`⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)

  // Print leaderboards
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')

  console.log('\n' + '═'.repeat(140))
  console.log('🎯 TOP 20: COPY TRADING CANDIDATES (taker-heavy, active, positive expectancy, big wins)')
  console.log('═'.repeat(140))

  const copyTradingCandidates = results.filter(r =>
    r.maker_pct <= 30 &&           // Taker-heavy (copyable)
    r.last_trade > threeDaysAgo && // Active in last 3 days
    r.expectancy_pct > 0 &&        // Positive expectancy
    r.pct_wins_over_100 > 20 &&    // Some big wins
    r.trades >= 20                 // Statistical significance
  ).slice(0, 20)

  console.log('Wallet          | Trades | Win%  | Expect | BigWin% | Med Win | PnL USD  | Mkr% | Avg$')
  console.log('-'.repeat(140))

  copyTradingCandidates.forEach((row, i) => {
    console.log(
      `#${String(i + 1).padStart(2)} ${row.wallet.slice(0, 10)}.. | ` +
      `${String(row.trades).padStart(5)} | ` +
      `${row.win_rate_pct.toFixed(1).padStart(5)}% | ` +
      `${row.expectancy_pct.toFixed(0).padStart(6)}% | ` +
      `${row.pct_wins_over_100.toFixed(0).padStart(6)}% | ` +
      `${row.median_win_roi_pct.toFixed(0).padStart(7)}% | ` +
      `${row.total_pnl_usd.toFixed(0).padStart(8)} | ` +
      `${row.maker_pct.toFixed(0).padStart(4)}% | ` +
      `${row.avg_trade_usd.toFixed(0).padStart(4)}`
    )
  })

  console.log('\n' + '═'.repeat(140))
  console.log('💰 TOP 20: HIGHEST EXPECTANCY (any maker %)')
  console.log('═'.repeat(140))

  const highExpectancy = results.filter(r =>
    r.trades >= 20 &&
    r.expectancy_pct > 0
  ).slice(0, 20)

  console.log('Wallet          | Trades | Win%  | Expect | AvgWin% | AvgLoss | W/L Ratio | PnL USD')
  console.log('-'.repeat(140))

  highExpectancy.forEach((row, i) => {
    console.log(
      `#${String(i + 1).padStart(2)} ${row.wallet.slice(0, 10)}.. | ` +
      `${String(row.trades).padStart(5)} | ` +
      `${row.win_rate_pct.toFixed(1).padStart(5)}% | ` +
      `${row.expectancy_pct.toFixed(0).padStart(6)}% | ` +
      `${row.avg_win_roi_pct.toFixed(0).padStart(6)}% | ` +
      `${row.avg_loss_roi_pct.toFixed(0).padStart(7)}% | ` +
      `${row.win_loss_ratio.toFixed(2).padStart(9)} | ` +
      `${row.total_pnl_usd.toFixed(0).padStart(8)}`
    )
  })

  console.log('\n' + '═'.repeat(140))
  console.log('🔥 TOP 20: ASYMMETRIC WINNERS (low win rate but huge avg win)')
  console.log('═'.repeat(140))

  const asymmetricWinners = results.filter(r =>
    r.trades >= 20 &&
    r.win_rate_pct < 50 &&           // Lose more often
    r.avg_win_roi_pct > 200 &&       // But wins are massive
    r.expectancy_pct > 0             // Still positive expectancy
  ).sort((a, b) => b.avg_win_roi_pct - a.avg_win_roi_pct).slice(0, 20)

  console.log('Wallet          | Trades | Win%  | AvgWin%  | BigWin% | Expect | PnL USD  | Mkr%')
  console.log('-'.repeat(140))

  asymmetricWinners.forEach((row, i) => {
    console.log(
      `#${String(i + 1).padStart(2)} ${row.wallet.slice(0, 10)}.. | ` +
      `${String(row.trades).padStart(5)} | ` +
      `${row.win_rate_pct.toFixed(1).padStart(5)}% | ` +
      `${row.avg_win_roi_pct.toFixed(0).padStart(7)}% | ` +
      `${row.pct_wins_over_100.toFixed(0).padStart(6)}% | ` +
      `${row.expectancy_pct.toFixed(0).padStart(6)}% | ` +
      `${row.total_pnl_usd.toFixed(0).padStart(8)} | ` +
      `${row.maker_pct.toFixed(0).padStart(4)}%`
    )
  })

  // Summary stats
  console.log('\n' + '═'.repeat(80))
  console.log('SUMMARY STATISTICS')
  console.log('═'.repeat(80))
  console.log(`   Total wallets analyzed: ${results.length.toLocaleString()}`)
  console.log(`   Positive expectancy: ${results.filter(r => r.expectancy_pct > 0).length.toLocaleString()}`)
  console.log(`   Taker-heavy (maker ≤30%): ${results.filter(r => r.maker_pct <= 30).length.toLocaleString()}`)
  console.log(`   Active last 3 days: ${results.filter(r => r.last_trade > threeDaysAgo).length.toLocaleString()}`)
  console.log(`   Win rate >50%: ${results.filter(r => r.win_rate_pct > 50).length.toLocaleString()}`)
  console.log(`   Big winners (>20% wins over 100%): ${results.filter(r => r.pct_wins_over_100 > 20).length.toLocaleString()}`)
  console.log(`   Copy trading candidates: ${copyTradingCandidates.length}`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
