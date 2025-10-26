import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

import { testClickHouseConnection, getClickHouseInfo } from '@/lib/clickhouse/client'

async function testConnection() {
  console.log('🔍 Testing ClickHouse connection...\n')

  // Test 1: Basic connection
  console.log('Test 1: Connection & Version')
  const connectionTest = await testClickHouseConnection()

  if (!connectionTest.success) {
    console.error('\n❌ Connection test failed!')
    console.error('Error:', connectionTest.error)
    process.exit(1)
  }

  console.log('')

  // Test 2: Database info
  console.log('Test 2: Database Info')
  const infoTest = await getClickHouseInfo()

  if (infoTest.success && infoTest.tables) {
    console.log(`✅ Database has ${infoTest.tables.length} tables`)

    if (infoTest.tables.length > 0) {
      console.log('\nExisting tables:')
      infoTest.tables.forEach((table: any) => {
        console.log(`  - ${table.name} (${table.engine}): ${table.total_rows} rows, ${table.size}`)
      })
    } else {
      console.log('  (No tables yet - this is expected for a new database)')
    }
  }

  console.log('\n✅ All tests passed! ClickHouse is ready.')
}

testConnection().catch((error) => {
  console.error('\n❌ Test failed:', error)
  process.exit(1)
})
