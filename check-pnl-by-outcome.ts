#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('Checking P&L by side and outcome...\n')

  const result = await clickhouse.query({
    query: `
      SELECT
        side,
        outcome,
        COUNT(*) as count,
        AVG(pnl_net) as avg_pnl,
        SUM(CASE WHEN pnl_net > 0 THEN 1 ELSE 0 END) as positive_count,
        SUM(CASE WHEN pnl_net < 0 THEN 1 ELSE 0 END) as negative_count
      FROM trades_raw
      WHERE is_resolved = 1
      GROUP BY side, outcome
      ORDER BY side, outcome
    `,
    format: 'JSONEachRow'
  })

  const data: any = await result.json()

  console.log('P&L by Side and Outcome:')
  console.log('=' .repeat(80))
  console.log('')

  for (const row of data) {
    const wonOrLost = (row.side === 'YES' && row.outcome === 1) || (row.side === 'NO' && row.outcome === 0) ? 'WON' : 'LOST'

    console.log(`${row.side} side, outcome=${row.outcome} (${row.side} ${wonOrLost}):`)
    console.log(`  Count: ${row.count.toLocaleString()}`)
    console.log(`  Avg P&L: $${parseFloat(row.avg_pnl).toFixed(2)}`)
    console.log(`  Positive: ${row.positive_count.toLocaleString()}, Negative: ${row.negative_count.toLocaleString()}`)

    // Check if this makes sense
    if (wonOrLost === 'WON' && parseFloat(row.avg_pnl) < 0) {
      console.log(`  ⚠️  BUG: Winners should have POSITIVE avg P&L!`)
    } else if (wonOrLost === 'LOST' && parseFloat(row.avg_pnl) > 0) {
      console.log(`  ⚠️  BUG: Losers should have NEGATIVE avg P&L!`)
    } else {
      console.log(`  ✅ This looks correct`)
    }
    console.log('')
  }
}

main()
