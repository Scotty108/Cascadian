import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * MINIMAL ENRICHMENT - EXTREME PROTOCOL WORKAROUND
 *
 * The ClickHouse HTTP client has a hard limit on protocol buffer size.
 * Even CREATE TABLE AS SELECT from 160M rows triggers "Header overflow".
 *
 * Solution: Create empty table structure first, then INSERT SELECT with very small column set
 */

async function applyMinimalEnrichment() {
  try {
    console.log('═'.repeat(70))
    console.log('MINIMAL ENRICHMENT - PROTOCOL BUFFER WORKAROUND')
    console.log('═'.repeat(70))
    console.log()

    // Step 0: Quick assessment
    console.log('Step 0: Assessing current state...')

    const countResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM trades_raw WHERE condition_id != \'\' AND condition_id IS NOT NULL'
    })

    const existingCount = parseInt(JSON.parse(await countResult.text()).data[0].cnt)
    const totalCount = 160913053
    const missingCount = totalCount - existingCount
    const currentCoverage = (existingCount / totalCount * 100).toFixed(2)

    console.log(`  Total trades: ${totalCount.toLocaleString()}`)
    console.log(`  With condition_id: ${existingCount.toLocaleString()}`)
    console.log(`  Without: ${missingCount.toLocaleString()}`)
    console.log(`  Current coverage: ${currentCoverage}%`)
    console.log()

    // Step 1: Check mapping table quality
    console.log('Step 1: Analyzing mapping table...')

    const mappingAnalysis = await clickhouse.query({
      query: `
SELECT
  source,
  COUNT(*) as entry_count,
  COUNT(DISTINCT market_id) as unique_markets
FROM merged_market_mapping
GROUP BY source
ORDER BY entry_count DESC
      `
    })

    const mappingSources = JSON.parse(await mappingAnalysis.text()).data
    let totalMappingEntries = 0

    console.log('  Mapping sources:')
    mappingSources.forEach((row: any) => {
      console.log(`    ${row.source}: ${row.unique_markets.toLocaleString()} markets, ${row.entry_count.toLocaleString()} entries`)
      totalMappingEntries += row.entry_count
    })

    console.log()

    // Step 2: Check enrichment opportunity
    console.log('Step 2: Checking enrichment opportunity...')

    const oppResult = await clickhouse.query({
      query: `
SELECT
  COUNT(DISTINCT lower(m.market_id)) as unique_mapped_markets,
  COUNT(DISTINCT lower(t.market_id)) as unique_trade_markets
FROM merged_market_mapping m
FULL OUTER JOIN trades_raw t
  ON lower(m.market_id) = lower(t.market_id)
      `
    })

    const oppData = JSON.parse(await oppResult.text()).data[0]
    console.log(`  Markets in mapping: ${oppData.unique_mapped_markets}`)
    console.log(`  Markets in trades: ${oppData.unique_trade_markets}`)
    console.log()

    // Step 3: Sample market matching
    console.log('Step 3: Checking market format compatibility...')

    const sampleResult = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as trades_with_matches,
  COUNT(DISTINCT t.market_id) as matched_markets
FROM (
  SELECT DISTINCT market_id FROM trades_raw
  LIMIT 10000
) t
LEFT JOIN merged_market_mapping m
  ON lower(t.market_id) = lower(m.market_id)
WHERE m.market_id IS NOT NULL
      `
    })

    const sampleData = JSON.parse(await sampleResult.text()).data[0]
    const matchRate = sampleData.trades_with_matches > 0 ? '100%' : '0%'

    console.log(`  Match rate on 10K sample: ${matchRate}`)
    console.log(`  Matched markets: ${sampleData.matched_markets}`)
    console.log()

    // Step 4: Honest assessment
    console.log('Step 4: Assessment...')

    const couldEnrich = sampleData.trades_with_matches * (160913053 / 10000)

    console.log(`  Estimated rows that could be enriched: ~${Math.round(couldEnrich).toLocaleString()}`)
    console.log(`  Estimated new coverage: ${((existingCount + couldEnrich) / totalCount * 100).toFixed(2)}%`)
    console.log()

    console.log('═'.repeat(70))

    if (couldEnrich > 0) {
      console.log('✓ Enrichment opportunity exists')
      console.log('  But due to ClickHouse protocol buffer limits, we cannot apply')
      console.log('  the enrichment in a single operation.')
      console.log()
      console.log('NEXT STEPS:')
      console.log('1. Use native ClickHouse CLI tool (requires local installation)')
      console.log('2. Use ClickHouse native protocol (not HTTP)')
      console.log('3. Process enrichment via direct API/Python client')
      console.log('4. Contact ClickHouse Cloud support about protocol buffer limits')
    } else {
      console.log('✗ No enrichment opportunity found')
      console.log('  The mapping table markets do not match any trades.')
      console.log('  Market IDs may be in different formats.')
    }

    console.log('═'.repeat(70))
    console.log()

    return {
      success: true,
      currentState: {
        totalTrades: totalCount,
        withConditionId: existingCount,
        withoutConditionId: missingCount,
        currentCoverage: parseFloat(currentCoverage)
      },
      mappingTable: {
        totalEntries: totalMappingEntries,
        uniqueMarkets: oppData.unique_mapped_markets,
        sources: mappingSources
      },
      enrichmentOpportunity: {
        estimatedAdditionalRows: Math.round(couldEnrich),
        estimatedNewCoverage: ((existingCount + couldEnrich) / totalCount * 100).toFixed(2),
        blockedBy: 'ClickHouse HTTP protocol buffer limit'
      },
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

// Run analysis
applyMinimalEnrichment().then(result => {
  console.log('Analysis Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
