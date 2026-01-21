#!/usr/bin/env npx tsx
/**
 * Corrected Copy Trading Backtest Analysis V3
 *
 * Uses a different approach to avoid memory issues:
 * 1. First get list of active wallets with 10+ trades
 * 2. Process each wallet individually using argMin to find first sell
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

async function main() {
  console.log('🔄 Running corrected copy trading analysis V3...')
  console.log('   - Using actual exit prices (sell or resolution)')
  console.log('   - Using asinh scoring formula')
  console.log('   - Filtering out bots (>5 trades/hour)')
  console.log('')

  // Step 1: Get list of qualifying wallets (10+ resolved trades, active last 7 days, <5 trades/hr)
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
    LIMIT 5000
  `

  const walletResult = await clickhouse.query({
    query: walletQuery,
    format: 'JSONEachRow'
  })
  const wallets = await walletResult.json() as Array<{wallet: string, trade_count: string}>
  console.log(`   ✅ Found ${wallets.length} qualifying wallets`)

  // Step 2: Process wallets in batches
  console.log('')
  console.log('📊 Step 2: Processing wallets in batches of 100...')

  const allResults: WalletResult[] = []
  const batchSize = 100

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize)
    const walletList = batch.map(w => `'${w.wallet}'`).join(',')

    process.stdout.write(`   Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(wallets.length/batchSize)}...`)

    const batchQuery = `
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
          countIf(sold_before_resolution = 1) as sold_early,
          countIf(sold_before_resolution = 0) as held_to_resolution,
          countIf(sold_before_resolution = 1) / count() * 100 as pct_sold_early,
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
            t.token_id,
            (t.usdc_amount / nullIf(t.token_amount, 0)) as entry_price,
            toFloat64(JSONExtractInt(r.payout_numerators, map.outcome_index + 1) >= 1) as resolution_price,
            r.resolved_at,
            -- Find first sell of same token after this buy but before resolution
            (
              SELECT min(trade_time)
              FROM pm_trader_events_v3 sell
              WHERE lower(sell.trader_wallet) = lower(t.trader_wallet)
                AND sell.token_id = t.token_id
                AND sell.side = 'sell'
                AND sell.trade_time > t.trade_time
                AND sell.trade_time < r.resolved_at
            ) as first_sell_time,
            (
              SELECT argMin(usdc_amount / nullIf(token_amount, 0), trade_time)
              FROM pm_trader_events_v3 sell
              WHERE lower(sell.trader_wallet) = lower(t.trader_wallet)
                AND sell.token_id = t.token_id
                AND sell.side = 'sell'
                AND sell.trade_time > t.trade_time
                AND sell.trade_time < r.resolved_at
            ) as first_sell_price,
            if(first_sell_time IS NOT NULL, 1, 0) as sold_before_resolution,
            if(first_sell_time IS NOT NULL, first_sell_price, resolution_price) as exit_price,
            (if(first_sell_time IS NOT NULL, first_sell_price, resolution_price) - entry_price) / entry_price as roi,
            if(first_sell_time IS NOT NULL,
               dateDiff('hour', t.trade_time, first_sell_time),
               dateDiff('hour', t.trade_time, r.resolved_at)) as hours_to_exit
          FROM pm_trader_events_v3 t
          JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
          JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
            AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
          WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
            AND t.trade_time >= now() - INTERVAL 30 DAY
            AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
            AND lower(t.trader_wallet) IN (${walletList})
        )
        GROUP BY wallet
      )
    `

    try {
      const batchResult = await clickhouse.query({
        query: batchQuery,
        format: 'JSONEachRow'
      })
      const batchData = await batchResult.json() as WalletResult[]
      allResults.push(...batchData)
      console.log(` ✅ ${batchData.length} wallets`)
    } catch (err: any) {
      console.log(` ❌ Error: ${err.message?.substring(0, 50)}...`)
    }
  }

  // Sort by asinh score
  allResults.sort((a, b) => b.asinh_score - a.asinh_score)

  // Print results
  console.log('')
  console.log('=' .repeat(120))
  console.log('TOP WALLETS BY ASINH SCORE (Corrected Analysis)')
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
    'Avg ROI%'.padStart(10) +
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
  console.log(`✅ Analysis complete. Processed ${allResults.length} wallets.`)
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
