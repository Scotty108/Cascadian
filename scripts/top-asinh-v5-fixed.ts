#!/usr/bin/env npx tsx
/**
 * FIXED FIFO matching with proper token quantity tracking
 *
 * Bug fix: Previously we matched each buy to any sell, regardless of quantities.
 * Now we properly track token amounts and FIFO-consume sells.
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
  simulated_profit: number
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
}

interface Sell {
  time: Date
  price: number
  tokens: number
}

async function main() {
  const startTime = Date.now()
  console.log('🔧 FIXED FIFO Scoring - Proper Token Quantity Tracking')
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
  const outputPath = './data/top-asinh-v5-fixed.jsonl'
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
      // Get buys with token amounts
      const buysQuery = `
        SELECT
          f.wallet,
          f.condition_id,
          f.outcome_index,
          f.event_time as entry_time,
          abs(f.usdc_delta / f.tokens_delta) as entry_price,
          f.tokens_delta as tokens,
          toFloat64(JSONExtractInt(r.payout_numerators, f.outcome_index + 1) >= 1) as resolution_price,
          r.resolved_at
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
        resolved_at: new Date(b.resolved_at)
      }))

      // Track sell consumption per position
      const sellConsumption = new Map<string, number>() // key -> index of first unconsumed sell

      interface TradeResult {
        wallet: string
        condition_id: string
        entry_time: Date
        roi: number
        soldEarly: boolean
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
          soldEarly: tokensSoldEarly > buy.tokens * 0.5 // >50% sold early counts as "sold early"
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

        const simulatedProfit = Math.round(walletTrades.reduce((sum, t) => sum + t.roi, 0) * 100) / 100

        const result: WalletResult = {
          wallet, positions, win_rate_pct: winRate, asinh_score: asinhScore,
          total_roi_pct: totalRoi, avg_roi_pct: avgRoi, markets_traded: markets,
          sold_early: soldEarly, held_to_resolution: heldToRes, last_trade: lastTrade,
          simulated_profit: simulatedProfit
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
  writeFileSync('./data/top-asinh-v5-final.json', JSON.stringify(results, null, 2))

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n💾 Saved ${results.length.toLocaleString()} results to ./data/top-asinh-v5-final.json`)
  console.log(`⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)

  // Verify the problematic wallet
  console.log('\n' + '═'.repeat(80))
  console.log('VERIFICATION: 0x85bc390dd31eee600f039848e01bfef7adc6c23f')
  console.log('═'.repeat(80))
  const problemWallet = results.find(r => r.wallet === '0x85bc390dd31eee600f039848e01bfef7adc6c23f')
  if (problemWallet) {
    console.log(`   Positions: ${problemWallet.positions}`)
    console.log(`   Win rate: ${problemWallet.win_rate_pct}%`)
    console.log(`   Asinh score: ${problemWallet.asinh_score}`)
    console.log(`   Simulated profit: $${problemWallet.simulated_profit}`)
  } else {
    console.log('   Not in results (likely <5 qualifying trades now)')
  }

  // Print top 20
  console.log('\n' + '═'.repeat(80))
  console.log('TOP 20 WALLETS BY ASINH SCORE (FIXED)')
  console.log('═'.repeat(80))

  results.slice(0, 20).forEach((row, i) => {
    console.log(`#${String(i+1).padStart(2)} ${row.wallet.slice(0,12)}... | ${String(row.positions).padStart(4)} trades | ${row.win_rate_pct.toFixed(1).padStart(5)}% win | ${row.markets_traded} mkts | asinh: ${row.asinh_score.toFixed(3)} | $${row.simulated_profit.toFixed(2)} profit`)
  })
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
