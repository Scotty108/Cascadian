import { createClient } from '@clickhouse/client'

const client = createClient({
  host: 'http://localhost:8123',
  database: 'default'
})

const result = await client.query({
  query: 'SELECT COUNT(*) as count, COUNT(DISTINCT tx_hash) as unique_txs FROM erc1155_transfers'
})

const data = await result.json()
console.log('Current events:', data.data[0].count)
console.log('Unique txs:', data.data[0].unique_txs)
