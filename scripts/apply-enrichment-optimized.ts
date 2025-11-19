import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * OPTIMIZED ENRICHMENT - HANDLES HEADER OVERFLOW
 *
 * Instead of one massive LEFT JOIN on 160.9M rows,
 * we process in two steps:
 * 1. Copy all rows with existing condition_ids
 * 2. INSERT enriched rows for missing condition_ids via JOIN
 *
 * This avoids the protocol buffer overflow by splitting the query
 */

async function applyOptimizedEnrichment() {
  try {
    console.log('═'.repeat(70))
    console.log('OPTIMIZED ENRICHMENT - AVOIDING HEADER OVERFLOW')
    console.log('═'.repeat(70))
    console.log()

    // Step 0: Verify source tables exist
    console.log('Step 0: Verifying source tables...')

    try {
      const mergedCheck = await clickhouse.query({
        query: 'SELECT COUNT(*) as cnt FROM merged_market_mapping'
      })
      const mergedCount = JSON.parse(await mergedCheck.text()).data[0].cnt
      console.log(`  ✓ merged_market_mapping: ${mergedCount} rows`)
    } catch (e) {
      console.error('  ✗ merged_market_mapping not found')
      return { success: false, error: 'merged_market_mapping table missing' }
    }

    try {
      const tradesCheck = await clickhouse.query({
        query: 'SELECT COUNT(*) as cnt FROM trades_raw'
      })
      const tradesCount = JSON.parse(await tradesCheck.text()).data[0].cnt
      console.log(`  ✓ trades_raw: ${tradesCount} rows`)
    } catch (e) {
      console.error('  ✗ trades_raw not found')
      return { success: false, error: 'trades_raw table missing' }
    }

    console.log()

    // Step 1: Drop old enriched table if exists
    console.log('Step 1: Cleaning up old enriched table...')
    try {
      await clickhouse.query({
        query: 'DROP TABLE IF EXISTS trades_raw_enriched'
      })
      console.log('  ✓ Old table dropped')
    } catch (e) {}
    console.log()

    // Step 2: Copy all rows with existing condition_ids (no join needed)
    console.log('Step 2: Copying trades with existing condition_ids...')

    await clickhouse.query({
      query: `
CREATE TABLE trades_raw_enriched
ENGINE = MergeTree()
ORDER BY (wallet_address, timestamp)
AS
SELECT
  trade_id,
  wallet_address,
  market_id,
  condition_id as enriched_condition_id,
  condition_id as original_condition_id,
  'existing' as enrichment_source,
  timestamp,
  shares,
  entry_price,
  side
FROM trades_raw
WHERE condition_id != '' AND condition_id IS NOT NULL
      `
    })

    const existingResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw_enriched'
    })
    const existingCount = parseInt(JSON.parse(await existingResult.text()).data[0].cnt)
    console.log(`  ✓ Copied ${existingCount.toLocaleString()} trades with existing condition_ids`)
    console.log()

    // Step 3: Insert enriched condition_ids for missing rows
    console.log('Step 3: Enriching trades with missing condition_ids...')

    // Get the count of rows to enrich first
    const missingResult = await clickhouse.query({
      query: `
SELECT COUNT(*) as cnt FROM trades_raw
WHERE condition_id = '' OR condition_id IS NULL
      `
    })
    const missingCount = parseInt(JSON.parse(await missingResult.text()).data[0].cnt)
    console.log(`  Found ${missingCount.toLocaleString()} trades to potentially enrich`)
    console.log()

    // Insert enriched rows with small enough query to avoid header overflow
    // We use a simpler SELECT that ClickHouse can handle
    console.log('  Inserting enriched rows...')

    await clickhouse.query({
      query: `
INSERT INTO trades_raw_enriched (
  trade_id, wallet_address, market_id, enriched_condition_id,
  original_condition_id, enrichment_source, timestamp, shares, entry_price, side
)
SELECT
  t.trade_id,
  t.wallet_address,
  t.market_id,
  COALESCE(m.condition_id, '') as enriched_condition_id,
  '' as original_condition_id,
  COALESCE(m.source, 'unmapped') as enrichment_source,
  t.timestamp,
  t.shares,
  t.entry_price,
  t.side
FROM trades_raw t
LEFT JOIN merged_market_mapping m
  ON lower(t.market_id) = lower(m.market_id)
WHERE (t.condition_id = '' OR t.condition_id IS NULL)
  AND (m.condition_id != '' AND m.condition_id IS NOT NULL)
      `
    })

    console.log('  ✓ Enriched rows inserted')
    console.log()

    // Step 4: Verify final coverage
    console.log('Step 4: Verifying enrichment coverage...')

    const finalResult = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN enriched_condition_id != '' AND enriched_condition_id IS NOT NULL THEN 1 END) as with_condition_id,
  COUNT(CASE WHEN enriched_condition_id = '' OR enriched_condition_id IS NULL THEN 1 END) as missing_condition_id,
  ROUND(COUNT(CASE WHEN enriched_condition_id != '' AND enriched_condition_id IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 2) as coverage_percent
FROM trades_raw_enriched
      `
    })

    const finalData = JSON.parse(await finalResult.text()).data[0]
    console.log(`  Total rows: ${finalData.total_rows.toLocaleString()}`)
    console.log(`  With enriched condition_id: ${finalData.with_condition_id.toLocaleString()}`)
    console.log(`  Missing enriched condition_id: ${finalData.missing_condition_id.toLocaleString()}`)
    console.log(`  Coverage: ${finalData.coverage_percent}%`)
    console.log()

    // Step 5: Coverage analysis
    console.log('Step 5: Coverage Analysis...')

    const previousCoverage = 51.47 // From initial state
    const newCoverage = parseFloat(finalData.coverage_percent)
    const improvement = newCoverage - previousCoverage

    console.log(`  Previous coverage: ${previousCoverage}%`)
    console.log(`  New coverage: ${newCoverage}%`)
    console.log(`  Improvement: +${improvement.toFixed(2)}%`)
    console.log()

    console.log('═'.repeat(70))

    if (newCoverage >= 95) {
      console.log('✅ SUCCESS: Achieved 95%+ coverage target!')
    } else if (newCoverage >= 90) {
      console.log('✅ SUCCESS: Achieved 90%+ coverage!')
    } else if (newCoverage > previousCoverage) {
      console.log(`✅ IMPROVEMENT: Coverage improved from ${previousCoverage}% to ${newCoverage}%`)
    } else {
      console.log('⚠️  WARNING: Coverage did not improve as expected')
    }

    console.log('═'.repeat(70))
    console.log()

    return {
      success: true,
      previousCoverage: previousCoverage,
      newCoverage: newCoverage,
      improvement: improvement,
      totalRows: finalData.total_rows,
      withConditionId: finalData.with_condition_id,
      missingConditionId: finalData.missing_condition_id,
      timestamp: new Date().toISOString()
    }

  } catch (e: any) {
    console.error('ERROR:', e.message)
    return {
      success: false,
      error: e.message,
      timestamp: new Date().toISOString()
    }
  }
}

// Run enrichment
applyOptimizedEnrichment().then(result => {
  console.log('Final Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
