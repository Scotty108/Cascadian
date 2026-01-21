#!/usr/bin/env npx tsx
/**
 * Resume processing - only remaining wallets
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs'

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
  console.log('🔍 Asinh Score - Resume Mode (remaining wallets only)')
  console.log('')

  // Load remaining wallets
  const wallets: string[] = JSON.parse(readFileSync('./data/remaining_wallets.json', 'utf-8'))
  console.log(`📦 Loaded ${wallets.length.toLocaleString()} remaining wallets`)

  // Output file (append mode)
  const tempPath = './data/top-asinh-v4-temp.jsonl'

  // Process in chunks
  const chunkSize = 500
  let totalProcessed = 0
  let totalWithScores = 0
  let totalSoldEarly = 0
  let totalHeldToRes = 0

  console.log(`📦 Processing in ${Math.ceil(wallets.length / chunkSize)} chunks...`)
  console.log('')

  for (let i = 0; i < wallets.length; i += chunkSize) {
    const chunk = wallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(wallets.length / chunkSize)
    const pct = Math.round((i / wallets.length) * 100)

    process.stdout.write(`\r   Chunk ${chunkNum}/${totalChunks} (${pct}%) | Wallets: ${totalWithScores.toLocaleString()} | Sold: ${totalSoldEarly.toLocaleString()} | Held: ${totalHeldToRes.toLocaleString()}`)

    try {
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

      const sellsQuery = `
        SELECT
          wallet,
          condition_id,
          outcome_index,
          groupArray(event_time) as sell_times,
          groupArray(abs(usdc_delta / tokens_delta)) as sell_prices
        FROM pm_canonical_fills_v4
        WHERE tokens_delta < 0
          AND event_time >= now() - INTERVAL 30 DAY
          AND wallet IN (${walletList})
        GROUP BY wallet, condition_id, outcome_index
      `

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

      const sellsMap = new Map<string, {sell_times: Date[], sell_prices: number[]}>()
      for (const s of sells) {
        const key = `${s.wallet}:${s.condition_id}:${s.outcome_index}`
        sellsMap.set(key, {
          sell_times: s.sell_times.map(t => new Date(t)),
          sell_prices: s.sell_prices
        })
      }

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
        trades.push({ wallet: buy.wallet, condition_id: buy.condition_id, entry_time: entryTime, roi, soldEarly })
      }

      const walletAgg = new Map<string, TradeROI[]>()
      for (const t of trades) {
        if (!walletAgg.has(t.wallet)) walletAgg.set(t.wallet, [])
        walletAgg.get(t.wallet)!.push(t)
      }

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
        const soldEarly = walletTrades.filter(t => t.soldEarly).length
        const heldToRes = positions - soldEarly
        const lastTrade = walletTrades.reduce(
          (max, t) => t.entry_time > max ? t.entry_time : max,
          new Date(0)
        ).toISOString().slice(0, 19).replace('T', ' ')

        totalSoldEarly += soldEarly
        totalHeldToRes += heldToRes

        const result: WalletResult = {
          wallet, positions, win_rate_pct: winRate, asinh_score: asinhScore,
          total_roi_pct: totalRoi, avg_roi_pct: avgRoi, markets_traded: markets,
          sold_early: soldEarly, held_to_resolution: heldToRes, last_trade: lastTrade
        }
        appendFileSync(tempPath, JSON.stringify(result) + '\n')
        totalWithScores++
      }

      totalProcessed += chunk.length
    } catch (err: any) {
      console.error(`\n   ⚠️ Chunk ${chunkNum} error: ${err.message.slice(0, 100)}`)
    }
  }

  console.log(`\n   ✅ Processed ${totalProcessed.toLocaleString()} wallets, ${totalWithScores.toLocaleString()} with scores`)

  // Now merge all results and sort
  console.log('\n📦 Merging all results...')

  const allResults: WalletResult[] = []
  for (const file of ['./data/top-asinh-v4-partial-75k.jsonl', './data/top-asinh-v4-partial-59k.jsonl', tempPath]) {
    try {
      const lines = readFileSync(file, 'utf-8').trim().split('\n').filter(l => l)
      for (const line of lines) {
        allResults.push(JSON.parse(line))
      }
    } catch {}
  }

  // Dedupe by wallet (keep latest)
  const walletMap = new Map<string, WalletResult>()
  for (const r of allResults) {
    walletMap.set(r.wallet, r)
  }
  const dedupedResults = [...walletMap.values()]
  dedupedResults.sort((a, b) => b.asinh_score - a.asinh_score)

  writeFileSync('./data/top-asinh-v4-results.json', JSON.stringify(dedupedResults, null, 2))

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n💾 Saved ${dedupedResults.length.toLocaleString()} results to ./data/top-asinh-v4-results.json`)
  console.log(`⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)

  // Print top 20
  console.log('\n' + '═'.repeat(130))
  console.log('TOP 20 WALLETS BY ASINH SCORE')
  console.log('═'.repeat(130))

  dedupedResults.slice(0, 20).forEach((row, i) => {
    console.log(`#${i + 1} ${row.wallet} | Asinh: ${row.asinh_score.toFixed(4)} | ${row.positions} trades | ${row.win_rate_pct}% win | ${row.total_roi_pct.toLocaleString()}% ROI`)
  })
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
