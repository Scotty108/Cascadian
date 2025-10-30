#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('Clearing existing P&L data...')
  console.log('This will reset all resolved trades so they can be recalculated with the corrected formula.')
  console.log('')

  await clickhouse.command({
    query: `
      ALTER TABLE trades_raw
      UPDATE
        realized_pnl_usd = 0,
        is_resolved = 0
      WHERE is_resolved = 1
    `
  })

  console.log('✅ P&L data cleared. All trades reset to unresolved state.')
  console.log('')
  console.log('Next step: Run enrichment with corrected P&L formula')
  console.log('  npx tsx scripts/full-enrichment-pass.ts')
}

main()
