// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * create-ui-pnl-view.ts
 *
 * Creates vw_wallet_ui_pnl_v1 - a view that approximates Polymarket's UI PnL.
 *
 * UI Formula: ui_pnl = resolution_payout - cost_basis
 * Where: cost_basis = total_bought_usdc
 *
 * This is SEPARATE from the canonical pm_wallet_condition_pnl_v4 table.
 * The canonical table uses cash-flow PnL: total_pnl = net_cash_flow + resolution_payout
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

async function main() {
  console.log('='.repeat(80))
  console.log('CREATING vw_wallet_ui_pnl_v1')
  console.log('='.repeat(80))
  console.log()

  // Drop existing view if exists
  console.log('[1/3] Dropping existing view if exists...')
  await clickhouse.command({
    query: `DROP VIEW IF EXISTS vw_wallet_ui_pnl_v1`,
  })

  // Create the UI PnL view
  // This computes UI-style PnL at condition level from canonical data
  console.log('[2/3] Creating vw_wallet_ui_pnl_v1...')
  await clickhouse.command({
    query: `
      CREATE VIEW vw_wallet_ui_pnl_v1 AS
      SELECT
        wallet_address,
        condition_id,
        total_bought_usdc as cost_basis_usdc,
        total_sold_usdc,
        net_cash_flow_usdc,
        resolution_payout_usdc,
        -- Canonical cash-flow PnL (for reference)
        total_pnl_usdc as cash_pnl_usdc,
        -- UI-style PnL: resolution_payout - cost_basis
        resolution_payout_usdc - total_bought_usdc as ui_pnl_usdc,
        -- Delta between the two formulas (should equal total_sold)
        total_pnl_usdc - (resolution_payout_usdc - total_bought_usdc) as formula_delta
      FROM pm_wallet_condition_pnl_v4
    `,
  })

  // Verify with a sample
  console.log('[3/3] Verifying view with sample...')
  const result = await clickhouse.query({
    query: `
      SELECT
        count() as rows,
        count(DISTINCT wallet_address) as wallets,
        sum(ui_pnl_usdc) as total_ui_pnl,
        sum(cash_pnl_usdc) as total_cash_pnl,
        sum(formula_delta) as total_delta,
        sum(total_sold_usdc) as total_sold
      FROM vw_wallet_ui_pnl_v1
    `,
    format: 'JSONEachRow',
  })

  const stats = (await result.json())[0] as any

  console.log()
  console.log('=== VIEW STATISTICS ===')
  console.log(`  Rows:           ${Number(stats.rows).toLocaleString()}`)
  console.log(`  Wallets:        ${Number(stats.wallets).toLocaleString()}`)
  console.log(`  Total UI PnL:   $${(Number(stats.total_ui_pnl) / 1e6).toFixed(2)}M`)
  console.log(`  Total Cash PnL: $${(Number(stats.total_cash_pnl) / 1e6).toFixed(2)}M`)
  console.log(`  Formula Delta:  $${(Number(stats.total_delta) / 1e6).toFixed(2)}M`)
  console.log(`  Total Sold:     $${(Number(stats.total_sold) / 1e6).toFixed(2)}M`)
  console.log()

  // Verify formula_delta = total_sold for all rows
  const integrityCheck = await clickhouse.query({
    query: `
      SELECT count() as mismatches
      FROM vw_wallet_ui_pnl_v1
      WHERE abs(formula_delta - total_sold_usdc) > 0.01
    `,
    format: 'JSONEachRow',
  })

  const mismatches = Number((await integrityCheck.json())[0].mismatches)

  console.log(`  Integrity check: ${mismatches === 0 ? 'PASSED' : `FAILED (${mismatches} mismatches)`}`)
  console.log(`  (formula_delta should equal total_sold for all rows)`)
  console.log()
  console.log('='.repeat(80))
  console.log('vw_wallet_ui_pnl_v1 created successfully!')
  console.log('='.repeat(80))

  await clickhouse.close()
}

main().catch(console.error)
