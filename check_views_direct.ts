#!/usr/bin/env tsx
import { clickhouse } from './lib/clickhouse/client'

async function main() {
  const niggemon = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  
  const tables = [
    'wallet_pnl_summary_final',
    'wallet_realized_pnl_final', 
    'realized_pnl_by_market_final',
    'wallet_unrealized_pnl_v2'
  ]
  
  console.log('Checking views from RECONCILIATION_FINAL_REPORT...\n')
  
  for (const table of tables) {
    try {
      const query = `SELECT * FROM ${table} WHERE wallet = '${niggemon}' LIMIT 1 FORMAT JSONEachRow`
      const result = await clickhouse.query({ query, format: 'JSONEachRow' })
      const data = await result.json() as any[]
      
      if (data.length > 0) {
        console.log(`✅ ${table} EXISTS with data`)
        console.log(`   Columns: ${Object.keys(data[0]).join(', ')}`)
        console.log(`   Sample: ${JSON.stringify(data[0], null, 2)}\n`)
      } else {
        console.log(`⚠️  ${table} exists but NO DATA\n`)
      }
    } catch (err: any) {
      console.log(`❌ ${table}: ${err.message}\n`)
    }
  }
}

main().catch(console.error)
