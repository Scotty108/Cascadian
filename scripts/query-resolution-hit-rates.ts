#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('\n=== Resolution Hit Rates for Top 4 Wallets ===\n')

  // Load top 4 wallets
  const walletPnlPath = resolve(process.cwd(), 'data/audited_wallet_pnl_extended.json')
  const allWallets = JSON.parse(fs.readFileSync(walletPnlPath, 'utf-8'))
  const top4 = allWallets
    .sort((a: any, b: any) => {
      const bPnl = b.realized_pnl_usd || b.realizedPnlUsd || 0
      const aPnl = a.realized_pnl_usd || a.realizedPnlUsd || 0
      return bPnl - aPnl
    })
    .slice(0, 4)
    .map((w: any) => w.wallet_address || w.address)

  console.log('Top 4 wallets:')
  for (let i = 0; i < top4.length; i++) {
    const shortAddr = `${top4[i].slice(0, 6)}...${top4[i].slice(-4)}`
    console.log(`  ${i + 1}. ${shortAddr}`)
  }
  console.log('')

  // Query (a): Overall resolution hit rate for each wallet
  console.log('=== (a) Overall Resolution Hit Rate ===\n')

  const overallResult = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        COUNT(*) as markets_tracked,
        SUM(won) as wins,
        AVG(won) * 100 as hit_rate_pct
      FROM wallet_resolution_outcomes
      WHERE wallet_address IN ('${top4.join("', '")}')
      GROUP BY wallet_address
      ORDER BY hit_rate_pct DESC
    `,
    format: 'JSONEachRow'
  })

  const overallRows = await overallResult.json() as any[]
  for (const row of overallRows) {
    const shortAddr = `${row.wallet_address.slice(0, 6)}...${row.wallet_address.slice(-4)}`
    console.log(`${shortAddr}:`)
    console.log(`  Resolution Hit Rate: ${parseFloat(row.hit_rate_pct).toFixed(1)}%`)
    console.log(`  Markets Tracked: ${row.markets_tracked}`)
    console.log(`  Wins: ${row.wins}`)
    console.log('')
  }

  // Query (b): Per-category resolution hit rate for Politics / Geopolitics
  console.log('=== (b) Resolution Hit Rate for Politics / Geopolitics ===\n')

  const politicsResult = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        COUNT(*) as markets_tracked,
        SUM(won) as wins,
        AVG(won) * 100 as hit_rate_pct
      FROM wallet_resolution_outcomes
      WHERE wallet_address IN ('${top4.join("', '")}')
        AND canonical_category = 'Politics / Geopolitics'
      GROUP BY wallet_address
      ORDER BY hit_rate_pct DESC
    `,
    format: 'JSONEachRow'
  })

  const politicsRows = await politicsResult.json() as any[]

  if (politicsRows.length > 0) {
    for (const row of politicsRows) {
      const shortAddr = `${row.wallet_address.slice(0, 6)}...${row.wallet_address.slice(-4)}`
      console.log(`${shortAddr}:`)
      console.log(`  Politics Hit Rate: ${parseFloat(row.hit_rate_pct).toFixed(1)}%`)
      console.log(`  Politics Markets: ${row.markets_tracked}`)
      console.log(`  Politics Wins: ${row.wins}`)
      console.log('')
    }
  } else {
    console.log('  No Politics / Geopolitics data available for these wallets\n')
  }

  // Query (c): Per-category breakdown for wallet #1
  console.log('=== (c) Per-Category Breakdown for Wallet #1 ===\n')

  const wallet1 = top4[0]
  const categoryResult = await clickhouse.query({
    query: `
      SELECT
        canonical_category,
        COUNT(*) as markets_tracked,
        SUM(won) as wins,
        AVG(won) * 100 as hit_rate_pct
      FROM wallet_resolution_outcomes
      WHERE wallet_address = '${wallet1}'
        AND canonical_category != 'Uncategorized'
      GROUP BY canonical_category
      ORDER BY hit_rate_pct DESC
    `,
    format: 'JSONEachRow'
  })

  const categoryRows = await categoryResult.json() as any[]

  if (categoryRows.length > 0) {
    console.log(`Wallet ${wallet1.slice(0, 6)}...${wallet1.slice(-4)}:\n`)
    for (const row of categoryRows) {
      console.log(`  ${row.canonical_category}:`)
      console.log(`    Hit Rate: ${parseFloat(row.hit_rate_pct).toFixed(1)}%`)
      console.log(`    Markets: ${row.markets_tracked}`)
      console.log(`    Wins: ${row.wins}`)
      console.log('')
    }
  } else {
    console.log('  No categorized data available for wallet #1\n')
  }

  // Generate blurb templates
  console.log('=== (d) Blurb Templates ===\n')

  for (const row of overallRows) {
    const shortAddr = `${row.wallet_address.slice(0, 6)}...${row.wallet_address.slice(-4)}`
    const hitRate = parseFloat(row.hit_rate_pct).toFixed(0)
    const markets = row.markets_tracked

    // Find top category for this wallet
    const categoryResult2 = await clickhouse.query({
      query: `
        SELECT
          canonical_category,
          COUNT(*) as markets_tracked,
          AVG(won) * 100 as hit_rate_pct
        FROM wallet_resolution_outcomes
        WHERE wallet_address = '${row.wallet_address}'
          AND canonical_category != 'Uncategorized'
        GROUP BY canonical_category
        ORDER BY markets_tracked DESC
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })

    const topCategoryRows = await categoryResult2.json() as any[]

    if (topCategoryRows.length > 0) {
      const topCat = topCategoryRows[0]
      const catHitRate = parseFloat(topCat.hit_rate_pct).toFixed(0)
      const catMarkets = topCat.markets_tracked

      console.log(`${shortAddr}:`)
      console.log(`  Generic: "${hitRate}% resolution accuracy across ${markets} markets"`)
      console.log(`  Category-specific: "${catHitRate}% resolution accuracy in ${topCat.canonical_category} across ${catMarkets} markets"`)
      console.log('')
    } else {
      console.log(`${shortAddr}:`)
      console.log(`  Generic: "${hitRate}% resolution accuracy across ${markets} markets"`)
      console.log('  (No category-specific data available)')
      console.log('')
    }
  }
}

main()
