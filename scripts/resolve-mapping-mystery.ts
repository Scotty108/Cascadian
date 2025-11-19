#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function resolveMystery() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n🕵️ RESOLVING THE MAPPING MYSTERY\n')
    
    // First, let's see actual counts more carefully
    const detailedResult = await client.query({
      query: `
        SELECT 
          uniq(condition_id) as unique_condition_ids,
          uniq(token_id) as unique_token_ids,
          count() as total_rows,
          count(DISTINCT condition_id) as distinct_conditions,
          count(DISTINCT token_id) as distinct_tokens
        FROM erc1155_condition_map
      `,
      format: 'JSONEachRow'
    })
    const detailed = await detailedResult.json<any>()
    
    console.log('📊 ERC1155_CONDITION_MAP DETAILED COUNT:')
    console.log(`   Total rows: ${parseInt(detailed[0].total_rows).toLocaleString()}`)
    console.log(`   Unique condition_ids: ${parseInt(detailed[0].unique_condition_ids).toLocaleString()}`)
    console.log(`   Unique token_ids: ${parseInt(detailed[0].unique_token_ids).toLocaleString()}`)
    console.log(`   Distinct condition_ids: ${parseInt(detailed[0].distinct_conditions).toLocaleString()}`)
    console.log(`   Distinct token_ids: ${parseInt(detailed[0].distinct_tokens).toLocaleString()}\n`)
    
    // Check if there are multiple tables with similar names
    const tableSearchResult = await client.query({
      query: `
        SELECT name, total_rows
        FROM system.tables
        WHERE database = 'default'
          AND (name LIKE '%condition%' OR name LIKE '%token%map%' OR name LIKE '%ctf%')
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    })
    const tables = await tableSearchResult.json<any>()
    
    console.log('📋 RELATED MAPPING TABLES:')
    tables.forEach((t: any) => {
      console.log(`   ${t.name.padEnd(40)}: ${parseInt(t.total_rows).toLocaleString()} rows`)
    })
    
    // Check if condition_market_map or market_key_map have better coverage
    console.log('\n🔍 CHECKING OTHER MAPPING TABLES:')
    
    const conditionMarketResult = await client.query({
      query: `SELECT uniq(condition_id) as unique_cids, count() as total FROM condition_market_map`,
      format: 'JSONEachRow'
    })
    const conditionMarket = await conditionMarketResult.json<any>()
    console.log(`   condition_market_map: ${parseInt(conditionMarket[0].unique_cids).toLocaleString()} unique condition_ids (${parseInt(conditionMarket[0].total).toLocaleString()} rows)`)
    
    // Check api_ctf_bridge
    const ctfBridgeResult = await client.query({
      query: `SELECT count() as total FROM api_ctf_bridge LIMIT 1`,
      format: 'JSONEachRow'
    })
    const ctfBridge = await ctfBridgeResult.json<any>()
    
    const ctfBridgeSchemaResult = await client.query({
      query: `SELECT * FROM api_ctf_bridge LIMIT 1`,
      format: 'JSONEachRow'
    })
    const ctfBridgeSchema = await ctfBridgeSchemaResult.json<any>()
    
    console.log(`   api_ctf_bridge: ${parseInt(ctfBridge[0].total).toLocaleString()} rows`)
    console.log(`      Fields: ${Object.keys(ctfBridgeSchema[0]).join(', ')}`)
    
    // Check market_key_map
    const marketKeyResult = await client.query({
      query: `SELECT * FROM market_key_map LIMIT 1`,
      format: 'JSONEachRow'
    })
    const marketKeySchema = await marketKeyResult.json<any>()
    console.log(`   market_key_map: 156,952 rows`)
    console.log(`      Fields: ${Object.keys(marketKeySchema[0]).join(', ')}`)
    
    // Now the KEY question: Why does the JOIN find all 118K?
    // Let me check if there's a VIEW or materialized view that's actually being used
    const viewCheckResult = await client.query({
      query: `
        SELECT name, engine
        FROM system.tables
        WHERE database = 'default'
          AND name = 'erc1155_condition_map'
      `,
      format: 'JSONEachRow'
    })
    const viewCheck = await viewCheckResult.json<any>()
    
    console.log(`\n🔎 TABLE TYPE:`)
    console.log(`   erc1155_condition_map engine: ${viewCheck[0].engine}`)
    
    // Sample some actual condition_ids from both tables to see format
    const clobSampleResult = await client.query({
      query: `SELECT DISTINCT condition_id FROM clob_fills LIMIT 3`,
      format: 'JSONEachRow'
    })
    const clobSample = await clobSampleResult.json<any>()
    
    const mapSampleResult = await client.query({
      query: `SELECT DISTINCT condition_id FROM erc1155_condition_map LIMIT 3`,
      format: 'JSONEachRow'
    })
    const mapSample = await mapSampleResult.json<any>()
    
    console.log(`\n📝 CONDITION_ID FORMAT SAMPLES:`)
    console.log(`   clob_fills:`)
    clobSample.forEach((row: any) => console.log(`      ${row.condition_id} (length: ${row.condition_id.length})`))
    console.log(`   erc1155_condition_map:`)
    mapSample.forEach((row: any) => console.log(`      ${row.condition_id} (length: ${row.condition_id.length})`))
    
    // Final answer: Check if maybe I should be looking at a different table entirely
    console.log(`\n💡 HYPOTHESIS:`)
    console.log(`   Maybe the 41K table is correct, but it's being EXPANDED via JOINs?`)
    console.log(`   Or maybe there's a larger mapping table we should use instead?`)
    console.log(`   Let me check condition_market_map coverage...`)
    
    const coverageTestResult = await client.query({
      query: `
        SELECT 
          count(DISTINCT cf.condition_id) as total_in_clob,
          count(DISTINCT cmm.condition_id) as found_in_cmm
        FROM clob_fills cf
        LEFT JOIN condition_market_map cmm ON cf.condition_id = cmm.condition_id
      `,
      format: 'JSONEachRow'
    })
    const coverageTest = await coverageTestResult.json<any>()
    
    console.log(`\n   condition_market_map coverage:`)
    console.log(`      Total condition_ids in clob_fills: ${parseInt(coverageTest[0].total_in_clob).toLocaleString()}`)
    console.log(`      Found in condition_market_map: ${parseInt(coverageTest[0].found_in_cmm).toLocaleString()}`)
    console.log(`      Coverage: ${(parseInt(coverageTest[0].found_in_cmm) / parseInt(coverageTest[0].total_in_clob) * 100).toFixed(1)}%`)
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

resolveMystery()
