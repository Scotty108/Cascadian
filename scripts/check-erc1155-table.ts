import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function checkERC1155() {
  try {
    console.log('═'.repeat(70))
    console.log('ERC1155_TRANSFERS TABLE ANALYSIS')
    console.log('═'.repeat(70))
    console.log()

    // Check row count
    const count = await clickhouse.query({
      query: 'SELECT COUNT(*) as cnt FROM erc1155_transfers'
    })
    const countData = JSON.parse(await count.text()).data[0]
    console.log('Row count: ' + countData.cnt.toLocaleString())
    console.log()

    // Check schema
    console.log('Schema:')
    const schema = await clickhouse.query({
      query: 'DESCRIBE erc1155_transfers'
    })
    const schemaData = JSON.parse(await schema.text()).data
    schemaData.forEach((col: any) => {
      console.log('  ' + col.name + ': ' + col.type)
    })
    console.log()

    // Sample data
    console.log('Sample rows:')
    const sample = await clickhouse.query({
      query: 'SELECT * FROM erc1155_transfers LIMIT 3'
    })
    const sampleData = JSON.parse(await sample.text()).data
    console.log(JSON.stringify(sampleData, null, 2))
    console.log()

    console.log('═'.repeat(70))

  } catch (e) {
    console.error('Error:', (e as any).message)
  }
}

checkERC1155()
