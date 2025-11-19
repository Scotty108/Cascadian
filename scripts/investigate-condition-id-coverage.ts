#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function investigateCoverage() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n🔍 CONDITION_ID MAPPING COVERAGE ANALYSIS\n')
    
    // 1. How many unique condition_ids exist across all sources?
    const gammaResult = await client.query({
      query: 'SELECT uniq(condition_id) as unique_cids FROM gamma_markets',
      format: 'JSONEachRow'
    })
    const gamma = await gammaResult.json<any>()
    
    const clobResult = await client.query({
      query: 'SELECT uniq(condition_id) as unique_cids FROM clob_fills',
      format: 'JSONEachRow'
    })
    const clob = await clobResult.json<any>()
    
    const erc1155Result = await client.query({
      query: 'SELECT uniq(token_id) as unique_token_ids FROM erc1155_transfers',
      format: 'JSONEachRow'
    })
    const erc1155 = await erc1155Result.json<any>()
    
    const mappingResult = await client.query({
      query: 'SELECT count() as total_mappings, uniq(condition_id) as unique_cids FROM erc1155_condition_map',
      format: 'JSONEachRow'
    })
    const mapping = await mappingResult.json<any>()
    
    console.log('📊 UNIQUE CONDITION IDS BY SOURCE:')
    console.log(`   gamma_markets: ${parseInt(gamma[0].unique_cids).toLocaleString()} unique condition_ids`)
    console.log(`   clob_fills: ${parseInt(clob[0].unique_cids).toLocaleString()} unique condition_ids`)
    console.log(`   erc1155_transfers: ${parseInt(erc1155[0].unique_token_ids).toLocaleString()} unique token_ids`)
    console.log(`   erc1155_condition_map: ${parseInt(mapping[0].unique_cids).toLocaleString()} unique condition_ids`)
    console.log(`                          ${parseInt(mapping[0].total_mappings).toLocaleString()} total mappings\n`)
    
    // 2. Calculate coverage gaps
    const gammaCount = parseInt(gamma[0].unique_cids)
    const clobCount = parseInt(clob[0].unique_cids)
    const erc1155Count = parseInt(erc1155[0].unique_token_ids)
    const mappingCount = parseInt(mapping[0].unique_cids)
    
    console.log('🔴 COVERAGE GAPS:')
    console.log(`   Expected mappings (from gamma_markets): ${gammaCount.toLocaleString()}`)
    console.log(`   Actual mappings: ${mappingCount.toLocaleString()}`)
    console.log(`   MISSING: ${(gammaCount - mappingCount).toLocaleString()} condition_ids (${((1 - mappingCount/gammaCount) * 100).toFixed(1)}% gap)\n`)
    
    console.log(`   Expected mappings (from clob_fills): ${clobCount.toLocaleString()}`)
    console.log(`   Actual mappings: ${mappingCount.toLocaleString()}`)
    console.log(`   MISSING: ${(clobCount - mappingCount).toLocaleString()} condition_ids (${((1 - mappingCount/clobCount) * 100).toFixed(1)}% gap)\n`)
    
    // 3. Check what erc1155_condition_map actually contains
    const sampleResult = await client.query({
      query: 'SELECT * FROM erc1155_condition_map LIMIT 3',
      format: 'JSONEachRow'
    })
    const sample = await sampleResult.json<any>()
    
    console.log('📋 SAMPLE MAPPINGS (what fields exist):')
    console.log(`   Fields: ${Object.keys(sample[0]).join(', ')}\n`)
    
    // 4. Find condition_ids that are traded but NOT mapped
    console.log('🔎 CHECKING FOR UNMAPPED TRADED CONDITION_IDS...')
    const unmappedResult = await client.query({
      query: `
        SELECT 
          c.condition_id,
          count() as trade_count
        FROM clob_fills c
        LEFT JOIN erc1155_condition_map m ON c.condition_id = m.condition_id
        WHERE m.condition_id IS NULL
        GROUP BY c.condition_id
        ORDER BY trade_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const unmapped = await unmappedResult.json<any>()
    
    if (unmapped.length > 0) {
      console.log(`\n   ❌ Found ${unmapped.length} traded condition_ids WITHOUT mappings:`)
      unmapped.forEach((row: any, i: number) => {
        console.log(`   ${i+1}. ${row.condition_id} (${parseInt(row.trade_count).toLocaleString()} trades)`)
      })
    } else {
      console.log(`   ✅ All traded condition_ids have mappings!`)
    }
    
    // 5. Check total unmapped count
    const unmappedCountResult = await client.query({
      query: `
        SELECT count(DISTINCT c.condition_id) as unmapped_count
        FROM clob_fills c
        LEFT JOIN erc1155_condition_map m ON c.condition_id = m.condition_id
        WHERE m.condition_id IS NULL
      `,
      format: 'JSONEachRow'
    })
    const unmappedCount = await unmappedCountResult.json<any>()
    console.log(`\n   Total unmapped traded condition_ids: ${parseInt(unmappedCount[0].unmapped_count).toLocaleString()}`)
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

investigateCoverage()
