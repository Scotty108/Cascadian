import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function checkTables() {
  console.log('🔍 Checking ClickHouse tables and data...\n')

  try {
    // List all tables
    console.log('📋 Tables in database:')
    const tablesResult = await clickhouse.query({
      query: 'SHOW TABLES',
      format: 'JSONEachRow',
    })
    const tables = await tablesResult.json<{ name: string }>()

    if (tables.length === 0) {
      console.log('   ❌ No tables found!')
      console.log('   Run: npx tsx scripts/setup-clickhouse-schema.ts')
      return
    }

    tables.forEach((t) => {
      console.log(`   - ${t.name}`)
    })

    // Check trades_raw
    console.log('\n\n📊 trades_raw table:')
    const countResult = await clickhouse.query({
      query: 'SELECT count() as total FROM trades_raw',
      format: 'JSONEachRow',
    })
    const count = await countResult.json<{ total: string }>()
    console.log(`   Total rows: ${count[0].total}`)

    if (parseInt(count[0].total) > 0) {
      // Show table schema
      console.log('\n   Table structure:')
      const schemaResult = await clickhouse.query({
        query: 'DESCRIBE TABLE trades_raw',
        format: 'JSONEachRow',
      })
      const schema = await schemaResult.json<{ name: string; type: string }>()
      schema.forEach((col) => {
        console.log(`   - ${col.name}: ${col.type}`)
      })

      // Show sample data with raw query
      console.log('\n   Sample rows (raw):')
      const sampleResult = await clickhouse.query({
        query: 'SELECT * FROM trades_raw LIMIT 3',
        format: 'JSONEachRow',
      })
      const samples = await sampleResult.json<any>()
      samples.forEach((row: any, i: number) => {
        console.log(`\n   Row ${i + 1}:`)
        console.log(`   ${JSON.stringify(row, null, 2)}`)
      })
    }

    // Check materialized view
    console.log('\n\n📊 wallet_metrics_daily (materialized view):')
    const metricsCountResult = await clickhouse.query({
      query: 'SELECT count() as total FROM wallet_metrics_daily',
      format: 'JSONEachRow',
    })
    const metricsCount = await metricsCountResult.json<{ total: string }>()
    console.log(`   Total rows: ${metricsCount[0].total}`)

    console.log('\n\n✅ ClickHouse data check complete!')
    console.log('\n📌 To view data in ClickHouse web interface:')
    console.log(`   1. Go to: ${process.env.CLICKHOUSE_HOST?.replace(':8443', '')}`)
    console.log(`   2. Login with:`)
    console.log(`      Username: ${process.env.CLICKHOUSE_USER}`)
    console.log(`      Password: ${process.env.CLICKHOUSE_PASSWORD}`)
    console.log(`   3. Select database: ${process.env.CLICKHOUSE_DATABASE}`)
    console.log(`   4. Run query: SELECT * FROM trades_raw LIMIT 100`)
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

checkTables()
