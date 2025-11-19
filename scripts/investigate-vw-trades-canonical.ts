#!/usr/bin/env npx tsx
/**
 * INVESTIGATE VW_TRADES_CANONICAL
 * This is the source table for trades_raw view - trace its dependencies
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function investigate() {
  const client = getClickHouseClient()

  console.log('\n🔍 Investigating vw_trades_canonical...\n')

  try {
    // 1. Get table definition
    console.log('Step 1: Get vw_trades_canonical definition')
    const typeResult = await client.query({
      query: "SELECT engine, create_table_query FROM system.tables WHERE database = 'default' AND name = 'vw_trades_canonical'",
      format: 'JSONEachRow'
    })
    const typeData = await typeResult.json<any>()

    console.log(`Engine: ${typeData[0].engine}`)
    console.log('\nDefinition (first 1000 chars):')
    console.log(typeData[0].create_table_query.substring(0, 1000) + '...')

    // 2. Check if it references erc1155_transfers
    console.log('\n\nStep 2: Check for erc1155 references')
    const query = typeData[0].create_table_query.toLowerCase()
    if (query.includes('erc1155')) {
      console.log('✅ vw_trades_canonical DOES reference erc1155')
      const matches = query.match(/erc1155[a-z_]*/g)
      console.log('  References:', [...new Set(matches)])
    } else {
      console.log('❌ vw_trades_canonical DOES NOT reference erc1155')
    }

    // 3. Check for clob references
    console.log('\n\nStep 3: Check for CLOB references')
    if (query.includes('clob')) {
      console.log('✅ vw_trades_canonical DOES reference CLOB')
      const matches = query.match(/clob[a-z_]*/g)
      console.log('  References:', [...new Set(matches)])
    } else {
      console.log('❌ vw_trades_canonical DOES NOT reference CLOB')
    }

    // 4. Sample the data
    console.log('\n\nStep 4: Sample vw_trades_canonical')
    const sampleResult = await client.query({
      query: 'SELECT * FROM default.vw_trades_canonical LIMIT 1',
      format: 'JSONEachRow'
    })
    const sampleData = await sampleResult.json<any>()
    console.log('\nSample row fields:', Object.keys(sampleData[0]))
    console.log('\nKey fields:')
    console.log(`  timestamp: ${sampleData[0].timestamp}`)
    console.log(`  wallet_address_norm: ${sampleData[0].wallet_address_norm}`)
    console.log(`  condition_id_norm: ${sampleData[0].condition_id_norm}`)

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
