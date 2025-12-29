// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * create-derived-views.ts
 *
 * Creates derived views for wallet metrics and category rollups
 * based on the canonical pm_wallet_condition_pnl_v4 table.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

async function runCommand(description: string, query: string): Promise<void> {
  console.log(`
[${new Date().toISOString()}] ${description}...`)
  const startTime = Date.now()
  try {
    await clickhouse.command({
      query,
      clickhouse_settings: { wait_end_of_query: 1, max_execution_time: 300 },
    })
    console.log(`  Done in ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
  } catch (error) {
    console.error(`  FAILED after ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
    throw error
  }
}

async function main() {
  console.log('='.repeat(80))
  console.log('CREATING DERIVED VIEWS')
  console.log('='.repeat(80))

  // 1. Wallet totals view
  await runCommand('Creating vw_wallet_pnl_totals', `
    CREATE OR REPLACE VIEW vw_wallet_pnl_totals AS
    SELECT
      wallet_address,
      count() as condition_count,
      sum(total_pnl_usdc) as total_pnl,
      sum(greatest(total_pnl_usdc, 0)) as total_gains,
      sum(least(total_pnl_usdc, 0)) as total_losses,
      sum(net_cash_flow_usdc) as net_cash_flow,
      sum(resolution_payout_usdc) as resolution_payout,
      sum(total_bought_usdc) as total_bought,
      sum(total_sold_usdc) as total_sold,
      countIf(total_pnl_usdc > 0) as winning_conditions,
      countIf(total_pnl_usdc < 0) as losing_conditions,
      countIf(total_pnl_usdc > 0) / nullIf(count(), 0) as win_rate,
      -- ROI: total_pnl / total_bought (return on investment)
      sum(total_pnl_usdc) / nullIf(sum(total_bought_usdc), 0) as roi,
      -- Omega ratio: total_gains / abs(total_losses)
      sum(greatest(total_pnl_usdc, 0)) / nullIf(abs(sum(least(total_pnl_usdc, 0))), 0) as omega_ratio
    FROM pm_wallet_condition_pnl_v4
    GROUP BY wallet_address
  `)

  // 2. Category PnL view (requires joining with market metadata)
  await runCommand('Creating vw_wallet_pnl_by_category', `
    CREATE OR REPLACE VIEW vw_wallet_pnl_by_category AS
    SELECT
      p.wallet_address,
      coalesce(m.category, 'Unknown') as category,
      count() as condition_count,
      sum(p.total_pnl_usdc) as total_pnl,
      sum(greatest(p.total_pnl_usdc, 0)) as total_gains,
      sum(least(p.total_pnl_usdc, 0)) as total_losses,
      countIf(p.total_pnl_usdc > 0) as wins,
      countIf(p.total_pnl_usdc < 0) as losses,
      countIf(p.total_pnl_usdc > 0) / nullIf(count(), 0) as win_rate,
      sum(p.total_pnl_usdc) / nullIf(sum(p.total_bought_usdc), 0) as roi,
      sum(greatest(p.total_pnl_usdc, 0)) / nullIf(abs(sum(least(p.total_pnl_usdc, 0))), 0) as omega_ratio
    FROM pm_wallet_condition_pnl_v4 p
    LEFT JOIN pm_market_metadata m ON m.condition_id = p.condition_id
    GROUP BY p.wallet_address, category
  `)

  // 3. Global category stats view
  await runCommand('Creating vw_category_pnl_totals', `
    CREATE OR REPLACE VIEW vw_category_pnl_totals AS
    SELECT
      coalesce(m.category, 'Unknown') as category,
      count(DISTINCT p.wallet_address) as unique_wallets,
      count() as total_positions,
      sum(p.total_pnl_usdc) as total_pnl,
      sum(greatest(p.total_pnl_usdc, 0)) as total_gains,
      sum(least(p.total_pnl_usdc, 0)) as total_losses,
      countIf(p.total_pnl_usdc > 0) as winning_positions,
      countIf(p.total_pnl_usdc < 0) as losing_positions,
      countIf(p.total_pnl_usdc > 0) / nullIf(count(), 0) as win_rate,
      sum(greatest(p.total_pnl_usdc, 0)) / nullIf(abs(sum(least(p.total_pnl_usdc, 0))), 0) as omega_ratio
    FROM pm_wallet_condition_pnl_v4 p
    LEFT JOIN pm_market_metadata m ON m.condition_id = p.condition_id
    GROUP BY category
    ORDER BY total_pnl DESC
  `)

  // 4. Verify views work
  console.log('
=== VERIFICATION ===')

  const walletTotals = await clickhouse.query({
    query: `
      SELECT *
      FROM vw_wallet_pnl_totals
      WHERE wallet_address = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
    `,
    format: 'JSONEachRow',
  })
  console.log('
Theo wallet totals:', JSON.stringify(await walletTotals.json(), null, 2))

  const categoryTotals = await clickhouse.query({
    query: `
      SELECT category, unique_wallets, total_pnl, win_rate, omega_ratio
      FROM vw_category_pnl_totals
      ORDER BY abs(total_pnl) DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  })
  console.log('
Top 5 categories by volume:', JSON.stringify(await categoryTotals.json(), null, 2))

  const walletByCategory = await clickhouse.query({
    query: `
      SELECT category, condition_count, total_pnl, win_rate, omega_ratio
      FROM vw_wallet_pnl_by_category
      WHERE wallet_address = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
      ORDER BY abs(total_pnl) DESC
    `,
    format: 'JSONEachRow',
  })
  console.log('
Theo by category:', JSON.stringify(await walletByCategory.json(), null, 2))

  console.log('
' + '='.repeat(80))
  console.log('DERIVED VIEWS CREATED')
  console.log('='.repeat(80))
  console.log('Views created:')
  console.log('  - vw_wallet_pnl_totals (wallet-level aggregates)')
  console.log('  - vw_wallet_pnl_by_category (wallet + category breakdown)')
  console.log('  - vw_category_pnl_totals (global category stats)')

  await clickhouse.close()
}

main().catch(console.error)
