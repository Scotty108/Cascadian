#!/usr/bin/env npx tsx
/**
 * UNREALIZED P&L - DIRECT UPDATE
 * Calculate and update unrealized_pnl_usd for all trades
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
})

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════')
  console.log('UNREALIZED P&L - DIRECT CALCULATION')
  console.log('════════════════════════════════════════════════════════════════════════════')

  try {
    console.log('\n[STEP 1] Check market price coverage...')
    const priceCheck = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(DISTINCT market_id) as unique_markets,
          (SELECT COUNT(*) FROM market_last_price) as markets_with_prices,
          (SELECT COUNT(DISTINCT market_id) FROM market_last_price) as unique_price_markets
        FROM trades_raw
      `,
      format: 'JSON',
    })

    const priceData: any = await priceCheck.json()
    const prices = priceData.data[0]

    console.log(`Total trades: ${prices.total_trades}`)
    console.log(`Unique markets in trades: ${prices.unique_markets}`)
    console.log(`Markets with prices: ${prices.unique_price_markets}`)
    console.log(`Coverage: ${((prices.unique_price_markets / prices.unique_markets) * 100).toFixed(2)}%`)

    console.log('\n[STEP 2] Create staging table for calculations...')

    // Create staging table with unrealized P&L calculations
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS trades_raw_unrealized_staging AS
        SELECT
          t.*,
          CASE
            WHEN p.last_price IS NOT NULL AND t.shares != 0
            THEN (t.shares * p.last_price) - (t.shares * t.entry_price)
            ELSE NULL
          END as unrealized_pnl_usd
        FROM trades_raw t
        LEFT JOIN market_last_price p ON t.market_id = p.market_id
      `,
    })

    console.log('✅ Staging table created')

    console.log('\n[STEP 3] Verify calculations...')
    const verify = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN unrealized_pnl_usd IS NOT NULL THEN 1 ELSE 0 END) as with_pnl,
          AVG(unrealized_pnl_usd) as avg_pnl,
          MIN(unrealized_pnl_usd) as min_pnl,
          MAX(unrealized_pnl_usd) as max_pnl
        FROM trades_raw_unrealized_staging
      `,
      format: 'JSON',
    })

    const verifyData: any = await verify.json()
    const v = verifyData.data[0]

    console.log(`Total trades: ${v.total}`)
    console.log(`With unrealized P&L: ${v.with_pnl}`)
    console.log(`Coverage: ${((v.with_pnl / v.total) * 100).toFixed(2)}%`)
    console.log(`Avg P&L: $${parseFloat(v.avg_pnl).toFixed(2)}`)
    console.log(`Range: $${parseFloat(v.min_pnl).toFixed(2)} to $${parseFloat(v.max_pnl).toFixed(2)}`)

    console.log('\n[STEP 4] Create wallet aggregates...')

    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS wallet_unrealized_pnl_staging AS
        SELECT
          wallet_address,
          COUNT(*) as positions_count,
          COUNT(DISTINCT market_id) as markets_count,
          SUM(shares) as total_shares,
          SUM(unrealized_pnl_usd) as total_unrealized_pnl,
          AVG(unrealized_pnl_usd) as avg_position_pnl,
          MIN(unrealized_pnl_usd) as worst_position,
          MAX(unrealized_pnl_usd) as best_position
        FROM trades_raw_unrealized_staging
        WHERE unrealized_pnl_usd IS NOT NULL
        GROUP BY wallet_address
      `,
    })

    console.log('✅ Wallet aggregates created')

    console.log('\n[STEP 5] Sample wallet results...')

    const sample = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          positions_count,
          markets_count,
          total_unrealized_pnl,
          avg_position_pnl
        FROM wallet_unrealized_pnl_staging
        ORDER BY total_unrealized_pnl DESC
        LIMIT 10
      `,
      format: 'JSON',
    })

    const sampleData: any = await sample.json()
    console.log('\n📊 Top 10 wallets by unrealized P&L:')
    console.log('─'.repeat(80))
    sampleData.data.forEach((row: any, idx: number) => {
      console.log(
        `${idx + 1}. ${row.wallet_address.substring(0, 10)}... | ` +
          `Positions: ${row.positions_count} | ` +
          `Markets: ${row.markets_count} | ` +
          `Total: $${parseFloat(row.total_unrealized_pnl).toFixed(2)} | ` +
          `Avg: $${parseFloat(row.avg_position_pnl).toFixed(2)}`
      )
    })

    console.log('\n════════════════════════════════════════════════════════════════════════════')
    console.log('✅ UNREALIZED P&L CALCULATION COMPLETE')
    console.log('════════════════════════════════════════════════════════════════════════════')
    console.log('\nStaging tables created:')
    console.log('  - trades_raw_unrealized_staging (all trades with unrealized P&L)')
    console.log('  - wallet_unrealized_pnl_staging (aggregated by wallet)')
    console.log('\n💡 Next steps:')
    console.log('  1. Verify results look correct')
    console.log('  2. Swap staging → production tables')
    console.log('  3. Integrate with API/dashboard')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

main()
