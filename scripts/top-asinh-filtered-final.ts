#!/usr/bin/env npx tsx
/**
 * Top Wallets by Asinh Score - Filtered
 *
 * Filters:
 * - Active in last 10 days
 * - >10 trades (90d)
 * - >5 markets (90d)
 * - >$5k volume (90d)
 *
 * Scoring: Asinh with actual exit prices (90d window)
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

async function processWalletBatch(wallets: string[]): Promise<WalletResult[]> {
  const walletList = wallets.map(w => `'${w}'`).join(',')

  const query = `
    WITH sells AS (
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
    )
    SELECT
      wallet,
      toUInt32(positions) as positions,
      round(win_rate * 100, 1) as win_rate_pct,
      round(asinh_score, 4) as asinh_score,
      round(total_roi, 0) as total_roi_pct,
      round(avg_roi * 100, 1) as avg_roi_pct,
      toUInt32(markets_traded) as markets_traded,
      toString(last_trade) as last_trade
    FROM (
      SELECT
        wallet,
        count() as positions,
        countIf(roi > 0) / count() as win_rate,
        avg(asinh(roi)) as asinh_score,
        sum(roi) * 100 as total_roi,
        avg(roi) as avg_roi,
        uniqExact(condition_id) as markets_traded,
        max(entry_time) as last_trade
      FROM (
        SELECT
          lower(t.trader_wallet) as wallet,
          t.trade_time as entry_time,
          map.condition_id as condition_id,
          (t.usdc_amount / nullIf(t.token_amount, 0)) as entry_price,
          toFloat64(JSONExtractInt(r.payout_numerators, map.outcome_index + 1) >= 1) as resolution_price,
          r.resolved_at,
          arrayFirst(x -> x > t.trade_time AND x < r.resolved_at, s.sell_times) as first_sell_time,
          arrayFirst((x, i) -> s.sell_times[i] > t.trade_time AND s.sell_times[i] < r.resolved_at, s.sell_prices, arrayEnumerate(s.sell_prices)) as first_sell_price,
          (if(first_sell_time > toDateTime('1970-01-01'), first_sell_price, resolution_price) - entry_price) / entry_price as roi
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
        JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
          AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
        LEFT JOIN sells s ON lower(t.trader_wallet) = s.wallet AND t.token_id = s.token_id
        WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
          AND t.trade_time >= now() - INTERVAL 90 DAY
          AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
          AND lower(t.trader_wallet) IN (${walletList})
      )
      GROUP BY wallet
      HAVING count() >= 5
    )
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  return await result.json() as WalletResult[]
}

async function main() {
  const startTime = Date.now()
  console.log('🔍 Top Wallets by Asinh Score (Filtered)')
  console.log('')
  console.log('Filters:')
  console.log('  - Active in last 3 days')
  console.log('  - >10 trades (90d)')
  console.log('  - >5 markets (90d)')
  console.log('  - >$5k volume (90d)')
  console.log('  - <40 trades/day avg')
  console.log('  - >$15 avg trade size')
  console.log('')

  // Step 1: Get filtered wallets (using RESOLVED trades - same criteria as scoring)
  console.log('📦 Step 1: Getting filtered wallet list (resolved trades)...')
  const walletQuery = `
    SELECT wallet
    FROM (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trades,
        uniqExact(map.condition_id) as markets,
        sum(t.usdc_amount) / 1e6 as volume_usdc,
        count() / greatest(dateDiff('day', min(t.trade_time), max(t.trade_time)), 1) as trades_per_day,
        (sum(t.usdc_amount) / 1e6) / count() as avg_trade_size
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
      JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
        AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
      WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
        AND t.trade_time >= now() - INTERVAL 90 DAY
        AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
      GROUP BY wallet
      HAVING trades > 10 AND markets > 5 AND volume_usdc > 5000
        AND trades_per_day < 40 AND avg_trade_size > 15
    )
    WHERE wallet IN (
      SELECT lower(trader_wallet)
      FROM pm_trader_events_v3
      WHERE side = 'buy' AND trade_time >= now() - INTERVAL 3 DAY
    )
    ORDER BY wallet
  `
  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' })
  const wallets = (await walletResult.json() as Array<{wallet: string}>).map(w => w.wallet)
  console.log(`   ✅ Found ${wallets.length} wallets`)

  // Step 2: Process in batches
  console.log('')
  console.log('📊 Step 2: Calculating asinh scores...')
  const allResults: WalletResult[] = []
  const batchSize = 30
  const totalBatches = Math.ceil(wallets.length / batchSize)

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const pct = Math.round((i / wallets.length) * 100)
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    process.stdout.write(`\r   Progress: ${pct}% (${batchNum}/${totalBatches}) | Found: ${allResults.length} | ${elapsed}s elapsed`)

    try {
      const results = await processWalletBatch(batch)
      allResults.push(...results)
    } catch (err: any) {
      console.error(`\n❌ Batch error: ${err.message}`)
    }
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\r   ✅ Complete! Found ${allResults.length} wallets with scores | ${totalTime}s total                    `)

  // Sort by asinh score
  allResults.sort((a, b) => b.asinh_score - a.asinh_score)

  // Save to JSON
  const outputPath = './data/top-asinh-filtered-results.json'
  writeFileSync(outputPath, JSON.stringify(allResults, null, 2))
  console.log(`\n💾 Saved ${allResults.length} results to ${outputPath}`)

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
    'Markets'.padStart(9) +
    'LastTrade'.padStart(12)
  )
  console.log('─'.repeat(130))

  allResults.slice(0, 50).forEach((row, i) => {
    const lastTradeDate = row.last_trade.slice(5, 10).replace('-', '/')
    console.log(
      `#${i + 1}`.padEnd(6) +
      row.wallet.padEnd(44) +
      row.positions.toString().padStart(8) +
      `${row.win_rate_pct}%`.padStart(8) +
      row.asinh_score.toFixed(4).padStart(10) +
      `${row.total_roi_pct.toLocaleString()}%`.padStart(14) +
      `${row.avg_roi_pct}%`.padStart(10) +
      row.markets_traded.toString().padStart(9) +
      lastTradeDate.padStart(12)
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
  console.log(`   Total time: ${totalTime} seconds`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
