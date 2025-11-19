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
  console.log('COMPLETE DATABASE REALITY CHECK - ROOT CAUSE ANALYSIS')
  console.log('='.repeat(80))
  
  // Step 1: Analyze fact_trades_clean
  console.log('\n📊 STEP 1: fact_trades_clean Analysis\n')
  
  const tradesResult = await client.query({
    query: `
      SELECT 
        count() as total_trades,
        uniq(cid) as unique_cids,
        countIf(cid IS NOT NULL AND cid != '') as with_cid,
        min(block_time) as earliest_date,
        max(block_time) as latest_date
      FROM fact_trades_clean
    `,
    format: 'JSONEachRow'
  })
  
  const tradesStats = (await tradesResult.json<any>())[0]
  console.log(`Total trades: ${Number(tradesStats.total_trades).toLocaleString()}`)
  console.log(`Unique condition_ids (cid): ${Number(tradesStats.unique_cids).toLocaleString()}`)
  console.log(`Trades with cid: ${Number(tradesStats.with_cid).toLocaleString()}`)
  console.log(`Date range: ${tradesStats.earliest_date} to ${tradesStats.latest_date}`)
  
  // Sample cids
  const sampleResult = await client.query({
    query: `SELECT DISTINCT cid FROM fact_trades_clean WHERE cid != '' LIMIT 10`,
    format: 'JSONEachRow'
  })
  const samples = await sampleResult.json<{cid: string}>()
  console.log(`\nSample condition_ids:`)
  samples.slice(0, 5).forEach(s => console.log(`   ${s.cid} (len=${s.cid.length})`))
  
  // Step 2: Test matching against each resolution table
  console.log('\n' + '='.repeat(80))
  console.log('🔗 STEP 2: Testing cid matching against resolution tables (100 samples)')
  console.log('='.repeat(80))
  
  const resolutionTables = [
    'staging_resolutions_union',
    'market_resolutions_final',
    'market_resolutions',
    'resolution_candidates',
    'resolutions_external_ingest'
  ]
  
  for (const tableName of resolutionTables) {
    console.log(`\n🔍 ${tableName}`)
    
    try {
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
      console.log(`   Columns: ${schema.map(c => c.name).join(', ')}`)
      
      const conditionColumn = schema.find(c => c.name.toLowerCase().includes('condition'))?.name
      
      if (!conditionColumn) {
        console.log(`   ⚠️  No condition column found`)
        continue
      }
      
      console.log(`   Condition column: ${conditionColumn}`)
      
      // Sample data
      const sampleRes = await client.query({
        query: `SELECT ${conditionColumn} FROM ${tableName} WHERE ${conditionColumn} != '' LIMIT 3`,
        format: 'JSONEachRow'
      })
      const resSamples = await sampleRes.json<any>()
      if (resSamples.length > 0) {
        const sample = resSamples[0][conditionColumn]
        console.log(`   Sample: ${sample} (len=${sample?.length || 0})`)
      }
      
      // Test exact match
      const exactResult = await client.query({
        query: `
          WITH trades AS (
            SELECT DISTINCT cid 
            FROM fact_trades_clean 
            WHERE cid != ''
            LIMIT 100
          )
          SELECT COUNT(*) as match_count
          FROM trades t
          INNER JOIN ${tableName} r
            ON t.cid = r.${conditionColumn}
        `,
        format: 'JSONEachRow'
      })
      const exactMatch = (await exactResult.json<{match_count: string}>())[0]
      const exactPct = (Number(exactMatch.match_count) / 100 * 100).toFixed(1)
      console.log(`   ✅ Exact match: ${exactMatch.match_count}/100 (${exactPct}%)`)
      
      // Test normalized match
      const normResult = await client.query({
        query: `
          WITH trades AS (
            SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
            FROM fact_trades_clean 
            WHERE cid != ''
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
      console.log(`   ❌ Error: ${e.message}`)
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
  
  // Step 4: Check if traded markets match api_markets
  console.log('\n' + '='.repeat(80))
  console.log('🔬 STEP 4: Do traded condition_ids exist in api_markets_staging?')
  console.log('='.repeat(80))
  
  // Get schema
  const apiSchema = await client.query({
    query: `DESCRIBE TABLE api_markets_staging`,
    format: 'JSONEachRow'
  })
  const apiCols = await apiSchema.json<{name: string}>()
  const apiCondCol = apiCols.find(c => c.name.toLowerCase().includes('condition'))?.name
  
  if (apiCondCol) {
    console.log(`\napi_markets_staging has condition column: ${apiCondCol}`)
    
    // Test match
    const matchResult = await client.query({
      query: `
        WITH trades AS (
          SELECT DISTINCT cid
          FROM fact_trades_clean
          WHERE cid != ''
          LIMIT 1000
        )
        SELECT COUNT(*) as match_count
        FROM trades t
        INNER JOIN api_markets_staging m
          ON t.cid = m.${apiCondCol}
      `,
      format: 'JSONEachRow'
    })
    const match = (await matchResult.json<{match_count: string}>())[0]
    console.log(`Match: ${match.match_count}/1000 traded cids found in api_markets_staging`)
    
    // How many are closed?
    const closedResult = await client.query({
      query: `
        WITH trades AS (
          SELECT DISTINCT cid
          FROM fact_trades_clean
          WHERE cid != ''
          LIMIT 1000
        )
        SELECT 
          COUNT(*) as total_matched,
          countIf(m.closed = true) as closed_matched
        FROM trades t
        INNER JOIN api_markets_staging m
          ON t.cid = m.${apiCondCol}
      `,
      format: 'JSONEachRow'
    })
    const closed = (await closedResult.json<any>())[0]
    console.log(`Of matched: ${closed.closed_matched}/${closed.total_matched} are closed (${(Number(closed.closed_matched)/Number(closed.total_matched)*100).toFixed(1)}%)`)
  } else {
    console.log('\n⚠️  api_markets_staging has NO condition_id column!')
    console.log(`Columns: ${apiCols.map(c => c.name).join(', ')}`)
  }
  
  // Step 5: Final diagnosis
  console.log('\n' + '='.repeat(80))
  console.log('🚨 STEP 5: ROOT CAUSE DIAGNOSIS')
  console.log('='.repeat(80))
  
  console.log(`\n📊 The Facts:`)
  console.log(`   • ${Number(tradesStats.unique_cids).toLocaleString()} unique condition_ids traded`)
  console.log(`   • ${Number(marketStats.total).toLocaleString()} markets in api_markets_staging`)
  console.log(`   • ${Number(marketStats.closed_count).toLocaleString()} closed markets (${(Number(marketStats.closed_count)/Number(marketStats.total)*100).toFixed(1)}%)`)
  console.log(`   • Only 11.88% of positions can be resolved in current system`)
  
  console.log(`\n🔬 Possible Root Causes:`)
  console.log(`   A) MISSING DATA: Most traded markets haven't resolved yet (still open)`)
  console.log(`   B) BAD JOINS: condition_id formats don't match between tables`)
  console.log(`   C) WRONG SOURCE: Best resolution data is in a different table`)
  console.log(`   D) INCOMPLETE BACKFILL: Resolution data exists but wasn't imported`)
  
  console.log('\n' + '='.repeat(80))
  console.log('✅ AUDIT COMPLETE - See results above for root cause')
  console.log('='.repeat(80))
  
  await client.close()
}

main().catch(console.error)
