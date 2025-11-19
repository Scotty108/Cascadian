import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function buildMapping() {
  try {
    console.log('BUILDING: market_id → condition_id MAPPING')
    console.log('═'.repeat(70))
    console.log('Source: 82.1M trades WITH condition_id')
    console.log('Goal: Map each market_id to its most-common condition_id')
    console.log('Use: Enrich 78.7M missing trades')
    console.log()

    // Step 1: Create a temporary mapping table
    console.log('Step 1: Creating market_id_mapping table...')

    try {
      await clickhouse.query({
        query: 'DROP TABLE IF EXISTS market_id_mapping'
      })
    } catch (e) {
      // OK if doesn't exist
    }

    await clickhouse.query({
      query: `
CREATE TABLE market_id_mapping (
  market_id String,
  condition_id String,
  trade_count UInt64
)
ENGINE = MergeTree()
ORDER BY market_id
      `
    })
    console.log('✓ Table created')
    console.log()

    // Step 2: Build mapping from complete trades
    console.log('Step 2: Analyzing 82.1M complete trades...')
    console.log('  (grouping by market_id, selecting most-common condition_id)')
    console.log()

    const mappingQuery = `
INSERT INTO market_id_mapping
SELECT
  market_id,
  condition_id,
  COUNT(*) as trade_count
FROM trades_raw
WHERE condition_id != '' AND market_id != ''
GROUP BY market_id, condition_id
ORDER BY market_id, trade_count DESC
    `

    const start = Date.now()
    await clickhouse.query({ query: mappingQuery })
    const elapsed = ((Date.now() - start) / 1000).toFixed(0)

    console.log(`✓ Mapping complete (${elapsed}s)`)
    console.log()

    // Step 3: Check coverage
    console.log('Step 3: Checking mapping coverage...')
    console.log()

    const coverageQuery = `
SELECT
  COUNT(DISTINCT market_id) as distinct_markets,
  SUM(trade_count) as total_trades,
  MAX(trade_count) as max_trades_per_market
FROM market_id_mapping
    `

    const coverageResult = await clickhouse.query({ query: coverageQuery })
    const coverageData = JSON.parse(await coverageResult.text()).data[0]

    console.log(`Distinct markets in mapping: ${coverageData.distinct_markets}`)
    console.log(`Total trades represented: ${coverageData.total_trades.toLocaleString()}`)
    console.log(`Max trades for single market: ${coverageData.max_trades_per_market}`)
    console.log()

    // Step 4: Deduplicate to get primary condition_id per market
    console.log('Step 4: De-duplicating to get primary condition_id per market...')
    console.log('  (keeping most-common condition_id for each market)')
    console.log()

    try {
      await clickhouse.query({
        query: 'DROP TABLE IF EXISTS market_id_mapping_final'
      })
    } catch (e) {
      // OK
    }

    const dedupQuery = `
CREATE TABLE market_id_mapping_final AS
SELECT
  market_id,
  condition_id,
  trade_count
FROM (
  SELECT
    market_id,
    condition_id,
    trade_count,
    ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY trade_count DESC) as rn
  FROM market_id_mapping
)
WHERE rn = 1
    `

    await clickhouse.query({ query: dedupQuery })

    const finalCheck = `
SELECT COUNT(*) as cnt FROM market_id_mapping_final
    `

    const finalResult = await clickhouse.query({ query: finalCheck })
    const finalData = JSON.parse(await finalResult.text()).data[0]

    console.log(`✓ De-duplication complete`)
    console.log(`  Final mapping: ${finalData.cnt} unique market_id entries`)
    console.log()

    // Step 5: Test on sample of missing trades
    console.log('Step 5: Testing enrichment on sample of missing trades...')
    console.log()

    const testQuery = `
SELECT
  COUNT(*) as total_tested,
  COUNT(CASE WHEN m.condition_id IS NOT NULL THEN 1 END) as with_mapping,
  ROUND(COUNT(CASE WHEN m.condition_id IS NOT NULL THEN 1 END) / COUNT(*) * 100, 2) as recovery_rate
FROM (SELECT * FROM trades_raw WHERE condition_id = '' LIMIT 1000000) t
LEFT JOIN market_id_mapping_final m ON t.market_id = m.market_id
    `

    const testResult = await clickhouse.query({ query: testQuery })
    const testData = JSON.parse(await testResult.text()).data[0]

    const tested = parseInt(testData.total_tested)
    const withMapping = parseInt(testData.with_mapping)
    const recoveryRate = parseFloat(testData.recovery_rate)

    console.log(`Sample of 1M missing trades:`)
    console.log(`  Total tested: ${tested.toLocaleString()}`)
    console.log(`  Can be enriched: ${withMapping.toLocaleString()}`)
    console.log(`  Recovery rate: ${recoveryRate}%`)
    console.log()

    // Step 6: Final recommendation
    console.log('═'.repeat(70))
    if (recoveryRate >= 50) {
      console.log(`✓ READY FOR ENRICHMENT!`)
      console.log(`  Recovery rate: ${recoveryRate}% is acceptable`)
      console.log(`  Missing 78.7M trades can recover ${(78700000 * recoveryRate / 100).toLocaleString()} rows`)
      console.log()
      console.log('Next step: Execute enrichment using market_id_mapping_final')
    } else {
      console.log(`⚠️  Recovery rate low (${recoveryRate}%)`)
      console.log('  This suggests many markets lack historical data')
      console.log('  Enrichment may not significantly improve coverage')
    }

  } catch (e: any) {
    console.error('Error:', e.message.substring(0, 200))
  }
}

buildMapping()
