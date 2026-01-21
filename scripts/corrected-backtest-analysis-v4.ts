#!/usr/bin/env npx tsx
/**
 * Corrected Copy Trading Backtest Analysis V4
 *
 * Uses the array approach that worked, but processes in small batches
 * to avoid memory issues.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'

interface WalletResult {
  wallet: string
  positions: number
  sold_early: number
  held_to_resolution: number
  pct_sold_early: number
  win_rate_pct: number
  asinh_score: number
  total_roi_corrected: number
  avg_roi_pct: number
  trades_per_hour: number
  avg_hours: number
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
        AND trade_time >= now() - INTERVAL 30 DAY
        AND lower(trader_wallet) IN (${walletList})
      GROUP BY wallet, token_id
    )
    SELECT
      wallet,
      toUInt32(positions) as positions,
      toUInt32(sold_early) as sold_early,
      toUInt32(held_to_resolution) as held_to_resolution,
      round(pct_sold_early, 1) as pct_sold_early,
      round(win_rate * 100, 1) as win_rate_pct,
      round(asinh_score, 4) as asinh_score,
      round(total_roi_corrected, 0) as total_roi_corrected,
      round(avg_roi_per_trade * 100, 1) as avg_roi_pct,
      round(trades_per_hour, 2) as trades_per_hour,
      round(avg_hours_to_exit, 1) as avg_hours,
      toString(last_trade) as last_trade
    FROM (
      SELECT
        wallet,
        count() as positions,
        countIf(exit_type = 'sold') as sold_early,
        countIf(exit_type = 'held') as held_to_resolution,
        countIf(exit_type = 'sold') / count() * 100 as pct_sold_early,
        countIf(roi > 0) / count() as win_rate,
        avg(asinh(roi)) as asinh_score,
        sum(roi) * 100 as total_roi_corrected,
        avg(roi) as avg_roi_per_trade,
        count() / (dateDiff('hour', min(entry_time), max(entry_time)) + 1) as trades_per_hour,
        avg(hours_to_exit) as avg_hours_to_exit,
        max(entry_time) as last_trade
      FROM (
        SELECT
          lower(t.trader_wallet) as wallet,
          t.trade_time as entry_time,
          (t.usdc_amount / nullIf(t.token_amount, 0)) as entry_price,
          toFloat64(JSONExtractInt(r.payout_numerators, map.outcome_index + 1) >= 1) as resolution_price,
          r.resolved_at,
          arrayFirst(x -> x > t.trade_time AND x < r.resolved_at, s.sell_times) as first_sell_time,
          arrayFirst((x, i) -> s.sell_times[i] > t.trade_time AND s.sell_times[i] < r.resolved_at, s.sell_prices, arrayEnumerate(s.sell_prices)) as first_sell_price,
          if(first_sell_time > toDateTime('1970-01-01'), 'sold', 'held') as exit_type,
          if(first_sell_time > toDateTime('1970-01-01'), first_sell_price, resolution_price) as exit_price,
          (if(first_sell_time > toDateTime('1970-01-01'), first_sell_price, resolution_price) - entry_price) / entry_price as roi,
          if(first_sell_time > toDateTime('1970-01-01'),
             dateDiff('hour', t.trade_time, first_sell_time),
             dateDiff('hour', t.trade_time, r.resolved_at)) as hours_to_exit
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
        JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
          AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
        LEFT JOIN sells s ON lower(t.trader_wallet) = s.wallet AND t.token_id = s.token_id
        WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
          AND t.trade_time >= now() - INTERVAL 30 DAY
          AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
          AND lower(t.trader_wallet) IN (${walletList})
      )
      GROUP BY wallet
    )
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  })

  return await result.json() as WalletResult[]
}

async function main() {
  console.log('🔄 Running corrected copy trading analysis V4...')
  console.log('   - Using actual exit prices (sell or resolution)')
  console.log('   - Using asinh scoring formula')
  console.log('   - Filtering out bots (>5 trades/hour)')
  console.log('')

  // Step 1: Get list of qualifying wallets
  console.log('📦 Step 1: Finding qualifying wallets...')

  const walletQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      count() as trade_count,
      count() / (dateDiff('hour', min(trade_time), max(trade_time)) + 1) as trades_per_hour
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
    JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != ''
    WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
      AND t.trade_time >= now() - INTERVAL 30 DAY
      AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
    GROUP BY wallet
    HAVING
      count() >= 10
      AND max(trade_time) >= now() - INTERVAL 7 DAY
      AND trades_per_hour < 5
    ORDER BY trade_count DESC
    LIMIT 1000
  `

  const walletResult = await clickhouse.query({
    query: walletQuery,
    format: 'JSONEachRow'
  })
  const wallets = (await walletResult.json() as Array<{wallet: string}>).map(w => w.wallet)
  console.log(`   ✅ Found ${wallets.length} qualifying wallets (limited to top 1000 by trade count)`)

  // Step 2: Process in small batches
  console.log('')
  console.log('📊 Step 2: Processing wallets in batches of 20...')

  const allResults: WalletResult[] = []
  const batchSize = 20
  let successCount = 0
  let errorCount = 0

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize)
    const batchNum = Math.floor(i/batchSize) + 1
    const totalBatches = Math.ceil(wallets.length/batchSize)

    process.stdout.write(`   Batch ${batchNum}/${totalBatches}...`)

    try {
      const results = await processWalletBatch(batch)
      allResults.push(...results)
      successCount += results.length
      console.log(` ✅ ${results.length} wallets`)
    } catch (err: any) {
      errorCount += batch.length
      const msg = err.message?.substring(0, 80) || 'Unknown error'
      console.log(` ❌ ${msg}`)
    }
  }

  console.log('')
  console.log(`   📊 Processed: ${successCount} success, ${errorCount} errors`)

  // Sort by asinh score
  allResults.sort((a, b) => b.asinh_score - a.asinh_score)

  // Print results
  console.log('')
  console.log('=' .repeat(120))
  console.log('TOP 50 WALLETS BY ASINH SCORE (Corrected Analysis)')
  console.log('=' .repeat(120))
  console.log('')

  console.log(
    'Rank'.padEnd(6) +
    'Wallet'.padEnd(44) +
    'Trades'.padStart(8) +
    'Sold%'.padStart(8) +
    'Win%'.padStart(8) +
    'Asinh'.padStart(10) +
    'ROI%'.padStart(12) +
    'AvgROI%'.padStart(10) +
    'Tr/Hr'.padStart(8) +
    'AvgHrs'.padStart(8)
  )
  console.log('-'.repeat(120))

  allResults.slice(0, 50).forEach((row, i) => {
    console.log(
      `#${i + 1}`.padEnd(6) +
      row.wallet.padEnd(44) +
      row.positions.toString().padStart(8) +
      `${row.pct_sold_early}%`.padStart(8) +
      `${row.win_rate_pct}%`.padStart(8) +
      row.asinh_score.toFixed(4).padStart(10) +
      `${row.total_roi_corrected.toLocaleString()}%`.padStart(12) +
      `${row.avg_roi_pct}%`.padStart(10) +
      row.trades_per_hour.toFixed(2).padStart(8) +
      row.avg_hours.toFixed(1).padStart(8)
    )
  })

  console.log('')
  console.log('=' .repeat(120))

  // Top 10 detailed
  console.log('')
  console.log('TOP 10 RECOMMENDED FOR COPY TRADING:')
  console.log('=' .repeat(120))

  const top10 = allResults.slice(0, 10)
  top10.forEach((row, i) => {
    console.log(`
#${i + 1}: ${row.wallet}
    Asinh Score: ${row.asinh_score.toFixed(4)}
    Positions: ${row.positions} | Win Rate: ${row.win_rate_pct}% | Sold Early: ${row.pct_sold_early}%
    Corrected ROI: ${row.total_roi_corrected.toLocaleString()}%
    Profit @ $100/trade: $${row.total_roi_corrected.toLocaleString()}
    Avg Time to Exit: ${row.avg_hours.toFixed(1)}h | Trades/Hour: ${row.trades_per_hour.toFixed(2)}
    Last Trade: ${row.last_trade}
    View: http://localhost:3000/wallet-v2/${row.wallet}
`)
  })

  console.log('')
  console.log(`✅ Analysis complete. Found ${allResults.length} qualifying wallets.`)
}

main().catch(err => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})
