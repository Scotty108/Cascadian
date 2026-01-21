#!/usr/bin/env npx tsx
/**
 * Build pm_wallet_copy_trading_metrics_v1 - FAST version
 *
 * Uses hold-to-resolution assumption for speed (~5-10 min for 300K wallets)
 * Includes sold_early_pct so users know which wallets actively manage positions.
 *
 * For wallets with sold_early_pct < 20%, metrics are very accurate.
 * For wallets with sold_early_pct > 50%, actual ROI may differ from calculated.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  const startTime = Date.now()
  console.log('🔧 Building pm_wallet_copy_trading_metrics_v1 (FAST)')
  console.log('')

  // Get all wallets with resolved trades in last 30 days
  console.log('📊 Finding wallets to process...')
  const walletQuery = `
    SELECT DISTINCT f.wallet
    FROM pm_canonical_fills_v4 f
    INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != ''
    WHERE f.source = 'clob'
      AND f.tokens_delta > 0
      AND f.event_time >= now() - INTERVAL 30 DAY
      AND f.wallet != '0x0000000000000000000000000000000000000000'
      AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
  `
  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' })
  const allWallets = (await walletResult.json() as { wallet: string }[]).map(w => w.wallet)
  console.log(`   Found ${allWallets.length.toLocaleString()} wallets`)

  // Process in chunks using SQL aggregation (much faster)
  // Note: 500 wallets per chunk to stay under ClickHouse query size limit (256KB)
  const chunkSize = 500
  let totalProcessed = 0
  let totalInserted = 0

  console.log(`\n📦 Processing ${Math.ceil(allWallets.length / chunkSize)} chunks...`)

  for (let i = 0; i < allWallets.length; i += chunkSize) {
    const chunk = allWallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(allWallets.length / chunkSize)
    const pct = Math.round((i / allWallets.length) * 100)

    process.stdout.write(`\r   Chunk ${chunkNum}/${totalChunks} (${pct}%) | Inserted: ${totalInserted.toLocaleString()}`)

    try {
      // Calculate sold_early_pct first (positions with sells before resolution)
      // Then calculate per-trade ROI using hold-to-resolution

      const insertQuery = `
        INSERT INTO pm_wallet_copy_trading_metrics_v1
        WITH
          -- Get buy trades with resolution info
          buy_trades AS (
            SELECT
              f.tx_hash,
              f.wallet,
              f.condition_id,
              f.outcome_index,
              min(f.event_time) as entry_time,
              sum(f.tokens_delta) as tokens,
              sum(abs(f.usdc_delta)) as cost_usd,
              max(f.is_maker) as is_maker,
              CASE
                WHEN r.payout_numerators = '[1,1]' THEN 0.5
                WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
                WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
                ELSE 0.0
              END as payout_rate,
              r.resolved_at
            FROM pm_canonical_fills_v4 f
            INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
              AND r.is_deleted = 0 AND r.payout_numerators != ''
            WHERE f.source = 'clob'
              AND f.tokens_delta > 0
              AND f.event_time >= now() - INTERVAL 30 DAY
              AND f.wallet IN (${walletList})
              AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
            GROUP BY f.tx_hash, f.wallet, f.condition_id, f.outcome_index, r.payout_numerators, r.resolved_at
          ),

          -- Calculate per-trade ROI (hold to resolution)
          trade_roi AS (
            SELECT
              wallet,
              tx_hash,
              condition_id,
              entry_time,
              cost_usd,
              tokens,
              payout_rate,
              is_maker,
              resolved_at,
              CASE
                WHEN cost_usd > 0.01 THEN ((tokens * payout_rate) - cost_usd) / cost_usd
                ELSE 0
              END as roi
            FROM buy_trades
            WHERE cost_usd > 0.01
          ),

          -- Check for sells before resolution (per position)
          sells_before_resolution AS (
            SELECT
              f.wallet,
              f.condition_id,
              f.outcome_index,
              1 as has_early_sell
            FROM pm_canonical_fills_v4 f
            INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
              AND r.is_deleted = 0
            WHERE f.source = 'clob'
              AND f.tokens_delta < 0
              AND f.event_time < r.resolved_at
              AND f.event_time >= now() - INTERVAL 30 DAY
              AND f.wallet IN (${walletList})
            GROUP BY f.wallet, f.condition_id, f.outcome_index
          ),

          -- Count positions with early sells per wallet
          early_sell_counts AS (
            SELECT
              wallet,
              count() as positions_with_early_sells
            FROM sells_before_resolution
            GROUP BY wallet
          )

        SELECT
          t.wallet,
          toUInt32(count()) as total_trades,
          toUInt32(countIf(t.roi > 0)) as wins,
          toUInt32(countIf(t.roi <= 0)) as losses,
          toFloat32(round(countIf(t.roi > 0) * 100.0 / count(), 2)) as win_rate_pct,

          toFloat32(round(avg(t.roi) * 100, 2)) as avg_roi_pct,
          toFloat32(round(avgIf(t.roi, t.roi > 0) * 100, 2)) as avg_win_roi_pct,
          toFloat32(round(abs(avgIf(t.roi, t.roi <= 0)) * 100, 2)) as avg_loss_roi_pct,
          toFloat32(round(medianIf(t.roi, t.roi > 0) * 100, 2)) as median_win_roi_pct,
          toFloat32(round(stddevPop(t.roi) * 100, 2)) as roi_stddev_pct,

          toFloat32(round(countIf(t.roi > 0.5 AND t.roi > 0) * 100.0 / nullIf(countIf(t.roi > 0), 0), 1)) as pct_wins_over_50,
          toFloat32(round(countIf(t.roi > 1.0 AND t.roi > 0) * 100.0 / nullIf(countIf(t.roi > 0), 0), 1)) as pct_wins_over_100,
          toFloat32(round(countIf(t.roi > 5.0 AND t.roi > 0) * 100.0 / nullIf(countIf(t.roi > 0), 0), 1)) as pct_wins_over_500,
          toFloat32(round(max(t.roi) * 100, 2)) as max_win_roi_pct,

          toFloat32(round(countIf(t.roi < -0.5 AND t.roi <= 0) * 100.0 / nullIf(countIf(t.roi <= 0), 0), 1)) as pct_losses_over_50,
          toFloat32(round(countIf(t.roi < -0.9 AND t.roi <= 0) * 100.0 / nullIf(countIf(t.roi <= 0), 0), 1)) as pct_losses_over_90,
          toFloat32(round(min(t.roi) * 100, 2)) as max_loss_roi_pct,

          toFloat32(round((countIf(t.roi > 0) / count() * avgIf(t.roi, t.roi > 0) -
                   countIf(t.roi <= 0) / count() * abs(avgIf(t.roi, t.roi <= 0))) * 100, 2)) as expectancy_pct,
          toFloat32(round(avg(asinh(t.roi)), 4)) as asinh_score,
          toFloat32(round(avgIf(t.roi, t.roi > 0) / nullIf(abs(avgIf(t.roi, t.roi <= 0)), 0), 2)) as win_loss_ratio,

          round(sum(t.cost_usd), 2) as total_volume_usd,
          round(sum(t.tokens * t.payout_rate - t.cost_usd), 2) as total_pnl_usd,
          toFloat32(round(avg(t.cost_usd), 2)) as avg_trade_usd,

          toUInt32(count(DISTINCT t.condition_id)) as positions_traded,
          min(t.entry_time) as first_trade_time,
          max(t.entry_time) as last_trade_time,
          toUInt16(dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1) as days_active,
          toFloat32(round(count() / (dateDiff('day', min(t.entry_time), max(t.entry_time)) + 1), 2)) as trades_per_day,

          toFloat32(round(countIf(t.is_maker = 1) * 100.0 / count(), 1)) as maker_pct,
          toFloat32(round(countIf(t.is_maker = 0) * 100.0 / count(), 1)) as taker_pct,
          toFloat32(round(ifNull(e.positions_with_early_sells, 0) * 100.0 / count(DISTINCT concat(t.condition_id, toString(t.payout_rate))), 1)) as sold_early_pct,

          now() as computed_at

        FROM trade_roi t
        LEFT JOIN early_sell_counts e ON t.wallet = e.wallet
        GROUP BY t.wallet, e.positions_with_early_sells
        HAVING count() >= 5
        SETTINGS max_execution_time = 300, max_memory_usage = 8000000000
      `

      await clickhouse.command({ query: insertQuery })

      // Count inserted
      const countResult = await clickhouse.query({
        query: `SELECT count() as cnt FROM pm_wallet_copy_trading_metrics_v1`,
        format: 'JSONEachRow'
      })
      const countRows = await countResult.json() as { cnt: number }[]
      totalInserted = countRows[0]?.cnt || 0

      totalProcessed += chunk.length
    } catch (err: any) {
      console.error(`\n   ⚠️ Chunk ${chunkNum} error: ${err.message.slice(0, 200)}`)
    }
  }

  console.log(`\n\n✅ Processed ${totalProcessed.toLocaleString()} wallets`)

  // Final stats
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_wallets,
        countIf(expectancy_pct > 0) as positive_expectancy,
        countIf(maker_pct <= 30) as taker_heavy,
        countIf(toDate(last_trade_time) >= today() - 3) as active_3d,
        round(avg(expectancy_pct), 2) as avg_expectancy,
        round(max(expectancy_pct), 2) as max_expectancy,
        round(avg(sold_early_pct), 1) as avg_sold_early,
        round(avg(win_rate_pct), 1) as avg_win_rate
      FROM pm_wallet_copy_trading_metrics_v1
    `,
    format: 'JSONEachRow'
  })
  const stats = (await statsResult.json() as any[])[0]

  console.log('\n📊 Table Statistics:')
  console.log(`   Total wallets: ${stats.total_wallets?.toLocaleString()}`)
  console.log(`   Positive expectancy: ${stats.positive_expectancy?.toLocaleString()} (${Math.round(stats.positive_expectancy/stats.total_wallets*100)}%)`)
  console.log(`   Taker-heavy (≤30%): ${stats.taker_heavy?.toLocaleString()} (${Math.round(stats.taker_heavy/stats.total_wallets*100)}%)`)
  console.log(`   Active last 3 days: ${stats.active_3d?.toLocaleString()} (${Math.round(stats.active_3d/stats.total_wallets*100)}%)`)
  console.log(`   Avg expectancy: ${stats.avg_expectancy}%`)
  console.log(`   Max expectancy: ${stats.max_expectancy}%`)
  console.log(`   Avg sold early: ${stats.avg_sold_early}%`)
  console.log(`   Avg win rate: ${stats.avg_win_rate}%`)

  // Copy trading candidates
  const candidatesResult = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_wallet_copy_trading_metrics_v1
      WHERE maker_pct <= 30
        AND toDate(last_trade_time) >= today() - 3
        AND expectancy_pct > 0
        AND pct_wins_over_100 > 20
        AND total_trades >= 20
    `,
    format: 'JSONEachRow'
  })
  const candidates = (await candidatesResult.json() as any[])[0]
  console.log(`\n🎯 Copy trading candidates: ${candidates.cnt}`)

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
