#!/usr/bin/env npx tsx

/**
 * FORMULA FIX: Test two P&L variants (A and B)
 *
 * Variant A: cash negative on buys, positive on sells
 * Variant B: cash positive on buys, negative on sells
 *
 * GPT directive: Test both, pick the one that matches UI within 2%
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, ui_gains: 145976, ui_losses: 8313 },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, ui_gains: 366546, ui_losses: 6054 },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, ui_gains: 205410, ui_losses: 110680 },
  { address: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, ui_gains: 16715, ui_losses: 4544 },
]

async function execute() {
  console.log('='.repeat(100))
  console.log('FORMULA FIX: Variant A vs B Testing')
  console.log('='.repeat(100))

  try {
    // STEP 1: Probe for units and scales
    console.log('\n[STEP 1] Probing price and shares units...')
    const probe = await (await clickhouse.query({
      query: `
        SELECT
          round(min(entry_price), 6) AS min_px,
          round(max(entry_price), 6) AS max_px,
          round(avg(entry_price), 6) AS avg_px,
          min(abs(shares)) AS min_sh,
          max(abs(shares)) AS max_sh,
          round(avg(abs(shares)), 2) AS avg_sh
        FROM trades_raw
        WHERE lower(wallet_address) IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        AND lower(replaceAll(condition_id, '0x', '')) IN (
          SELECT condition_id_norm FROM market_resolutions_final WHERE winning_index IS NOT NULL
        )
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    let px_scale = 1
    let sh_scale = 1

    if (probe[0]) {
      console.log(`Price range: ${probe[0].min_px} to ${probe[0].max_px} (avg: ${probe[0].avg_px})`)
      console.log(`Shares range: ${probe[0].min_sh} to ${probe[0].max_sh} (avg: ${probe[0].avg_sh})`)

      // Determine px_scale
      if (probe[0].max_px > 10000) px_scale = 10000
      else if (probe[0].max_px > 100) px_scale = 100
      else px_scale = 1

      // Determine sh_scale
      if (probe[0].max_sh > 10000) sh_scale = 1
      else sh_scale = 1

      console.log(`Auto-detected: px_scale=${px_scale}, sh_scale=${sh_scale}`)
    }

    // STEP 2: Build canonical condition
    console.log('\n[STEP 2] Creating canonical condition view...')
    await clickhouse.command({ query: `DROP DATABASE IF EXISTS shadow_v1_formula` })
    await clickhouse.command({ query: `CREATE DATABASE shadow_v1_formula` })

    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.canonical_condition AS
      SELECT condition_id_norm
      FROM market_resolutions_final
      WHERE condition_id_norm IS NOT NULL
      GROUP BY condition_id_norm
    ` })
    console.log('✅ Canonical condition view created')

    // STEP 3: Build both cashflow variants
    console.log('\n[STEP 3] Building Variant A (cash negative on buys)...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.flows_by_condition_A AS
      SELECT
        lower(wallet_address) AS wallet,
        lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
        sum(-toFloat64(entry_price) * toFloat64(shares)) AS cash_usd,
        sum(coalesce(toFloat64(fee_usd), 0)) AS fees_usd
      FROM trades_raw
      GROUP BY wallet, condition_id_norm
    ` })
    console.log('✅ Variant A flows created')

    console.log('[STEP 3] Building Variant B (cash positive on buys)...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.flows_by_condition_B AS
      SELECT
        lower(wallet_address) AS wallet,
        lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
        sum(toFloat64(entry_price) * toFloat64(shares)) AS cash_usd,
        sum(coalesce(toFloat64(fee_usd), 0)) AS fees_usd
      FROM trades_raw
      GROUP BY wallet, condition_id_norm
    ` })
    console.log('✅ Variant B flows created')

    // STEP 4: Build positions
    console.log('\n[STEP 4] Building positions and winners...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.pos_by_condition AS
      SELECT
        lower(wallet_address) AS wallet,
        lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
        toInt16(outcome_index) AS outcome_idx,
        sum(toFloat64(shares)) AS net_shares
      FROM trades_raw
      GROUP BY wallet, condition_id_norm, outcome_idx
    ` })

    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.winners AS
      SELECT
        condition_id_norm,
        toInt16(winning_index) AS win_idx,
        arrayElement(payout_numerators, toInt16(winning_index) + 1) AS payout_num,
        toFloat64(payout_denominator) AS payout_denom
      FROM market_resolutions_final
      WHERE winning_index IS NOT NULL
    ` })
    console.log('✅ Positions and winners created')

    // STEP 5: Build offset view
    console.log('[STEP 4] Building offset detection...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.condition_offset AS
      WITH votes AS (
        SELECT
          p.condition_id_norm AS cid,
          toInt16(p.outcome_idx) - toInt16(w.win_idx) AS delta,
          count() AS cnt
        FROM shadow_v1_formula.pos_by_condition p
        JOIN shadow_v1_formula.winners w ON p.condition_id_norm = w.condition_id_norm
        GROUP BY cid, delta
      )
      SELECT cid AS condition_id_norm, CAST(argMax(delta, cnt) AS Int16) AS offset
      FROM votes
      GROUP BY cid
    ` })
    console.log('✅ Offset detection created')

    // STEP 6: Build realized PnL for both variants
    console.log('\n[STEP 5] Building realized P&L for Variant A...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.realized_pnl_by_condition_A AS
      SELECT
        f.wallet,
        f.condition_id_norm,
        round(
          coalesce(f.cash_usd, 0) - coalesce(f.fees_usd, 0)
          + coalesce(
              sumIf(p.net_shares, p.outcome_idx = w.win_idx + coalesce(co.offset, 0))
              * (w.payout_num / w.payout_denom),
              0
            ),
          2
        ) AS realized_pnl_usd
      FROM shadow_v1_formula.flows_by_condition_A f
      JOIN shadow_v1_formula.winners w ON f.condition_id_norm = w.condition_id_norm
      JOIN shadow_v1_formula.pos_by_condition p ON p.wallet = f.wallet AND p.condition_id_norm = f.condition_id_norm
      LEFT JOIN shadow_v1_formula.condition_offset co ON f.condition_id_norm = co.condition_id_norm
      GROUP BY f.wallet, f.condition_id_norm, f.cash_usd, f.fees_usd, w.payout_num, w.payout_denom, w.win_idx, coalesce(co.offset, 0)
    ` })
    console.log('✅ Variant A P&L created')

    console.log('[STEP 5] Building realized P&L for Variant B...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.realized_pnl_by_condition_B AS
      SELECT
        f.wallet,
        f.condition_id_norm,
        round(
          coalesce(f.cash_usd, 0) - coalesce(f.fees_usd, 0)
          + coalesce(
              sumIf(p.net_shares, p.outcome_idx = w.win_idx + coalesce(co.offset, 0))
              * (w.payout_num / w.payout_denom),
              0
            ),
          2
        ) AS realized_pnl_usd
      FROM shadow_v1_formula.flows_by_condition_B f
      JOIN shadow_v1_formula.winners w ON f.condition_id_norm = w.condition_id_norm
      JOIN shadow_v1_formula.pos_by_condition p ON p.wallet = f.wallet AND p.condition_id_norm = f.condition_id_norm
      LEFT JOIN shadow_v1_formula.condition_offset co ON f.condition_id_norm = co.condition_id_norm
      GROUP BY f.wallet, f.condition_id_norm, f.cash_usd, f.fees_usd, w.payout_num, w.payout_denom, w.win_idx, coalesce(co.offset, 0)
    ` })
    console.log('✅ Variant B P&L created')

    // STEP 7: Build wallet-level aggregations
    console.log('\n[STEP 6] Building wallet rollups...')
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.wallet_breakout_A AS
      SELECT
        wallet,
        round(sumIf(realized_pnl_usd, realized_pnl_usd > 0), 2) AS total_gains,
        round(abs(sumIf(realized_pnl_usd, realized_pnl_usd < 0)), 2) AS total_losses,
        round(sum(realized_pnl_usd), 2) AS realized_pnl_usd,
        uniqExact(condition_id_norm) AS resolved_condition_count
      FROM shadow_v1_formula.realized_pnl_by_condition_A
      GROUP BY wallet
    ` })

    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1_formula.wallet_breakout_B AS
      SELECT
        wallet,
        round(sumIf(realized_pnl_usd, realized_pnl_usd > 0), 2) AS total_gains,
        round(abs(sumIf(realized_pnl_usd, realized_pnl_usd < 0)), 2) AS total_losses,
        round(sum(realized_pnl_usd), 2) AS realized_pnl_usd,
        uniqExact(condition_id_norm) AS resolved_condition_count
      FROM shadow_v1_formula.realized_pnl_by_condition_B
      GROUP BY wallet
    ` })
    console.log('✅ Wallet rollups created')

    // STEP 8: Compare both variants
    console.log('\n[STEP 7] Comparing Variant A vs B...')
    const comparison = await (await clickhouse.query({
      query: `
        SELECT 'A' AS variant, wallet, realized_pnl_usd, total_gains, total_losses, resolved_condition_count
        FROM shadow_v1_formula.wallet_breakout_A
        WHERE wallet IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        UNION ALL
        SELECT 'B' AS variant, wallet, realized_pnl_usd, total_gains, total_losses, resolved_condition_count
        FROM shadow_v1_formula.wallet_breakout_B
        WHERE wallet IN (
          '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
          '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
        )
        ORDER BY variant, wallet
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n' + '='.repeat(100))
    console.log('RESULTS: Variant A vs B Comparison')
    console.log('='.repeat(100))

    const resultTable: any[] = []

    for (const variant of ['A', 'B']) {
      console.log(`\n${variant === 'A' ? '━' : '━'} VARIANT ${variant} (cash ${variant === 'A' ? 'negative on buys' : 'positive on buys'})`)
      console.log('━'.repeat(100))

      let variantPassCount = 0

      for (const wallet of TEST_WALLETS) {
        const row = comparison.find(r => r.variant === variant && r.wallet === wallet.address.toLowerCase())
        const pnl = row ? parseFloat(row.realized_pnl_usd) : 0
        const variance = wallet.ui_pnl !== 0 ? ((pnl - wallet.ui_pnl) / wallet.ui_pnl) * 100 : 0
        const pass = Math.abs(variance) <= 2

        console.log(`\n${wallet.address.substring(0, 12)}...`)
        console.log(`  UI P&L:         $${wallet.ui_pnl.toLocaleString('en-US')}`)
        console.log(`  Calculated:     $${pnl.toLocaleString('en-US', {maximumFractionDigits: 2})}`)
        console.log(`  Variance:       ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%`)
        console.log(`  Gains/Losses:   $${row ? row.total_gains.toLocaleString('en-US') : '0'} / $${row ? row.total_losses.toLocaleString('en-US') : '0'}`)
        console.log(`  Conditions:     ${row ? row.resolved_condition_count : 0}`)
        console.log(`  Status:         ${pass ? '✅ PASS' : '❌ FAIL'}`)

        resultTable.push({
          variant,
          wallet: wallet.address.substring(0, 12) + '...',
          ui_pnl: wallet.ui_pnl,
          calculated_pnl: pnl,
          gains: row ? parseFloat(row.total_gains) : 0,
          losses: row ? parseFloat(row.total_losses) : 0,
          variance_pct: variance.toFixed(2),
          status: pass ? 'PASS' : 'FAIL'
        })

        if (pass) variantPassCount++
      }

      console.log(`\n${variant}: ${variantPassCount}/4 wallets passed`)
    }

    console.log('\n' + '='.repeat(100))
    console.log('SUMMARY TABLE')
    console.log('='.repeat(100))
    console.log('\nVariant A vs B Results:')
    console.log(resultTable.map(r =>
      `${r.variant} | ${r.wallet} | UI: $${r.ui_pnl} | Calc: $${r.calculated_pnl.toLocaleString('en-US', {maximumFractionDigits: 2})} | Var: ${r.variance_pct}% | ${r.status}`
    ).join('\n'))

    // Determine winner
    const variantAPass = resultTable.filter(r => r.variant === 'A' && r.status === 'PASS').length
    const variantBPass = resultTable.filter(r => r.variant === 'B' && r.status === 'PASS').length

    console.log('\n' + '='.repeat(100))
    console.log('DECISION')
    console.log('='.repeat(100))

    if (variantAPass >= 3) {
      console.log('\n✅ VARIANT A WINS')
      console.log('Formula: cash_usd = -entry_price × shares (negative on all trades)')
      console.log('Result: At least 3/4 wallets within ±2% of UI values')
      console.log(`Scales: px_scale=${px_scale}, sh_scale=${sh_scale}`)
    } else if (variantBPass >= 3) {
      console.log('\n✅ VARIANT B WINS')
      console.log('Formula: cash_usd = entry_price × shares (positive on all trades)')
      console.log('Result: At least 3/4 wallets within ±2% of UI values')
      console.log(`Scales: px_scale=${px_scale}, sh_scale=${sh_scale}`)
    } else {
      console.log('\n⚠️ BOTH VARIANTS FAILED')
      console.log(`Variant A: ${variantAPass}/4 passed`)
      console.log(`Variant B: ${variantBPass}/4 passed`)
      console.log('Recommendation: Switch to on-chain data validation (ERC1155/ERC20)')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
