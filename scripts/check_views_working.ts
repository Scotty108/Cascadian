#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
})

async function main() {
  const niggemon = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  
  const tables = [
    'wallet_pnl_summary_final',
    'wallet_realized_pnl_final', 
    'realized_pnl_by_market_final',
    'wallet_unrealized_pnl_v2',
    'outcome_positions_v2',
    'trade_cashflows_v3',
    'winning_index'
  ]
  
  console.log('='.repeat(80))
  console.log('CHECKING TABLES FROM RECONCILIATION_FINAL_REPORT.md')
  console.log('='.repeat(80))
  console.log('')
  
  for (const table of tables) {
    try {
      const query = `SELECT * FROM ${table} WHERE wallet = '${niggemon}' LIMIT 1 FORMAT JSONEachRow`
      const result = await clickhouse.query({ query, format: 'JSONEachRow' })
      const data = await result.json() as any[]
      
      if (data.length > 0) {
        console.log(`✅ ${table} EXISTS WITH DATA`)
        console.log(`   Columns: ${Object.keys(data[0]).join(', ')}`)
        console.log(`   Sample row:`)
        Object.entries(data[0]).forEach(([key, val]) => {
          console.log(`      ${key}: ${val}`)
        })
      } else {
        console.log(`⚠️  ${table} EXISTS BUT NO DATA FOR niggemon`)
      }
    } catch (err: any) {
      console.log(`❌ ${table} DOES NOT EXIST`)
      console.log(`   Error: ${err.message.split('\n')[0]}`)
    }
    console.log('')
  }
  
  // Now check if the report's query actually works
  console.log('='.repeat(80))
  console.log('TESTING QUERY FROM RECONCILIATION_FINAL_REPORT (line 56-64)')
  console.log('='.repeat(80))
  console.log('')
  
  try {
    const reportQuery = `
      SELECT
        coalesce(r.wallet, u.wallet) as wallet,
        coalesce(r.realized_pnl_usd, 0) as realized_pnl,
        coalesce(u.unrealized_pnl_usd, 0) as unrealized_pnl,
        coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0) as total_pnl
      FROM wallet_realized_pnl_final r
      FULL OUTER JOIN wallet_unrealized_pnl_v2 u USING (wallet)
      WHERE wallet = '${niggemon}'
      FORMAT JSONEachRow
    `
    
    const result = await clickhouse.query({ query: reportQuery, format: 'JSONEachRow' })
    const data = await result.json() as any[]
    
    if (data.length > 0) {
      console.log('✅ QUERY WORKS! Results:')
      console.log(JSON.stringify(data[0], null, 2))
      console.log('')
      console.log(`Realized: $${parseFloat(data[0].realized_pnl).toFixed(2)}`)
      console.log(`Unrealized: $${parseFloat(data[0].unrealized_pnl).toFixed(2)}`)
      console.log(`Total: $${parseFloat(data[0].total_pnl).toFixed(2)}`)
      console.log('')
      console.log(`Expected: $102,001.46`)
      console.log(`Variance: ${((parseFloat(data[0].total_pnl) - 102001.46) / 102001.46 * 100).toFixed(2)}%`)
    } else {
      console.log('⚠️  Query works but returned no data')
    }
  } catch (err: any) {
    console.log('❌ QUERY FAILED')
    console.log(`Error: ${err.message}`)
  }
}

main().catch(console.error)
