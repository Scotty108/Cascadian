#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('═'.repeat(80))
  console.log('                    TOP WALLETS ANALYSIS')
  console.log('═'.repeat(80))
  console.log('')

  // Overall lifetime metrics for top N wallets
  const tiers = [50, 100, 200]

  for (const tier of tiers) {
    console.log(`\n📊 TOP ${tier} WALLETS (by Omega Ratio, lifetime):`)
    console.log('─'.repeat(80))

    const result = await clickhouse.query({
      query: `
        SELECT
          AVG(metric_2_omega_net) as avg_omega,
          AVG(metric_9_net_pnl_usd) as avg_pnl,
          MIN(metric_2_omega_net) as min_omega,
          MAX(metric_2_omega_net) as max_omega,
          MIN(metric_9_net_pnl_usd) as min_pnl,
          MAX(metric_9_net_pnl_usd) as max_pnl,
          COUNT(*) as count
        FROM (
          SELECT
            wallet_address,
            metric_2_omega_net,
            metric_9_net_pnl_usd
          FROM wallet_metrics_complete
          WHERE window = 'lifetime'
            AND metric_22_resolved_bets >= 10
          ORDER BY metric_2_omega_net DESC
          LIMIT ${tier}
        )
      `,
      format: 'JSONEachRow'
    })

    const data: any = await result.json()
    const stats = data[0]

    console.log(`  Count: ${stats.count}`)
    console.log(`  Average Omega: ${parseFloat(stats.avg_omega).toFixed(4)}`)
    console.log(`  Average P&L: $${parseFloat(stats.avg_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    console.log(`  Omega Range: ${parseFloat(stats.min_omega).toFixed(4)} - ${parseFloat(stats.max_omega).toFixed(4)}`)
    console.log(`  P&L Range: $${parseFloat(stats.min_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - $${parseFloat(stats.max_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  }

  console.log('\n\n')
  console.log('═'.repeat(80))
  console.log('                    TOP WALLETS BY CATEGORY')
  console.log('═'.repeat(80))

  // Get list of categories
  const categoriesResult = await clickhouse.query({
    query: `
      SELECT DISTINCT category
      FROM wallet_metrics_by_category
      WHERE window = 'lifetime'
        AND category != ''
      ORDER BY category
    `,
    format: 'JSONEachRow'
  })

  const categories: any = await categoriesResult.json()

  for (const catRow of categories) {
    const category = catRow.category

    console.log(`\n\n📂 CATEGORY: ${category}`)
    console.log('═'.repeat(80))

    for (const tier of tiers) {
      console.log(`\n  Top ${tier} wallets in ${category}:`)
      console.log('  ' + '─'.repeat(76))

      const result = await clickhouse.query({
        query: `
          SELECT
            AVG(metric_2_omega_net) as avg_omega,
            AVG(metric_9_net_pnl_usd) as avg_pnl,
            MIN(metric_2_omega_net) as min_omega,
            MAX(metric_2_omega_net) as max_omega,
            MIN(metric_9_net_pnl_usd) as min_pnl,
            MAX(metric_9_net_pnl_usd) as max_pnl,
            COUNT(*) as count
          FROM (
            SELECT
              wallet_address,
              metric_2_omega_net,
              metric_9_net_pnl_usd
            FROM wallet_metrics_by_category
            WHERE window = 'lifetime'
              AND category = '${category}'
              AND metric_22_resolved_bets >= 10
            ORDER BY metric_2_omega_net DESC
            LIMIT ${tier}
          )
        `,
        format: 'JSONEachRow'
      })

      const data: any = await result.json()

      if (data.length === 0 || data[0].count === '0') {
        console.log(`    No wallets with >=10 resolved trades in this category`)
        continue
      }

      const stats = data[0]

      console.log(`    Count: ${stats.count}`)
      console.log(`    Average Omega: ${parseFloat(stats.avg_omega).toFixed(4)}`)
      console.log(`    Average P&L: $${parseFloat(stats.avg_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
      console.log(`    Omega Range: ${parseFloat(stats.min_omega).toFixed(4)} - ${parseFloat(stats.max_omega).toFixed(4)}`)
      console.log(`    P&L Range: $${parseFloat(stats.min_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - $${parseFloat(stats.max_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    }
  }

  console.log('\n\n')
  console.log('═'.repeat(80))
  console.log('Analysis complete!')
  console.log('═'.repeat(80))
}

main()
