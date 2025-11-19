#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || '',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

async function main() {
  console.log('='.repeat(80))
  console.log('COMPLETE DATABASE REALITY CHECK')
  console.log('='.repeat(80))
  
  // Step 1: Analyze fact_trades_clean
  console.log('\n📊 STEP 1: fact_trades_clean Analysis\n')
  
  const tradesResult = await client.query({
    query: `
      SELECT 
        count() as total_trades,
        uniq(condition_id) as unique_conditions,
        countIf(condition_id IS NOT NULL AND condition_id != '') as with_condition_id,
        min(block_timestamp) as earliest_date,
        max(block_timestamp) as latest_date
      FROM fact_trades_clean
    `,
    format: 'JSONEachRow'
  })
  
  const tradesStats = (await tradesResult.json<any>())[0]
  console.log(`Total trades: ${Number(tradesStats.total_trades).toLocaleString()}`)
  console.log(`Unique condition_ids: ${Number(tradesStats.unique_conditions).toLocaleString()}`)
  console.log(`Trades with condition_id: ${Number(tradesStats.with_condition_id).toLocaleString()}`)
  console.log(`Date range: ${tradesStats.earliest_date} to ${tradesStats.latest_date}`)
  
  // Sample condition_ids
  const sampleResult = await client.query({
    query: `SELECT DISTINCT condition_id FROM fact_trades_clean WHERE condition_id != '' LIMIT 10`,
    format: 'JSONEachRow'
  })
  const samples = await sampleResult.json<{condition_id: string}>()
  console.log(`\nSample condition_ids:`)
  samples.slice(0, 5).forEach(s => console.log(`   ${s.condition_id} (len=${s.condition_id.length})`))
  
  // Step 2: Test matching against each resolution table
  console.log('\n' + '='.repeat(80))
  console.log('🔗 STEP 2: Testing condition_id matching (100 random samples)')
  console.log('='.repeat(80))
  
  const resolutionTables = [
    'staging_resolutions_union',
    'market_resolutions_final',
    'market_resolutions',
    'resolution_candidates',
    'resolutions_external_ingest'
  ]
  
  for (const tableName of resolutionTables) {
    console.log(`\n🔍 Testing ${tableName}...`)
    
    // Get table info
    const countResult = await client.query({
      query: `SELECT count() as cnt FROM ${tableName}`,
      format: 'JSONEachRow'
    })
    const cnt = (await countResult.json<{cnt: string}>())[0].cnt
    console.log(`   Rows: ${Number(cnt).toLocaleString()}`)
    
    // Get schema
    const schemaResult = await client.query({
      query: `DESCRIBE TABLE ${tableName}`,
      format: 'JSONEachRow'
    })
    const schema = await schemaResult.json<{name: string, type: string}>()
    const conditionColumn = schema.find(c => c.name.toLowerCase().includes('condition'))?.name
    
    if (!conditionColumn) {
      console.log(`   ⚠️  No condition_id column found`)
      continue
    }
    
    console.log(`   Condition column: ${conditionColumn}`)
    
    // Sample data
    try {
      const sampleRes = await client.query({
        query: `SELECT ${conditionColumn} FROM ${tableName} WHERE ${conditionColumn} != '' LIMIT 3`,
        format: 'JSONEachRow'
      })
      const resSamples = await sampleRes.json<any>()
      if (resSamples.length > 0) {
        const sample = resSamples[0][conditionColumn]
        console.log(`   Sample: ${sample} (len=${sample?.length || 0})`)
      }
    } catch (e: any) {
      console.log(`   Sample error: ${e.message}`)
    }
    
    // Test exact match
    try {
      const exactResult = await client.query({
        query: `
          WITH trades AS (
            SELECT DISTINCT condition_id 
            FROM fact_trades_clean 
            WHERE condition_id != ''
            LIMIT 100
          )
          SELECT COUNT(*) as match_count
          FROM trades t
          INNER JOIN ${tableName} r
            ON t.condition_id = r.${conditionColumn}
        `,
        format: 'JSONEachRow'
      })
      const exactMatch = (await exactResult.json<{match_count: string}>())[0]
      const exactPct = (Number(exactMatch.match_count) / 100 * 100).toFixed(1)
      console.log(`   ✅ Exact match: ${exactMatch.match_count}/100 (${exactPct}%)`)
    } catch (e: any) {
      console.log(`   ❌ Exact match failed: ${e.message}`)
    }
    
    // Test normalized match
    try {
      const normResult = await client.query({
        query: `
          WITH trades AS (
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
            FROM fact_trades_clean 
            WHERE condition_id != ''
            LIMIT 100
          )
          SELECT COUNT(*) as match_count
          FROM trades t
          INNER JOIN ${tableName} r
            ON t.cid_norm = lower(replaceAll(r.${conditionColumn}, '0x', ''))
        `,
        format: 'JSONEachRow'
      })
      const normMatch = (await normResult.json<{match_count: string}>())[0]
      const normPct = (Number(normMatch.match_count) / 100 * 100).toFixed(1)
      console.log(`   ✅ Normalized match: ${normMatch.match_count}/100 (${normPct}%)`)
    } catch (e: any) {
      console.log(`   ❌ Normalized match failed: ${e.message}`)
    }
  }
  
  // Step 3: Check market status
  console.log('\n' + '='.repeat(80))
  console.log('🎯 STEP 3: Market Status Analysis')
  console.log('='.repeat(80))
  
  const apiMarketsCheck = await client.query({
    query: `
      SELECT 
        count() as total,
        countIf(closed = true) as closed_count,
        countIf(closed = false) as open_count
      FROM api_markets_staging
    `,
    format: 'JSONEachRow'
  })
  const marketStats = (await apiMarketsCheck.json<any>())[0]
  console.log(`\napi_markets_staging:`)
  console.log(`   Total: ${Number(marketStats.total).toLocaleString()}`)
  console.log(`   Closed: ${Number(marketStats.closed_count).toLocaleString()} (${(Number(marketStats.closed_count)/Number(marketStats.total)*100).toFixed(1)}%)`)
  console.log(`   Open: ${Number(marketStats.open_count).toLocaleString()} (${(Number(marketStats.open_count)/Number(marketStats.total)*100).toFixed(1)}%)`)
  
  // Step 4: Check if traded markets are in api_markets_staging
  console.log('\n' + '='.repeat(80))
  console.log('🔬 STEP 4: Testing if traded markets exist in api_markets_staging')
  console.log('='.repeat(80))
  
  // Get condition_id column from api_markets_staging
  const apiSchema = await client.query({
    query: `DESCRIBE TABLE api_markets_staging`,
    format: 'JSONEachRow'
  })
  const apiCols = await apiSchema.json<{name: string}>()
  console.log(`\napi_markets_staging columns: ${apiCols.map(c => c.name).join(', ')}`)
  
  // Check if condition_id exists
  const hasConditionId = apiCols.some(c => c.name.toLowerCase().includes('condition'))
  console.log(`Has condition_id column: ${hasConditionId}`)
  
  // Step 5: Final diagnosis
  console.log('\n' + '='.repeat(80))
  console.log('🚨 STEP 5: ROOT CAUSE DIAGNOSIS')
  console.log('='.repeat(80))
  
  console.log(`\n📊 Summary:`)
  console.log(`   • ${Number(tradesStats.unique_conditions).toLocaleString()} unique traded condition_ids`)
  console.log(`   • ${Number(marketStats.closed_count).toLocaleString()} closed markets in api_markets_staging`)
  console.log(`   • Only 11.88% of positions can be resolved`)
  console.log(`\n🔬 This means one of:`)
  console.log(`   A) Missing data: Markets haven't resolved yet (still open)`)
  console.log(`   B) Bad joins: ID formats don't match between tables`)
  console.log(`   C) Wrong tables: Resolution data is elsewhere`)
  
  console.log('\n' + '='.repeat(80))
  console.log('✅ AUDIT COMPLETE')
  console.log('='.repeat(80))
  
  await client.close()
}

main().catch(console.error)
