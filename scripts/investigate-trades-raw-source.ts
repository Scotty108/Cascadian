#!/usr/bin/env npx tsx
/**
 * INVESTIGATE TRADES_RAW SOURCE
 * Determine if trades_raw is a table or view and trace its data source
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function investigate() {
  const client = getClickHouseClient()

  console.log('\n🔍 Investigating trades_raw data source...\n')

  try {
    // 1. Check if trades_raw is a table or view
    console.log('Step 1: Check table type')
    const typeResult = await client.query({
      query: "SELECT engine, create_table_query FROM system.tables WHERE database = 'default' AND name = 'trades_raw'",
      format: 'JSONEachRow'
    })
    const typeData = await typeResult.json<any>()

    if (!typeData[0]) {
      console.log('❌ trades_raw NOT FOUND in default database')
      return
    }

    console.log(`Engine: ${typeData[0].engine}`)
    console.log('')

    if (typeData[0].engine.includes('View')) {
      console.log('✅ trades_raw is a VIEW')
      console.log('\nView definition:')
      console.log(typeData[0].create_table_query)
    } else {
      console.log('✅ trades_raw is a TABLE')
      console.log('\nTable definition (first 500 chars):')
      console.log(typeData[0].create_table_query.substring(0, 500) + '...')
    }

    // 2. Check for source tables that might feed trades_raw
    console.log('\n\nStep 2: Check for source tables')
    const sourceTablesResult = await client.query({
      query: `
        SELECT name, engine, total_rows
        FROM system.tables
        WHERE database = 'default'
          AND (name LIKE '%clob%' OR name LIKE '%fill%' OR name LIKE '%trade%' OR name LIKE '%erc1155%')
        ORDER BY total_rows DESC
      `,
      format: 'JSONEachRow'
    })
    const sourceTables = await sourceTablesResult.json<any>()

    console.log('\nRelated tables in database:')
    for (const table of sourceTables.slice(0, 15)) {
      console.log(`  ${table.name.padEnd(40)} ${table.engine.padEnd(30)} ${Number(table.total_rows).toLocaleString()} rows`)
    }

    // 3. Sample trades_raw to see data structure
    console.log('\n\nStep 3: Sample trades_raw data')
    const sampleResult = await client.query({
      query: 'SELECT * FROM default.trades_raw LIMIT 2',
      format: 'JSONEachRow'
    })
    const sampleData = await sampleResult.json<any>()
    console.log('\nSample row 1:')
    console.log(JSON.stringify(sampleData[0], null, 2))

    // 4. Check if erc1155_transfers is referenced
    console.log('\n\nStep 4: Check if trades_raw uses erc1155_transfers')
    const query = typeData[0].create_table_query.toLowerCase()
    if (query.includes('erc1155')) {
      console.log('✅ trades_raw definition DOES reference erc1155')
      const matches = query.match(/erc1155[a-z_]*/g)
      console.log('  References:', [...new Set(matches)])
    } else {
      console.log('❌ trades_raw definition DOES NOT reference erc1155')
    }

  } catch (error: any) {
    console.error('\n❌ Investigation failed:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

investigate().catch(error => {
  console.error('\n❌ Fatal error:', error.message)
  process.exit(1)
})
