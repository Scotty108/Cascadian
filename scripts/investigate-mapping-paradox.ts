#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function investigateParadox() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n🔍 MAPPING PARADOX INVESTIGATION\n')
    console.log('Question: Why does the mapping table have only 41K condition_ids,')
    console.log('but somehow ALL 118K traded condition_ids have mappings?\n')
    
    // Check if clob_fills condition_ids are actually IN the mapping table
    const coverageCheckResult = await client.query({
      query: `
        SELECT 
          count(DISTINCT cf.condition_id) as total_traded_cids,
          count(DISTINCT CASE WHEN m.condition_id IS NOT NULL THEN cf.condition_id END) as mapped_cids,
          count(DISTINCT CASE WHEN m.condition_id IS NULL THEN cf.condition_id END) as unmapped_cids
        FROM clob_fills cf
        LEFT JOIN erc1155_condition_map m ON cf.condition_id = m.condition_id
      `,
      format: 'JSONEachRow'
    })
    const coverage = await coverageCheckResult.json<any>()
    
    console.log('📊 COVERAGE CHECK:')
    console.log(`   Total unique condition_ids in clob_fills: ${parseInt(coverage[0].total_traded_cids).toLocaleString()}`)
    console.log(`   Mapped (found in erc1155_condition_map): ${parseInt(coverage[0].mapped_cids).toLocaleString()}`)
    console.log(`   Unmapped (NOT in erc1155_condition_map): ${parseInt(coverage[0].unmapped_cids).toLocaleString()}\n`)
    
    // Maybe the mapping table has duplicates?
    const dupCheckResult = await client.query({
      query: `
        SELECT 
          count() as total_rows,
          uniq(condition_id) as unique_cids,
          count() - uniq(condition_id) as duplicate_count
        FROM erc1155_condition_map
      `,
      format: 'JSONEachRow'
    })
    const dupCheck = await dupCheckResult.json<any>()
    
    console.log('📋 MAPPING TABLE STRUCTURE:')
    console.log(`   Total rows: ${parseInt(dupCheck[0].total_rows).toLocaleString()}`)
    console.log(`   Unique condition_ids: ${parseInt(dupCheck[0].unique_cids).toLocaleString()}`)
    console.log(`   Duplicate rows: ${parseInt(dupCheck[0].duplicate_count).toLocaleString()}\n`)
    
    // Check token_id field - maybe it's a token-to-condition map, not 1:1
    const tokenMapResult = await client.query({
      query: `
        SELECT 
          uniq(token_id) as unique_token_ids,
          uniq(condition_id) as unique_condition_ids,
          count() as total_mappings,
          avg(arrayLength(groupArray(token_id))) as avg_tokens_per_condition
        FROM erc1155_condition_map
        GROUP BY condition_id
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })
    
    // Actually, let me check structure differently
    const structureResult = await client.query({
      query: `
        SELECT 
          condition_id,
          count() as token_count
        FROM erc1155_condition_map
        GROUP BY condition_id
        ORDER BY token_count DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const structure = await structureResult.json<any>()
    
    console.log('🔢 TOKEN MAPPING STRUCTURE:')
    console.log('   Top condition_ids by token count:')
    structure.forEach((row: any, i: number) => {
      console.log(`   ${i+1}. ${row.condition_id}: ${row.token_count} token(s)`)
    })
    
    // Check if this is a token->condition map (many tokens to one condition)
    const reverseCheckResult = await client.query({
      query: `
        SELECT 
          uniq(condition_id) as unique_conditions,
          uniq(token_id) as unique_tokens,
          count() as total_rows
        FROM erc1155_condition_map
      `,
      format: 'JSONEachRow'
    })
    const reverseCheck = await reverseCheckResult.json<any>()
    
    console.log(`\n📌 RELATIONSHIP:`)
    console.log(`   Unique condition_ids: ${parseInt(reverseCheck[0].unique_conditions).toLocaleString()}`)
    console.log(`   Unique token_ids: ${parseInt(reverseCheck[0].unique_tokens).toLocaleString()}`)
    console.log(`   Total mappings: ${parseInt(reverseCheck[0].total_rows).toLocaleString()}`)
    
    if (parseInt(reverseCheck[0].unique_tokens) > parseInt(reverseCheck[0].unique_conditions)) {
      console.log(`\n   ✅ This is a TOKEN → CONDITION map (many tokens per condition)`)
      console.log(`   Each condition can have multiple token_ids (different outcomes)`)
    } else {
      console.log(`\n   This is a CONDITION → TOKEN map (roughly 1:1 or few tokens per condition)`)
    }
    
    // Now check erc1155_transfers - how many unique token_ids are there?
    const transferTokensResult = await client.query({
      query: `
        SELECT 
          uniq(token_id) as unique_token_ids,
          count() as total_transfers
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow'
    })
    const transferTokens = await transferTokensResult.json<any>()
    
    console.log(`\n💡 ERC1155 TRANSFERS:`)
    console.log(`   Unique token_ids: ${parseInt(transferTokens[0].unique_token_ids).toLocaleString()}`)
    console.log(`   Total transfers: ${parseInt(transferTokens[0].total_transfers).toLocaleString()}`)
    
    const mappedTokensPct = (parseInt(reverseCheck[0].unique_tokens) / parseInt(transferTokens[0].unique_token_ids) * 100).toFixed(1)
    console.log(`\n   erc1155_condition_map covers ${mappedTokensPct}% of token_ids in erc1155_transfers`)
    
    console.log('\n🎯 CONCLUSION:')
    if (parseInt(coverage[0].unmapped_cids) === 0) {
      console.log(`   ✅ All traded condition_ids ARE mapped (100% coverage for trades)`)
      console.log(`   ⚠️  But only 41K out of 139K total condition_ids are mapped`)
      console.log(`   💡 This means: Only actively traded markets have token mappings`)
      console.log(`   📊 77K condition_ids in clob_fills have no mapping (never saw ERC1155 transfers?)`)
    } else {
      console.log(`   ❌ ${parseInt(coverage[0].unmapped_cids).toLocaleString()} traded condition_ids are MISSING mappings`)
      console.log(`   🚨 This is a DATA GAP that needs backfilling!`)
    }
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

investigateParadox()
