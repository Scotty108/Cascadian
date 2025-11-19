#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function findCorrectTable() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n🎯 FINDING THE CORRECT MAPPING TABLE FOR ENRICHMENT\n')
    
    // Test each potential mapping table
    const tables = [
      'erc1155_condition_map',
      'condition_market_map',
      'api_ctf_bridge',
      'market_key_map',
      'ctf_token_map'
    ]
    
    console.log('📊 COVERAGE TEST FOR EACH MAPPING TABLE:\n')
    
    for (const table of tables) {
      try {
        // Get schema
        const schemaResult = await client.query({
          query: `SELECT * FROM ${table} LIMIT 1`,
          format: 'JSONEachRow'
        })
        const schema = await schemaResult.json<any>()
        
        // Get total rows and unique condition_ids
        const countResult = await client.query({
          query: `SELECT count() as total, uniq(condition_id) as unique_cids FROM ${table}`,
          format: 'JSONEachRow'
        })
        const count = await countResult.json<any>()
        
        // Test coverage against clob_fills
        const coverageResult = await client.query({
          query: `
            SELECT 
              count(DISTINCT cf.condition_id) as total_traded,
              count(DISTINCT t.condition_id) as mapped,
              count(DISTINCT cf.condition_id) - count(DISTINCT t.condition_id) as unmapped
            FROM clob_fills cf
            LEFT JOIN ${table} t ON cf.condition_id = t.condition_id
          `,
          format: 'JSONEachRow'
        })
        const coverage = await coverageResult.json<any>()
        
        const coveragePct = (parseInt(coverage[0].mapped) / parseInt(coverage[0].total_traded) * 100).toFixed(1)
        
        console.log(`${table}:`)
        console.log(`   Total rows: ${parseInt(count[0].total).toLocaleString()}`)
        console.log(`   Unique condition_ids: ${parseInt(count[0].unique_cids).toLocaleString()}`)
        console.log(`   Fields: ${Object.keys(schema[0]).join(', ')}`)
        console.log(`   Coverage of traded condition_ids: ${coveragePct}% (${parseInt(coverage[0].mapped).toLocaleString()} / ${parseInt(coverage[0].total_traded).toLocaleString()})`)
        console.log(`   MISSING from trades: ${parseInt(coverage[0].unmapped).toLocaleString()}\n`)
      } catch (e: any) {
        console.log(`${table}: Error - ${e.message}\n`)
      }
    }
    
    // Check if there's a "master" mapping view we should use
    console.log('🔍 CHECKING FOR MASTER MAPPING TABLES:\n')
    
    const masterTablesResult = await client.query({
      query: `
        SELECT name, engine, total_rows
        FROM system.tables
        WHERE database = 'default'
          AND (name LIKE '%merged%' OR name LIKE '%master%' OR name LIKE '%complete%')
          AND name LIKE '%market%'
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    })
    const masterTables = await masterTablesResult.json<any>()
    
    masterTables.forEach((t: any) => {
      console.log(`   ${t.name.padEnd(40)}: ${t.total_rows.toLocaleString().padStart(10)} rows (${t.engine})`)
    })
    
    // Check merged_market_mapping specifically
    if (masterTables.find((t: any) => t.name === 'merged_market_mapping')) {
      console.log('\n📋 MERGED_MARKET_MAPPING ANALYSIS:')
      
      const mergedSchemaResult = await client.query({
        query: `SELECT * FROM merged_market_mapping LIMIT 1`,
        format: 'JSONEachRow'
      })
      const mergedSchema = await mergedSchemaResult.json<any>()
      
      const mergedCoverageResult = await client.query({
        query: `
          SELECT 
            count(DISTINCT cf.condition_id) as total_traded,
            count(DISTINCT m.condition_id) as mapped
          FROM clob_fills cf
          LEFT JOIN merged_market_mapping m ON cf.condition_id = m.condition_id
        `,
        format: 'JSONEachRow'
      })
      const mergedCoverage = await mergedCoverageResult.json<any>()
      
      console.log(`   Fields: ${Object.keys(mergedSchema[0]).join(', ')}`)
      console.log(`   Coverage: ${(parseInt(mergedCoverage[0].mapped) / parseInt(mergedCoverage[0].total_traded) * 100).toFixed(1)}%`)
    }
    
    console.log('\n🎯 RECOMMENDATION:')
    console.log('   Based on coverage analysis, the best mapping table is:')
    console.log('   → Checking which has highest coverage...')
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

findCorrectTable()
