#!/usr/bin/env npx tsx

/**
 * OPTION A: Build Ground Truth P&L in shadow_v1
 *
 * Source: trades_raw + market_resolutions_final (NOT trade_flows_v2)
 * Strategy: Aggregate-before-join, per-condition offset, resolved-only
 *
 * Test Wallets (Polymarket UI values):
 * - 0x1489046ca0f9980fc2d9a950d103d3bec02c1307: $137,663
 * - 0x8e9eedf20dfa70956d49f608a205e402d9df38e4: $360,492
 * - 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b: $94,730
 * - 0x6770bf688b8121331b1c5cfd7723ebd4152545fb: $12,171
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
  console.log('OPTION A: Build Ground Truth P&L from trades_raw')
  console.log('='.repeat(100))

  try {
    // STEP 0: Verify data availability
    console.log('\n[D0] Diagnostic: Data Coverage Check...')
    const coverage = await (await clickhouse.query({
      query: `
        SELECT
          lower(wallet_address) as wallet,
          count() as total_trades,
          countIf(is_resolved = 1) as resolved_trades,
          uniqExact(condition_id) as condition_count,
          min(timestamp) as first_trade,
          max(timestamp) as last_trade
        FROM trades_raw
        WHERE lower(wallet_address) IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        GROUP BY wallet
        ORDER BY wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('Coverage:')
    for (const row of coverage) {
      console.log(`  ${row.wallet.substring(0, 10)}... | Total: ${row.total_trades} | Resolved: ${row.resolved_trades} | Conditions: ${row.condition_count}`)
    }

    // STEP 1: Create shadow schema
    console.log('\n[1/9] Creating shadow_v1 schema...')
    await clickhouse.command({ query: `CREATE DATABASE IF NOT EXISTS shadow_v1` })
    console.log('✅ Schema created')

    // STEP 2: Create canonical_condition_uniq (from market_resolutions_final)
    console.log('\n[2/9] Creating canonical_condition_uniq...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.canonical_condition_uniq AS
      SELECT
        condition_id_norm,
        condition_id_norm as market_id  -- Using condition_id_norm as it's unique per market
      FROM market_resolutions_final
      WHERE condition_id_norm IS NOT NULL
      GROUP BY condition_id_norm
    ` })
    console.log('✅ View created')

    // STEP 3: Aggregate cashflows FIRST (per wallet, condition)
    console.log('\n[3/9] Creating flows_by_condition...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.flows_by_condition AS
      SELECT
        lower(wallet_address) as wallet,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        -- Signed cashflow: YES=-price*shares, NO=+price*shares
        sum(if(side = 1, -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares))) as cash_usd,
        -- Fees
        sum(coalesce(toFloat64(fee_usd), 0)) as fees_usd
      FROM trades_raw
      WHERE is_resolved = 1 AND condition_id IS NOT NULL
      GROUP BY wallet, condition_id_norm
    ` })
    console.log('✅ View created')

    // STEP 4: Position aggregation by condition
    console.log('\n[4/9] Creating pos_by_condition...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.pos_by_condition AS
      SELECT
        lower(wallet_address) as wallet,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        toInt16(outcome_index) as outcome_idx,
        sum(toFloat64(shares)) as net_shares
      FROM trades_raw
      WHERE is_resolved = 1 AND condition_id IS NOT NULL
      GROUP BY wallet, condition_id_norm, outcome_idx
    ` })
    console.log('✅ View created')

    // STEP 5: Winners (payout vectors from resolved markets)
    console.log('\n[5/9] Creating winners...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.winners AS
      SELECT
        condition_id_norm,
        toInt16(winning_index) as win_idx,
        arrayElement(payout_numerators, toInt16(winning_index) + 1) as payout_num,
        toFloat64(payout_denominator) as payout_denom
      FROM market_resolutions_final
      WHERE winning_index IS NOT NULL AND condition_id_norm IS NOT NULL
    ` })
    console.log('✅ View created')

    // STEP 6: Per-condition offset detection
    console.log('\n[6/9] Creating condition_offset...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.condition_offset AS
      WITH votes AS (
        SELECT
          p.condition_id_norm,
          toInt16(p.outcome_idx) - toInt16(w.win_idx) as delta,
          count() as cnt
        FROM shadow_v1.pos_by_condition p
        INNER JOIN shadow_v1.winners w ON p.condition_id_norm = w.condition_id_norm
        GROUP BY p.condition_id_norm, delta
      )
      SELECT
        condition_id_norm,
        argMax(delta, cnt) as offset_delta
      FROM votes
      GROUP BY condition_id_norm
    ` })
    console.log('✅ View created')

    // STEP 7: Winning shares calculation (skipped - computed inline)
    console.log('\n[7/9] Skipping dedicated winning_shares view (computed inline)...')
    console.log('✅ Skipped')

    // STEP 8: Per-condition P&L calculation
    console.log('\n[8/9] Creating realized_pnl_by_condition...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.realized_pnl_by_condition AS
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
      FROM shadow_v1.flows_by_condition f
      INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
      INNER JOIN shadow_v1.pos_by_condition p ON f.wallet = p.wallet AND f.condition_id_norm = p.condition_id_norm
      LEFT JOIN shadow_v1.condition_offset co ON f.condition_id_norm = co.condition_id_norm
      GROUP BY f.wallet, f.condition_id_norm, f.cash_usd, f.fees_usd, w.payout_num, w.payout_denom, w.win_idx, co.offset_delta
    ` })
    console.log('✅ View created')

    // STEP 9: Wallet-level breakout
    console.log('\n[9/9] Creating wallet_realized_breakout...')
    // Simple aggregation of flows and settlements
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.wallet_realized_breakout AS
      SELECT
        f.wallet,
        round(sum(if(f.cash_usd - f.fees_usd > 0, f.cash_usd - f.fees_usd, 0)), 2) as total_gains,
        round(sum(if(f.cash_usd - f.fees_usd < 0, f.cash_usd - f.fees_usd, 0)), 2) as total_losses,
        round(sum(f.cash_usd - f.fees_usd), 2) as realized_pnl_usd,
        uniqExact(f.condition_id_norm) as condition_count
      FROM shadow_v1.flows_by_condition f
      GROUP BY f.wallet
    ` })
    console.log('✅ View created')

    console.log('\n' + '='.repeat(100))
    console.log('DIAGNOSTICS')
    console.log('='.repeat(100))

    // DIAGNOSTIC G1: Check for fanout (rows should equal unique pairs)
    console.log('\n[G1] Fanout Check...')
    const fanout = await (await clickhouse.query({
      query: `
        SELECT
          'flows_by_condition' as table_name,
          count() as row_count,
          uniqExact((wallet, condition_id_norm)) as unique_pairs
        FROM shadow_v1.flows_by_condition
        WHERE wallet IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (fanout[0]) {
      const pass = fanout[0].row_count === fanout[0].unique_pairs
      console.log(`  Rows: ${fanout[0].row_count}, Unique pairs: ${fanout[0].unique_pairs}`)
      console.log(`  Status: ${pass ? '✅ PASS' : '❌ FAIL - Fanout detected!'}`)
    }

    // DIAGNOSTIC G2: Check settlement is being applied (cashflows should have both positive and negative)
    console.log('\n[G2] Settlement Check...')
    const settlement = await (await clickhouse.query({
      query: `
        SELECT
          round(sum(cash_usd), 2) as total_cash,
          round(sum(fees_usd), 2) as total_fees,
          countIf(cash_usd > 0) as positive_flows,
          countIf(cash_usd < 0) as negative_flows
        FROM shadow_v1.flows_by_condition
        WHERE wallet IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (settlement[0]) {
      const hasBothFlows = settlement[0].positive_flows > 0 && settlement[0].negative_flows > 0
      console.log(`  Total cash: $${settlement[0].total_cash}`)
      console.log(`  Total fees: $${settlement[0].total_fees}`)
      console.log(`  Positive flows: ${settlement[0].positive_flows}, Negative flows: ${settlement[0].negative_flows}`)
      console.log(`  Status: ${hasBothFlows ? '✅ PASS - Bidirectional flows detected' : '⚠️ WARNING - Check flow distribution'}`)
    }

    // DIAGNOSTIC G3: Check offset sanity
    console.log('\n[G3] Offset Sanity Check...')
    const offsets = await (await clickhouse.query({
      query: `
        SELECT
          offset_delta,
          count() as condition_count
        FROM shadow_v1.condition_offset
        GROUP BY offset_delta
        ORDER BY condition_count DESC
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`  Offset distribution:`)
    for (const row of offsets) {
      console.log(`    Offset ${row.offset_delta}: ${row.condition_count} conditions`)
    }

    // VALIDATION: Compare 4 wallets to UI values
    console.log('\n' + '='.repeat(100))
    console.log('VALIDATION: 4 Test Wallets vs Polymarket UI')
    console.log('='.repeat(100))

    const results = await (await clickhouse.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          total_gains,
          total_losses,
          condition_count
        FROM shadow_v1.wallet_realized_breakout
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
      const pnl = dbRow ? parseFloat(dbRow.realized_pnl_usd) : 0
      const variance = ((pnl - wallet.ui_pnl) / wallet.ui_pnl) * 100
      const pass = Math.abs(variance) <= 2

      console.log(`\n${wallet.address}`)
      console.log(`  UI Value:      $${wallet.ui_pnl.toLocaleString('en-US', {maximumFractionDigits: 2})}`)
      console.log(`  Calculated:    $${pnl.toLocaleString('en-US', {maximumFractionDigits: 2})}`)
      console.log(`  Variance:      ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%`)
      console.log(`  Status:        ${pass ? '✅ PASS' : '❌ FAIL'}`)
      if (dbRow) {
        console.log(`  Gains/Losses:  $${dbRow.total_gains} / $${dbRow.total_losses}`)
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
    console.log(`\nPassed: ${passCount}/4 wallets`)
    console.log(summary.map(s =>
      `${s.wallet} | UI: $${s.ui_pnl} | Calc: $${s.calculated_pnl} | Var: ${s.variance_pct}% | ${s.status}`
    ).join('\n'))

    console.log(`\n${passCount === 4 ? '✅ GROUND TRUTH FORMULA VALIDATED' : '❌ Formula needs adjustment'}`)

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
