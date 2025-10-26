import { config } from 'dotenv'
import { resolve } from 'path'
import fs from 'fs'

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse, getClickHouseInfo } from '@/lib/clickhouse/client'

async function setupSchema() {
  console.log('🔧 Setting up ClickHouse schema...\n')

  try {
    // Read migration file
    const schemaSQL = fs.readFileSync(
      resolve(process.cwd(), 'migrations/clickhouse/001_create_trades_table.sql'),
      'utf-8'
    )

    // Remove comments and split into individual statements
    const cleanSQL = schemaSQL
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')

    const statements = cleanSQL
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    console.log(`Found ${statements.length} SQL statements to execute\n`)

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      const preview = statement.substring(0, 100).replace(/\n/g, ' ')

      console.log(`[${i + 1}/${statements.length}] Executing: ${preview}...`)

      await clickhouse.command({
        query: statement,
      })

      console.log('  ✅ Success')
    }

    console.log('\n✅ Schema setup complete!')

    // Verify tables were created
    console.log('\n📊 Verifying database structure...')
    const info = await getClickHouseInfo()

    if (info.success && info.tables) {
      console.log(`\nCreated ${info.tables.length} tables:`)
      info.tables.forEach((table: any) => {
        console.log(`  - ${table.name} (${table.engine})`)
      })
    }
  } catch (error) {
    console.error('\n❌ Schema setup failed:', error)
    process.exit(1)
  }
}

setupSchema()
