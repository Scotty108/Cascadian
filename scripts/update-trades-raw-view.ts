#!/usr/bin/env npx tsx
/**
 * UPDATE TRADES_RAW VIEW
 * Check if trades_raw exists and update it to use enriched data if needed
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function updateTradesRaw() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n🔍 CHECKING TRADES_RAW VIEW\n')
    
    // Check if trades_raw exists
    const existsResult = await client.query({
      query: `
        SELECT engine, create_table_query
        FROM system.tables
        WHERE database = 'default' AND name = 'trades_raw'
      `,
      format: 'JSONEachRow'
    })
    const exists = await existsResult.json<any>()
    
    if (exists.length === 0) {
      console.log('ℹ️  trades_raw view does not exist')
      console.log('   This is fine - vw_clob_fills_enriched can be used directly\n')
      console.log('✅ No action needed for trades_raw')
      return
    }
    
    console.log(`📋 trades_raw exists (engine: ${exists[0].engine})\n`)
    
    // Get current definition
    const currentDef = exists[0].create_table_query
    console.log('Current definition:')
    console.log(currentDef.substring(0, 500) + '...\n')
    
    // Check if it already uses vw_clob_fills_enriched
    if (currentDef.includes('vw_clob_fills_enriched')) {
      console.log('✅ trades_raw already uses vw_clob_fills_enriched')
      console.log('   No update needed!\n')
      return
    }
    
    // Get row count before
    const beforeResult = await client.query({
      query: 'SELECT count() as row_count FROM default.trades_raw',
      format: 'JSONEachRow'
    })
    const before = await beforeResult.json<any>()
    console.log(`📊 BEFORE: trades_raw has ${parseInt(before[0].row_count).toLocaleString()} rows\n`)
    
    console.log('⚠️  trades_raw does NOT use enriched data yet')
    console.log('   Recommendation: Update trades_raw definition to source from vw_clob_fills_enriched')
    console.log('   OR: Use vw_clob_fills_enriched directly in downstream queries\n')
    
    console.log('✅ Assessment complete')
    
  } catch (error: any) {
    console.error('\n❌ Error checking trades_raw:', error.message)
  } finally {
    await client.close()
  }
}

updateTradesRaw()
