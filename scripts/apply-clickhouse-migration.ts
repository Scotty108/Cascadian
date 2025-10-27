import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import { readFileSync } from 'fs'

async function applyMigration() {
  console.log('🔧 Applying ClickHouse migration: 002_add_metric_fields.sql\n')

  const migrationSQL = readFileSync(
    resolve(process.cwd(), 'migrations/clickhouse/002_add_metric_fields.sql'),
    'utf-8'
  )

  // Split by semicolons and filter out comments/empty lines
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*') && !s.startsWith('COMMENT'))
    .filter(s => !s.match(/^(SELECT|DESCRIBE|SHOW)/i)) // Skip verification queries for now

  console.log(`📊 Found ${statements.length} SQL statements to execute\n`)

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    const preview = stmt.substring(0, 80).replace(/\s+/g, ' ')

    try {
      console.log(`[${i + 1}/${statements.length}] Executing: ${preview}...`)
      await clickhouse.command({ query: stmt + ';' })
      console.log(`  ✅ Success\n`)
    } catch (error: any) {
      // Ignore "already exists" errors
      if (error.message?.includes('already exists') || error.message?.includes('COLUMN_ALREADY_EXISTS')) {
        console.log(`  ⚠️  Already exists (skipped)\n`)
      } else {
        console.error(`  ❌ Error: ${error.message}\n`)
        // Continue with other statements
      }
    }
  }

  console.log('✅ Migration complete!')
  console.log('\n📊 Verifying schema...\n')

  // Verify new columns exist
  const result = await clickhouse.query({
    query: `DESCRIBE trades_raw`,
    format: 'JSONEachRow',
  })

  const rows = await result.json() as any
  const newColumns = ['close_price', 'fee_usd', 'slippage_usd', 'hours_held', 'bankroll_at_entry', 'outcome', 'pnl_gross', 'pnl_net']

  console.log('New columns in trades_raw:')
  newColumns.forEach(col => {
    const exists = rows.some((r: any) => r.name === col)
    console.log(`  ${exists ? '✅' : '❌'} ${col}`)
  })

  process.exit(0)
}

applyMigration().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
