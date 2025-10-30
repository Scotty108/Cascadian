#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  const result = await clickhouse.query({
    query: `
      SELECT
        countIf(metric_22_resolved_bets >= 10) as has_10_trades,
        countIf(metric_2_omega_net >= 1.0) as positive_omega,
        countIf(metric_22_resolved_bets >= 10 AND metric_2_omega_net >= 1.0) as both,
        countIf(metric_22_resolved_bets < 10) as too_few_trades,
        countIf(metric_2_omega_net < 1.0) as losing_traders,
        COUNT(*) as total
      FROM wallet_metrics_complete
      WHERE window = 'lifetime'
    `,
    format: 'JSONEachRow'
  })

  const data: any = await result.json()

  console.log('\nWallet Metrics Breakdown (lifetime):')
  console.log('=' .repeat(60))
  console.log('Total wallets with metrics:', data[0].total.toLocaleString())
  console.log('')
  console.log('Breakdown:')
  console.log('  ✅ Has >=10 resolved trades:', data[0].has_10_trades.toLocaleString())
  console.log('  ✅ Has omega>=1.0 (profitable):', data[0].positive_omega.toLocaleString())
  console.log('  ✅ Meets BOTH criteria (leaderboard):', data[0].both.toLocaleString())
  console.log('')
  console.log('Excluded:')
  console.log('  ❌ <10 resolved trades:', data[0].too_few_trades.toLocaleString())
  console.log('  ❌ Omega <1.0 (losing):', data[0].losing_traders.toLocaleString())
  console.log('=' .repeat(60))
}

main()
