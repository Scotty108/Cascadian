#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('Step 3: Compute real per-category P&L for wallet #1\n')

  // Top wallet
  const walletAddr = '0xb744f56635b537e859152d14b022af5afe485210'
  console.log(`Top wallet: ${walletAddr}`)

  // Load resolved mappings
  const mappingsPath = resolve(process.cwd(), 'data/condition_market_map_sample.jsonl')
  const lines = fs.readFileSync(mappingsPath, 'utf-8').split('\n').filter(l => l.trim())
  const mappings = lines.map(line => JSON.parse(line))

  // Build map of condition_id -> canonical_category
  const conditionToCategory = new Map()
  for (const m of mappings) {
    if (m.market_id && m.canonical_category) {
      conditionToCategory.set(m.condition_id, m.canonical_category)
    }
  }

  console.log(`Loaded ${conditionToCategory.size} condition->category mappings`)

  // Get wallet's trades for these condition_ids
  const conditionIds = Array.from(conditionToCategory.keys())
  const conditionIdsStr = conditionIds.map(c => "'"+c+"'").join(',')

  console.log(`\nQuerying trades_raw for wallet #1 with resolved condition_ids...`)

  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        COUNT(*) as trade_count,
        SUM(realized_pnl_usd) as total_pnl
      FROM trades_raw
      WHERE wallet_address = '${walletAddr}'
        AND condition_id IN (${conditionIdsStr})
      GROUP BY condition_id
    `,
    format: 'JSONEachRow'
  })

  const rows = await result.json() as any[]
  console.log(`Found ${rows.length} condition_ids with trades`)

  // Aggregate by canonical_category
  const categoryStats = new Map()

  for (const row of rows) {
    const category = conditionToCategory.get(row.condition_id) || 'Unknown'
    const pnl = parseFloat(row.total_pnl)
    const count = parseInt(row.trade_count)

    if (!categoryStats.has(category)) {
      categoryStats.set(category, { pnl: 0, trade_count: 0, condition_ids: new Set() })
    }

    const stats = categoryStats.get(category)!
    stats.pnl += pnl
    stats.trade_count += count
    stats.condition_ids.add(row.condition_id)
  }

  // Convert to array and sort
  const categoryArray = Array.from(categoryStats.entries()).map(([category, stats]: [string, any]) => ({
    canonical_category: category,
    pnl_usd: stats.pnl,
    num_trades: stats.trade_count,
    num_resolved_markets: stats.condition_ids.size
  })).sort((a, b) => b.pnl_usd - a.pnl_usd)

  console.log(`\nPer-category P&L table:`)
  console.log(JSON.stringify(categoryArray, null, 2))

  // Generate blurb
  const walletPnlPath = resolve(process.cwd(), 'data/audited_wallet_pnl_extended.json')
  const allWallets = JSON.parse(fs.readFileSync(walletPnlPath, 'utf-8'))
  const walletData = allWallets.find((w: any) => (w.wallet_address || w.address) === walletAddr)
  const totalPnl = walletData.realized_pnl_usd || walletData.realizedPnlUsd
  const coverage = walletData.coverage_pct || walletData.coveragePct

  let blurb = ''
  if (categoryArray.length > 0) {
    const topCat = categoryArray[0]
    const shortAddr = `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}`
    const pnlK = (totalPnl / 1000).toFixed(1)
    const catPnlK = (topCat.pnl_usd / 1000).toFixed(1)
    const numMarkets = topCat.num_resolved_markets

    blurb = `Wallet ${shortAddr} has $${pnlK}K realized P&L overall, including $${catPnlK}K in ${topCat.canonical_category}, across ${numMarkets} resolved markets. Coverage on this wallet is ${coverage.toFixed(0)}%.`
  } else {
    blurb = 'No resolved trades found in sample.'
  }

  console.log(`\nUpdated blurb:`)
  console.log(blurb)
}

main()
