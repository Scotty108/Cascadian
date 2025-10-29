#!/usr/bin/env tsx
/**
 * NUCLEAR OPTION: Calculate all metrics directly from Goldsky PnL API
 *
 * NO trade loading required - goes straight from PnL endpoint to metrics
 * Expected time: 30-60 minutes for 28k wallets with 20 workers
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import { calculateWalletOmegaScore } from '@/lib/metrics/omega-from-goldsky'
import { pnlClient } from '@/lib/goldsky/client'
import fs from 'fs'

const CONCURRENT_WORKERS = 20  // Parallel processing
const BATCH_SIZE = 100  // ClickHouse insert batch size
const RATE_LIMIT_DELAY = 50  // ms between batches

// Discover wallets query
const DISCOVER_WALLETS_QUERY = /* GraphQL */ `
  query DiscoverActiveWallets($skip: Int!) {
    userPositions(
      first: 1000
      skip: $skip
      orderBy: realizedPnl
      orderDirection: desc
    ) {
      user
      realizedPnl
    }
  }
`

async function discoverAllWallets(): Promise<string[]> {
  console.log('🔍 Discovering wallets from Goldsky PnL API...\n')

  const wallets = new Set<string>()
  let skip = 0
  let hasMore = true

  while (hasMore && skip < 100000) {
    try {
      const data: any = await pnlClient.request(DISCOVER_WALLETS_QUERY, { skip })

      if (data.userPositions && data.userPositions.length > 0) {
        data.userPositions.forEach((pos: any) => {
          if (pos.user) {
            wallets.add(pos.user.toLowerCase())
          }
        })

        console.log(`   Skip ${skip}: +${data.userPositions.length} positions (${wallets.size} unique wallets)`)
        skip += 1000

        if (data.userPositions.length < 1000) {
          hasMore = false
        }

        await new Promise(resolve => setTimeout(resolve, 100))
      } else {
        hasMore = false
      }
    } catch (error) {
      console.error(`   ❌ Error at skip ${skip}:`, error)
      hasMore = false
    }
  }

  console.log(`\n✅ Found ${wallets.size} unique wallets\n`)
  return Array.from(wallets)
}

async function calculateMetricsForWallet(wallet: string): Promise<any | null> {
  try {
    const score = await calculateWalletOmegaScore(wallet)

    if (!score || !score.meets_minimum_trades) {
      return null
    }

    // Return in ClickHouse format
    return {
      wallet_address: score.wallet_address,
      window: 'lifetime',
      calculated_at: new Date(),
      trades_analyzed: score.total_positions,
      resolved_trades: score.closed_positions,
      track_record_days: 365, // Placeholder
      raw_data_hash: '',

      // Metrics
      metric_2_omega_net: score.omega_ratio,
      metric_6_sharpe: null,
      metric_9_net_pnl_usd: score.total_pnl,
      metric_12_hit_rate: score.win_rate * 100,
      metric_13_avg_win_usd: score.avg_gain,
      metric_14_avg_loss_usd: score.avg_loss,
      metric_22_resolved_bets: score.closed_positions,
      metric_23_track_record_days: 365,
      metric_24_bets_per_week: null,
      metric_48_omega_lag_30s: null,
      metric_49_omega_lag_2min: null,
      metric_60_tail_ratio: null,
      metric_69_ev_per_hour_capital: null,
      metric_85_performance_trend_flag: score.momentum_direction,
      metric_88_sizing_discipline_trend: null,
      resolution_accuracy: null
    }
  } catch (error) {
    return null
  }
}

