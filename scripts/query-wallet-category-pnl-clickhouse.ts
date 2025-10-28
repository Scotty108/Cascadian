#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('\n=== Per-category P&L for wallet #1 (via ClickHouse JOIN) ===\n')

  // Load top wallet
  const walletPnlPath = resolve(process.cwd(), 'data/audited_wallet_pnl_extended.json')
  const allWallets = JSON.parse(fs.readFileSync(walletPnlPath, 'utf-8'))
  const topWallet = allWallets.sort((a: any, b: any) => {
    const bPnl = b.realized_pnl_usd || b.realizedPnlUsd || 0
    const aPnl = a.realized_pnl_usd || a.realizedPnlUsd || 0
    return bPnl - aPnl
  })[0]

  const walletAddress = topWallet.wallet_address || topWallet.address
  const totalPnl = topWallet.realized_pnl_usd || topWallet.realizedPnlUsd
  const coverage = topWallet.coverage_pct || topWallet.coveragePct

  console.log(`Wallet: ${walletAddress}`)
  console.log(`Overall realized P&L: $${totalPnl.toLocaleString()}`)
  console.log(`Coverage: ${coverage.toFixed(1)}%\n`)

  // Query ClickHouse with full JOIN
  const result = await clickhouse.query({
    query: `
      SELECT
        e.canonical_category,
        SUM(t.realized_pnl_usd) as pnl_usd,
        COUNT(*) as num_trades,
        COUNT(DISTINCT t.condition_id) as num_resolved_markets
      FROM trades_raw t
      LEFT JOIN condition_market_map c ON t.condition_id = c.condition_id
      LEFT JOIN events_dim e ON c.event_id = e.event_id
      WHERE t.wallet_address = '${walletAddress}'
        AND t.is_resolved = 1
        AND t.realized_pnl_usd != 0
      GROUP BY e.canonical_category
      ORDER BY pnl_usd DESC
    `,
    format: 'JSONEachRow'
  })

  const rows = await result.json() as any[]

  console.log('Per-category breakdown (from ClickHouse):')
  console.log(JSON.stringify(rows, null, 2))

  // Generate blurb - find first row with non-empty canonical_category
  const validRow = rows.find(r => r['e.canonical_category'] && r['e.canonical_category'].trim() !== '')

  if (validRow) {
    const topCat = validRow
    const shortAddr = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    const pnlK = (totalPnl / 1000).toFixed(1)
    const catPnlK = (parseFloat(topCat.pnl_usd) / 1000).toFixed(1)
    const numMarkets = parseInt(topCat.num_resolved_markets)

    const blurb = `Wallet ${shortAddr} has $${pnlK}K realized P&L overall, including $${catPnlK}K in ${topCat['e.canonical_category']}, across ${numMarkets} resolved markets. Coverage on this wallet is ${coverage.toFixed(0)}%.`

    console.log('\nGenerated blurb:')
    console.log(blurb)
  } else {
    console.log('\n⚠️  No category data available (canonical_category is NULL for all rows)')
  }
}

main()
