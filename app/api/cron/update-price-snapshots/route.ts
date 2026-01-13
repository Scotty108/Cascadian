/**
 * Cron: Update Price Snapshots
 *
 * Maintains 15-minute price snapshots for CLV (Closing Line Value) calculations.
 *
 * Creates aggregated price data from CLOB trades:
 * - last_price: Most recent trade price in bucket
 * - vwap: Volume-weighted average price
 * - volume_usdc: Total USDC volume
 * - trade_count: Number of trades
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Every 15 minutes (vercel.json)
 */

import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { logCronExecution } from '@/lib/alerts/cron-tracker'

export const runtime = 'nodejs'
export const maxDuration = 300

const LOOKBACK_HOURS = 2 // Process last 2 hours each run for overlap safety

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  const isProduction = process.env.NODE_ENV === 'production'

  if (!cronSecret && !isProduction) return true
  if (!cronSecret && isProduction) return false

  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${cronSecret}`) return true

  const url = new URL(request.url)
  if (url.searchParams.get('token') === cronSecret) return true

  return false
}

async function ensureTableExists() {
  // Check if table exists
  const checkResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM system.tables WHERE database = 'default' AND name = 'pm_price_snapshots_15m'`,
    format: 'JSONEachRow'
  })
  const rows = await checkResult.json() as any[]

  if (rows[0]?.cnt === 0) {
    // Create table
    await clickhouse.command({
      query: `
        CREATE TABLE pm_price_snapshots_15m (
          token_id String,
          bucket DateTime,
          last_price Float64,
          vwap Float64,
          volume_usdc Float64,
          trade_count UInt32
        ) ENGINE = ReplacingMergeTree(bucket)
        PARTITION BY toYYYYMM(bucket)
        ORDER BY (token_id, bucket)
        TTL bucket + INTERVAL 90 DAY
      `
    })
    return true
  }
  return false
}

export async function GET(request: Request) {
  const startTime = Date.now()

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Check for backfill parameter
    const url = new URL(request.url)
    const backfillDays = parseInt(url.searchParams.get('backfill') || '0')

    const tableCreated = await ensureTableExists()

    let lookbackHours = LOOKBACK_HOURS
    if (backfillDays > 0) {
      lookbackHours = backfillDays * 24
    }

    // Insert/update price snapshots
    // Uses ReplacingMergeTree so duplicates are automatically handled
    await clickhouse.command({
      query: `
        INSERT INTO pm_price_snapshots_15m
        SELECT
          token_id,
          toStartOfFifteenMinutes(trade_time) as bucket,
          argMax(
            toFloat64(usdc_amount) / nullIf(toFloat64(token_amount), 0),
            trade_time
          ) as last_price,
          sum(toFloat64(usdc_amount)) / nullIf(sum(toFloat64(token_amount)), 0) as vwap,
          sum(toFloat64(usdc_amount)) / 1e6 as volume_usdc,
          count() as trade_count
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL ${lookbackHours} HOUR
          AND token_amount > 0
          AND usdc_amount > 0
        GROUP BY token_id, bucket
        HAVING last_price > 0 AND last_price < 10
        SETTINGS max_memory_usage = 8000000000
      `
    })

    // Get stats
    const statsResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_snapshots,
          uniqExact(token_id) as unique_tokens,
          min(bucket) as oldest_bucket,
          max(bucket) as newest_bucket
        FROM pm_price_snapshots_15m
      `,
      format: 'JSONEachRow'
    })
    const stats = (await statsResult.json() as any[])[0]

    const durationMs = Date.now() - startTime

    await logCronExecution({
      cron_name: 'update-price-snapshots',
      status: 'success',
      duration_ms: durationMs,
      details: {
        table_created: tableCreated,
        lookback_hours: lookbackHours,
        total_snapshots: Number(stats?.total_snapshots || 0),
        unique_tokens: Number(stats?.unique_tokens || 0)
      }
    })

    return NextResponse.json({
      success: true,
      table_created: tableCreated,
      lookback_hours: lookbackHours,
      stats: {
        total_snapshots: Number(stats?.total_snapshots || 0),
        unique_tokens: Number(stats?.unique_tokens || 0),
        oldest_bucket: stats?.oldest_bucket,
        newest_bucket: stats?.newest_bucket
      },
      duration_ms: durationMs
    })

  } catch (error: any) {
    const durationMs = Date.now() - startTime
    console.error('[update-price-snapshots] Error:', error)

    await logCronExecution({
      cron_name: 'update-price-snapshots',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message
    })

    return NextResponse.json({
      success: false,
      error: error.message,
      duration_ms: durationMs
    }, { status: 500 })
  }
}
