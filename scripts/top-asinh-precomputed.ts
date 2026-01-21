#!/usr/bin/env npx tsx
/**
 * Top Wallets by Asinh Score - Pre-computed Sells
 *
 * Optimization: Pre-compute sells data ONCE, then batch process wallets
 * This avoids rebuilding the sells CTE for every batch.
 *
 * Filters:
 * - 90-day active (resolved trades)
 * - 5+ trades
 * - 2+ markets
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'
import { writeFileSync } from 'fs'

interface WalletResult {
  wallet: string
  positions: number
  win_rate_pct: number
  asinh_score: number
  total_roi_pct: number
  avg_roi_pct: number
  markets_traded: number
  last_trade: string
}

async function main() {
  const startTime = Date.now()
  console.log('🔍 Top Wallets by Asinh Score (Pre-computed Sells)')
  console.log('')
  console.log('Filters:')
  console.log('  - 90-day active (resolved trades)')
  console.log('  - 5+ trades')
  console.log('  - 2+ markets')
  console.log('')

  // Step 1: Get filtered wallets
  console.log('📦 Step 1: Getting filtered wallet list...')
  const walletQuery = `
    SELECT wallet
    FROM (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        uniqExact(map.condition_id) as markets
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
      JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
        AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
      WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
        AND t.trade_time >= now() - INTERVAL 90 DAY
        AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
      GROUP BY wallet
      HAVING trades >= 5 AND markets >= 2
    )
  `
  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' })
  const wallets = (await walletResult.json() as Array<{wallet: string}>).map(w => w.wallet)
  console.log(`   ✅ Found ${wallets.length} wallets`)

  const walletSet = new Set(wallets)

  // Step 2: Pre-compute sells data using subquery (avoids max_query_size)
  console.log('')
  console.log('📦 Step 2: Pre-computing sells data for all wallets...')
  const sellsQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      token_id,
      groupArray(trade_time) as sell_times,
      groupArray(usdc_amount / nullIf(token_amount, 0)) as sell_prices
    FROM pm_trader_events_v3
    WHERE side = 'sell' AND usdc_amount > 0 AND token_amount > 0
      AND trade_time >= now() - INTERVAL 90 DAY
      AND lower(trader_wallet) IN (
        SELECT wallet FROM (
          SELECT
            lower(trader_wallet) as wallet,
            count() as trades,
            uniqExact(map.condition_id) as markets
          FROM pm_trader_events_v3 t
          JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
          JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
            AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
          WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
            AND t.trade_time >= now() - INTERVAL 90 DAY
            AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
          GROUP BY wallet
          HAVING trades >= 5 AND markets >= 2
        )
      )
    GROUP BY wallet, token_id
  `
  const sellsResult = await clickhouse.query({ query: sellsQuery, format: 'JSONEachRow' })
  const sellsData = await sellsResult.json() as Array<{
    wallet: string
    token_id: string
    sell_times: string[]
    sell_prices: number[]
  }>

  // Build lookup map: wallet -> token_id -> {sell_times, sell_prices}
  const sellsMap = new Map<string, Map<string, {sell_times: Date[], sell_prices: number[]}>>()
  for (const row of sellsData) {
    if (!sellsMap.has(row.wallet)) {
      sellsMap.set(row.wallet, new Map())
    }
    sellsMap.get(row.wallet)!.set(row.token_id, {
      sell_times: row.sell_times.map(t => new Date(t)),
      sell_prices: row.sell_prices
    })
  }
  console.log(`   ✅ Pre-computed sells for ${sellsMap.size} wallets (${sellsData.length} token pairs)`)

  // Step 3: Get all buy trades with resolutions (chunked to avoid timeout)
  console.log('')
  console.log('📦 Step 3: Fetching buy trades with resolutions (chunked)...')

  interface BuyTrade {
    wallet: string
    token_id: string
    entry_time: string
    condition_id: string
    entry_price: number
    resolution_price: number
    resolved_at: string
  }

  const buysData: BuyTrade[] = []
  const chunkSize = 2000

  for (let i = 0; i < wallets.length; i += chunkSize) {
    const chunk = wallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const pct = Math.round((i / wallets.length) * 100)
    process.stdout.write(`\r   Progress: ${pct}% (${Math.floor(i/chunkSize)+1}/${Math.ceil(wallets.length/chunkSize)}) | ${buysData.length.toLocaleString()} trades`)

    const buysQuery = `
      SELECT
        lower(t.trader_wallet) as wallet,
        t.token_id,
        t.trade_time as entry_time,
        map.condition_id,
        (t.usdc_amount / nullIf(t.token_amount, 0)) as entry_price,
        toFloat64(JSONExtractInt(r.payout_numerators, map.outcome_index + 1) >= 1) as resolution_price,
        r.resolved_at
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
      JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
        AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
      WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
        AND t.trade_time >= now() - INTERVAL 90 DAY
        AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
        AND lower(t.trader_wallet) IN (${walletList})
    `
    try {
      const buysResult = await clickhouse.query({ query: buysQuery, format: 'JSONEachRow' })
      const text = await buysResult.text()
      // Parse line by line to avoid stack overflow
      const lines = text.trim().split('\n').filter(l => l)
      for (const line of lines) {
        buysData.push(JSON.parse(line) as BuyTrade)
      }
    } catch (err: any) {
      console.error(`\n   ⚠️ Chunk error: ${err.message}`)
    }
  }
  console.log(`\r   ✅ Fetched ${buysData.length.toLocaleString()} buy trades                    `)

  // Step 4: Calculate ROI for each trade (in memory)
  console.log('')
  console.log('📦 Step 4: Calculating ROI with actual exit prices...')

  interface TradeWithROI {
    wallet: string
    condition_id: string
    entry_time: Date
    roi: number
  }

  const tradesWithROI: TradeWithROI[] = []
  let soldEarly = 0
  let heldToResolution = 0

  for (const buy of buysData) {
    const entryTime = new Date(buy.entry_time)
    const resolvedAt = new Date(buy.resolved_at)

    // Find first sell after entry but before resolution
    let exitPrice = buy.resolution_price
    const walletSells = sellsMap.get(buy.wallet)?.get(buy.token_id)

    if (walletSells) {
      for (let i = 0; i < walletSells.sell_times.length; i++) {
        const sellTime = walletSells.sell_times[i]
        if (sellTime > entryTime && sellTime < resolvedAt) {
          exitPrice = walletSells.sell_prices[i]
          soldEarly++
          break
        }
      }
      if (exitPrice === buy.resolution_price) {
        heldToResolution++
      }
    } else {
      heldToResolution++
    }

    const roi = (exitPrice - buy.entry_price) / buy.entry_price

    tradesWithROI.push({
      wallet: buy.wallet,
      condition_id: buy.condition_id,
      entry_time: entryTime,
      roi
    })
  }

  console.log(`   ✅ Calculated ROI for ${tradesWithROI.length.toLocaleString()} trades`)
  console.log(`      Sold early: ${soldEarly.toLocaleString()} | Held to resolution: ${heldToResolution.toLocaleString()}`)

  // Step 5: Aggregate by wallet
  console.log('')
  console.log('📦 Step 5: Aggregating wallet scores...')

  const walletAgg = new Map<string, {
    trades: Array<{roi: number, condition_id: string, entry_time: Date}>
  }>()

  for (const trade of tradesWithROI) {
    if (!walletAgg.has(trade.wallet)) {
      walletAgg.set(trade.wallet, { trades: [] })
    }
    walletAgg.get(trade.wallet)!.trades.push({
      roi: trade.roi,
      condition_id: trade.condition_id,
      entry_time: trade.entry_time
    })
  }

  const allResults: WalletResult[] = []

  for (const [wallet, data] of walletAgg) {
    if (data.trades.length < 5) continue

    const positions = data.trades.length
    const wins = data.trades.filter(t => t.roi > 0).length
    const winRate = wins / positions
    const asinhScore = data.trades.reduce((sum, t) => sum + Math.asinh(t.roi), 0) / positions
    const totalRoi = data.trades.reduce((sum, t) => sum + t.roi, 0) * 100
    const avgRoi = totalRoi / positions
    const markets = new Set(data.trades.map(t => t.condition_id)).size
    const lastTrade = data.trades.reduce((max, t) => t.entry_time > max ? t.entry_time : max, new Date(0))

    allResults.push({
      wallet,
      positions,
      win_rate_pct: Math.round(winRate * 1000) / 10,
      asinh_score: Math.round(asinhScore * 10000) / 10000,
      total_roi_pct: Math.round(totalRoi),
      avg_roi_pct: Math.round(avgRoi * 10) / 10,
      markets_traded: markets,
      last_trade: lastTrade.toISOString().slice(0, 19).replace('T', ' ')
    })
  }

  console.log(`   ✅ Aggregated ${allResults.length} wallets`)

  // Sort by asinh score
  allResults.sort((a, b) => b.asinh_score - a.asinh_score)

  // Save to JSON
  const outputPath = './data/top-asinh-filtered-results.json'
  writeFileSync(outputPath, JSON.stringify(allResults, null, 2))

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log('')
  console.log(`💾 Saved ${allResults.length} results to ${outputPath}`)
  console.log(`⏱️  Total time: ${totalTime} seconds`)

  // Print top 50
  console.log('')
  console.log('═'.repeat(130))
  console.log(`TOP 50 WALLETS BY ASINH SCORE (${allResults.length} total)`)
  console.log('═'.repeat(130))
  console.log('')
  console.log(
    'Rank'.padEnd(6) +
    'Wallet'.padEnd(44) +
    'Trades'.padStart(8) +
    'Win%'.padStart(8) +
    'Asinh'.padStart(10) +
    'TotalROI%'.padStart(14) +
    'AvgROI%'.padStart(10) +
    'Markets'.padStart(9)
  )
  console.log('─'.repeat(130))

  allResults.slice(0, 50).forEach((row, i) => {
    console.log(
      `#${i + 1}`.padEnd(6) +
      row.wallet.padEnd(44) +
      row.positions.toString().padStart(8) +
      `${row.win_rate_pct}%`.padStart(8) +
      row.asinh_score.toFixed(4).padStart(10) +
      `${row.total_roi_pct.toLocaleString()}%`.padStart(14) +
      `${row.avg_roi_pct}%`.padStart(10) +
      row.markets_traded.toString().padStart(9)
    )
  })

  // Full details for top 10
  console.log('')
  console.log('═'.repeat(130))
  console.log('FULL WALLET DETAILS (Top 10):')
  console.log('═'.repeat(130))

  allResults.slice(0, 10).forEach((row, i) => {
    console.log(`
#${i + 1}: ${row.wallet}
    Asinh Score: ${row.asinh_score.toFixed(4)}
    Trades: ${row.positions} | Win Rate: ${row.win_rate_pct}% | Markets: ${row.markets_traded}
    Total ROI: ${row.total_roi_pct.toLocaleString()}% | Avg ROI/Trade: ${row.avg_roi_pct}%
    Last Trade: ${row.last_trade}
    View: http://localhost:3000/wallet-v2/${row.wallet}`)
  })

  console.log('')
  console.log(`✅ Complete. ${allResults.length} wallets scored and saved.`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
