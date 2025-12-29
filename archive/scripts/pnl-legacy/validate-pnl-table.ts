#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function runQuery(name: string, query: string) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(name)
  console.log('='.repeat(60))
  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' })
    const data = await result.json()
    console.log(JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return null
  }
}

async function main() {
  console.log('\n🎯 FINAL VALIDATION: pm_wallet_market_pnl')

  // 1. Overall stats
  await runQuery('TABLE STATS',
    `SELECT
      count() as total_rows,
      countDistinct(wallet) as unique_wallets,
      countDistinct(condition_id) as unique_markets,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(total_bought_usdc), 2) as total_volume_bought,
      round(sum(total_sold_usdc), 2) as total_volume_sold,
      round(sum(trading_pnl), 2) as net_trading_pnl
    FROM pm_wallet_market_pnl`)

  // 2. Top winners (resolved markets)
  await runQuery('TOP 10 WINNERS (Resolved Markets)',
    `SELECT
      wallet,
      question,
      category,
      round(total_bought_usdc, 2) as bought,
      round(total_sold_usdc, 2) as sold,
      round(trading_pnl, 2) as trading_pnl,
      total_trades
    FROM pm_wallet_market_pnl
    WHERE is_resolved = 1
    ORDER BY trading_pnl DESC
    LIMIT 10`)

  // 3. Top losers (resolved markets)
  await runQuery('TOP 10 LOSERS (Resolved Markets)',
    `SELECT
      wallet,
      question,
      category,
      round(total_bought_usdc, 2) as bought,
      round(total_sold_usdc, 2) as sold,
      round(trading_pnl, 2) as trading_pnl,
      total_trades
    FROM pm_wallet_market_pnl
    WHERE is_resolved = 1
    ORDER BY trading_pnl ASC
    LIMIT 10`)

  // 4. PnL by category
  await runQuery('PnL BY CATEGORY',
    `SELECT
      category,
      count() as positions,
      countDistinct(wallet) as unique_wallets,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(trading_pnl), 2) as total_trading_pnl
    FROM pm_wallet_market_pnl
    WHERE is_resolved = 1
    GROUP BY category
    ORDER BY total_trading_pnl DESC`)

  // 5. Wallet-level aggregation
  await runQuery('TOP WALLETS BY TOTAL PnL',
    `SELECT
      wallet,
      count() as markets_traded,
      sum(total_trades) as total_trades,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(trading_pnl), 2) as total_pnl
    FROM pm_wallet_market_pnl
    WHERE is_resolved = 1
    GROUP BY wallet
    ORDER BY total_pnl DESC
    LIMIT 10`)

  // 6. Check for Trump 2024 election market specifically
  await runQuery('TRUMP 2024 MARKET TOP TRADERS',
    `SELECT
      wallet,
      round(total_bought_usdc, 2) as bought,
      round(total_sold_usdc, 2) as sold,
      round(trading_pnl, 2) as trading_pnl,
      total_trades
    FROM pm_wallet_market_pnl
    WHERE question LIKE '%Donald Trump%2024%Presidential%'
      AND is_resolved = 1
    ORDER BY abs(trading_pnl) DESC
    LIMIT 10`)

  await clickhouse.close()
  console.log('\n✅ Validation complete!')
}

main().catch(console.error)
