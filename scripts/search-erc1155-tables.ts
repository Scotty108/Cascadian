import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function searchERC1155() {
  try {
    console.log('═'.repeat(70))
    console.log('SEARCHING FOR ERC1155 AND TRANSFER TABLES')
    console.log('═'.repeat(70))
    console.log()

    // Search for ERC1155 tables
    console.log('ERC1155-related tables:')
    const result1 = await clickhouse.query({
      query: `
SELECT table_name, total_bytes
FROM system.tables
WHERE database = 'default' AND table_name LIKE '%1155%'
ORDER BY table_name
      `
    })

    const tables1 = JSON.parse(await result1.text()).data
    if (tables1.length === 0) {
      console.log('  None found')
    } else {
      tables1.forEach((t: any) => {
        const sizeGB = (t.total_bytes / 1024 / 1024 / 1024).toFixed(2)
        console.log(`  ✓ ${t.table_name} (${sizeGB} GB)`)
      })
    }
    console.log()

    // Search for token/transfer related tables
    console.log('Token/Transfer/Condition related tables:')
    const result2 = await clickhouse.query({
      query: `
SELECT table_name, total_bytes
FROM system.tables
WHERE database = 'default' AND (table_name LIKE '%transfer%' OR table_name LIKE '%token%' OR table_name LIKE '%condition%')
ORDER BY table_name
      `
    })

    const tables2 = JSON.parse(await result2.text()).data
    if (tables2.length === 0) {
      console.log('  None found')
    } else {
      tables2.forEach((t: any) => {
        const sizeGB = (t.total_bytes / 1024 / 1024 / 1024).toFixed(2)
        console.log(`  ✓ ${t.table_name} (${sizeGB} GB)`)
      })
    }
    console.log()

    // Search for all tables (for context)
    console.log('All tables in database:')
    const result3 = await clickhouse.query({
      query: `
SELECT table_name, total_bytes
FROM system.tables
WHERE database = 'default'
ORDER BY total_bytes DESC
LIMIT 20
      `
    })

    const tables3 = JSON.parse(await result3.text()).data
    tables3.forEach((t: any) => {
      const sizeGB = (t.total_bytes / 1024 / 1024 / 1024).toFixed(2)
      console.log(`  ${t.table_name} (${sizeGB} GB)`)
    })

    console.log()
    console.log('═'.repeat(70))

  } catch (e) {
    console.error('Error:', (e as any).message)
  }
}

searchERC1155()
