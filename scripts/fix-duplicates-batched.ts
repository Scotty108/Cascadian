#!/usr/bin/env npx tsx

/**
 * Batched deduplication for pm_trader_events_v2.
 *
 * Strategy:
 *  1. Ensure staging table exists (`pm_trader_events_v2_clean`).
 *  2. Truncate staging table.
 *  3. Fetch distinct months present in pm_trader_events_v2.
 *  4. For each month, insert unique rows (LIMIT 1 BY event_id) into staging table.
 *  5. Swap tables once batching succeeds.
 *  6. Re-run duplicate audit to confirm zero dupes remain.
 *
 * This avoids the 14 GB memory cap by operating one month at a time.
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

type MonthRow = { month: string }

async function runCommand(name: string, query: string) {
  console.log(`\n${'='.repeat(80)}\n${name}\n${'='.repeat(80)}`)
  console.log(query)
  await clickhouse.command({ query })
  console.log('✅ Done')
}

async function fetchMonths(): Promise<string[]> {
  console.log('\nFetching distinct months from pm_trader_events_v2...')
  const result = await clickhouse.query({
    query: `
      SELECT toStartOfMonth(trade_time) AS month
      FROM pm_trader_events_v2
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow',
  })

  const rows = (await result.json()) as MonthRow[]
  if (!rows.length) {
    throw new Error('pm_trader_events_v2 returned zero months — aborting.')
  }

  console.log(`Found ${rows.length} distinct month partitions`)
  return rows.map((row) => row.month)
}

async function ensureCleanTable() {
  await runCommand(
    'Ensuring pm_trader_events_v2_clean exists',
    `
    CREATE TABLE IF NOT EXISTS pm_trader_events_v2_clean
    (
      event_id String,
      trader_wallet String,
      role String,
      side String,
      token_id String,
      usdc_amount Float64,
      token_amount Float64,
      fee_amount Float64,
      trade_time DateTime,
      transaction_hash String,
      block_number UInt64,
      insert_time DateTime DEFAULT now(),
      is_deleted UInt8 DEFAULT 0
    )
    ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
    ORDER BY (trader_wallet, token_id, trade_time)
    `
  )
}

function buildMonthCondition(month: string) {
  return `toStartOfMonth(trade_time) = toDateTime('${month}')`
}

async function insertMonth(month: string) {
  console.log(`\n➡️  Processing month ${month}...`)

  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() AS raw_rows,
        uniqExact(event_id) AS unique_rows
      FROM pm_trader_events_v2
      WHERE ${buildMonthCondition(month)}
    `,
    format: 'JSONEachRow',
  })

  const stats = (await statsResult.json()) as Array<{
    raw_rows: string
    unique_rows: string
  }>

  const rawRows = Number(stats[0]?.raw_rows ?? 0)
  const uniqueRows = Number(stats[0]?.unique_rows ?? 0)

  console.log(
    `   Source rows: ${rawRows.toLocaleString()} (unique: ${uniqueRows.toLocaleString()})`
  )

  if (uniqueRows === 0) {
    console.log('   Skipping month (no rows)')
    return 0
  }

  const insertQuery = `
    INSERT INTO pm_trader_events_v2_clean
    SELECT *
    FROM pm_trader_events_v2
    WHERE ${buildMonthCondition(month)}
    LIMIT 1 BY event_id
  `

  const start = Date.now()
  await clickhouse.command({ query: insertQuery })
  const duration = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`   ✅ Inserted ${uniqueRows.toLocaleString()} rows in ${duration}s`)
  return uniqueRows
}

async function swapTables() {
  await runCommand(
    'Swapping pm_trader_events_v2 with pm_trader_events_v2_clean',
    'EXCHANGE TABLES pm_trader_events_v2 AND pm_trader_events_v2_clean'
  )
}

async function verifyNoDuplicates() {
  console.log('\nVerifying duplicates are removed...')
  const result = await clickhouse.query({
    query: `
      SELECT count() AS dup_events
      FROM (
        SELECT event_id
        FROM pm_trader_events_v2
        GROUP BY event_id
        HAVING count() > 1
      )
      SETTINGS max_execution_time = 600
    `,
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as Array<{ dup_events: string }>
  const dupEvents = Number(rows[0]?.dup_events ?? 0)

  if (dupEvents === 0) {
    console.log('✅ Duplicate audit passed (0 duplicate event_id rows)')
  } else {
    console.log(`❌ WARNING: Still found ${dupEvents.toLocaleString()} duplicate event_ids`)
  }
}

async function main() {
  console.log('🚀 Batched deduplication for pm_trader_events_v2 (one month at a time)\n')

  await ensureCleanTable()
  await runCommand('Truncating pm_trader_events_v2_clean', 'TRUNCATE TABLE pm_trader_events_v2_clean')

  const months = await fetchMonths()
  let totalInserted = 0

  for (const month of months) {
    const inserted = await insertMonth(month)
    totalInserted += inserted
    console.log(`   ➕ Running total inserted: ${totalInserted.toLocaleString()} rows`)
  }

  console.log(`\nTotal rows inserted into clean table: ${totalInserted.toLocaleString()}`)

  console.log('\nComparing source vs clean row counts...')
  const countResult = await clickhouse.query({
    query: `
      SELECT
        (SELECT count() FROM pm_trader_events_v2_clean) AS clean_count,
        (SELECT count() FROM pm_trader_events_v2) AS current_count
    `,
    format: 'JSONEachRow',
  })
  const counts = (await countResult.json()) as Array<{
    clean_count: string
    current_count: string
  }>

  const cleanCount = Number(counts[0]?.clean_count ?? 0)
  const currentCount = Number(counts[0]?.current_count ?? 0)

  console.log(`   pm_trader_events_v2_clean: ${cleanCount.toLocaleString()} rows`)
  console.log(`   pm_trader_events_v2 (current): ${currentCount.toLocaleString()} rows`)

  if (cleanCount >= currentCount) {
    console.log('⚠️  Clean table is not smaller than source. Aborting swap to avoid data loss.')
    process.exit(1)
  }

  await swapTables()
  await verifyNoDuplicates()
  console.log('\n🎉 Deduplication complete.')
}

main().catch((error) => {
  console.error('\n❌ Deduplication script failed:', error)
  process.exit(1)
})
