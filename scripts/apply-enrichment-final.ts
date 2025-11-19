import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * FINAL ENRICHMENT APPLICATION
 *
 * Merges CLOB + TheGraph data and applies enrichment to trades_raw
 * Run this AFTER both worker-clob-ultra-fast.ts and worker-thegraph-complete.ts finish
 *
 * Steps:
 * 1. Create merged_market_mapping from CLOB + TheGraph (deduplicated)
 * 2. Apply enrichment to trades_raw with COALESCE
 * 3. Verify final coverage
 */

async function applyEnrichment() {
  try {
    console.log('═'.repeat(70))
    console.log('FINAL ENRICHMENT APPLICATION - CLOB + ERC1155 + TheGraph')
    console.log('═'.repeat(70))
    console.log()

    // Step 0: Check available tables
    console.log('Step 0: Checking available data sources...')

    let clobCount = 0
    let erc1155Count = 0
    let thegraphCount = 0

    // Check CLOB
    try {
      const clobResult = await clickhouse.query({
        query: 'SELECT COUNT(DISTINCT condition_id) as cnt FROM clob_market_mapping'
      })
      clobCount = parseInt(JSON.parse(await clobResult.text()).data[0].cnt)
      console.log(`  ✓ CLOB mappings: ${clobCount.toLocaleString()} condition_ids`)
    } catch (e) {
      console.log(`  ✗ CLOB mappings: Not available`)
    }

    // Check ERC1155
    try {
      const erc1155Result = await clickhouse.query({
        query: 'SELECT COUNT(DISTINCT condition_id) as cnt FROM erc1155_condition_map'
      })
      erc1155Count = parseInt(JSON.parse(await erc1155Result.text()).data[0].cnt)
      console.log(`  ✓ ERC1155 mappings: ${erc1155Count.toLocaleString()} condition_ids`)
    } catch (e) {
      console.log(`  ✗ ERC1155 mappings: Not available`)
    }

    // Check TheGraph
    try {
      const thegraphResult = await clickhouse.query({
        query: 'SELECT COUNT(DISTINCT condition_id) as cnt FROM thegraph_market_mapping'
      })
      thegraphCount = parseInt(JSON.parse(await thegraphResult.text()).data[0].cnt)
      console.log(`  ✓ TheGraph mappings: ${thegraphCount.toLocaleString()} condition_ids`)
    } catch (e) {
      console.log(`  ✗ TheGraph mappings: Not available`)
    }

    console.log()

    if (clobCount === 0 && erc1155Count === 0 && thegraphCount === 0) {
      console.error('ERROR: No data found in any source table')
      console.error('Please ensure at least one worker has completed before running this script')
      return { success: false, error: 'No data sources available' }
    }

    // Step 1: Create merged market mapping
    console.log('Step 1: Creating merged market mapping (CLOB + ERC1155 + TheGraph)...')

    try {
      await clickhouse.query({ query: 'DROP TABLE IF EXISTS merged_market_mapping' })
    } catch (e) {}

    await clickhouse.query({
      query: `
CREATE TABLE merged_market_mapping
ENGINE = MergeTree()
ORDER BY (market_id, condition_id)
AS
SELECT
  market_id,
  condition_id,
  question,
  source
FROM (
  -- CLOB API mappings
  SELECT market_id, condition_id, question, 'clob' as source FROM clob_market_mapping
  WHERE market_id != '' AND market_id IS NOT NULL AND condition_id != '' AND condition_id IS NOT NULL

  UNION ALL

  -- ERC1155 blockchain mappings
  SELECT
    lower(market_address) as market_id,
    condition_id,
    '' as question,
    'erc1155' as source
  FROM erc1155_condition_map
  WHERE market_address != '' AND market_address IS NOT NULL AND condition_id != '' AND condition_id IS NOT NULL

  UNION ALL

  -- TheGraph mappings (if available)
  SELECT market_id, condition_id, question, 'thegraph' as source FROM thegraph_market_mapping
  WHERE market_id != '' AND market_id IS NOT NULL AND condition_id != '' AND condition_id IS NOT NULL
)
GROUP BY market_id, condition_id, question, source
      `
    })

    const mergedCountResult = await clickhouse.query({
      query: 'SELECT COUNT(DISTINCT market_id) as cnt FROM merged_market_mapping'
    })
    const mergedCount = JSON.parse(await mergedCountResult.text()).data[0].cnt
    console.log(`✓ Merged table created: ${mergedCount.toLocaleString()} unique markets`)
    console.log()

    // Step 2: Apply enrichment to trades_raw
    console.log('Step 2: Applying enrichment to trades_raw (via JOIN + CREATE TABLE)...')

    // Create enriched trades table with matched condition_ids
    console.log('  Creating enriched table with ERC1155-matched condition_ids...')

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
  COALESCE(m.condition_id, t.condition_id) as enriched_condition_id,
  t.condition_id as original_condition_id,
  m.source as enrichment_source,
  timestamp,
  shares,
  entry_price,
  side
FROM trades_raw t
LEFT JOIN merged_market_mapping m ON lower(t.market_id) = lower(m.market_id)
      `
    })

    console.log('✓ Enriched table created')
    console.log()

    // Step 3: Verify enrichment results
    console.log('Step 3: Verification of enrichment results...')

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
    console.log(`  Missing enriched condition_id: ${verifyData.missing_condition_id.toLocaleString()}`)
    console.log(`  Coverage: ${verifyData.coverage_percent}%`)
    console.log()

    // Step 4: Calculate coverage improvement
    console.log('Step 4: Coverage Analysis...')

    const previousCoverage = 51.47 // From initial problem statement
    const newCoverage = verifyData.coverage_percent
    const improvement = newCoverage - previousCoverage

    console.log(`  Previous coverage: ${previousCoverage}%`)
    console.log(`  New coverage: ${newCoverage}%`)
    console.log(`  Improvement: +${improvement.toFixed(2)}%`)
    console.log(`  Newly enriched rows: ${verifyData.with_condition_id - Math.round(160.9 * 1000000 * previousCoverage / 100)}`)
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
      sources: {
        clobMarkets: clobCount,
        erc1155Markets: erc1155Count,
        thegraphMarkets: thegraphCount
      },
      totalMerged: mergedCount,
      previousCoverage: previousCoverage,
      newCoverage: newCoverage,
      improvement: improvement,
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
applyEnrichment().then(result => {
  console.log('Final Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
