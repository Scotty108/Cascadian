#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('='.repeat(100))
  console.log('SHADOW_V1 - Formula Variant Testing')
  console.log('='.repeat(100))

  try {
    const testWallet = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'
    const expectedUI = 137663

    console.log(`\nWallet: ${testWallet}`)
    console.log(`Expected (Polymarket UI): $${expectedUI.toLocaleString()}`)

    // Variant 1: Cashflow only (NO settlement addition)
    console.log('\n[1] Formula: Cashflow ONLY (resolved conditions only)...')
    const var1 = await (await clickhouse.query({
      query: `
        SELECT round(sum(f.cash_usd), 2) as realized_pnl
        FROM shadow_v1.flows_by_condition f
        INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
        WHERE f.wallet = '${testWallet.toLowerCase()}'
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    const v1 = parseFloat(var1[0].realized_pnl)
    const var1Diff = ((v1 - expectedUI) / expectedUI * 100)
    console.log(`   Result: $${v1.toLocaleString('en-US', {maximumFractionDigits: 2})}`)
    console.log(`   Variance: ${var1Diff > 0 ? '+' : ''}${var1Diff.toFixed(2)}%`)
    console.log(`   Status: ${Math.abs(var1Diff) <= 2 ? '✅ PASS' : '❌ FAIL'}`)

    // Variant 2: Cashflow + Winning Shares
    console.log('\n[2] Formula: Cashflow + (Winning Shares × $1.00)...')
    const var2 = await (await clickhouse.query({
      query: `
        SELECT round(sum(f.cash_usd) + sumIf(p.net_shares, p.outcome_idx = w.win_idx + coalesce(co.offset, 0)) * 1.00, 2) as realized_pnl
        FROM shadow_v1.flows_by_condition f
        INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
        LEFT JOIN shadow_v1.pos_by_condition p ON f.wallet = p.wallet AND f.condition_id_norm = p.condition_id_norm
        LEFT JOIN shadow_v1.condition_offset co ON f.condition_id_norm = co.condition_id_norm
        WHERE f.wallet = '${testWallet.toLowerCase()}'
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    const v2 = parseFloat(var2[0].realized_pnl)
    const var2Diff = ((v2 - expectedUI) / expectedUI * 100)
    console.log(`   Result: $${v2.toLocaleString('en-US', {maximumFractionDigits: 2})}`)
    console.log(`   Variance: ${var2Diff > 0 ? '+' : ''}${var2Diff.toFixed(2)}%`)
    console.log(`   Status: ${Math.abs(var2Diff) <= 2 ? '✅ PASS' : '❌ FAIL'}`)

    // Variant 3: Check what's in cashflows - break it down
    console.log('\n[3] Cashflow breakdown...')
    const breakdown = await (await clickhouse.query({
      query: `
        SELECT
          count(distinct f.condition_id_norm) as condition_count,
          sum(f.cash_usd) as total_cash,
          min(f.cash_usd) as min_cash,
          max(f.cash_usd) as max_cash,
          sumIf(f.cash_usd, f.cash_usd > 0) as positive_cash,
          sumIf(f.cash_usd, f.cash_usd < 0) as negative_cash
        FROM shadow_v1.flows_by_condition f
        INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
        WHERE f.wallet = '${testWallet.toLowerCase()}'
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    const bd = breakdown[0]
    console.log(`   Conditions: ${bd.condition_count}`)
    console.log(`   Total: $${parseFloat(bd.total_cash).toFixed(2)}`)
    console.log(`   Min per condition: $${parseFloat(bd.min_cash).toFixed(2)}`)
    console.log(`   Max per condition: $${parseFloat(bd.max_cash).toFixed(2)}`)
    console.log(`   Positive cashflows: $${parseFloat(bd.positive_cash).toFixed(2)}`)
    console.log(`   Negative cashflows: $${parseFloat(bd.negative_cash).toFixed(2)}`)

    console.log('\n' + '='.repeat(100))
    console.log('SUMMARY')
    console.log('='.repeat(100))
    console.log(`\nBest variant: ${Math.abs(var1Diff) < Math.abs(var2Diff) ? '[1] Cashflow only' : '[2] Cashflow + Winning Shares'}`)
    console.log(`\nCashflows alone: $${v1.toLocaleString('en-US', {maximumFractionDigits: 2})} (${Math.abs(var1Diff).toFixed(2)}% off)`)
    console.log(`With settlements: $${v2.toLocaleString('en-US', {maximumFractionDigits: 2})} (${Math.abs(var2Diff).toFixed(2)}% off)`)

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
