#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'
import { fetchWalletPnL } from '../lib/goldsky/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  const walletAddress = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'
  const groundTruthPnl = 2650.64

  // Step A: Pull fills with real resolution map
  const query = `
    SELECT
      t.wallet_address,
      t.condition_id,
      t.side,
      t.entry_price,
      t.shares,
      m.resolved_outcome
    FROM trades_raw t
    INNER JOIN market_resolution_map m
      ON t.condition_id = m.condition_id
    WHERE t.wallet_address = '${walletAddress}'
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const trades: any[] = await result.json()

  // Step B: Compute P&L in memory using first principles
  let totalExpectedPnlUsd = 0
  let totalTradesCount = 0

  for (const row of trades) {
    const won = row.side === row.resolved_outcome ? 1 : 0
    const payoutPerShare = won ? 1 : 0
    const tradePnlUsd = parseFloat(row.shares) * (payoutPerShare - parseFloat(row.entry_price))

    totalExpectedPnlUsd += tradePnlUsd
    totalTradesCount += 1
  }

  // Step C: Pull Goldsky and normalize
  const goldskyData = await fetchWalletPnL(walletAddress)
  const correctedGoldskyPnlUsd = goldskyData
    ? goldskyData.totalRealizedPnl / 13.2399 / 1e6
    : 0

  const percentDiffVsGoldsky =
    Math.abs(totalExpectedPnlUsd - correctedGoldskyPnlUsd) /
    Math.max(1, Math.abs(correctedGoldskyPnlUsd))

  const percentDiffVsPublicProfile =
    Math.abs(totalExpectedPnlUsd - groundTruthPnl) / Math.max(1, groundTruthPnl)

  // Output
  console.log(`wallet_address: ${walletAddress}`)
  console.log(`clickhouse_recomputed_total_pnl_usd: ${totalExpectedPnlUsd.toFixed(2)}`)
  console.log(`clickhouse_trades_used: ${totalTradesCount}`)
  console.log(`goldsky_total_pnl_usd_corrected: ${correctedGoldskyPnlUsd.toFixed(2)}`)
  console.log(`percent_diff_vs_goldsky: ${(percentDiffVsGoldsky * 100).toFixed(2)}%`)
  console.log(`ground_truth_portfolio_pnl_usd: ${groundTruthPnl.toFixed(2)}`)
  console.log(
    `percent_diff_vs_public_profile: ${(percentDiffVsPublicProfile * 100).toFixed(2)}%`
  )

  await clickhouse.close()
}

main()
