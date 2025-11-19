import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * ENRICHMENT VIA BATCHED APPROACH
 *
 * Process enrichment in chunks to avoid query size limits:
 * 1. Process trades in 20M row batches
 * 2. Create temp enriched table for each batch
 * 3. Union all batches together
 *
 * This splits the 160.9M row query into 8x 20M queries
 */

async function applyBatchedEnrichment() {
  try {
    console.log('═'.repeat(70))
    console.log('BATCHED ENRICHMENT - PROCESSING IN CHUNKS')
    console.log('═'.repeat(70))
    console.log()

    // Step 0: Get table stats
    console.log('Step 0: Analyzing trades_raw...')

    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw'
    })
    const totalRows = parseInt(JSON.parse(await countResult.text()).data[0].cnt)
    console.log(`  Total rows: ${totalRows.toLocaleString()}`)

    const batchSize = 20_000_000 // 20M per batch
    const numBatches = Math.ceil(totalRows / batchSize)
    console.log(`  Batch size: ${(batchSize / 1_000_000).toFixed(0)}M rows`)
    console.log(`  Number of batches: ${numBatches}`)
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

    // Step 2: Create main table (will INSERT into it)
    console.log('Step 2: Creating enriched table...')

    await clickhouse.query({
      query: `
CREATE TABLE trades_raw_enriched (
  trade_id String,
  wallet_address String,
  market_id String,
  enriched_condition_id String,
  original_condition_id String,
  enrichment_source String,
  timestamp DateTime,
  shares Float64,
  entry_price Float64,
  side String
)
ENGINE = MergeTree()
ORDER BY (wallet_address, timestamp)
      `
    })

    console.log('  ✓ Empty enriched table created')
    console.log()

    // Step 3: Process batches
    console.log('Step 3: Processing enrichment in batches...')
    console.log()

    let totalInserted = 0

    for (let batch = 0; batch < numBatches; batch++) {
      const offset = batch * batchSize
      process.stdout.write(`  Batch ${batch + 1}/${numBatches} (offset ${offset.toLocaleString()}): `)

      // Get row count for this batch first
      const batchCountQuery = `
SELECT COUNT(*) as cnt
FROM trades_raw
LIMIT ${batchSize}
OFFSET ${offset}
      `

      let batchRows = 0
      try {
        const batchCountResult = await clickhouse.query({
          query: batchCountQuery
        })
        batchRows = parseInt(JSON.parse(await batchCountResult.text()).data[0].cnt)
      } catch (e) {
        console.log(`\n    Error counting batch rows: ${(e as any).message}`)
        continue
      }

      if (batchRows === 0) {
        console.log('Done (no more rows)')
        break
      }

      // Now insert for this batch with enrichment
      const insertQuery = `
INSERT INTO trades_raw_enriched (
  trade_id, wallet_address, market_id, enriched_condition_id,
  original_condition_id, enrichment_source, timestamp, shares, entry_price, side
)
SELECT
  t.trade_id,
  t.wallet_address,
  t.market_id,
  CASE
    WHEN t.condition_id != '' AND t.condition_id IS NOT NULL THEN t.condition_id
    ELSE COALESCE(m.condition_id, '')
  END as enriched_condition_id,
  t.condition_id as original_condition_id,
  CASE
    WHEN t.condition_id != '' AND t.condition_id IS NOT NULL THEN 'existing'
    WHEN m.condition_id != '' AND m.condition_id IS NOT NULL THEN COALESCE(m.source, 'mapped')
    ELSE 'unmapped'
  END as enrichment_source,
  t.timestamp,
  t.shares,
  t.entry_price,
  t.side
FROM (
  SELECT * FROM trades_raw
  LIMIT ${batchSize}
  OFFSET ${offset}
) t
LEFT JOIN merged_market_mapping m
  ON lower(t.market_id) = lower(m.market_id)
      `

      try {
        await clickhouse.query({
          query: insertQuery
        })

        totalInserted += batchRows
        console.log(`✓ ${batchRows.toLocaleString()} rows`)
      } catch (e: any) {
        console.log(`\n    Error inserting batch: ${(e as any).message.substring(0, 100)}`)
        // Continue with next batch even if this one fails
      }
    }

    console.log()
    console.log(`Total inserted: ${totalInserted.toLocaleString()}`)
    console.log()

    // Step 4: Verify coverage
    console.log('Step 4: Verifying enrichment coverage...')

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

    // Step 5: Analyze
    console.log('Step 5: Coverage Analysis...')

    const previousCoverage = 51.47
    const newCoverage = parseFloat(verifyData.coverage_percent)
    const improvement = newCoverage - previousCoverage

    console.log(`  Previous: ${previousCoverage}%`)
    console.log(`  New: ${newCoverage}%`)
    console.log(`  Improvement: +${improvement.toFixed(2)}%`)
    console.log()

    console.log('═'.repeat(70))

    if (newCoverage >= 95) {
      console.log('✅ SUCCESS: Achieved 95%+ coverage!')
    } else if (newCoverage >= 90) {
      console.log('✅ SUCCESS: Achieved 90%+ coverage!')
    } else if (newCoverage > previousCoverage) {
      console.log(`✅ IMPROVEMENT: ${previousCoverage}% → ${newCoverage}%`)
    } else {
      console.log('⚠️  Coverage did not improve as expected')
    }

    console.log('═'.repeat(70))
    console.log()

    return {
      success: true,
      previousCoverage: previousCoverage,
      newCoverage: newCoverage,
      improvement: improvement,
      totalRows: verifyData.total_rows,
      withConditionId: verifyData.with_condition_id,
      missingConditionId: verifyData.missing_condition_id,
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
applyBatchedEnrichment().then(result => {
  console.log('Final Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
