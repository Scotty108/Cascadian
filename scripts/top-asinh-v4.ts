#!/usr/bin/env npx tsx
/**
 * Top Wallets by Asinh Score - Using pm_canonical_fills_v4
 *
 * FIFO matching: Each buy matched to first sell after entry (or resolution if held)
 * Uses pm_canonical_fills_v4 which already has condition_id (no token mapping needed)
 *
 * Filters:
 * - 30-day active
 * - 5+ trades, 2+ markets
 * - ≤10K trades (exclude mega-bots)
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'
import { writeFileSync, appendFileSync, existsSync, unlinkSync, readFileSync } from 'fs'

interface WalletResult {
  wallet: string
  positions: number
  win_rate_pct: number
  asinh_score: number
  total_roi_pct: number
  avg_roi_pct: number
  markets_traded: number
  sold_early: number
  held_to_resolution: number
  last_trade: string
}

async function main() {
  const startTime = Date.now()
  console.log('🔍 Top Wallets by Asinh Score (pm_canonical_fills_v4)')
  console.log('')
  console.log('Filters: 30d active, 5+ trades, 2+ markets, ≤10K trades')
  console.log('')

  // Step 1: Get wallets matching filter
  console.log('📦 Step 1: Getting filtered wallets...')
  const walletQuery = `
    SELECT wallet
    FROM pm_canonical_fills_v4 f
    JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
    WHERE f.tokens_delta > 0  -- buys only
      AND f.event_time >= now() - INTERVAL 30 DAY
      AND f.wallet != '0x0000000000000000000000000000000000000000'
      AND abs(f.usdc_delta / f.tokens_delta) BETWEEN 0.02 AND 0.98
    GROUP BY wallet
    HAVING count() >= 5 AND count() <= 10000 AND uniqExact(f.condition_id) >= 2
  `
  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' })
  const walletData = await walletResult.json() as Array<{wallet: string}>
  const wallets = walletData.map(w => w.wallet)
  console.log(`   ✅ Found ${wallets.length.toLocaleString()} wallets`)

  // Output files
  const tempPath = './data/top-asinh-v4-temp.jsonl'
  const outputPath = './data/top-asinh-v4-results.json'
  if (existsSync(tempPath)) unlinkSync(tempPath)

  // Step 2: Process in chunks
  const chunkSize = 500  // Smaller chunks for stability
  let totalProcessed = 0
  let totalWithScores = 0
  let totalSoldEarly = 0
  let totalHeldToRes = 0

  console.log('')
  console.log(`📦 Step 2: Processing ${wallets.length.toLocaleString()} wallets in ${Math.ceil(wallets.length / chunkSize)} chunks...`)

  for (let i = 0; i < wallets.length; i += chunkSize) {
    const chunk = wallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(wallets.length / chunkSize)
    const pct = Math.round((i / wallets.length) * 100)

    process.stdout.write(`\r   Chunk ${chunkNum}/${totalChunks} (${pct}%) | Wallets: ${totalWithScores.toLocaleString()} | Sold early: ${totalSoldEarly.toLocaleString()} | Held: ${totalHeldToRes.toLocaleString()}`)

    try {
      // Get buys with resolution data
      const buysQuery = `
        SELECT
          f.wallet,
          f.condition_id,
          f.outcome_index,
          f.event_time as entry_time,
          abs(f.usdc_delta / f.tokens_delta) as entry_price,
          toFloat64(JSONExtractInt(r.payout_numerators, f.outcome_index + 1) >= 1) as resolution_price,
          r.resolved_at
        FROM pm_canonical_fills_v4 f
        JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
          AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
        WHERE f.tokens_delta > 0
          AND f.event_time >= now() - INTERVAL 30 DAY
          AND f.wallet IN (${walletList})
          AND abs(f.usdc_delta / f.tokens_delta) BETWEEN 0.02 AND 0.98
      `

      // Get sells for these wallets
      const sellsQuery = `
        SELECT
          wallet,
          condition_id,
          outcome_index,
          groupArray(event_time) as sell_times,
          groupArray(abs(usdc_delta / tokens_delta)) as sell_prices
        FROM pm_canonical_fills_v4
        WHERE tokens_delta < 0  -- sells
          AND event_time >= now() - INTERVAL 30 DAY
          AND wallet IN (${walletList})
        GROUP BY wallet, condition_id, outcome_index
      `

      // Execute both
      const [buysResult, sellsResult] = await Promise.all([
        clickhouse.query({ query: buysQuery, format: 'JSONEachRow' }),
        clickhouse.query({ query: sellsQuery, format: 'JSONEachRow' })
      ])

      const buysText = await buysResult.text()
      const sellsText = await sellsResult.text()

      interface Buy {
        wallet: string
        condition_id: string
        outcome_index: number
        entry_time: string
        entry_price: number
        resolution_price: number
        resolved_at: string
      }

      interface SellData {
        wallet: string
        condition_id: string
        outcome_index: number
        sell_times: string[]
        sell_prices: number[]
      }

      const buys: Buy[] = buysText.trim().split('\n').filter(l => l).map(l => JSON.parse(l))
      const sells: SellData[] = sellsText.trim().split('\n').filter(l => l).map(l => JSON.parse(l))

      // Build sells lookup: wallet:condition_id:outcome_index -> {times, prices}
      const sellsMap = new Map<string, {sell_times: Date[], sell_prices: number[]}>()
      for (const s of sells) {
        const key = `${s.wallet}:${s.condition_id}:${s.outcome_index}`
        sellsMap.set(key, {
          sell_times: s.sell_times.map(t => new Date(t)),
          sell_prices: s.sell_prices
        })
      }

      // Calculate ROI with FIFO matching
      interface TradeROI {
        wallet: string
        condition_id: string
        entry_time: Date
        roi: number
        soldEarly: boolean
      }

      const trades: TradeROI[] = []
      for (const buy of buys) {
        const entryTime = new Date(buy.entry_time)
        const resolvedAt = new Date(buy.resolved_at)
        let exitPrice = buy.resolution_price
        let soldEarly = false

        const key = `${buy.wallet}:${buy.condition_id}:${buy.outcome_index}`
        const sellData = sellsMap.get(key)

        if (sellData) {
          // FIFO: find first sell after entry but before resolution
          for (let j = 0; j < sellData.sell_times.length; j++) {
            const sellTime = sellData.sell_times[j]
            if (sellTime > entryTime && sellTime < resolvedAt) {
              exitPrice = sellData.sell_prices[j]
              soldEarly = true
              break
            }
          }
        }

        const roi = (exitPrice - buy.entry_price) / buy.entry_price
        trades.push({
          wallet: buy.wallet,
          condition_id: buy.condition_id,
          entry_time: entryTime,
          roi,
          soldEarly
        })
      }

      // Aggregate by wallet
      const walletAgg = new Map<string, TradeROI[]>()
      for (const t of trades) {
        if (!walletAgg.has(t.wallet)) walletAgg.set(t.wallet, [])
        walletAgg.get(t.wallet)!.push(t)
      }

      // Generate results
      for (const [wallet, walletTrades] of walletAgg) {
        if (walletTrades.length < 5) continue  // 5+ trades

        const positions = walletTrades.length
        const wins = walletTrades.filter(t => t.roi > 0).length
        const winRate = Math.round((wins / positions) * 1000) / 10
        const asinhScore = Math.round(
          walletTrades.reduce((sum, t) => sum + Math.asinh(t.roi), 0) / positions * 10000
        ) / 10000
        const totalRoi = Math.round(walletTrades.reduce((sum, t) => sum + t.roi, 0) * 100)
        const avgRoi = Math.round(totalRoi / positions * 10) / 10
        const markets = new Set(walletTrades.map(t => t.condition_id)).size
        const soldEarly = walletTrades.filter(t => t.soldEarly).length
        const heldToRes = positions - soldEarly
        const lastTrade = walletTrades.reduce(
          (max, t) => t.entry_time > max ? t.entry_time : max,
          new Date(0)
        ).toISOString().slice(0, 19).replace('T', ' ')

        totalSoldEarly += soldEarly
        totalHeldToRes += heldToRes

        const result: WalletResult = {
          wallet,
          positions,
          win_rate_pct: winRate,
          asinh_score: asinhScore,
          total_roi_pct: totalRoi,
          avg_roi_pct: avgRoi,
          markets_traded: markets,
          sold_early: soldEarly,
          held_to_resolution: heldToRes,
          last_trade: lastTrade
        }
        appendFileSync(tempPath, JSON.stringify(result) + '\n')
        totalWithScores++
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

  console.log(`\n   ✅ Processed ${totalProcessed.toLocaleString()} wallets`)
  console.log(`      ${totalWithScores.toLocaleString()} wallets with 5+ trades`)
  console.log(`      ${totalSoldEarly.toLocaleString()} trades sold early | ${totalHeldToRes.toLocaleString()} held to resolution`)

  // Step 3: Sort and save
  console.log('')
  console.log('📦 Step 3: Sorting and saving results...')

  const lines = readFileSync(tempPath, 'utf-8').trim().split('\n').filter(l => l)
  const allResults: WalletResult[] = lines.map(l => JSON.parse(l))
  allResults.sort((a, b) => b.asinh_score - a.asinh_score)

  writeFileSync(outputPath, JSON.stringify(allResults, null, 2))
  unlinkSync(tempPath)

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log('')
  console.log(`💾 Saved ${allResults.length.toLocaleString()} results to ${outputPath}`)
  console.log(`⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)

  // Print top 50
  console.log('')
  console.log('═'.repeat(140))
  console.log(`TOP 50 WALLETS BY ASINH SCORE (${allResults.length.toLocaleString()} total)`)
  console.log('═'.repeat(140))
  console.log('')
  console.log(
    'Rank'.padEnd(6) +
    'Wallet'.padEnd(44) +
    'Trades'.padStart(8) +
    'Win%'.padStart(8) +
    'Asinh'.padStart(10) +
    'TotalROI%'.padStart(12) +
    'AvgROI%'.padStart(10) +
    'Markets'.padStart(9) +
    'SoldEarly'.padStart(11) +
    'Held'.padStart(8)
  )
  console.log('─'.repeat(140))

  allResults.slice(0, 50).forEach((row, i) => {
    console.log(
      `#${i + 1}`.padEnd(6) +
      row.wallet.padEnd(44) +
      row.positions.toString().padStart(8) +
      `${row.win_rate_pct}%`.padStart(8) +
      row.asinh_score.toFixed(4).padStart(10) +
      `${row.total_roi_pct.toLocaleString()}%`.padStart(12) +
      `${row.avg_roi_pct}%`.padStart(10) +
      row.markets_traded.toString().padStart(9) +
      row.sold_early.toString().padStart(11) +
      row.held_to_resolution.toString().padStart(8)
    )
  })

  // Top 10 details
  console.log('')
  console.log('═'.repeat(140))
  console.log('TOP 10 FULL DETAILS:')
  console.log('═'.repeat(140))

  allResults.slice(0, 10).forEach((row, i) => {
    const soldPct = Math.round(row.sold_early / row.positions * 100)
    console.log(`
#${i + 1}: ${row.wallet}
    Asinh Score: ${row.asinh_score.toFixed(4)}
    Trades: ${row.positions} | Win Rate: ${row.win_rate_pct}% | Markets: ${row.markets_traded}
    Total ROI: ${row.total_roi_pct.toLocaleString()}% | Avg ROI/Trade: ${row.avg_roi_pct}%
    Exit Behavior: ${row.sold_early} sold early (${soldPct}%) | ${row.held_to_resolution} held to resolution
    Last Trade: ${row.last_trade}
    View: http://localhost:3000/wallet-v2/${row.wallet}`)
  })

  console.log('')
  console.log(`✅ Complete. ${allResults.length.toLocaleString()} wallets scored.`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
