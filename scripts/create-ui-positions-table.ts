/**
 * Create pm_ui_positions_new table
 *
 * Stores Polymarket UI position data from Data API
 * Used for reconciling our PnL calculations with Polymarket UI
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function createTable() {
  console.log('🔧 Creating pm_ui_positions_new table\n')
  console.log('='.repeat(80))

  try {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS pm_ui_positions_new (
        proxy_wallet String,
        condition_id String,
        asset String,
        outcome_index UInt8,
        total_bought Float64,
        total_sold Float64,
        net_shares Float64,
        cash_pnl Float64,
        realized_pnl Float64,
        unrealized_pnl Float64,
        current_value Float64,

        -- Metadata
        inserted_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY (proxy_wallet, condition_id, outcome_index)
      SETTINGS index_granularity = 8192
    `

    await clickhouse.command({ query: createTableSQL })
    console.log('✅ Table created: pm_ui_positions_new')

    // Verify table
    const result = await clickhouse.query({
      query: 'DESCRIBE TABLE pm_ui_positions_new',
      format: 'JSONEachRow'
    })
    const schema = await result.json() as Array<{ name: string; type: string }>

    console.log('\nTable schema:')
    console.log('Column                  | Type')
    console.log('-'.repeat(50))
    schema.forEach(col => {
      const name = col.name.padEnd(23)
      console.log(`${name} | ${col.type}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('\n✅ TABLE READY\n')
    console.log('Next steps:')
    console.log('  1. Run backfill for test wallet:')
    console.log('     npx tsx scripts/backfill-ui-positions-v2.ts --wallet=0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
    console.log()
    console.log('  2. Then run reconciliation:')
    console.log('     npx tsx scripts/reconcile-ui-vs-v2.ts')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

createTable()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
