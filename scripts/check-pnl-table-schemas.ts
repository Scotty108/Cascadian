#!/usr/bin/env tsx
/**
 * Check actual schemas of P&L tables
 */

import { getClickHouseClient } from '../lib/clickhouse/client'

async function checkSchemas() {
  const client = getClickHouseClient()

  const tables = [
    'wallet_pnl_summary_v2',
    'realized_pnl_by_market_v2',
    'trade_cashflows_v3'
  ]

  for (const table of tables) {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`TABLE: ${table}`)
    console.log('='.repeat(80))

    try {
      const result = await client.query({
        query: `SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = '${table}' ORDER BY position`,
        format: 'JSONEachRow'
      })
      const columns = await result.json<any>()

      console.log('\nColumns:')
      columns.forEach((col: any) => {
        console.log(`  ${col.name.padEnd(30)} ${col.type}`)
      })
    } catch (error: any) {
      console.log(`Error: ${error.message}`)
    }
  }
}

checkSchemas().catch(console.error)
