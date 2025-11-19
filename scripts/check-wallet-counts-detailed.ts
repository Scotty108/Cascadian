#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('Checking wallet counts in detail...\n')

  // Total wallets with metrics
  const total = await clickhouse.query({
    query: `SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_metrics_complete WHERE window = 'lifetime'`,
    format: 'JSONEachRow'
  })
  const totalData: any = await total.json()
  console.log('Total wallets with lifetime metrics:', totalData[0].count)

  // Wallets with >=10 resolved bets
  const has10 = await clickhouse.query({
    query: `SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_metrics_complete WHERE window = 'lifetime' AND metric_22_resolved_bets >= 10`,
    format: 'JSONEachRow'
  })
  const has10Data: any = await has10.json()
  console.log('Wallets with >=10 resolved bets:', has10Data[0].count)

  // Wallets with omega >= 1.0
  const profitable = await clickhouse.query({
    query: `SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_metrics_complete WHERE window = 'lifetime' AND metric_2_omega_net >= 1.0`,
    format: 'JSONEachRow'
  })
  const profitableData: any = await profitable.json()
  console.log('Wallets with omega >= 1.0:', profitableData[0].count)

  // Wallets meeting BOTH criteria (leaderboard)
  const leaderboard = await clickhouse.query({
    query: `SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_metrics_complete WHERE window = 'lifetime' AND metric_22_resolved_bets >= 10 AND metric_2_omega_net >= 1.0`,
    format: 'JSONEachRow'
  })
  const leaderboardData: any = await leaderboard.json()
  console.log('Wallets on leaderboard (omega>=1.0 AND >=10 bets):', leaderboardData[0].count)

  console.log('\nSo when I query "top 50/100/200 wallets by omega with >=10 bets":')
  console.log('  - I am querying from ALL', has10Data[0].count, 'wallets with >=10 bets')
  console.log('  - NOT just the', leaderboardData[0].count, 'profitable ones')
  console.log('  - This includes UNPROFITABLE wallets (omega < 1.0) in the rankings')
  console.log('')
  console.log('The top 50 are likely all profitable (avg omega 4.6)')
  console.log('But top 100-200 includes unprofitable wallets (that\'s why avg P&L goes negative)')
}

main()
