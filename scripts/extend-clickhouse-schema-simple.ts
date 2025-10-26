import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function extendSchema() {
  console.log('🔧 Extending ClickHouse schema for Phase 1 metrics\n')

  const columns = [
    { name: 'close_price', type: 'DECIMAL(10, 6)', default: '0.0', comment: 'YES price at pre-resolution close' },
    { name: 'fee_usd', type: 'DECIMAL(18, 6)', default: '0.0', comment: 'Total fees paid on this trade' },
    { name: 'slippage_usd', type: 'DECIMAL(18, 6)', default: '0.0', comment: 'Slippage cost' },
    { name: 'hours_held', type: 'DECIMAL(10, 2)', default: '0.0', comment: 'Hours from entry to exit' },
    { name: 'bankroll_at_entry', type: 'DECIMAL(18, 2)', default: '0.0', comment: 'Account equity at entry' },
    { name: 'outcome', type: 'Nullable(UInt8)', default: 'NULL', comment: '1=YES won, 0=NO won' },
    { name: 'fair_price_at_entry', type: 'DECIMAL(10, 6)', default: '0.0', comment: 'Market mid price at entry' },
    { name: 'pnl_gross', type: 'DECIMAL(18, 6)', default: '0.0', comment: 'P&L before fees' },
    { name: 'pnl_net', type: 'DECIMAL(18, 6)', default: '0.0', comment: 'P&L after all costs' },
    { name: 'return_pct', type: 'DECIMAL(10, 6)', default: '0.0', comment: 'Return as % of capital' },
  ]

  console.log(`📊 Adding ${columns.length} new columns to trades_raw table...\n`)

  for (const col of columns) {
    try {
      const query = `ALTER TABLE trades_raw ADD COLUMN IF NOT EXISTS ${col.name} ${col.type} DEFAULT ${col.default}`
      console.log(`  Adding: ${col.name} (${col.type})`)
      await clickhouse.command({ query })
      console.log(`    ✅ Success`)
    } catch (error: any) {
      if (error.message?.includes('already exists') || error.message?.includes('COLUMN_ALREADY_EXISTS')) {
        console.log(`    ⚠️  Already exists (skipped)`)
      } else {
        console.error(`    ❌ Error: ${error.message}`)
      }
    }
  }

  console.log('\n✅ Schema extension complete!')
  console.log('\n📊 Verifying columns...\n')

  // Verify columns exist
  const result = await clickhouse.query({
    query: `DESCRIBE trades_raw`,
    format: 'JSONEachRow',
  })

  const rows = await result.json<any>()

  console.log('Verification:')
  for (const col of columns) {
    const exists = rows.some((r: any) => r.name === col.name)
    console.log(`  ${exists ? '✅' : '❌'} ${col.name}`)
  }

  console.log('\n🎯 Next steps:')
  console.log('  1. Populate these fields from trade data')
  console.log('  2. Calculate outcome (1/0) from market resolutions')
  console.log('  3. Calculate pnl_gross and pnl_net from trade data')
  console.log('  4. Start calculating Phase 1 metrics!')

  process.exit(0)
}

extendSchema().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
