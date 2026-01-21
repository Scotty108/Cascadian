#!/usr/bin/env npx tsx
/**
 * Find Top Wallets by Asinh Score (Filtered) - V2
 *
 * Fixed version that properly handles the 90-day resolved trades window.
 *
 * Filters:
 * - Active in last 10 days (any buy trade)
 * - Has resolved trades in 90-day window (calculated on)
 * - 5+ trades in window (relaxed from 10)
 * - 2+ different markets
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'

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
          map.condition_id,
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
  console.log('🔍 Finding top wallets by Asinh Score (Filtered V2)...')
  console.log('')
  console.log('   Selection:')
  console.log('   - Active in last 10 days (any buy trade)')
  console.log('   - Has 10+ resolved trades in last 90 days')
  console.log('')
  console.log('   Scoring (90-day resolved trades):')
  console.log('   - Asinh score with actual exit prices')
  console.log('   - 5+ trades minimum in window')
  console.log('')

  // Get wallets that:
  // 1. Have been active (any buy) in last 10 days
  // 2. Have 10+ RESOLVED trades in the 90-day window (matching our scoring window)
  console.log('📦 Step 1: Getting wallet list...')
  const walletQuery = `
    SELECT wallet, resolved_90d
    FROM (
      -- Wallets with 10+ resolved trades in 90-day window
      SELECT
        lower(trader_wallet) as wallet,
        count() as resolved_90d
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
      JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
        AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
      WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
        AND t.trade_time >= now() - INTERVAL 90 DAY
        AND (t.usdc_amount / nullIf(t.token_amount, 0)) BETWEEN 0.02 AND 0.98
      GROUP BY wallet
      HAVING resolved_90d >= 10
    ) resolved
    JOIN (
      -- Active in last 10 days
      SELECT lower(trader_wallet) as wallet
      FROM pm_trader_events_v3
      WHERE side = 'buy' AND trade_time >= now() - INTERVAL 10 DAY
      GROUP BY wallet
    ) recent USING wallet
    ORDER BY resolved_90d DESC
  `
  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' })
  const wallets = (await walletResult.json() as Array<{wallet: string, resolved_90d: number}>).map(w => w.wallet)
  console.log(`   ✅ Found ${wallets.length} wallets (active 10d + 10+ resolved in 90d)`)

  if (wallets.length === 0) {
    console.log('')
    console.log('❌ No wallets found. Debugging...')

    // Debug: count how many wallets are active in last 10 days
    const debug1 = await clickhouse.query({
      query: `SELECT count(DISTINCT lower(trader_wallet)) as cnt FROM pm_trader_events_v3 WHERE side = 'buy' AND trade_time >= now() - INTERVAL 10 DAY`,
      format: 'JSONEachRow'
    })
    const d1 = await debug1.json() as Array<{cnt: number}>
    console.log(`   Active in 10d: ${d1[0]?.cnt || 0}`)

    // Debug: count how many wallets have 10+ resolved in 90d
    const debug2 = await clickhouse.query({
      query: `
        SELECT count() as cnt FROM (
          SELECT lower(trader_wallet) as wallet
          FROM pm_trader_events_v3 t
          JOIN pm_token_to_condition_map_v5 map ON t.token_id = map.token_id_dec
          JOIN pm_condition_resolutions r ON map.condition_id = r.condition_id
            AND r.is_deleted = 0 AND r.payout_numerators != '' AND r.payout_numerators != '[]'
          WHERE t.side = 'buy' AND t.usdc_amount > 0 AND t.token_amount > 0
            AND t.trade_time >= now() - INTERVAL 90 DAY
          GROUP BY wallet
          HAVING count() >= 10
        )
      `,
      format: 'JSONEachRow'
    })
    const d2 = await debug2.json() as Array<{cnt: number}>
    console.log(`   10+ resolved in 90d: ${d2[0]?.cnt || 0}`)

    return
  }

  // Process in batches
  console.log('')
  console.log('📊 Step 2: Calculating asinh scores...')
  const allResults: WalletResult[] = []
  const batchSize = 50

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize)
    const pct = Math.round((i / wallets.length) * 100)
    process.stdout.write(`\r   Progress: ${pct}% (${i}/${wallets.length}) | Found: ${allResults.length}`)

    try {
      const results = await processWalletBatch(batch)
      allResults.push(...results)
    } catch (err: any) {
      // Skip errors silently
    }
  }
  console.log(`\r   ✅ Complete! Found ${allResults.length} wallets with scores                    `)

  // Sort by asinh score
  allResults.sort((a, b) => b.asinh_score - a.asinh_score)

  // Apply post-hoc filters (more flexible than SQL HAVING)
  const filtered = allResults.filter(w => w.markets_traded >= 2)

  // Print results
  console.log('')
  console.log('═'.repeat(120))
  console.log(`TOP 30 WALLETS BY ASINH SCORE (${filtered.length} total passed filters)`)
  console.log('═'.repeat(120))
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
  console.log('─'.repeat(120))

  filtered.slice(0, 30).forEach((row, i) => {
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

  console.log('')
  console.log('═'.repeat(120))
  console.log('')
  console.log('FULL WALLET DETAILS (Top 10):')
  console.log('═'.repeat(120))

  filtered.slice(0, 10).forEach((row, i) => {
    console.log(`
#${i + 1}: ${row.wallet}
    Asinh Score: ${row.asinh_score.toFixed(4)}
    Trades: ${row.positions} | Win Rate: ${row.win_rate_pct}% | Markets: ${row.markets_traded}
    Total ROI: ${row.total_roi_pct.toLocaleString()}% | Avg ROI/Trade: ${row.avg_roi_pct}%
    Last Trade: ${row.last_trade}
    View: http://localhost:3000/wallet-v2/${row.wallet}`)
  })

  console.log('')
  console.log(`✅ Complete. ${filtered.length} wallets passed all filters.`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
