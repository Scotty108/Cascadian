import { getClickHouseClient } from './lib/clickhouse/client'

async function testConnection() {
  try {
    console.log('Testing ClickHouse connection...')
    const client = getClickHouseClient()
    console.log('✅ Client created successfully')

    const result = await client.query({
      query: 'SELECT version() as version, currentDatabase() as db',
      format: 'JSONEachRow'
    })

    const data = await result.json()
    console.log('✅ Query successful:', data)
  } catch (error) {
    console.error('❌ Connection failed:', error)
  }
}

testConnection()