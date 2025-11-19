#!/usr/bin/env npx tsx
/**
 * DOCUMENT ENRICHMENT RESULTS
 * Create summary of enrichment implementation
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import { writeFileSync } from 'fs'

async function documentResults() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n📝 DOCUMENTING ENRICHMENT RESULTS\n')
    
    // Gather all metrics
    const metrics: any = {}
    
    // clob_fills
    const clobResult = await client.query({
      query: 'SELECT count() as c, uniq(asset_id) as u FROM clob_fills',
      format: 'JSONEachRow'
    })
    metrics.clob_fills = await clobResult.json<any>()
    
    // vw_clob_fills_enriched
    const enrichedResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          countIf(market_question IS NOT NULL) as with_question,
          countIf(market_slug IS NOT NULL) as with_slug
        FROM vw_clob_fills_enriched
      `,
      format: 'JSONEachRow'
    })
    metrics.enriched = await enrichedResult.json<any>()
    
    // trades_raw
    const tradesResult = await client.query({
      query: 'SELECT count() as c FROM trades_raw',
      format: 'JSONEachRow'
    })
    metrics.trades_raw = await tradesResult.json<any>()
    
    // market_key_map
    const mapResult = await client.query({
      query: 'SELECT count() as c, uniq(condition_id) as u FROM market_key_map',
      format: 'JSONEachRow'
    })
    metrics.market_key_map = await mapResult.json<any>()
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        status: 'ENRICHMENT_LIVE',
        coverage_pct: (parseInt(metrics.enriched[0].with_question) / parseInt(metrics.enriched[0].total_rows) * 100).toFixed(2),
        total_fills: parseInt(metrics.enriched[0].total_rows).toLocaleString(),
        enriched_fills: parseInt(metrics.enriched[0].with_question).toLocaleString()
      },
      before: {
        clob_fills: {
          rows: parseInt(metrics.clob_fills[0].c),
          unique_asset_ids: parseInt(metrics.clob_fills[0].u),
          has_market_metadata: false
        }
      },
      after: {
        vw_clob_fills_enriched: {
          rows: parseInt(metrics.enriched[0].total_rows),
          with_market_question: parseInt(metrics.enriched[0].with_question),
          with_market_slug: parseInt(metrics.enriched[0].with_slug),
          coverage_pct: parseFloat((parseInt(metrics.enriched[0].with_question) / parseInt(metrics.enriched[0].total_rows) * 100).toFixed(2)),
          has_market_metadata: true
        }
      },
      mapping_tables: {
        market_key_map: {
          rows: parseInt(metrics.market_key_map[0].c),
          unique_condition_ids: parseInt(metrics.market_key_map[0].u),
          purpose: 'Primary enrichment source (questions, slugs, resolution dates)'
        }
      },
      downstream_views: {
        trades_raw: {
          rows: parseInt(metrics.trades_raw[0].c),
          uses_enriched_data: false,
          recommendation: 'Use vw_clob_fills_enriched for new queries requiring market metadata'
        }
      },
      usage_recommendation: 'Use vw_clob_fills_enriched for all new queries requiring market metadata. Existing queries using clob_fills or trades_raw continue to work unchanged.'
    }
    
    const reportPath = 'docs/reports/enrichment_execution_log.json'
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    
    console.log('✅ Enrichment execution log saved to:', reportPath)
    console.log('\n📊 SUMMARY:')
    console.log(`   Total fills: ${report.summary.total_fills}`)
    console.log(`   Enriched with market metadata: ${report.summary.enriched_fills} (${report.summary.coverage_pct}%)`)
    console.log(`   New view available: vw_clob_fills_enriched`)
    console.log(`   Mapping source: market_key_map (${metrics.market_key_map[0].c.toLocaleString()} markets)`)
    console.log('\n✅ DOCUMENTATION COMPLETE')
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
  } finally {
    await client.close()
  }
}

documentResults()
