#!/usr/bin/env npx tsx
/**
 * VALIDATE ENRICHMENT COVERAGE
 * Checks that vw_clob_fills_enriched provides 100% market metadata coverage
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function validateCoverage() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n📊 VALIDATING ENRICHMENT COVERAGE\n')
    
    // Overall coverage stats
    const overallResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          countIf(market_question IS NOT NULL) as with_question,
          countIf(market_slug IS NOT NULL) as with_slug,
          countIf(market_resolved_at IS NOT NULL) as with_resolution_date,
          countIf(api_market_id IS NOT NULL) as with_api_id,
          countIf(canonical_category IS NOT NULL) as with_category
        FROM default.vw_clob_fills_enriched
      `,
      format: 'JSONEachRow'
    })
    const overall = await overallResult.json<any>()
    
    const total = parseInt(overall[0].total_rows)
    const withQuestion = parseInt(overall[0].with_question)
    const withSlug = parseInt(overall[0].with_slug)
    const withResDate = parseInt(overall[0].with_resolution_date)
    const withApiId = parseInt(overall[0].with_api_id)
    const withCategory = parseInt(overall[0].with_category)
    
    console.log('📈 ENRICHMENT COVERAGE RESULTS:')
    console.log(`   Total fills: ${total.toLocaleString()}`)
    console.log(`   With market_question: ${withQuestion.toLocaleString()} (${(withQuestion/total*100).toFixed(2)}%)`)
    console.log(`   With market_slug: ${withSlug.toLocaleString()} (${(withSlug/total*100).toFixed(2)}%)`)
    console.log(`   With resolution date: ${withResDate.toLocaleString()} (${(withResDate/total*100).toFixed(2)}%)`)
    console.log(`   With api_market_id: ${withApiId.toLocaleString()} (${(withApiId/total*100).toFixed(2)}%)`)
    console.log(`   With category: ${withCategory.toLocaleString()} (${(withCategory/total*100).toFixed(2)}%)\n`)
    
    // Check unique condition coverage
    const uniqueResult = await client.query({
      query: `
        SELECT
          uniq(condition_id) as total_unique_conditions,
          uniqIf(condition_id, market_question IS NOT NULL) as conditions_with_question
        FROM default.vw_clob_fills_enriched
      `,
      format: 'JSONEachRow'
    })
    const unique = await uniqueResult.json<any>()
    
    const totalConditions = parseInt(unique[0].total_unique_conditions)
    const conditionsWithQ = parseInt(unique[0].conditions_with_question)
    
    console.log('📊 UNIQUE CONDITION_ID COVERAGE:')
    console.log(`   Total unique condition_ids: ${totalConditions.toLocaleString()}`)
    console.log(`   With market metadata: ${conditionsWithQ.toLocaleString()} (${(conditionsWithQ/totalConditions*100).toFixed(2)}%)\n`)
    
    // Sample some enriched data
    const sampleResult = await client.query({
      query: `
        SELECT
          condition_id,
          market_question,
          market_slug,
          size,
          price
        FROM default.vw_clob_fills_enriched
        WHERE market_question IS NOT NULL
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const samples = await sampleResult.json<any>()
    
    console.log('📝 SAMPLE ENRICHED ROWS:')
    samples.forEach((row: any, i: number) => {
      console.log(`\n   ${i+1}. ${row.market_question}`)
      console.log(`      Slug: ${row.market_slug}`)
      console.log(`      Condition ID: ${row.condition_id.substring(0, 20)}...`)
      console.log(`      Trade: ${row.size} @ $${row.price}`)
    })
    
    // Quality assessment
    console.log('\n\n🎯 QUALITY ASSESSMENT:')
    if (conditionsWithQ / totalConditions >= 0.99) {
      console.log('   ✅ EXCELLENT: ≥99% condition_id coverage')
    } else if (conditionsWithQ / totalConditions >= 0.95) {
      console.log('   ✅ GOOD: ≥95% condition_id coverage')
    } else if (conditionsWithQ / totalConditions >= 0.90) {
      console.log('   ⚠️  ACCEPTABLE: ≥90% condition_id coverage')
    } else {
      console.log('   ❌ POOR: <90% condition_id coverage - investigation needed')
    }
    
    if (withQuestion / total >= 0.99) {
      console.log('   ✅ EXCELLENT: ≥99% row-level enrichment')
    } else if (withQuestion / total >= 0.95) {
      console.log('   ✅ GOOD: ≥95% row-level enrichment')
    } else {
      console.log('   ⚠️  Needs improvement: <95% row-level enrichment')
    }
    
    console.log('\n✅ VALIDATION COMPLETE')
    
  } catch (error: any) {
    console.error('\n❌ Error validating coverage:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

validateCoverage()
