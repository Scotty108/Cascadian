/**
 * Backfill price snapshots table with historical CLOB data.
 *
 * Usage: npx tsx scripts/backfill-price-snapshots.ts [days]
 * Default: 60 days
 */

import { createClient } from '@clickhouse/client'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const host = process.env.CLICKHOUSE_HOST?.replace('https://', '').replace(':8443', '')
const password = process.env.CLICKHOUSE_PASSWORD

if (!host || !password) {
  console.error('Missing CLICKHOUSE_HOST or CLICKHOUSE_PASSWORD')
  process.exit(1)
}

const client = createClient({
  url: `https://${host}:8443`,
  username: 'default',
  password,
  database: 'default',
  request_timeout: 300000, // 5 minute timeout
  clickhouse_settings: {
    max_execution_time: 300,
  }
})

async function run() {
  const totalDays = parseInt(process.argv[2] || '60')
  const batchDays = 3 // Process 3 days at a time to avoid timeout
  console.log(`Backfilling ${totalDays} days of price snapshots in ${batchDays}-day batches...`)

  // Create table if not exists
  console.log('Creating table if not exists...')
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_price_snapshots_15m (
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
  console.log('Table ready.')

  const startTime = Date.now()

  // Process in weekly batches, from oldest to newest
  for (let daysAgo = totalDays; daysAgo > 0; daysAgo -= batchDays) {
    const batchEnd = daysAgo
    const batchStart = Math.max(daysAgo - batchDays, 0)
    console.log(`Processing days ${batchEnd} to ${batchStart} ago...`)

    await client.command({
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
          AND trade_time >= now() - INTERVAL ${batchEnd} DAY
          AND trade_time < now() - INTERVAL ${batchStart} DAY
          AND token_amount > 0
          AND usdc_amount > 0
        GROUP BY token_id, bucket
        HAVING last_price > 0 AND last_price < 10
        SETTINGS max_memory_usage = 8000000000
      `,
      clickhouse_settings: {
        wait_end_of_query: 1,
      }
    })
    console.log(`  Batch complete.`)
  }

  const elapsed = (Date.now() - startTime) / 1000
  console.log(`Backfill complete in ${elapsed.toFixed(1)}s`)

  // Get stats
  const result = await client.query({
    query: `
      SELECT
        count() as total_snapshots,
        uniqExact(token_id) as unique_tokens,
        min(bucket) as oldest,
        max(bucket) as newest
      FROM pm_price_snapshots_15m
    `,
    format: 'JSONEachRow'
  })
  const stats = await result.json() as any[]
  console.log('Stats:', stats[0])

  await client.close()
}

run().catch(e => {
  console.error('Error:', e)
  process.exit(1)
})
