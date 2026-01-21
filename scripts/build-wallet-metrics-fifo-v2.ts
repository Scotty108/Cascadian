#!/usr/bin/env npx tsx
/**
 * Build pm_wallet_copy_trading_metrics_v1 with FIFO-based ROI (V2 - Fixed)
 *
 * Fixes from V1:
 * - Use reduce() instead of Math.min/max(...spread) to avoid stack overflow
 * - Smaller chunks (50 wallets instead of 200)
 * - Stream inserts directly to ClickHouse instead of buffering
 * - Clear memory between chunks
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'

// Helper functions to avoid stack overflow
function arrayMin(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((min, val) => val < min ? val : min, arr[0])
}

function arrayMax(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((max, val) => val > max ? val : max, arr[0])
}

interface WalletResult {
  wallet: string
  total_trades: number
  wins: number
  losses: number
  win_rate_pct: number
  avg_roi_pct: number
  avg_win_roi_pct: number
  avg_loss_roi_pct: number
  median_win_roi_pct: number
  roi_stddev_pct: number
  pct_wins_over_50: number
  pct_wins_over_100: number
  pct_wins_over_500: number
  max_win_roi_pct: number
  pct_losses_over_50: number
  pct_losses_over_90: number
  max_loss_roi_pct: number
  expectancy_pct: number
  asinh_score: number
  win_loss_ratio: number
  total_volume_usd: number
  total_pnl_usd: number
  avg_trade_usd: number
  positions_traded: number
  first_trade_time: string
  last_trade_time: string
  days_active: number
  trades_per_day: number
  maker_pct: number
  taker_pct: number
  sold_early_pct: number
}

interface SellTrade {
  tx_hash: string
  trade_time: Date
  tokens: number
  proceeds_usd: number
  avg_price: number
}

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

async function insertBatch(results: WalletResult[]) {
  if (results.length === 0) return

  const values = results.map(r => `(
    '${r.wallet}',
    ${r.total_trades}, ${r.wins}, ${r.losses}, ${r.win_rate_pct},
    ${r.avg_roi_pct}, ${r.avg_win_roi_pct}, ${r.avg_loss_roi_pct}, ${r.median_win_roi_pct}, ${r.roi_stddev_pct},
    ${r.pct_wins_over_50}, ${r.pct_wins_over_100}, ${r.pct_wins_over_500}, ${r.max_win_roi_pct},
    ${r.pct_losses_over_50}, ${r.pct_losses_over_90}, ${r.max_loss_roi_pct},
    ${r.expectancy_pct}, ${r.asinh_score}, ${isFinite(r.win_loss_ratio) ? r.win_loss_ratio : 999},
    ${r.total_volume_usd}, ${r.total_pnl_usd}, ${r.avg_trade_usd},
    ${r.positions_traded}, '${r.first_trade_time}', '${r.last_trade_time}', ${r.days_active}, ${r.trades_per_day},
    ${r.maker_pct}, ${r.taker_pct}, ${r.sold_early_pct},
    now()
  )`).join(',\n')

  await clickhouse.command({
    query: `INSERT INTO pm_wallet_copy_trading_metrics_v1 VALUES ${values}`
  })
}

function computeWalletMetrics(wallet: string, walletTrades: TradeResult[]): WalletResult | null {
  if (walletTrades.length < 5) return null

  const n = walletTrades.length
  const winningTrades = walletTrades.filter(t => t.roi > 0)
  const losingTrades = walletTrades.filter(t => t.roi <= 0)
  const wins = winningTrades.length
  const losses = losingTrades.length

  // ROI arrays
  const rois = walletTrades.map(t => t.roi)
  const winRois = winningTrades.map(t => t.roi)
  const lossRois = losingTrades.map(t => t.roi)

  // Basic metrics
  const winRate = (wins / n) * 100
  const avgRoi = rois.reduce((a, b) => a + b, 0) / n
  const avgWinRoi = wins > 0 ? winRois.reduce((a, b) => a + b, 0) / wins : 0
  const avgLossRoi = losses > 0 ? Math.abs(lossRois.reduce((a, b) => a + b, 0) / losses) : 0

  // Median win ROI
  const sortedWinRois = [...winRois].sort((a, b) => a - b)
  const medianWinRoi = wins > 0
    ? (wins % 2 === 0
      ? (sortedWinRois[wins / 2 - 1] + sortedWinRois[wins / 2]) / 2
      : sortedWinRois[Math.floor(wins / 2)])
    : 0

  // Std dev
  const mean = avgRoi
  const variance = rois.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n
  const stddev = Math.sqrt(variance)

  // Win distribution
  const pctWinsOver50 = wins > 0 ? winRois.filter(r => r > 0.5).length / wins * 100 : 0
  const pctWinsOver100 = wins > 0 ? winRois.filter(r => r > 1.0).length / wins * 100 : 0
  const pctWinsOver500 = wins > 0 ? winRois.filter(r => r > 5.0).length / wins * 100 : 0
  const maxWinRoi = arrayMax(winRois)

  // Loss distribution
  const pctLossesOver50 = losses > 0 ? lossRois.filter(r => r < -0.5).length / losses * 100 : 0
  const pctLossesOver90 = losses > 0 ? lossRois.filter(r => r < -0.9).length / losses * 100 : 0
  const maxLossRoi = arrayMin(lossRois)

  // Expectancy
  const expectancy = (wins / n) * avgWinRoi - (losses / n) * avgLossRoi

  // Asinh score
  const asinhScore = rois.reduce((sum, r) => sum + Math.asinh(r), 0) / n

  // Win/loss ratio
  const winLossRatio = avgLossRoi > 0 ? avgWinRoi / avgLossRoi : (avgWinRoi > 0 ? 999 : 0)

  // Volume
  const totalVolume = walletTrades.reduce((sum, t) => sum + t.cost_usd, 0)
  const totalPnl = walletTrades.reduce((sum, t) => sum + t.pnl_usd, 0)
  const avgTradeUsd = totalVolume / n

  // Activity - use reduce to avoid stack overflow
  const positions = new Set(walletTrades.map(t => t.condition_id)).size
  const times = walletTrades.map(t => t.trade_time.getTime())
  const minTime = arrayMin(times)
  const maxTime = arrayMax(times)
  const firstTrade = new Date(minTime)
  const lastTrade = new Date(maxTime)
  const daysActive = Math.max(1, Math.ceil((maxTime - minTime) / (1000 * 60 * 60 * 24)))
  const tradesPerDay = n / daysActive

  // Behavior
  const makerPct = walletTrades.filter(t => t.is_maker === 1).length / n * 100
  const takerPct = 100 - makerPct
  const soldEarlyPct = walletTrades.filter(t => t.sold_early).length / n * 100

  return {
    wallet,
    total_trades: n,
    wins,
    losses,
    win_rate_pct: Math.round(winRate * 100) / 100,
    avg_roi_pct: Math.round(avgRoi * 10000) / 100,
    avg_win_roi_pct: Math.round(avgWinRoi * 10000) / 100,
    avg_loss_roi_pct: Math.round(avgLossRoi * 10000) / 100,
    median_win_roi_pct: Math.round(medianWinRoi * 10000) / 100,
    roi_stddev_pct: Math.round(stddev * 10000) / 100,
    pct_wins_over_50: Math.round(pctWinsOver50 * 10) / 10,
    pct_wins_over_100: Math.round(pctWinsOver100 * 10) / 10,
    pct_wins_over_500: Math.round(pctWinsOver500 * 10) / 10,
    max_win_roi_pct: Math.round(maxWinRoi * 10000) / 100,
    pct_losses_over_50: Math.round(pctLossesOver50 * 10) / 10,
    pct_losses_over_90: Math.round(pctLossesOver90 * 10) / 10,
    max_loss_roi_pct: Math.round(maxLossRoi * 10000) / 100,
    expectancy_pct: Math.round(expectancy * 10000) / 100,
    asinh_score: Math.round(asinhScore * 10000) / 10000,
    win_loss_ratio: Math.round(winLossRatio * 100) / 100,
    total_volume_usd: Math.round(totalVolume * 100) / 100,
    total_pnl_usd: Math.round(totalPnl * 100) / 100,
    avg_trade_usd: Math.round(avgTradeUsd * 100) / 100,
    positions_traded: positions,
    first_trade_time: firstTrade.toISOString().slice(0, 19).replace('T', ' '),
    last_trade_time: lastTrade.toISOString().slice(0, 19).replace('T', ' '),
    days_active: daysActive,
    trades_per_day: Math.round(tradesPerDay * 100) / 100,
    maker_pct: Math.round(makerPct * 10) / 10,
    taker_pct: Math.round(takerPct * 10) / 10,
    sold_early_pct: Math.round(soldEarlyPct * 10) / 10
  }
}

async function main() {
  const startTime = Date.now()
  console.log('🔧 Building pm_wallet_copy_trading_metrics_v1 with FIFO (V2)')
  console.log('   Estimated time: ~45-60 minutes for 320K wallets')
  console.log('')

  // Step 1: Get all wallets with resolved trades in last 30 days
  console.log('📊 Finding wallets to process...')
  const walletQuery = `
    SELECT DISTINCT f.wallet
    FROM pm_canonical_fills_v4 f
    INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != ''
    WHERE f.source = 'clob'
      AND f.tokens_delta > 0
      AND f.event_time >= now() - INTERVAL 30 DAY
      AND f.wallet != '0x0000000000000000000000000000000000000000'
      AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
  `
  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' })
  const allWallets = (await walletResult.json() as { wallet: string }[]).map(w => w.wallet)
  console.log(`   Found ${allWallets.length.toLocaleString()} wallets`)

  // Process in chunks - stack overflow was from spread operator, not chunk size
  // Now that we use arrayMin/arrayMax with reduce, we can use larger chunks
  const chunkSize = 300
  let totalProcessed = 0
  let totalInserted = 0

  console.log(`\n📦 Processing ${Math.ceil(allWallets.length / chunkSize)} chunks...`)

  for (let i = 0; i < allWallets.length; i += chunkSize) {
    const chunk = allWallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(allWallets.length / chunkSize)
    const pct = Math.round((i / allWallets.length) * 100)
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const rate = totalProcessed > 0 ? totalProcessed / elapsed : 0
    const remaining = allWallets.length - totalProcessed
    const eta = rate > 0 ? Math.round(remaining / rate / 60) : '?'

    process.stdout.write(`\r   Chunk ${chunkNum}/${totalChunks} (${pct}%) | Inserted: ${totalInserted.toLocaleString()} | ETA: ${eta}m   `)

    try {
      // Get BUY trades (grouped by tx_hash)
      const buysQuery = `
        SELECT
          f.tx_hash,
          f.wallet,
          f.condition_id,
          f.outcome_index,
          min(f.event_time) as trade_time,
          round(sum(f.tokens_delta), 4) as tokens,
          round(sum(abs(f.usdc_delta)), 2) as cost_usd,
          round(sum(abs(f.usdc_delta)) / nullIf(sum(f.tokens_delta), 0), 4) as avg_price,
          max(f.is_maker) as is_maker,
          CASE
            WHEN r.payout_numerators = '[1,1]' THEN 0.5
            WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
            ELSE 0.0
          END as payout_rate,
          r.resolved_at
        FROM pm_canonical_fills_v4 f
        INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          AND r.is_deleted = 0 AND r.payout_numerators != ''
        WHERE f.source = 'clob'
          AND f.tokens_delta > 0
          AND f.event_time >= now() - INTERVAL 30 DAY
          AND f.wallet IN (${walletList})
          AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
        GROUP BY f.tx_hash, f.wallet, f.condition_id, f.outcome_index, r.payout_numerators, r.resolved_at
        ORDER BY f.wallet, f.condition_id, f.outcome_index, trade_time
      `

      // Get SELL trades (grouped by tx_hash)
      const sellsQuery = `
        SELECT
          tx_hash,
          wallet,
          condition_id,
          outcome_index,
          min(event_time) as trade_time,
          round(sum(abs(tokens_delta)), 4) as tokens,
          round(sum(usdc_delta), 2) as proceeds_usd,
          round(sum(usdc_delta) / nullIf(sum(abs(tokens_delta)), 0), 4) as avg_price
        FROM pm_canonical_fills_v4
        WHERE source = 'clob'
          AND tokens_delta < 0
          AND event_time >= now() - INTERVAL 30 DAY
          AND wallet IN (${walletList})
          AND NOT (is_self_fill = 1 AND is_maker = 1)
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        ORDER BY wallet, condition_id, outcome_index, trade_time
      `

      const [buysResult, sellsResult] = await Promise.all([
        clickhouse.query({ query: buysQuery, format: 'JSONEachRow' }),
        clickhouse.query({ query: sellsQuery, format: 'JSONEachRow' })
      ])

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

      const rawBuys: RawBuy[] = await buysResult.json() as RawBuy[]
      const rawSells: RawSell[] = await sellsResult.json() as RawSell[]

      // Build sells map: wallet:condition:outcome -> array of sells (with mutable tokens)
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

      // Process buys and compute trades by wallet
      const walletTrades = new Map<string, TradeResult[]>()

      for (const buy of rawBuys) {
        if (buy.cost_usd < 0.01) continue // Skip dust

        const key = `${buy.wallet}:${buy.condition_id}:${buy.outcome_index}`
        const sells = sellsMap.get(key) || []
        const resolvedAt = new Date(buy.resolved_at)
        const buyTime = new Date(buy.trade_time)

        // Get or initialize consumption index
        if (!sellConsumption.has(key)) sellConsumption.set(key, 0)
        let sellIdx = sellConsumption.get(key)!

        let remainingTokens = buy.tokens
        let totalExitValue = 0
        let tokensSoldEarly = 0

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

        // Calculate ROI and PnL
        const pnl_usd = totalExitValue - buy.cost_usd
        const roi = buy.cost_usd > 0 ? pnl_usd / buy.cost_usd : 0

        const trade: TradeResult = {
          wallet: buy.wallet,
          tx_hash: buy.tx_hash,
          condition_id: buy.condition_id,
          roi,
          pnl_usd,
          cost_usd: buy.cost_usd,
          sold_early: tokensSoldEarly > buy.tokens * 0.5,
          is_maker: buy.is_maker,
          trade_time: buyTime
        }

        if (!walletTrades.has(buy.wallet)) walletTrades.set(buy.wallet, [])
        walletTrades.get(buy.wallet)!.push(trade)
      }

      // Compute metrics for each wallet and insert
      const results: WalletResult[] = []
      for (const [wallet, trades] of walletTrades) {
        const metrics = computeWalletMetrics(wallet, trades)
        if (metrics) results.push(metrics)
      }

      // Insert batch
      if (results.length > 0) {
        await insertBatch(results)
        totalInserted += results.length
      }

      totalProcessed += chunk.length

      // Clear memory
      sellsMap.clear()
      sellConsumption.clear()
      walletTrades.clear()

    } catch (err: any) {
      console.error(`\n   ⚠️ Chunk ${chunkNum} error: ${err.message.slice(0, 150)}`)
    }
  }

  console.log(`\n\n✅ Processed ${totalProcessed.toLocaleString()} wallets`)
  console.log(`   Inserted ${totalInserted.toLocaleString()} wallets with ≥5 trades`)

  // Final stats
  console.log('\n📊 Final Statistics:')
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

  // Copy trading candidates
  const candidatesResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_wallet_copy_trading_metrics_v1
      WHERE maker_pct <= 30
        AND toDate(last_trade_time) >= today() - 3
        AND expectancy_pct > 0
        AND total_pnl_usd > 100
        AND total_trades >= 20
    `,
    format: 'JSONEachRow'
  })
  const candidates = (await candidatesResult.json() as any[])[0]
  console.log(`\n🎯 Copy trading candidates (profitable, active, taker): ${candidates.cnt}`)

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