async function insertMetricsBatch(metrics: any[]) {
  if (metrics.length === 0) return

  const values = metrics.map(m => `(
    '${m.wallet_address}',
    '${m.window}',
    now(),
    ${m.trades_analyzed},
    ${m.resolved_trades},
    ${m.track_record_days},
    '',
    ${m.metric_2_omega_net || 0},
    NULL,
    ${m.metric_9_net_pnl_usd || 0},
    ${m.metric_12_hit_rate || 0},
    ${m.metric_13_avg_win_usd || 0},
    ${m.metric_14_avg_loss_usd || 0},
    ${m.metric_22_resolved_bets || 0},
    ${m.metric_23_track_record_days || 0},
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '${m.metric_85_performance_trend_flag || 'stable'}',
    NULL,
    NULL
  )`).join(',')

  await clickhouse.command({
    query: `
      INSERT INTO wallet_metrics_complete (
        wallet_address, window, calculated_at, trades_analyzed, resolved_trades,
        track_record_days, raw_data_hash, metric_2_omega_net, metric_6_sharpe,
        metric_9_net_pnl_usd, metric_12_hit_rate, metric_13_avg_win_usd,
        metric_14_avg_loss_usd, metric_22_resolved_bets, metric_23_track_record_days,
        metric_24_bets_per_week, metric_48_omega_lag_30s, metric_49_omega_lag_2min,
        metric_60_tail_ratio, metric_69_ev_per_hour_capital,
        metric_85_performance_trend_flag, metric_88_sizing_discipline_trend,
        resolution_accuracy
      ) VALUES ${values}
    `
  })
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  NUCLEAR METRICS: Direct from PnL API (NO trade loading)')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`Workers: ${CONCURRENT_WORKERS}`)
  console.log(`Batch size: ${BATCH_SIZE}\n`)

  const startTime = Date.now()

  // Step 1: Discover wallets
  const allWallets = await discoverAllWallets()

  // Step 2: Process in parallel
  console.log('📊 Calculating metrics in parallel...\n')

  let processed = 0
  let successful = 0
  let skipped = 0
  let metricsBuffer: any[] = []

  for (let i = 0; i < allWallets.length; i += CONCURRENT_WORKERS) {
    const batch = allWallets.slice(i, i + CONCURRENT_WORKERS)

    const results = await Promise.all(
      batch.map(wallet => calculateMetricsForWallet(wallet))
    )

    results.forEach((metrics, idx) => {
      processed++

      if (metrics) {
        successful++
        metricsBuffer.push(metrics)
        console.log(`[${processed}/${allWallets.length}] ✅ ${batch[idx]}: Ω=${metrics.metric_2_omega_net.toFixed(2)}`)
      } else {
        skipped++
        console.log(`[${processed}/${allWallets.length}] ⏭️  ${batch[idx]}: skipped`)
      }
    })

    // Insert when buffer full
    if (metricsBuffer.length >= BATCH_SIZE) {
      console.log(`   💾 Inserting ${metricsBuffer.length} metrics...`)
      await insertMetricsBatch(metricsBuffer)
      metricsBuffer = []
    }

    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY))
  }

  // Insert remaining
  if (metricsBuffer.length > 0) {
    console.log(`   💾 Inserting final ${metricsBuffer.length} metrics...`)
    await insertMetricsBatch(metricsBuffer)
  }

  const duration = ((Date.now() - startTime) / 60000).toFixed(1)

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('✅ NUCLEAR METRICS COMPLETE!')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`⏱️  Duration: ${duration} minutes`)
  console.log(`📊 Processed: ${processed} wallets`)
  console.log(`✅ Successful: ${successful} wallets`)
  console.log(`⏭️  Skipped: ${skipped} wallets (< 5 trades)`)
  console.log('')

  // Query top 10
  const top10 = await clickhouse.query({
    query: `
      SELECT wallet_address, metric_2_omega_net, metric_9_net_pnl_usd, metric_22_resolved_bets
      FROM wallet_metrics_complete
      WHERE window = 'lifetime'
      ORDER BY metric_2_omega_net DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })

  const topWallets = await top10.json()
  console.log('🏆 TOP 10 WALLETS:')
  topWallets.forEach((w: any, i: number) => {
    console.log(`${i+1}. ${w.wallet_address.substring(0,12)}... Ω=${parseFloat(w.metric_2_omega_net).toFixed(2)} P&L=$${parseFloat(w.metric_9_net_pnl_usd).toLocaleString()}`)
  })
  console.log('')
}

main().catch(console.error)
