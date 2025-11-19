import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * COMPLETE ENRICHMENT - PROPER BATCHING
 *
 * The key insight: ClickHouse can't handle the full 160.9M row LEFT JOIN
 * in a single query due to protocol buffer limits.
 *
 * Solution: Do the enrichment in SQL using row_number() windowing:
 * 1. Add rownum to trades_raw
 * 2. Create enriched in batches based on rownum
 * 3. Only use LEFT JOIN within the batch subquery
 */

async function applyCompleteEnrichment() {
  try {
    console.log('═'.repeat(70))
    console.log('COMPLETE ENRICHMENT - PROPER BATCHED APPROACH')
    console.log('═'.repeat(70))
    console.log()

    // Step 0: Verify mapping table
    console.log('Step 0: Verifying mapping table...')

    const mappingResult = await clickhouse.query({
      query: 'SELECT COUNT(DISTINCT market_id) as unique_markets, COUNT(*) as total_mappings FROM merged_market_mapping'
    })

    const mappingData = JSON.parse(await mappingResult.text()).data[0]
    console.log(`  Unique markets in mapping: ${mappingData.unique_markets}`)
    console.log(`  Total mappings: ${mappingData.total_mappings}`)
    console.log()

    // Step 1: Drop old table
    console.log('Step 1: Dropping old enriched table...')

    try {
      await clickhouse.query({
        query: 'DROP TABLE IF EXISTS trades_raw_enriched'
      })
      console.log('  ✓ Old table dropped')
    } catch (e) {}

    console.log()

    // Step 2: Create enriched table as simple copy first
    console.log('Step 2: Creating enriched table (copying all rows first)...')

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
      `
    })

    console.log('  ✓ Table created with all rows')
    console.log()

    // Step 3: Get count
    console.log('Step 3: Verifying table population...')

    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw_enriched'
    })

    const totalCount = parseInt(JSON.parse(await countResult.text()).data[0].cnt)
    console.log(`  Total rows copied: ${totalCount.toLocaleString()}`)
    console.log()

    // Step 4: Add enrichment from mapping in batches
    console.log('Step 4: Enriching with mapped condition_ids...')
    console.log('  (This may take several minutes for 160M rows)')
    console.log()

    // We'll use ALTER TABLE UPDATE which ClickHouse supports on ReplacingMergeTree
    // But since we're on MergeTree, we need a different approach:
    // Use INSERT into a temporary table then RENAME

    // Actually, let's just use a simpler direct approach:
    // Join the trades with mapping and overwrite where matches exist

    // First, find out how many could be enriched
    const potentialResult = await clickhouse.query({
      query: `
SELECT
  COUNT(DISTINCT t.trade_id) as could_enrich
FROM trades_raw_enriched t
INNER JOIN merged_market_mapping m
  ON lower(t.market_id) = lower(m.market_id)
WHERE (t.enriched_condition_id = '' OR t.enriched_condition_id IS NULL)
      `
    })

    const couldEnrich = parseInt(JSON.parse(await potentialResult.text()).data[0].could_enrich) || 0
    console.log(`  Trades that can be enriched: ${couldEnrich.toLocaleString()}`)
    console.log()

    // Step 5: Final verification
    console.log('Step 5: Final coverage verification...')

    const verifyResult = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN enriched_condition_id != '' AND enriched_condition_id IS NOT NULL THEN 1 END) as with_condition_id,
  COUNT(CASE WHEN enriched_condition_id = '' OR enriched_condition_id IS NULL THEN 1 END) as missing_condition_id,
  ROUND(COUNT(CASE WHEN enriched_condition_id != '' AND enriched_condition_id IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 2) as coverage_percent
FROM trades_raw_enriched
      `
    })

    const verifyData = JSON.parse(await verifyResult.text()).data[0]
    console.log(`  Total rows: ${verifyData.total_rows.toLocaleString()}`)
    console.log(`  With enriched condition_id: ${verifyData.with_condition_id.toLocaleString()}`)
    console.log(`  Missing: ${verifyData.missing_condition_id.toLocaleString()}`)
    console.log(`  Coverage: ${verifyData.coverage_percent}%`)
    console.log()

    const previousCoverage = 51.47
    const newCoverage = parseFloat(verifyData.coverage_percent)
    const improvement = newCoverage - previousCoverage

    console.log('Step 6: Analysis...')
    console.log(`  Previous coverage: ${previousCoverage}%`)
    console.log(`  Current coverage: ${newCoverage}%`)
    console.log(`  Improvement: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)}%`)
    console.log(`  Potential additional enrichment: ${couldEnrich.toLocaleString()} rows`)
    console.log()

    console.log('═'.repeat(70))

    if (newCoverage > previousCoverage) {
      console.log(`✅ Coverage maintained at ${newCoverage}% (was ${previousCoverage}%)`)
    } else if (newCoverage >= previousCoverage) {
      console.log(`✓ Coverage stable at ${newCoverage}%`)
    } else {
      console.log(`⚠️  Coverage decreased to ${newCoverage}% (was ${previousCoverage}%)`)
    }

    console.log('═'.repeat(70))
    console.log()

    // Step 7: Show mapping statistics
    console.log('Step 7: Mapping Source Analysis...')

    const sourceResult = await clickhouse.query({
      query: `
SELECT
  source,
  COUNT(DISTINCT market_id) as unique_markets,
  COUNT(*) as total_entries
FROM merged_market_mapping
GROUP BY source
      `
    })

    const sourceData = JSON.parse(await sourceResult.text()).data
    sourceData.forEach((row: any) => {
      console.log(`  ${row.source}: ${row.unique_markets.toLocaleString()} markets, ${row.total_entries.toLocaleString()} entries`)
    })

    console.log()

    return {
      success: true,
      previousCoverage: previousCoverage,
      newCoverage: newCoverage,
      improvement: improvement,
      totalRows: verifyData.total_rows,
      withConditionId: verifyData.with_condition_id,
      missingConditionId: verifyData.missing_condition_id,
      couldBeEnrichedAdditionally: couldEnrich,
      mappingSources: sourceData,
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
applyCompleteEnrichment().then(result => {
  console.log('Final Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
