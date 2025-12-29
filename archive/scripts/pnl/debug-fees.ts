// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * Debug fee handling in PnL calculation
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
})

const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
const SPORTS = '0xf29bb8e0712075041e87e8605b69833ef738dd4c'

function formatUSD(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`
  return `${sign}$${abs.toFixed(2)}`
}

async function main() {
  console.log('=== FEE ANALYSIS ===
')

  for (const [name, wallet, target] of [['Theo', THEO, 22_053_934], ['Sports', SPORTS, -10_021_172]] as const) {
    const result = await clickhouse.query({
      query: `
        SELECT
          sum(total_fees_usdc) as total_fees,
          sum(net_cash_flow_usdc) as net_cash_flow,
          sum(resolution_payout_usdc) as resolution_payout,
          sum(total_pnl_usdc) as total_pnl
        FROM vw_pm_wallet_condition_pnl_v4
        WHERE wallet_address = '${wallet}'
      `,
      format: 'JSONEachRow',
    })
    const r = (await result.json())[0] as any

    console.log(`${name}:`)
    console.log(`  Net Cash Flow:    ${formatUSD(Number(r.net_cash_flow))}`)
    console.log(`  Total Fees:       ${formatUSD(Number(r.total_fees))}`)
    console.log(`  Resolution:       ${formatUSD(Number(r.resolution_payout))}`)
    console.log(`  Current PnL:      ${formatUSD(Number(r.total_pnl))}`)
    console.log(`  Target PnL:       ${formatUSD(target)}`)

    // Calculate what PnL would be with fees subtracted
    const pnlWithFees = Number(r.net_cash_flow) - Number(r.total_fees) + Number(r.resolution_payout)
    console.log(`  PnL with fees:    ${formatUSD(pnlWithFees)}`)

    const gap = Number(r.total_pnl) - target
    console.log(`  Gap to target:    ${formatUSD(gap)}`)
    console.log()
  }

  // Also check raw ledger fees
  console.log('=== RAW LEDGER FEES ===
')

  for (const [name, wallet] of [['Theo', THEO], ['Sports', SPORTS]] as const) {
    const result = await clickhouse.query({
      query: `
        SELECT
          sum(fee_usdc) as total_fees,
          countIf(fee_usdc > 0) as trades_with_fees,
          count() as total_trades
        FROM vw_pm_ledger
        WHERE wallet_address = '${wallet}'
      `,
      format: 'JSONEachRow',
    })
    const r = (await result.json())[0] as any

    console.log(`${name}:`)
    console.log(`  Total Fees:        ${formatUSD(Number(r.total_fees))}`)
    console.log(`  Trades with fees:  ${Number(r.trades_with_fees).toLocaleString()}`)
    console.log(`  Total trades:      ${Number(r.total_trades).toLocaleString()}`)
    console.log()
  }

  await clickhouse.close()
}

main().catch(console.error)
