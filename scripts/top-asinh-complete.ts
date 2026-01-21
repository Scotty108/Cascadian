#!/usr/bin/env npx tsx
/**
 * Complete the 102K wallet processing - find remaining and process them
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'
import { writeFileSync, appendFileSync, readFileSync } from 'fs'

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
  simulated_profit: number  // $1/trade simulation
}

async function main() {
  const startTime = Date.now()
  console.log('🔍 Complete 102K Processing')
  console.log('')

  // Step 1: Get all target wallets (30d filter)
  console.log('📊 Querying target wallets...')
  const targetQuery = `
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
  const targetResult = await clickhouse.query({ query: targetQuery, format: 'JSONEachRow' })
  const targetWallets = new Set((await targetResult.json() as {wallet: string}[]).map(w => w.wallet))
  console.log(`   Target wallets: ${targetWallets.size.toLocaleString()}`)

  // Step 2: Load already processed clean wallets
  const cleanWallets = new Set<string>(JSON.parse(readFileSync('./data/clean_wallet_list.json', 'utf-8')))
  console.log(`   Already processed: ${cleanWallets.size.toLocaleString()}`)

  // Step 3: Find remaining
  const remaining = [...targetWallets].filter(w => !cleanWallets.has(w))
  console.log(`   Remaining to process: ${remaining.length.toLocaleString()}`)
  console.log('')

  if (remaining.length === 0) {
    console.log('✅ All wallets already processed!')
    return
  }

  // Step 4: Process remaining in chunks
  const tempPath = './data/top-asinh-remaining.jsonl'
  writeFileSync(tempPath, '') // Clear file

  const chunkSize = 500
  let totalProcessed = 0
  let totalWithScores = 0

  console.log(`📦 Processing ${remaining.length.toLocaleString()} remaining wallets in ${Math.ceil(remaining.length / chunkSize)} chunks...`)
  console.log('')

  for (let i = 0; i < remaining.length; i += chunkSize) {
    const chunk = remaining.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(remaining.length / chunkSize)
    const pct = Math.round((i / remaining.length) * 100)

    process.stdout.write(`\r   Chunk ${chunkNum}/${totalChunks} (${pct}%) | Scored: ${totalWithScores.toLocaleString()}`)

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

        // Simulated profit: $1/trade, so profit = sum of ROIs
        const simulatedProfit = Math.round(walletTrades.reduce((sum, t) => sum + t.roi, 0) * 100) / 100

        const result: WalletResult = {
          wallet, positions, win_rate_pct: winRate, asinh_score: asinhScore,
          total_roi_pct: totalRoi, avg_roi_pct: avgRoi, markets_traded: markets,
          sold_early: soldEarly, held_to_resolution: heldToRes, last_trade: lastTrade,
          simulated_profit: simulatedProfit
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

  // Step 5: Merge with existing clean data
  console.log('\n📦 Merging all results...')

  const allResults: WalletResult[] = []

  // Load existing clean data and add simulated_profit
  const cleanData = JSON.parse(readFileSync('./data/top-asinh-30d-clean.json', 'utf-8'))
  for (const w of cleanData) {
    // Add simulated_profit if not present (total_roi_pct / 100 = profit in $)
    if (w.simulated_profit === undefined) {
      w.simulated_profit = Math.round(w.total_roi_pct) / 100
    }
    allResults.push(w)
  }
  console.log(`   Loaded ${cleanData.length.toLocaleString()} from existing clean data`)

  // Load newly processed
  const newLines = readFileSync(tempPath, 'utf-8').trim().split('\n').filter(l => l)
  for (const line of newLines) {
    allResults.push(JSON.parse(line))
  }
  console.log(`   Loaded ${newLines.length.toLocaleString()} newly processed`)

  // Dedupe by wallet
  const walletMap = new Map<string, WalletResult>()
  for (const r of allResults) {
    walletMap.set(r.wallet, r)
  }
  const dedupedResults = [...walletMap.values()]
  dedupedResults.sort((a, b) => b.asinh_score - a.asinh_score)

  // Save final consolidated file
  writeFileSync('./data/top-asinh-102k-final.json', JSON.stringify(dedupedResults, null, 2))

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n💾 Saved ${dedupedResults.length.toLocaleString()} results to ./data/top-asinh-102k-final.json`)
  console.log(`⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)

  // Coverage check
  const coverage = (dedupedResults.length / targetWallets.size * 100).toFixed(1)
  console.log(`📊 Coverage: ${dedupedResults.length.toLocaleString()} / ${targetWallets.size.toLocaleString()} (${coverage}%)`)

  // Print top 20
  console.log('\n' + '═'.repeat(100))
  console.log('TOP 20 WALLETS BY ASINH SCORE')
  console.log('═'.repeat(100))

  dedupedResults.slice(0, 20).forEach((row, i) => {
    console.log(`#${String(i+1).padStart(2)} ${row.wallet.slice(0,12)}... | ${String(row.positions).padStart(4)} trades | ${row.win_rate_pct.toFixed(1).padStart(5)}% win | ${row.markets_traded} mkts | asinh: ${row.asinh_score.toFixed(3)} | $${row.simulated_profit.toFixed(2)} profit`)
  })
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
