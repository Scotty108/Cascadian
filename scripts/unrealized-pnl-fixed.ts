#!/usr/bin/env npx tsx
/**
 * UNREALIZED P&L - FIXED TYPE CASTING
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
  console.log('UNREALIZED P&L - CALCULATION WITH TYPE FIXING')
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
    const coverage = Math.min(100, (prices.unique_price_markets / prices.unique_markets) * 100)
    console.log(`Coverage: ${coverage.toFixed(2)}%`)

    console.log('\n[STEP 2] Calculate unrealized P&L by wallet...')

    // Direct calculation without staging table
    const walletCalc = await clickhouse.query({
      query: `
        SELECT
          t.wallet_address,
          COUNT(*) as positions_count,
          COUNT(DISTINCT t.market_id) as markets_count,
          SUM(t.shares) as total_shares,
          SUM(
            CASE
              WHEN p.last_price IS NOT NULL AND t.shares != 0
              THEN (toFloat64(t.shares) * toFloat64(p.last_price)) - (toFloat64(t.shares) * toFloat64(t.entry_price))
              ELSE NULL
            END
          ) as total_unrealized_pnl,
          AVG(
            CASE
              WHEN p.last_price IS NOT NULL AND t.shares != 0
              THEN (toFloat64(t.shares) * toFloat64(p.last_price)) - (toFloat64(t.shares) * toFloat64(t.entry_price))
              ELSE NULL
            END
          ) as avg_position_pnl,
          MIN(
            CASE
              WHEN p.last_price IS NOT NULL AND t.shares != 0
              THEN (toFloat64(t.shares) * toFloat64(p.last_price)) - (toFloat64(t.shares) * toFloat64(t.entry_price))
              ELSE NULL
            END
          ) as worst_position,
          MAX(
            CASE
              WHEN p.last_price IS NOT NULL AND t.shares != 0
              THEN (toFloat64(t.shares) * toFloat64(p.last_price)) - (toFloat64(t.shares) * toFloat64(t.entry_price))
              ELSE NULL
            END
          ) as best_position
        FROM trades_raw t
        LEFT JOIN market_last_price p ON t.market_id = p.market_id
        GROUP BY t.wallet_address
      `,
      format: 'JSON',
    })

    const walletData: any = await walletCalc.json()
    const wallets = walletData.data

    console.log(`\n✅ Calculated unrealized P&L for ${wallets.length} wallets`)

    console.log('\n[STEP 3] Sample results - Top 10 by unrealized P&L:')
    console.log('─'.repeat(100))

    const sorted = wallets.sort((a: any, b: any) => parseFloat(b.total_unrealized_pnl || 0) - parseFloat(a.total_unrealized_pnl || 0))
    sorted.slice(0, 10).forEach((row: any, idx: number) => {
      console.log(
        `${(idx + 1).toString().padStart(2, ' ')}. ${row.wallet_address.substring(0, 10)}... | ` +
          `Pos: ${row.positions_count.toString().padStart(5, ' ')} | ` +
          `Markets: ${row.markets_count.toString().padStart(5, ' ')} | ` +
          `Unrealized: $${parseFloat(row.total_unrealized_pnl || '0').toLocaleString('en-US', { maximumFractionDigits: 2 }).padStart(12, ' ')} | ` +
          `Avg: $${parseFloat(row.avg_position_pnl || '0').toFixed(2).padStart(10, ' ')}`
      )
    })

    console.log('\n[STEP 4] Global statistics:')
    const stats = await clickhouse.query({
      query: `
        SELECT
          COUNT(DISTINCT wallet_address) as unique_wallets,
          SUM(positions_count) as total_positions,
          COUNT(DISTINCT market_id) as traded_markets,
          SUM(
            CASE
              WHEN p.last_price IS NOT NULL AND t.shares != 0
              THEN (toFloat64(t.shares) * toFloat64(p.last_price)) - (toFloat64(t.shares) * toFloat64(t.entry_price))
              ELSE NULL
            END
          ) as total_unrealized_pnl
        FROM trades_raw t
        LEFT JOIN market_last_price p ON t.market_id = p.market_id
        WHERE p.last_price IS NOT NULL
      `,
      format: 'JSON',
    })

    const statsData: any = await stats.json()
    const s = statsData.data[0]

    console.log(`Unique wallets: ${s.unique_wallets}`)
    console.log(`Total positions: ${s.total_positions}`)
    console.log(`Traded markets: ${s.traded_markets}`)
    console.log(`Total unrealized P&L: $${parseFloat(s.total_unrealized_pnl || '0').toLocaleString()}`)

    console.log('\n════════════════════════════════════════════════════════════════════════════')
    console.log('✅ UNREALIZED P&L SYSTEM READY')
    console.log('════════════════════════════════════════════════════════════════════════════')
    console.log('\n📊 System shows:')
    console.log(`  • ${s.unique_wallets} wallets with calculated unrealized P&L`)
    console.log(`  • ${s.total_positions} positions across all wallets`)
    console.log(`  • ${s.traded_markets} unique markets traded`)
    console.log(`  • $${parseFloat(s.total_unrealized_pnl || '0').toLocaleString()} total unrealized portfolio value`)
    console.log('\n✅ Ready to integrate with dashboard and API')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    console.error(error.code)
    process.exit(1)
  }
}

main()
