#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('='.repeat(100))
  console.log('SHADOW_V1 - Resolved Conditions Check')
  console.log('='.repeat(100))

  try {
    const testWallet = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'

    console.log(`\nFor wallet: ${testWallet}`)

    // How many conditions does the wallet have cashflows in?
    console.log('\n[1] Total conditions with cashflows...')
    const allConditions = await (await clickhouse.query({
      query: `
        SELECT uniqExact(condition_id_norm) as condition_count
        FROM shadow_v1.flows_by_condition
        WHERE wallet = '${testWallet.toLowerCase()}'
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    console.log(`   Total: ${allConditions[0].condition_count}`)

    // How many of those are resolved?
    console.log('\n[2] Conditions that are RESOLVED...')
    const resolvedCount = await (await clickhouse.query({
      query: `
        SELECT count(distinct f.condition_id_norm) as resolved_condition_count
        FROM shadow_v1.flows_by_condition f
        INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
        WHERE f.wallet = '${testWallet.toLowerCase()}'
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    console.log(`   Resolved: ${resolvedCount[0].resolved_condition_count}`)

    // Sample of resolved conditions with cashflow
    console.log('\n[3] Sample of RESOLVED conditions with cashflow...')
    const sample = await (await clickhouse.query({
      query: `
        SELECT f.condition_id_norm, f.cash_usd, w.win_idx
        FROM shadow_v1.flows_by_condition f
        INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
        WHERE f.wallet = '${testWallet.toLowerCase()}'
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })).json() as any[]
    console.log(`   Found ${sample.length} resolved conditions`)
    if (sample.length > 0) {
      sample.slice(0, 3).forEach(row => {
        console.log(`   condition=${row.condition_id_norm}, cash=$${row.cash_usd}, win_idx=${row.win_idx}`)
      })
    }

    // Try the full PnL calculation
    console.log('\n[4] Full PnL calculation (debug)...')
    const pnl = await (await clickhouse.query({
      query: `
        SELECT
          f.wallet,
          count(distinct f.condition_id_norm) as condition_count,
          sum(f.cash_usd) as total_cash,
          sumIf(p.net_shares, p.outcome_idx = w.win_idx + coalesce(co.offset, 0)) as total_winning_shares,
          round(sum(f.cash_usd) + coalesce(sumIf(p.net_shares, p.outcome_idx = w.win_idx + coalesce(co.offset, 0)), 0) * 1.00, 2) as realized_pnl_usd
        FROM shadow_v1.flows_by_condition f
        INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
        LEFT JOIN shadow_v1.pos_by_condition p ON f.wallet = p.wallet AND f.condition_id_norm = p.condition_id_norm
        LEFT JOIN shadow_v1.condition_offset co ON f.condition_id_norm = co.condition_id_norm
        WHERE f.wallet = '${testWallet.toLowerCase()}'
        GROUP BY f.wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (pnl.length > 0) {
      const row = pnl[0]
      console.log(`   Conditions: ${row.condition_count}`)
      console.log(`   Total cashflow: $${parseFloat(row.total_cash).toFixed(2)}`)
      console.log(`   Winning shares: ${row.total_winning_shares}`)
      console.log(`   Realized PnL: $${row.realized_pnl_usd}`)
    } else {
      console.log(`   No data (check joins)`)
    }

    console.log('\n' + '='.repeat(100))

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
