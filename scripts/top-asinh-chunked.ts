#!/usr/bin/env npx tsx
/**
 * Top Wallets by Asinh Score - Chunked Processing
 *
 * Memory-efficient: Process wallets in chunks, fetching sells per chunk
 * to avoid loading all sells data into memory at once.
 *
 * Filters:
 * - 90-day active (resolved trades)
 * - 5+ trades
 * - 2+ markets
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'
import { writeFileSync, appendFileSync, existsSync, unlinkSync } from 'fs'

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
  console.log('🔍 Top Wallets by Asinh Score (Chunked Processing)')
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
  console.log(`   ✅ Found ${wallets.length.toLocaleString()} wallets`)

  // Output file for streaming results
  const outputPath = './data/top-asinh-full-results.json'
  const tempPath = './data/top-asinh-full-results.jsonl'

  // Clear temp file
  if (existsSync(tempPath)) unlinkSync(tempPath)

  // Process in chunks
  const chunkSize = 1000 // Smaller chunks to manage memory
  let totalProcessed = 0
  let totalWithData = 0

  console.log('')
  console.log(`📦 Step 2: Processing ${wallets.length.toLocaleString()} wallets in ${Math.ceil(wallets.length / chunkSize)} chunks...`)
  console.log('')

  for (let i = 0; i < wallets.length; i += chunkSize) {
    const chunk = wallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(wallets.length / chunkSize)
    const pct = Math.round((i / wallets.length) * 100)

    process.stdout.write(`\r   Chunk ${chunkNum}/${totalChunks} (${pct}%) | Processed: ${totalProcessed.toLocaleString()} | With scores: ${totalWithData.toLocaleString()}`)

    try {
      // Simpler approach: fetch buys and sells separately, join in memory
      // Get buys for this chunk
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

      // Get sells for this chunk
      const sellsQuery = `
        SELECT
          lower(trader_wallet) as wallet,
          token_id,
          groupArray(trade_time) as sell_times,
          groupArray(usdc_amount / nullIf(token_amount, 0)) as sell_prices
        FROM pm_trader_events_v3
        WHERE side = 'sell' AND usdc_amount > 0 AND token_amount > 0
          AND trade_time >= now() - INTERVAL 90 DAY
          AND lower(trader_wallet) IN (${walletList})
        GROUP BY wallet, token_id
      `

      // Execute both queries
      const [buysResult, sellsResult] = await Promise.all([
        clickhouse.query({ query: buysQuery, format: 'JSONEachRow' }),
        clickhouse.query({ query: sellsQuery, format: 'JSONEachRow' })
      ])

      const buysText = await buysResult.text()
      const sellsText = await sellsResult.text()

      interface Buy {
        wallet: string
        token_id: string
        entry_time: string
        condition_id: string
        entry_price: number
        resolution_price: number
        resolved_at: string
      }

      interface SellData {
        wallet: string
        token_id: string
        sell_times: string[]
        sell_prices: number[]
      }

      const buys: Buy[] = buysText.trim().split('\n').filter(l => l).map(l => JSON.parse(l))
      const sells: SellData[] = sellsText.trim().split('\n').filter(l => l).map(l => JSON.parse(l))

      // Build sells lookup
      const sellsMap = new Map<string, {sell_times: Date[], sell_prices: number[]}>()
      for (const s of sells) {
        const key = `${s.wallet}:${s.token_id}`
        sellsMap.set(key, {
          sell_times: s.sell_times.map(t => new Date(t)),
          sell_prices: s.sell_prices
        })
      }

      // Calculate ROI for each buy
      interface TradeROI {
        wallet: string
        condition_id: string
        entry_time: Date
        roi: number
      }

      const trades: TradeROI[] = []
      for (const buy of buys) {
        const entryTime = new Date(buy.entry_time)
        const resolvedAt = new Date(buy.resolved_at)
        let exitPrice = buy.resolution_price

        const sellData = sellsMap.get(`${buy.wallet}:${buy.token_id}`)
        if (sellData) {
          for (let i = 0; i < sellData.sell_times.length; i++) {
            const sellTime = sellData.sell_times[i]
            if (sellTime > entryTime && sellTime < resolvedAt) {
              exitPrice = sellData.sell_prices[i]
              break
            }
          }
        }

        const roi = (exitPrice - buy.entry_price) / buy.entry_price
        trades.push({
          wallet: buy.wallet,
          condition_id: buy.condition_id,
          entry_time: entryTime,
          roi
        })
      }

      // Aggregate by wallet
      const walletAgg = new Map<string, TradeROI[]>()
      for (const t of trades) {
        if (!walletAgg.has(t.wallet)) walletAgg.set(t.wallet, [])
        walletAgg.get(t.wallet)!.push(t)
      }

      // Generate results for wallets with 5+ trades
      for (const [wallet, walletTrades] of walletAgg) {
        if (walletTrades.length < 5) continue

        const positions = walletTrades.length
        const wins = walletTrades.filter(t => t.roi > 0).length
        const winRate = Math.round((wins / positions) * 1000) / 10
        const asinhScore = Math.round(
          walletTrades.reduce((sum, t) => sum + Math.asinh(t.roi), 0) / positions * 10000
        ) / 10000
        const totalRoi = Math.round(walletTrades.reduce((sum, t) => sum + t.roi, 0) * 100)
        const avgRoi = Math.round(totalRoi / positions * 10) / 10
        const markets = new Set(walletTrades.map(t => t.condition_id)).size
        const lastTrade = walletTrades.reduce(
          (max, t) => t.entry_time > max ? t.entry_time : max,
          new Date(0)
        ).toISOString().slice(0, 19).replace('T', ' ')

        const result = {
          wallet,
          positions,
          win_rate_pct: winRate,
          asinh_score: asinhScore,
          total_roi_pct: totalRoi,
          avg_roi_pct: avgRoi,
          markets_traded: markets,
          last_trade: lastTrade
        }
        appendFileSync(tempPath, JSON.stringify(result) + '\n')
        totalWithData++
      }

      totalProcessed += chunk.length

      // Clear memory
      buys.length = 0
      sells.length = 0
      sellsMap.clear()
      trades.length = 0
      walletAgg.clear()
    } catch (err: any) {
      console.error(`\n   ⚠️ Chunk ${chunkNum} error: ${err.message.slice(0, 100)}`)
    }
  }

  console.log(`\n   ✅ Processed ${totalProcessed.toLocaleString()} wallets, ${totalWithData.toLocaleString()} with scores`)

  // Read results and sort
  console.log('')
  console.log('📦 Step 3: Sorting and saving results...')

  const { readFileSync } = await import('fs')
  const lines = readFileSync(tempPath, 'utf-8').trim().split('\n').filter(l => l)
  const allResults: WalletResult[] = lines.map(l => JSON.parse(l))

  // Sort by asinh score
  allResults.sort((a, b) => b.asinh_score - a.asinh_score)

  // Save final JSON
  writeFileSync(outputPath, JSON.stringify(allResults, null, 2))

  // Cleanup temp file
  unlinkSync(tempPath)

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log('')
  console.log(`💾 Saved ${allResults.length.toLocaleString()} results to ${outputPath}`)
  console.log(`⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)

  // Print top 50
  console.log('')
  console.log('═'.repeat(130))
  console.log(`TOP 50 WALLETS BY ASINH SCORE (${allResults.length.toLocaleString()} total)`)
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
  console.log(`✅ Complete. ${allResults.length.toLocaleString()} wallets scored and saved.`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
