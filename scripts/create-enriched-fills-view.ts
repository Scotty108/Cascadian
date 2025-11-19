#!/usr/bin/env npx tsx
/**
 * CREATE ENRICHED FILLS VIEW
 * Creates vw_clob_fills_enriched with market metadata using normalized condition_id joins
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function createEnrichedView() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n🔧 CREATING ENRICHED FILLS VIEW\n')
    
    // First, capture BEFORE state
    console.log('📊 BEFORE STATE:')
    const beforeResult = await client.query({
      query: `
        SELECT 
          count() as total_fills,
          uniq(condition_id) as unique_conditions
        FROM clob_fills
      `,
      format: 'JSONEachRow'
    })
    const before = await beforeResult.json<any>()
    console.log(`   clob_fills: ${parseInt(before[0].total_fills).toLocaleString()} rows`)
    console.log(`   Unique condition_ids: ${parseInt(before[0].unique_conditions).toLocaleString()}\n`)
    
    // Check if view already exists
    const existsResult = await client.query({
      query: `
        SELECT count() as exists
        FROM system.tables
        WHERE database = 'default' AND name = 'vw_clob_fills_enriched'
      `,
      format: 'JSONEachRow'
    })
    const exists = await existsResult.json<any>()
    
    if (parseInt(exists[0].exists) > 0) {
      console.log('⚠️  View vw_clob_fills_enriched already exists. Dropping and recreating...\n')
      await client.query({
        query: 'DROP VIEW IF EXISTS default.vw_clob_fills_enriched'
      })
    }
    
    // Create the enriched view
    console.log('🏗️  Creating vw_clob_fills_enriched...')
    await client.query({
      query: `
        CREATE VIEW default.vw_clob_fills_enriched AS
        SELECT
          cf.*,
          mkm.question as market_question,
          mkm.market_id as market_slug,
          mkm.resolved_at as market_resolved_at,
          acb.api_market_id,
          acb.resolved_outcome as api_resolved_outcome,
          cmm.canonical_category,
          cmm.raw_tags
        FROM default.clob_fills cf
        LEFT JOIN default.market_key_map mkm
          ON lower(replaceAll(cf.condition_id, '0x', '')) = mkm.condition_id
        LEFT JOIN default.api_ctf_bridge acb
          ON lower(replaceAll(cf.condition_id, '0x', '')) = acb.condition_id
        LEFT JOIN default.condition_market_map cmm
          ON lower(replaceAll(cf.condition_id, '0x', '')) = cmm.condition_id
      `
    })
    console.log('✅ View created successfully!\n')
    
    // Verify view was created
    const verifyResult = await client.query({
      query: `
        SELECT engine
        FROM system.tables
        WHERE database = 'default' AND name = 'vw_clob_fills_enriched'
      `,
      format: 'JSONEachRow'
    })
    const verify = await verifyResult.json<any>()
    
    if (verify.length > 0) {
      console.log(`✅ Verification: View exists with engine = ${verify[0].engine}\n`)
    } else {
      throw new Error('View creation failed - view not found in system.tables')
    }
    
    console.log('✅ ENRICHED VIEW CREATED SUCCESSFULLY')
    
  } catch (error: any) {
    console.error('\n❌ Error creating enriched view:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

createEnrichedView()
