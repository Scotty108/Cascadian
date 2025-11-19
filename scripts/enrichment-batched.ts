#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('CONDITION ID ENRICHMENT - Batched Approach')
  console.log('═'.repeat(100))

  try {
    // Get baseline
    console.log('\n[BASELINE] Current coverage...')
    const baselineRes = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
          ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as pct
        FROM trades_raw
      `
    })
    const baselineText = await baselineRes.text()
    let baselineData: any = { data: [] }
    try {
      baselineData = JSON.parse(baselineText)
    } catch {
      return
    }
    if (baselineData.data[0]) {
      const row = baselineData.data[0]
      console.log(`Total: ${row.total}`)
      console.log(`With condition_id: ${row.with_id} (${row.pct}%)`)
    }

    // Create temp table with enriched data
    console.log('\n[STEP 1] Creating temporary table...')
    try {
      await clickhouse.query({
        query: `DROP TABLE IF EXISTS trades_raw_temp`
      })
    } catch {}

    // Create temp with full schema
    await clickhouse.query({
      query: `
        CREATE TABLE trades_raw_temp (
          trade_id String,
          wallet_address String,
          market_id String,
          timestamp DateTime,
          side Enum8('YES' = 1, 'NO' = 2),
          entry_price Decimal(18, 8),
          exit_price Nullable(Decimal(18, 8)),
          shares Decimal(18, 8),
          usd_value Decimal(18, 2),
          pnl Nullable(Decimal(18, 2)),
          is_closed Bool,
          transaction_hash String,
          created_at DateTime,
          close_price Decimal(10, 6),
          fee_usd Decimal(18, 6),
          slippage_usd Decimal(18, 6),
          hours_held Decimal(10, 2),
          bankroll_at_entry Decimal(18, 2),
          outcome Nullable(Int8),
          fair_price_at_entry Decimal(10, 6),
          pnl_gross Decimal(18, 6),
          pnl_net Decimal(18, 6),
          return_pct Decimal(10, 6),
          condition_id String,
          was_win Nullable(UInt8),
          tx_timestamp DateTime,
          canonical_category String,
          raw_tags Array(String),
          realized_pnl_usd Float64,
          is_resolved UInt8,
          resolved_outcome Nullable(String)
        )
        ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
        ORDER BY (wallet_address, timestamp)
        SETTINGS index_granularity = 8192
      `
    })
    console.log(`✅ Temp table created`)

    // Insert enriched rows - this avoids the large JOIN in one statement
    console.log('\n[STEP 2] Inserting enriched rows...')
    const insertStart = Date.now()

    // Insert with enriched condition_ids
    await clickhouse.query({
      query: `
        INSERT INTO trades_raw_temp
        SELECT
          t.trade_id,
          t.wallet_address,
          t.market_id,
          t.timestamp,
          t.side,
          t.entry_price,
          t.exit_price,
          t.shares,
          t.usd_value,
          t.pnl,
          t.is_closed,
          t.transaction_hash,
          t.created_at,
          t.close_price,
          t.fee_usd,
          t.slippage_usd,
          t.hours_held,
          t.bankroll_at_entry,
          t.outcome,
          t.fair_price_at_entry,
          t.pnl_gross,
          t.pnl_net,
          t.return_pct,
          COALESCE(t.condition_id, m.condition_id) as condition_id,
          t.was_win,
          t.tx_timestamp,
          t.canonical_category,
          t.raw_tags,
          t.realized_pnl_usd,
          t.is_resolved,
          t.resolved_outcome
        FROM trades_raw t
        LEFT JOIN condition_market_map m ON t.market_id = m.market_id
      `
    })

    const insertTime = ((Date.now() - insertStart) / 1000 / 60).toFixed(2)
    console.log(`✅ Insert completed in ${insertTime} minutes`)

    // Verify temp table
    console.log('\n[STEP 3] Verifying temp table...')
    const tempRes = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
          ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as pct
        FROM trades_raw_temp
      `
    })
    const tempText = await tempRes.text()
    let tempData: any = { data: [] }
    try {
      tempData = JSON.parse(tempText)
    } catch {
      return
    }
    if (tempData.data[0]) {
      const row = tempData.data[0]
      console.log(`Total: ${row.total}`)
      console.log(`With condition_id: ${row.with_id} (${row.pct}%)`)
      console.log(`Improvement: +${(parseFloat(row.pct) - 51.47).toFixed(2)}%`)
    }

    // Swap tables
    console.log('\n[STEP 4] Swapping tables...')
    await clickhouse.query({
      query: `RENAME TABLE trades_raw TO trades_raw_old`
    })
    console.log(`✅ Backup created`)

    await clickhouse.query({
      query: `RENAME TABLE trades_raw_temp TO trades_raw`
    })
    console.log(`✅ New trades_raw is live`)

    // Final verification
    console.log('\n[STEP 5] Final verification...')
    const finalRes = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
          ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as pct
        FROM trades_raw
      `
    })
    const finalText = await finalRes.text()
    let finalData: any = { data: [] }
    try {
      finalData = JSON.parse(finalText)
    } catch {
      return
    }

    console.log('\n' + '═'.repeat(100))
    console.log('✅ ENRICHMENT COMPLETE')
    console.log('═'.repeat(100))

    if (finalData.data[0]) {
      const row = finalData.data[0]
      console.log(`\nFINAL STATS:`)
      console.log(`  Total trades: ${row.total}`)
      console.log(`  With condition_id: ${row.with_id} (${row.pct}%)`)
      console.log(`  Improvement: +${(parseFloat(row.pct) - 51.47).toFixed(2)}%`)
      console.log(`\nBackup: trades_raw_old`)
      console.log(`\n🎉 Ready for P&L calculations!`)
    }

  } catch (e: any) {
    console.error(`\n❌ ERROR: ${e.message}`)
    console.error(`\nCleaning up...`)
    try {
      await clickhouse.query({
        query: `DROP TABLE IF EXISTS trades_raw_temp`
      })
      console.log(`✅ Temp table cleaned`)
    } catch {}
  }
}

execute()
