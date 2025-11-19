#!/usr/bin/env npx tsx

/**
 * ATOMIC ENRICHMENT: Populate condition_id via market_id JOIN
 *
 * This script:
 * 1. Verifies condition_market_map has the data
 * 2. Tests the JOIN on a sample
 * 3. Creates enriched table
 * 4. Atomically swaps tables
 * 5. Validates results
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
    // STEP 1: Verify condition_market_map
    console.log('\n[STEP 1] Verifying condition_market_map table...')
    const mapCheckResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_mappings,
          COUNT(DISTINCT market_id) as unique_markets,
          COUNT(DISTINCT condition_id) as unique_conditions
        FROM condition_market_map
      `
    })

    const mapCheckText = await mapCheckResult.text()
    let mapCheckData: any = { data: [] }
    try {
      mapCheckData = JSON.parse(mapCheckText)
    } catch {
      console.error('Failed to parse mapping check')
      return
    }

    if (mapCheckData.data && mapCheckData.data[0]) {
      const row = mapCheckData.data[0]
      console.log(`✅ Mapping table has ${row.total_mappings} entries`)
      console.log(`✅ Unique markets: ${row.unique_markets}`)
      console.log(`✅ Unique conditions: ${row.unique_conditions}`)
    }

    // STEP 2: Test the JOIN on a sample
    console.log('\n[STEP 2] Testing JOIN on sample...')
    const sampleTestResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_sample,
          COUNT(CASE WHEN m.condition_id IS NOT NULL THEN 1 END) as matched,
          COUNT(CASE WHEN m.condition_id IS NULL THEN 1 END) as unmatched
        FROM (
          SELECT DISTINCT market_id FROM trades_raw WHERE market_id != ''
          LIMIT 1000
        ) t
        LEFT JOIN condition_market_map m ON t.market_id = m.market_id
      `
    })

    const sampleTestText = await sampleTestResult.text()
    let sampleTestData: any = { data: [] }
    try {
      sampleTestData = JSON.parse(sampleTestText)
    } catch {
      console.error('Failed to parse sample test')
      return
    }

    if (sampleTestData.data && sampleTestData.data[0]) {
      const row = sampleTestData.data[0]
      console.log(`✅ Sample market_ids tested: ${row.total_sample}`)
      console.log(`✅ Matched to condition_id: ${row.matched}`)
      console.log(`✅ Unmatched: ${row.unmatched}`)
    }

    // STEP 3: Get baseline stats
    console.log('\n[STEP 3] Baseline: Current condition_id coverage...')
    const baselineResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
          COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as without_condition_id,
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
      console.log(`✅ Total trades: ${row.total_trades}`)
      console.log(`✅ With condition_id: ${row.with_condition_id} (${row.coverage_pct}%)`)
      console.log(`✅ Without condition_id: ${row.without_condition_id}`)
    }

    // STEP 4: Create enriched table with proper SharedMergeTree engine
    console.log('\n[STEP 4] Creating enriched trades table...')
    console.log('Running: CREATE TABLE trades_raw_enriched with proper schema...')

    const createStart = Date.now()
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
        AS SELECT
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
    const createTime = ((Date.now() - createStart) / 1000).toFixed(2)
    console.log(`✅ Table created in ${createTime}s`)

    // STEP 5: Verify enriched table
    console.log('\n[STEP 5] Verifying enriched table...')
    const enrichedCheckResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) as with_condition_id,
          COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as without_condition_id,
          ROUND(COUNT(CASE WHEN condition_id != '' AND condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as coverage_pct
        FROM trades_raw_enriched
      `
    })

    const enrichedCheckText = await enrichedCheckResult.text()
    let enrichedCheckData: any = { data: [] }
    try {
      enrichedCheckData = JSON.parse(enrichedCheckText)
    } catch {
      console.error('Failed to parse enriched check')
      return
    }

    if (enrichedCheckData.data && enrichedCheckData.data[0]) {
      const row = enrichedCheckData.data[0]
      console.log(`✅ Enriched table rows: ${row.total_trades}`)
      console.log(`✅ With condition_id: ${row.with_condition_id} (${row.coverage_pct}%)`)
      console.log(`✅ Still missing: ${row.without_condition_id}`)

      const improvement = parseFloat(row.coverage_pct) - parseFloat(baselineData.data[0].coverage_pct)
      console.log(`✅ IMPROVEMENT: +${improvement.toFixed(2)}%`)
    }

    // STEP 6: Atomic rename
    console.log('\n[STEP 6] Executing atomic table swap...')
    console.log('RENAME trades_raw → trades_raw_backup')
    await clickhouse.query({
      query: `RENAME TABLE trades_raw TO trades_raw_backup`
    })
    console.log('✅ Backup created')

    console.log('RENAME trades_raw_enriched → trades_raw')
    await clickhouse.query({
      query: `RENAME TABLE trades_raw_enriched TO trades_raw`
    })
    console.log('✅ Enriched table is now live')

    // STEP 7: Final validation
    console.log('\n[STEP 7] Final validation...')
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
      console.error('Failed to parse final check')
      return
    }

    console.log('\n' + '═'.repeat(100))
    console.log('ENRICHMENT COMPLETE')
    console.log('═'.repeat(100))

    if (finalData.data && finalData.data[0]) {
      const row = finalData.data[0]
      console.log(`\n✅ NEW STATS:`)
      console.log(`   Total trades: ${row.total_trades}`)
      console.log(`   With condition_id: ${row.with_condition_id} (${row.coverage_pct}%)`)
      console.log(`   Missing condition_id: ${row.without_condition_id}`)
      console.log(`\n✅ Backup saved as: trades_raw_backup`)
      console.log(`✅ You can safely query trades_raw now`)
      console.log(`\n🎉 Ready to build P&L calculations!`)
    }

  } catch (e: any) {
    console.error(`\n❌ ERROR: ${e.message}`)
    console.error(`\nAttempting rollback...`)
    try {
      await clickhouse.query({
        query: `RENAME TABLE trades_raw TO trades_raw_failed`
      })
      await clickhouse.query({
        query: `RENAME TABLE trades_raw_backup TO trades_raw`
      })
      console.log(`✅ Rolled back to original trades_raw`)
    } catch (rollbackError: any) {
      console.error(`Rollback failed: ${rollbackError.message}`)
    }
  }
}

execute().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
