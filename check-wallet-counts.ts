#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function checkCounts() {
  // Total wallets with ANY trades
  const totalWallets = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw',
    format: 'JSONEachRow'
  })
  const totalData = await totalWallets.json()
  console.log('Total wallets with trades:', totalData[0].count)

  // Wallets with enriched trades (market_id set)
  const enrichedWallets = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw WHERE market_id != \'\'',
    format: 'JSONEachRow'
  })
  const enrichedData = await enrichedWallets.json()
  console.log('Wallets with enriched trades:', enrichedData[0].count)

  // Wallets in metrics table (lifetime)
  const metricsWallets = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_metrics_complete WHERE window = \'lifetime\'',
    format: 'JSONEachRow'
  })
  const metricsData = await metricsWallets.json()
  console.log('Wallets with lifetime metrics:', metricsData[0].count)

  // Wallets with omega >= 1.0 and min 10 trades (what leaderboard shows)
  const qualifiedWallets = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_metrics_complete WHERE window = \'lifetime\' AND metric_2_omega_net >= 1.0 AND metric_22_resolved_bets >= 10',
    format: 'JSONEachRow'
  })
  const qualifiedData = await qualifiedWallets.json()
  console.log('Wallets qualifying for leaderboard (omega>=1.0, trades>=10):', qualifiedData[0].count)
}

checkCounts()
