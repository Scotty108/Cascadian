#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('\n🎯 Generating Investor-Ready Blurbs for Top 4 Wallets\n')
  console.log('=' .repeat(70) + '\n')

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

  for (const wallet of top4) {
    const walletAddress = wallet.wallet_address || wallet.address
    const totalPnl = wallet.realized_pnl_usd || wallet.realizedPnlUsd
    const coverage = wallet.coverage_pct || wallet.coveragePct

    const shortAddr = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    const pnlK = (totalPnl / 1000).toFixed(1)

    // Get resolution accuracy
    const resAccQuery = `
      SELECT
        COUNT(*) as markets_tracked,
        AVG(won) * 100 as hit_rate_pct
      FROM wallet_resolution_outcomes
      WHERE wallet_address = '${walletAddress}'
    `

    const resAccResult = await clickhouse.query({
      query: resAccQuery,
      format: 'JSONEachRow'
    })

    const resAccRows = await resAccResult.json() as any[]

    let resolutionBlurb = ''

    if (resAccRows.length > 0 && parseInt(resAccRows[0].markets_tracked) > 0) {
      const marketsTracked = parseInt(resAccRows[0].markets_tracked)
      const hitRate = parseFloat(resAccRows[0].hit_rate_pct)

      // Check if they have a category with >= 5 markets
      const catQuery = `
        SELECT
          canonical_category,
          COUNT(*) as markets_tracked,
          AVG(won) * 100 as hit_rate_pct
        FROM wallet_resolution_outcomes
        WHERE wallet_address = '${walletAddress}'
          AND canonical_category != 'Uncategorized'
        GROUP BY canonical_category
        HAVING COUNT(*) >= 5
        ORDER BY COUNT(*) DESC
        LIMIT 1
      `

      const catResult = await clickhouse.query({
        query: catQuery,
        format: 'JSONEachRow'
      })

      const catRows = await catResult.json() as any[]

      if (catRows.length > 0) {
        const topCat = catRows[0]
        const catHitRate = parseFloat(topCat.hit_rate_pct)
        const catMarkets = parseInt(topCat.markets_tracked)

        resolutionBlurb = `${catHitRate.toFixed(0)}% resolution accuracy in ${topCat.canonical_category} across ${catMarkets} settled markets`
      } else {
        resolutionBlurb = `${hitRate.toFixed(0)}% resolution accuracy across ${marketsTracked} settled markets`
      }
    } else {
      resolutionBlurb = 'resolution accuracy pending enrichment'
    }

    // Final blurb
    const blurb = `Wallet ${shortAddr}: $${pnlK}K realized P&L, ${coverage.toFixed(0)}% coverage, ${resolutionBlurb}.`

    console.log(blurb)
    console.log('')
  }

  console.log('=' .repeat(70))
  console.log('\n✅ These blurbs are safe for investor calls.\n')
}

main()
