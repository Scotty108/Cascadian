#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function verifyTransformations() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n🔄 TRANSFORMATION CHAIN VERIFICATION\n')
    
    // Check clob_fills
    const clobResult = await client.query({
      query: `
        SELECT 
          count() as total_rows,
          uniq(proxy_wallet) as unique_proxy,
          uniq(user_eoa) as unique_eoa,
          uniq(condition_id) as unique_conditions,
          countIf(proxy_wallet != user_eoa) as different_wallets
        FROM default.clob_fills
      `,
      format: 'JSONEachRow'
    })
    const clob = await clobResult.json<any>()
    
    console.log('1️⃣ CLOB_FILLS (Source)')
    console.log(`   Total rows: ${parseInt(clob[0].total_rows).toLocaleString()}`)
    console.log(`   Unique proxy_wallet: ${parseInt(clob[0].unique_proxy).toLocaleString()}`)
    console.log(`   Unique user_eoa: ${parseInt(clob[0].unique_eoa).toLocaleString()}`)
    console.log(`   Unique condition_ids: ${parseInt(clob[0].unique_conditions).toLocaleString()}`)
    console.log(`   Rows where proxy_wallet != user_eoa: ${parseInt(clob[0].different_wallets).toLocaleString()}`)
    
    // Check trade_direction_assignments
    const tdaResult = await client.query({
      query: `
        SELECT count() as total_rows
        FROM default.trade_direction_assignments
      `,
      format: 'JSONEachRow'
    })
    const tda = await tdaResult.json<any>()
    
    console.log('\n2️⃣ TRADE_DIRECTION_ASSIGNMENTS (Enrichment Layer 1)')
    console.log(`   Total rows: ${parseInt(tda[0].total_rows).toLocaleString()}`)
    console.log(`   Row multiplier from clob_fills: ${(parseInt(tda[0].total_rows) / parseInt(clob[0].total_rows)).toFixed(2)}x`)
    
    // Check vw_trades_canonical
    const vtcResult = await client.query({
      query: `
        SELECT count() as total_rows
        FROM default.vw_trades_canonical
      `,
      format: 'JSONEachRow'
    })
    const vtc = await vtcResult.json<any>()
    
    console.log('\n3️⃣ VW_TRADES_CANONICAL (Enrichment Layer 2)')
    console.log(`   Total rows: ${parseInt(vtc[0].total_rows).toLocaleString()}`)
    console.log(`   Row multiplier from trade_direction_assignments: ${(parseInt(vtc[0].total_rows) / parseInt(tda[0].total_rows)).toFixed(2)}x`)
    console.log(`   Row multiplier from clob_fills: ${(parseInt(vtc[0].total_rows) / parseInt(clob[0].total_rows)).toFixed(2)}x`)
    
    // Check if trades_raw is a view
    const tradesRawResult = await client.query({
      query: `
        SELECT engine, create_table_query
        FROM system.tables
        WHERE database = 'default' AND name = 'trades_raw'
      `,
      format: 'JSONEachRow'
    })
    const tradesRawInfo = await tradesRawResult.json<any>()
    
    if (tradesRawInfo.length > 0) {
      console.log('\n4️⃣ TRADES_RAW')
      console.log(`   Engine: ${tradesRawInfo[0].engine}`)
      if (tradesRawInfo[0].engine === 'View') {
        console.log(`   Type: VIEW (no storage, query-time filtering)`)
        // Try to get effective row count
        try {
          const trCountResult = await client.query({
            query: `SELECT count() as total_rows FROM default.trades_raw`,
            format: 'JSONEachRow'
          })
          const trCount = await trCountResult.json<any>()
          console.log(`   Effective rows (when queried): ${parseInt(trCount[0].total_rows).toLocaleString()}`)
          console.log(`   Row reduction from vw_trades_canonical: ${(parseInt(trCount[0].total_rows) / parseInt(vtc[0].total_rows)).toFixed(2)}x`)
        } catch (e) {
          console.log(`   (Cannot query view - might not exist or be broken)`)
        }
      }
    } else {
      console.log('\n4️⃣ TRADES_RAW: Not found')
    }
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

verifyTransformations()
