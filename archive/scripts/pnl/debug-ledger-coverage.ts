// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * debug-ledger-coverage.ts
 *
 * Investigate why condition-level PnL shows so few conditions for Theo
 * and wrong totals for Sports Bettor.
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
  console.log('='.repeat(80))
  console.log('DEBUG: LEDGER COVERAGE ANALYSIS')
  console.log('='.repeat(80))

  // 1. Check raw trader events (before join)
  console.log('
--- 1. RAW TRADER EVENTS (pm_trader_events_v2) ---')

  for (const [name, wallet] of [['Theo', THEO], ['Sports', SPORTS]]) {
    const raw = await clickhouse.query({
      query: `
        SELECT
          count() as total_events,
          uniqExact(token_id) as unique_tokens,
          sum(usdc_amount) / 1e6 as total_usdc_volume
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}'
          AND is_deleted = 0
      `,
      format: 'JSONEachRow',
    })
    const r = (await raw.json())[0] as any
    console.log(`
  ${name}:`)
    console.log(`    Total events:    ${Number(r.total_events).toLocaleString()}`)
    console.log(`    Unique tokens:   ${Number(r.unique_tokens).toLocaleString()}`)
    console.log(`    USDC volume:     ${formatUSD(Number(r.total_usdc_volume))}`)
  }

  // 2. Check vw_pm_ledger (after join with token map)
  console.log('
--- 2. VW_PM_LEDGER (after token map join) ---')

  for (const [name, wallet] of [['Theo', THEO], ['Sports', SPORTS]]) {
    const ledger = await clickhouse.query({
      query: `
        SELECT
          count() as total_entries,
          uniqExact(condition_id) as unique_conditions,
          sumIf(abs(cash_delta_usdc), side = 'buy') as total_bought,
          sumIf(abs(cash_delta_usdc), side = 'sell') as total_sold,
          sum(cash_delta_usdc) as net_cash
        FROM vw_pm_ledger
        WHERE wallet_address = '${wallet}'
      `,
      format: 'JSONEachRow',
    })
    const r = (await ledger.json())[0] as any
    console.log(`
  ${name}:`)
    console.log(`    Total entries:     ${Number(r.total_entries).toLocaleString()}`)
    console.log(`    Unique conditions: ${Number(r.unique_conditions).toLocaleString()}`)
    console.log(`    Total bought:      ${formatUSD(Number(r.total_bought))}`)
    console.log(`    Total sold:        ${formatUSD(Number(r.total_sold))}`)
    console.log(`    Net cash:          ${formatUSD(Number(r.net_cash))}`)
  }

  // 3. Check token map coverage
  console.log('
--- 3. TOKEN MAP COVERAGE ---')

  for (const [name, wallet] of [['Theo', THEO], ['Sports', SPORTS]]) {
    const coverage = await clickhouse.query({
      query: `
        SELECT
          countIf(m.condition_id IS NOT NULL) as mapped_events,
          countIf(m.condition_id IS NULL) as unmapped_events,
          count() as total_events
        FROM pm_trader_events_v2 t
        LEFT JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id
        WHERE t.trader_wallet = '${wallet}'
          AND t.is_deleted = 0
      `,
      format: 'JSONEachRow',
    })
    const r = (await coverage.json())[0] as any
    const mappedPct = (Number(r.mapped_events) / Number(r.total_events) * 100).toFixed(2)
    console.log(`
  ${name}:`)
    console.log(`    Mapped events:   ${Number(r.mapped_events).toLocaleString()} (${mappedPct}%)`)
    console.log(`    Unmapped events: ${Number(r.unmapped_events).toLocaleString()}`)
  }

  // 4. Check resolution coverage
  console.log('
--- 4. RESOLUTION COVERAGE ---')

  for (const [name, wallet] of [['Theo', THEO], ['Sports', SPORTS]]) {
    const resolution = await clickhouse.query({
      query: `
        SELECT
          count(DISTINCT l.condition_id) as conditions_in_ledger,
          countIf(r.condition_id IS NOT NULL) as resolved_conditions,
          countIf(r.condition_id IS NULL) as unresolved_conditions
        FROM (
          SELECT DISTINCT condition_id
          FROM vw_pm_ledger
          WHERE wallet_address = '${wallet}'
        ) l
        LEFT JOIN pm_condition_resolutions r ON r.condition_id = l.condition_id
      `,
      format: 'JSONEachRow',
    })
    const r = (await resolution.json())[0] as any
    console.log(`
  ${name}:`)
    console.log(`    Conditions in ledger:  ${Number(r.conditions_in_ledger).toLocaleString()}`)
    console.log(`    Resolved conditions:   ${Number(r.resolved_conditions).toLocaleString()}`)
    console.log(`    Unresolved conditions: ${Number(r.unresolved_conditions).toLocaleString()}`)
  }

  // 5. Sample unmapped tokens
  console.log('
--- 5. SAMPLE UNMAPPED TOKENS (Theo) ---')
  const unmapped = await clickhouse.query({
    query: `
      SELECT
        t.token_id,
        t.side,
        t.usdc_amount / 1e6 as usdc_amount,
        t.trade_time
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id
      WHERE t.trader_wallet = '${THEO}'
        AND t.is_deleted = 0
        AND m.condition_id IS NULL
      ORDER BY t.usdc_amount DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  })
  const unmappedData = await unmapped.json() as any[]
  if (unmappedData.length > 0) {
    for (const u of unmappedData) {
      console.log(`  Token: ${u.token_id.toString().slice(0, 20)}... | ${u.side} | ${formatUSD(Number(u.usdc_amount))} | ${u.trade_time}`)
    }
  } else {
    console.log('  No unmapped tokens found!')
  }

  // 6. Check total resolution payout calculation
  console.log('
--- 6. RESOLUTION PAYOUT CHECK ---')

  for (const [name, wallet] of [['Theo', THEO], ['Sports', SPORTS]]) {
    const payout = await clickhouse.query({
      query: `
        SELECT
          sum(resolution_payout_usdc) as total_payout,
          count() as conditions_with_payout
        FROM vw_pm_resolution_payouts
        WHERE wallet_address = '${wallet}'
      `,
      format: 'JSONEachRow',
    })
    const r = (await payout.json())[0] as any
    console.log(`
  ${name}:`)
    console.log(`    Resolution payout:   ${formatUSD(Number(r.total_payout))}`)
    console.log(`    Conditions with payout: ${Number(r.conditions_with_payout).toLocaleString()}`)
  }

  // 7. Compare with pm_wallet_market_pnl_v4 (old methodology)
  console.log('
--- 7. COMPARISON WITH OLD V4 METHODOLOGY ---')

  for (const [name, wallet] of [['Theo', THEO], ['Sports', SPORTS]]) {
    const oldV4 = await clickhouse.query({
      query: `
        SELECT
          count() as positions,
          uniqExact(condition_id) as unique_conditions,
          sum(total_pnl) as total_pnl,
          sum(total_bought_usdc) as bought,
          sum(total_sold_usdc) as sold,
          sum(resolution_payout) as resolution
        FROM pm_wallet_market_pnl_v4
        WHERE wallet = '${wallet}'
      `,
      format: 'JSONEachRow',
    })
    const r = (await oldV4.json())[0] as any
    console.log(`
  ${name} (old v4):`)
    console.log(`    Positions:     ${Number(r.positions).toLocaleString()}`)
    console.log(`    Conditions:    ${Number(r.unique_conditions).toLocaleString()}`)
    console.log(`    Total PnL:     ${formatUSD(Number(r.total_pnl))}`)
    console.log(`    Bought:        ${formatUSD(Number(r.bought))}`)
    console.log(`    Sold:          ${formatUSD(Number(r.sold))}`)
    console.log(`    Resolution:    ${formatUSD(Number(r.resolution))}`)
  }

  await clickhouse.close()
}

main().catch(console.error)
