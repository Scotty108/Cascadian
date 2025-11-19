#!/usr/bin/env npx tsx

/**
 * ATOMIC ENRICHMENT - Simpler approach
 * Split into: CREATE TABLE, then INSERT INTO SELECT
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('═'.repeat(100))
  console.log('ATOMIC ENRICHMENT: Populate condition_id via market_id JOIN')
  console.log('═'.repeat(100))

  try {
    // BASELINE
    console.log('\n[BASELINE] Current condition_id coverage...')
    const baselineResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
          ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
        FROM trades_raw
      `
    })

    const baselineText = await baselineResult.text()
    let baselineData: any = { data: [] }
    try {
      baselineData = JSON.parse(baselineText)
    } catch {
      console.error('Failed to parse baseline')
      return
    }

    if (baselineData.data && baselineData.data[0]) {
      const row = baselineData.data[0]
      console.log(`Total trades: ${row.total_trades}`)
      console.log(`With condition_id: ${row.with_condition_id} (${row.coverage_pct}%)`)
      console.log(`Without condition_id: ${row.total_trades - row.with_condition_id}`)
    }

    // STEP 1: Create empty table
    console.log('\n[STEP 1] Creating empty enriched trades table...')
    await clickhouse.query({
      query: `
        CREATE TABLE trades_raw_enriched (
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
    console.log(`✅ Empty table created`)

    // STEP 2: Insert enriched data
    console.log('\n[STEP 2] Inserting enriched data (this may take 1-2 minutes)...')
    const insertStart = Date.now()

    await clickhouse.query({
      query: `
        INSERT INTO trades_raw_enriched
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

    const insertTime = ((Date.now() - insertStart) / 1000).toFixed(2)
    console.log(`✅ Data inserted in ${insertTime}s`)

    // STEP 3: Verify enriched table
    console.log('\n[STEP 3] Verifying enriched table...')
    const enrichedResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
          ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
        FROM trades_raw_enriched
      `
    })

    const enrichedText = await enrichedResult.text()
    let enrichedData: any = { data: [] }
    try {
      enrichedData = JSON.parse(enrichedText)
    } catch {
      console.error('Failed to parse enriched')
      return
    }

    if (enrichedData.data && enrichedData.data[0]) {
      const row = enrichedData.data[0]
      const improvement = parseFloat(row.coverage_pct) - parseFloat(baselineData.data[0].coverage_pct)
      console.log(`Total trades: ${row.total_trades}`)
      console.log(`With condition_id: ${row.with_condition_id} (${row.coverage_pct}%)`)
      console.log(`IMPROVEMENT: +${improvement.toFixed(2)}%`)
    }

    // STEP 4: Atomic rename
    console.log('\n[STEP 4] Executing atomic table swap...')
    await clickhouse.query({
      query: `RENAME TABLE trades_raw TO trades_raw_backup`
    })
    console.log(`✅ Backup created: trades_raw_backup`)

    await clickhouse.query({
      query: `RENAME TABLE trades_raw_enriched TO trades_raw`
    })
    console.log(`✅ Enriched table is now live: trades_raw`)

    // STEP 5: Final validation
    console.log('\n[STEP 5] Final validation...')
    const finalResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
          COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as without_condition_id,
          ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
        FROM trades_raw
      `
    })

    const finalText = await finalResult.text()
    let finalData: any = { data: [] }
    try {
      finalData = JSON.parse(finalText)
    } catch {
      console.error('Failed to parse final')
      return
    }

    console.log('\n' + '═'.repeat(100))
    console.log('✅ ENRICHMENT COMPLETE')
    console.log('═'.repeat(100))

    if (finalData.data && finalData.data[0]) {
      const row = finalData.data[0]
      const improvement = parseFloat(row.coverage_pct) - 51.47
      console.log(`\nFINAL STATS:`)
      console.log(`  Total trades: ${row.total_trades}`)
      console.log(`  With condition_id: ${row.with_condition_id} (${row.coverage_pct}%)`)
      console.log(`  Without condition_id: ${row.without_condition_id}`)
      console.log(`\nIMPROVEMENT: ${improvement.toFixed(2)}% increase in coverage`)
      console.log(`\nBackup available: trades_raw_backup`)
      console.log(`\n🎉 Ready to build P&L calculations!`)
    }

  } catch (e: any) {
    console.error(`\n❌ ERROR: ${e.message}`)
    console.error(`\nAttempting rollback...`)
    try {
      await clickhouse.query({
        query: `DROP TABLE IF EXISTS trades_raw_enriched`
      })
      console.log(`✅ Cleaned up failed enriched table`)
    } catch (cleanupError: any) {
      console.error(`Cleanup failed: ${cleanupError.message}`)
    }
  }
}

execute().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
