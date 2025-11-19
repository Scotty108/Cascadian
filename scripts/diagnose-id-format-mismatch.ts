#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function diagnoseFormatMismatch() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n🔍 DIAGNOSING ID FORMAT MISMATCH\n')
    
    // Get sample condition_ids from each source
    console.log('📋 CONDITION_ID SAMPLES BY SOURCE:\n')
    
    // clob_fills
    const clobResult = await client.query({
      query: `SELECT condition_id FROM clob_fills WHERE condition_id != '' LIMIT 5`,
      format: 'JSONEachRow'
    })
    const clobIds = await clobResult.json<any>()
    console.log('clob_fills:')
    clobIds.forEach((row: any) => {
      console.log(`   ${row.condition_id}`)
      console.log(`      Length: ${row.condition_id.length}, Has 0x: ${row.condition_id.startsWith('0x')}, Case: ${row.condition_id === row.condition_id.toLowerCase() ? 'lowercase' : 'mixed'}`)
    })
    
    // gamma_markets
    const gammaResult = await client.query({
      query: `SELECT condition_id FROM gamma_markets WHERE condition_id != '' LIMIT 5`,
      format: 'JSONEachRow'
    })
    const gammaIds = await gammaResult.json<any>()
    console.log('\ngamma_markets:')
    gammaIds.forEach((row: any) => {
      console.log(`   ${row.condition_id}`)
      console.log(`      Length: ${row.condition_id.length}, Has 0x: ${row.condition_id.startsWith('0x')}, Case: ${row.condition_id === row.condition_id.toLowerCase() ? 'lowercase' : 'mixed'}`)
    })
    
    // api_ctf_bridge
    const ctfResult = await client.query({
      query: `SELECT condition_id FROM api_ctf_bridge WHERE condition_id != '' AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000' LIMIT 5`,
      format: 'JSONEachRow'
    })
    const ctfIds = await ctfResult.json<any>()
    console.log('\napi_ctf_bridge:')
    ctfIds.forEach((row: any) => {
      console.log(`   ${row.condition_id}`)
      console.log(`      Length: ${row.condition_id.length}, Has 0x: ${row.condition_id.startsWith('0x')}, Case: ${row.condition_id === row.condition_id.toLowerCase() ? 'lowercase' : 'mixed'}`)
    })
    
    // market_key_map
    const keyMapResult = await client.query({
      query: `SELECT condition_id FROM market_key_map WHERE condition_id != '' LIMIT 5`,
      format: 'JSONEachRow'
    })
    const keyMapIds = await keyMapResult.json<any>()
    console.log('\nmarket_key_map:')
    keyMapIds.forEach((row: any) => {
      console.log(`   ${row.condition_id}`)
      console.log(`      Length: ${row.condition_id.length}, Has 0x: ${row.condition_id.startsWith('0x')}, Case: ${row.condition_id === row.condition_id.toLowerCase() ? 'lowercase' : 'mixed'}`)
    })
    
    // Now test if normalization fixes the join
    console.log('\n🔬 TESTING NORMALIZED JOIN:\n')
    
    const normalizedJoinResult = await client.query({
      query: `
        SELECT 
          count(DISTINCT cf.condition_id) as total_traded,
          count(DISTINCT CASE 
            WHEN lower(replaceAll(mkm.condition_id, '0x', '')) = lower(replaceAll(cf.condition_id, '0x', ''))
            THEN cf.condition_id 
          END) as matched_normalized
        FROM clob_fills cf
        CROSS JOIN (SELECT condition_id FROM market_key_map LIMIT 1000) mkm
        WHERE lower(replaceAll(mkm.condition_id, '0x', '')) = lower(replaceAll(cf.condition_id, '0x', ''))
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })
    const normalizedJoin = await normalizedJoinResult.json<any>()
    
    console.log('Testing normalized join (lowercase, no 0x):')
    console.log(`   Matched: ${parseInt(normalizedJoin[0].matched_normalized || 0).toLocaleString()}`)
    
    // Try direct overlap test
    const overlapResult = await client.query({
      query: `
        WITH 
          clob_normalized AS (
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
            FROM clob_fills
            LIMIT 10000
          ),
          map_normalized AS (
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
            FROM market_key_map
          )
        SELECT 
          (SELECT count() FROM clob_normalized) as clob_sample,
          (SELECT count() FROM map_normalized) as map_total,
          count() as overlapping
        FROM clob_normalized
        INNER JOIN map_normalized ON clob_normalized.cid_norm = map_normalized.cid_norm
      `,
      format: 'JSONEachRow'
    })
    const overlap = await overlapResult.json<any>()
    
    console.log(`\nOverlap test (10K sample from clob_fills vs all market_key_map):`)
    console.log(`   Sample from clob_fills: ${parseInt(overlap[0].clob_sample).toLocaleString()}`)
    console.log(`   Total in market_key_map: ${parseInt(overlap[0].map_total).toLocaleString()}`)
    console.log(`   Overlapping: ${parseInt(overlap[0].overlapping).toLocaleString()}`)
    console.log(`   Coverage: ${(parseInt(overlap[0].overlapping) / parseInt(overlap[0].clob_sample) * 100).toFixed(1)}%`)
    
    console.log('\n🎯 DIAGNOSIS:')
    if (parseInt(overlap[0].overlapping) < parseInt(overlap[0].clob_sample) * 0.5) {
      console.log('   ❌ MAJOR GAP: Even after normalization, <50% of condition_ids match')
      console.log('   Problem: The mapping tables dont have the condition_ids we need')
      console.log('   Solution: Need to backfill mapping tables from Polymarket API')
    } else {
      console.log('   ✅ Format mismatch: Normalization fixes the problem')
      console.log('   Solution: Apply ID normalization (lowercase, strip 0x) in all joins')
    }
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

diagnoseFormatMismatch()
