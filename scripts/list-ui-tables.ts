import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function listUITables() {
  try {
    // Get all tables
    const result = await clickhouse.query({
      query: 'SHOW TABLES',
      format: 'JSONEachRow'
    })
    const tables = await result.json() as Array<{ name: string }>

    console.log('All tables:')
    tables.forEach(t => console.log('  ', t.name))

    console.log('\nTables with "ui" or "position":')
    const filtered = tables.filter(t =>
      t.name.toLowerCase().includes('ui') ||
      t.name.toLowerCase().includes('position')
    )
    filtered.forEach(t => console.log('  ', t.name))

  } catch (error) {
    console.error('Error:', error)
    throw error
  }
}

listUITables()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
