#!/usr/bin/env npx tsx
/**
 * Build pm_wallet_copy_trading_metrics_v1 table
 *
 * Processes 30 days of data in chunks to avoid memory limits.
 * Each chunk processes trades for a subset of wallets.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  const startTime = Date.now()
  console.log('🔧 Building pm_wallet_copy_trading_metrics_v1 table')
  console.log('')

  // Get all wallets with resolved trades in last 30 days
  console.log('📊 Finding wallets to process...')
  const walletQuery = `
    SELECT DISTINCT wallet
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

  // Process in chunks
  const chunkSize = 5000
  let totalProcessed = 0
  let totalInserted = 0

  console.log(`\n📦 Processing ${Math.ceil(allWallets.length / chunkSize)} chunks of ${chunkSize} wallets...`)

  for (let i = 0; i < allWallets.length; i += chunkSize) {
    const chunk = allWallets.slice(i, i + chunkSize)
    const walletList = chunk.map(w => `'${w}'`).join(',')
    const chunkNum = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(allWallets.length / chunkSize)
    const pct = Math.round((i / allWallets.length) * 100)

    process.stdout.write(`\r   Chunk ${chunkNum}/${totalChunks} (${pct}%) | Inserted: ${totalInserted.toLocaleString()}`)

    try {
      const insertQuery = `
        INSERT INTO pm_wallet_copy_trading_metrics_v1
        WITH
          buy_trades AS (
            SELECT
              f.tx_hash,
              f.wallet,
              f.condition_id,
              f.outcome_index,
              min(f.event_time) as entry_time,
              sum(f.tokens_delta) as tokens,
              sum(abs(f.usdc_delta)) as cost_usd,
              sum(abs(f.usdc_delta)) / nullIf(sum(f.tokens_delta), 0) as entry_price,
              max(f.is_maker) as is_maker,
              CASE
                WHEN r.payout_numerators = '[1,1]' THEN 0.5
                WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
                WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
                ELSE 0.0
              END as payout_rate
            FROM pm_canonical_fills_v4 f
            INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
              AND r.is_deleted = 0 AND r.payout_numerators != ''
            WHERE f.source = 'clob'
              AND f.tokens_delta > 0
              AND f.event_time >= now() - INTERVAL 30 DAY
              AND f.wallet IN (${walletList})
              AND NOT (f.is_self_fill = 1 AND f.is_maker = 1)
            GROUP BY f.tx_hash, f.wallet, f.condition_id, f.outcome_index, r.payout_numerators
          ),

          trade_roi AS (
            SELECT
              wallet,
              tx_hash,
              condition_id,
              entry_time,
              cost_usd,
              tokens,
              entry_price,
              payout_rate,
              is_maker,
              CASE
                WHEN cost_usd > 0.01 THEN ((tokens * payout_rate) - cost_usd) / cost_usd
                ELSE 0
              END as roi
            FROM buy_trades
            WHERE cost_usd > 0.01
          )

        SELECT
          wallet,
          toUInt32(count()) as total_trades,
          toUInt32(countIf(roi > 0)) as wins,
          toUInt32(countIf(roi <= 0)) as losses,
          toFloat32(round(countIf(roi > 0) * 100.0 / count(), 2)) as win_rate_pct,

          toFloat32(round(avg(roi) * 100, 2)) as avg_roi_pct,
          toFloat32(round(avgIf(roi, roi > 0) * 100, 2)) as avg_win_roi_pct,
          toFloat32(round(abs(avgIf(roi, roi <= 0)) * 100, 2)) as avg_loss_roi_pct,
          toFloat32(round(medianIf(roi, roi > 0) * 100, 2)) as median_win_roi_pct,
          toFloat32(round(stddevPop(roi) * 100, 2)) as roi_stddev_pct,

          toFloat32(round(countIf(roi > 0.5 AND roi > 0) * 100.0 / nullIf(countIf(roi > 0), 0), 1)) as pct_wins_over_50,
          toFloat32(round(countIf(roi > 1.0 AND roi > 0) * 100.0 / nullIf(countIf(roi > 0), 0), 1)) as pct_wins_over_100,
          toFloat32(round(countIf(roi > 5.0 AND roi > 0) * 100.0 / nullIf(countIf(roi > 0), 0), 1)) as pct_wins_over_500,
          toFloat32(round(max(roi) * 100, 2)) as max_win_roi_pct,

          toFloat32(round(countIf(roi < -0.5 AND roi <= 0) * 100.0 / nullIf(countIf(roi <= 0), 0), 1)) as pct_losses_over_50,
          toFloat32(round(countIf(roi < -0.9 AND roi <= 0) * 100.0 / nullIf(countIf(roi <= 0), 0), 1)) as pct_losses_over_90,
          toFloat32(round(min(roi) * 100, 2)) as max_loss_roi_pct,

          toFloat32(round((countIf(roi > 0) / count() * avgIf(roi, roi > 0) -
                   countIf(roi <= 0) / count() * abs(avgIf(roi, roi <= 0))) * 100, 2)) as expectancy_pct,
          toFloat32(round(avg(asinh(roi)), 4)) as asinh_score,
          toFloat32(round(avgIf(roi, roi > 0) / nullIf(abs(avgIf(roi, roi <= 0)), 0), 2)) as win_loss_ratio,

          round(sum(cost_usd), 2) as total_volume_usd,
          round(sum(tokens * payout_rate - cost_usd), 2) as total_pnl_usd,
          toFloat32(round(avg(cost_usd), 2)) as avg_trade_usd,

          toUInt32(count(DISTINCT condition_id)) as positions_traded,
          min(entry_time) as first_trade_time,
          max(entry_time) as last_trade_time,
          toUInt16(dateDiff('day', min(entry_time), max(entry_time)) + 1) as days_active,
          toFloat32(round(count() / (dateDiff('day', min(entry_time), max(entry_time)) + 1), 2)) as trades_per_day,

          toFloat32(round(countIf(is_maker = 1) * 100.0 / count(), 1)) as maker_pct,
          toFloat32(round(countIf(is_maker = 0) * 100.0 / count(), 1)) as taker_pct,

          now() as computed_at

        FROM trade_roi
        GROUP BY wallet
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
        countIf(last_trade_time >= now() - INTERVAL 3 DAY) as active_3d,
        round(avg(expectancy_pct), 2) as avg_expectancy,
        round(max(expectancy_pct), 2) as max_expectancy
      FROM pm_wallet_copy_trading_metrics_v1
    `,
    format: 'JSONEachRow'
  })
  const stats = (await statsResult.json() as any[])[0]

  console.log('\n📊 Table Statistics:')
  console.log(`   Total wallets: ${stats.total_wallets?.toLocaleString()}`)
  console.log(`   Positive expectancy: ${stats.positive_expectancy?.toLocaleString()}`)
  console.log(`   Taker-heavy (≤30%): ${stats.taker_heavy?.toLocaleString()}`)
  console.log(`   Active last 3 days: ${stats.active_3d?.toLocaleString()}`)
  console.log(`   Avg expectancy: ${stats.avg_expectancy}%`)
  console.log(`   Max expectancy: ${stats.max_expectancy}%`)

  const totalTime = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n⏱️  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`)
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
