#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function findConsumers() {
  const client = getClickHouseClient()
  console.log('\n🔍 Finding tables that reference erc1155_transfers...\n')

  try {
    const result = await client.query({
      query: `
        SELECT name, engine, create_table_query
        FROM system.tables
        WHERE database = 'default'
          AND (
            create_table_query LIKE '%erc1155_transfers%'
            OR create_table_query LIKE '%erc1155%'
          )
        ORDER BY name
      `,
      format: 'JSONEachRow'
    })
    const tables = await result.json<any>()

    if (tables.length === 0) {
      console.log('❌ NO tables found that reference erc1155_transfers')
    } else {
      console.log(`✅ Found ${tables.length} tables that reference erc1155:\n`)
      for (const table of tables) {
        console.log(`Table: ${table.name}`)
        console.log(`Engine: ${table.engine}`)
        const query = table.create_table_query.toLowerCase()
        if (query.includes('erc1155_transfers')) {
          console.log('  ✅ References erc1155_transfers')
        } else if (query.includes('erc1155')) {
          console.log('  ⚠️  References erc1155 (but not erc1155_transfers)')
        }
        console.log('')
      }
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

findConsumers().catch(console.error)
