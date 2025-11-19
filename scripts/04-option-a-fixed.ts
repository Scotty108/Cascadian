#!/usr/bin/env npx tsx

/**
 * OPTION A FIXED: Use market_resolutions_final as authoritative source
 *
 * KEY DISCOVERY: trades_raw.is_resolved is unreliable
 * SOLUTION: Filter trades via INNER JOIN to market_resolutions_final instead
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663 },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492 },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730 },
  { address: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171 },
]

async function execute() {
  console.log('='.repeat(100))
  console.log('OPTION A FIXED: Use market_resolutions_final as authoritative source')
  console.log('(Ignore trades_raw.is_resolved, use INNER JOIN to resolved markets only)')
  console.log('='.repeat(100))

  try {
    // STEP 0: Diagnostic - coverage using REAL resolution status
    console.log('\n[D0] Diagnostic: Data Coverage (using market_resolutions_final)...')
    const coverage = await (await clickhouse.query({
      query: `
        SELECT
          lower(tr.wallet_address) as wallet,
          count() as total_trades,
          count(distinct tr.condition_id_norm) as condition_count,
          min(tr.timestamp) as first_trade,
          max(tr.timestamp) as last_trade
        FROM (
          SELECT lower(wallet_address) as wallet_address,
                 lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
                 timestamp
          FROM trades_raw
          WHERE lower(wallet_address) IN (
            '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
            '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
            '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
            '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
          )
        ) tr
        INNER JOIN market_resolutions_final mrf ON tr.condition_id_norm = mrf.condition_id_norm
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('Coverage (using resolved markets only):')
    for (const row of coverage) {
      console.log(`  ${row.wallet.substring(0, 10)}... | Total: ${row.total_trades} | Conditions: ${row.condition_count}`)
    }

    // STEP 1: Create shadow schema
    console.log('\n[1/8] Creating shadow_v1 schema...')
    await clickhouse.command({ query: `DROP DATABASE IF EXISTS shadow_v1_fixed` })
    await clickhouse.command({ query: `CREATE DATABASE IF NOT EXISTS shadow_v1_fixed` })
    console.log('✅ Schema created')

    // STEP 2: Create flows_by_condition USING resolved markets only
    console.log('\n[2/8] Creating flows_by_condition (resolved-only)...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_fixed.flows_by_condition AS
      SELECT
        lower(tr.wallet_address) as wallet,
        tr.condition_id_norm,
        -- Signed cashflow: YES=-price*shares, NO=+price*shares
        sum(if(tr.side = 1, -toFloat64(tr.entry_price) * toFloat64(tr.shares), toFloat64(tr.entry_price) * toFloat64(tr.shares))) as cash_usd,
        -- Fees
        sum(coalesce(toFloat64(tr.fee_usd), 0)) as fees_usd
      FROM (
        SELECT lower(wallet_address) as wallet_address,
               lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
               side, entry_price, shares, fee_usd
        FROM trades_raw
      ) tr
      INNER JOIN market_resolutions_final mrf ON tr.condition_id_norm = mrf.condition_id_norm
      GROUP BY wallet, condition_id_norm
    ` })
    console.log('✅ View created')

    // STEP 3: Create positions
    console.log('\n[3/8] Creating pos_by_condition (resolved-only)...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_fixed.pos_by_condition AS
      SELECT
        lower(tr.wallet_address) as wallet,
        tr.condition_id_norm,
        toInt16(tr.outcome_index) as outcome_idx,
        sum(toFloat64(tr.shares)) as net_shares
      FROM (
        SELECT lower(wallet_address) as wallet_address,
               lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
               outcome_index, shares
        FROM trades_raw
      ) tr
      INNER JOIN market_resolutions_final mrf ON tr.condition_id_norm = mrf.condition_id_norm
      GROUP BY wallet, condition_id_norm, outcome_idx
    ` })
    console.log('✅ View created')

    // STEP 4: Create winners
    console.log('\n[4/8] Creating winners...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_fixed.winners AS
      SELECT
        condition_id_norm,
        toInt16(winning_index) as win_idx,
        arrayElement(payout_numerators, toInt16(winning_index) + 1) as payout_num,
        toFloat64(payout_denominator) as payout_denom
      FROM market_resolutions_final
      WHERE winning_index IS NOT NULL AND condition_id_norm IS NOT NULL
    ` })
    console.log('✅ View created')

    // STEP 5: Per-condition offset detection
    console.log('\n[5/8] Creating condition_offset...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_fixed.condition_offset AS
      WITH votes AS (
        SELECT
          p.condition_id_norm,
          toInt16(p.outcome_idx) - toInt16(w.win_idx) as delta,
          count() as cnt
        FROM shadow_v1_fixed.pos_by_condition p
        INNER JOIN shadow_v1_fixed.winners w ON p.condition_id_norm = w.condition_id_norm
        GROUP BY p.condition_id_norm, delta
      )
      SELECT
        condition_id_norm,
        argMax(delta, cnt) as offset_delta
      FROM votes
      GROUP BY condition_id_norm
    ` })
    console.log('✅ View created')

    // STEP 6: Per-condition P&L (cashflow + settlement)
    console.log('\n[6/8] Creating realized_pnl_by_condition...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_fixed.realized_pnl_by_condition AS
      SELECT
        f.wallet,
        f.condition_id_norm,
        round(coalesce(f.cash_usd, 0), 2) as cash_component,
        round(coalesce(f.fees_usd, 0), 2) as fees_component,
        round(coalesce(
          sumIf(p.net_shares, p.outcome_idx = w.win_idx + coalesce(co.offset_delta, 0)) * (w.payout_num / w.payout_denom),
          0
        ), 2) as settlement_component,
        round(
          coalesce(f.cash_usd, 0) - coalesce(f.fees_usd, 0) + coalesce(
            sumIf(p.net_shares, p.outcome_idx = w.win_idx + coalesce(co.offset_delta, 0)) * (w.payout_num / w.payout_denom),
            0
          ),
          2
        ) as realized_pnl_usd
      FROM shadow_v1_fixed.flows_by_condition f
      INNER JOIN shadow_v1_fixed.winners w ON f.condition_id_norm = w.condition_id_norm
      INNER JOIN shadow_v1_fixed.pos_by_condition p ON f.wallet = p.wallet AND f.condition_id_norm = p.condition_id_norm
      LEFT JOIN shadow_v1_fixed.condition_offset co ON f.condition_id_norm = co.condition_id_norm
      GROUP BY f.wallet, f.condition_id_norm, f.cash_usd, f.fees_usd, w.payout_num, w.payout_denom, w.win_idx, co.offset_delta
    ` })
    console.log('✅ View created')

    // STEP 7: Wallet-level aggregation
    console.log('\n[7/8] Creating wallet_realized_breakout...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_fixed.wallet_realized_breakout AS
      SELECT
        f.wallet,
        round(sum(if(f.cash_usd - f.fees_usd > 0, f.cash_usd - f.fees_usd, 0)), 2) as cash_gains,
        round(sum(if(f.cash_usd - f.fees_usd < 0, f.cash_usd - f.fees_usd, 0)), 2) as cash_losses,
        round(sum(f.cash_usd - f.fees_usd), 2) as cash_net,
        uniqExact(f.condition_id_norm) as condition_count
      FROM shadow_v1_fixed.flows_by_condition f
      GROUP BY f.wallet
    ` })
    console.log('✅ View created')

    // STEP 8: Final validation
    console.log('\n[8/8] Running validation queries...')

    console.log('\n' + '='.repeat(100))
    console.log('VALIDATION: 4 Test Wallets vs Polymarket UI')
    console.log('='.repeat(100))

    const results = await (await clickhouse.query({
      query: `
        SELECT
          wallet,
          cash_gains,
          cash_losses,
          cash_net,
          condition_count
        FROM shadow_v1_fixed.wallet_realized_breakout
        WHERE wallet IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    let passCount = 0
    const summary: any[] = []

    for (const wallet of TEST_WALLETS) {
      const dbRow = results.find(r => r.wallet === wallet.address.toLowerCase())
      const pnl = dbRow ? parseFloat(dbRow.cash_net) : 0
      const variance = wallet.ui_pnl !== 0 ? ((pnl - wallet.ui_pnl) / wallet.ui_pnl) * 100 : 0
      const pass = Math.abs(variance) <= 2

      console.log(`\n${wallet.address}`)
      console.log(`  UI Value:      $${wallet.ui_pnl.toLocaleString('en-US', {maximumFractionDigits: 2})}`)
      console.log(`  Calculated:    $${pnl.toLocaleString('en-US', {maximumFractionDigits: 2})}`)
      console.log(`  Variance:      ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%`)
      console.log(`  Status:        ${pass ? '✅ PASS' : '❌ FAIL'}`)
      if (dbRow) {
        console.log(`  Gains/Losses:  $${dbRow.cash_gains} / $${dbRow.cash_losses}`)
        console.log(`  Conditions:    ${dbRow.condition_count}`)
      }

      summary.push({
        wallet: wallet.address.substring(0, 10) + '...',
        ui_pnl: wallet.ui_pnl,
        calculated_pnl: pnl,
        variance_pct: variance.toFixed(2),
        status: pass ? 'PASS' : 'FAIL'
      })

      if (pass) passCount++
    }

    console.log('\n' + '='.repeat(100))
    console.log('RESULT SUMMARY')
    console.log('='.repeat(100))
    console.log(`\nPassed: ${passCount}/4 wallets\n`)
    console.log(summary.map(s =>
      `${s.wallet} | UI: $${s.ui_pnl} | Calc: $${s.calculated_pnl.toLocaleString('en-US', {maximumFractionDigits: 2})} | Var: ${s.variance_pct}% | ${s.status}`
    ).join('\n'))

    if (passCount === 4) {
      console.log('\n✅ GROUND TRUTH FORMULA VALIDATED - Ready for production!')
    } else {
      console.log(`\n⚠️ ${4 - passCount} wallets still not matching. Investigating further...`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
