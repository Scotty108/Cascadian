#!/usr/bin/env npx tsx

/**
 * SHADOW_V1 SCHEMA BUILD & VALIDATION
 *
 * Purpose: Build proven P&L calculation in shadow schema, validate against Polymarket UI
 *
 * Test Wallets (from Polymarket UI):
 * - 0x1489046ca0f9980fc2d9a950d103d3bec02c1307: $137,663 PnL
 * - 0x8e9eedf20dfa70956d49f608a205e402d9df38e4: $360,492 PnL
 * - 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b: $94,730 PnL
 * - 0x6770bf688b8121331b1c5cfd7723ebd4152545fb: $12,171 PnL
 *
 * Strategy: Aggregate-before-join, per-condition offset, resolved-only
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client';

const TEST_WALLETS = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, ui_gains: 145976, ui_losses: 8313 },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, ui_gains: 366546, ui_losses: 6054 },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, ui_gains: 205410, ui_losses: 110680 },
  { address: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, ui_gains: 16715, ui_losses: 4544 },
];

async function execute() {
  console.log('='.repeat(80));
  console.log('SHADOW_V1 SCHEMA BUILD & VALIDATION');
  console.log('='.repeat(80));

  try {
    // Step 1: Create shadow schema
    console.log('\n[1/13] Creating shadow_v1 database...');
    await clickhouse.command({ query: `CREATE DATABASE IF NOT EXISTS shadow_v1` });
    console.log('✅ Schema created');

    // Step 2: Create canonical_condition_uniq (1:1 market→condition map)
    console.log('\n[2/13] Creating canonical_condition_uniq (1:1 market→condition)...');
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.canonical_condition_uniq AS
      SELECT lower(market_id) AS market_id, anyHeavy(condition_id_norm) AS condition_id_norm
      FROM canonical_condition
      GROUP BY market_id
    ` });
    console.log('✅ View created');

    // Step 3: Aggregate cash FIRST per wallet, market
    console.log('\n[3/13] Creating flows_by_market (aggregate first)...');
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.flows_by_market AS
      SELECT lower(wallet) AS wallet, lower(market_id) AS market_id,
             sum(toFloat64(cashflow_usdc)) AS cash_usd
      FROM trade_flows_v2
      GROUP BY wallet, market_id
    ` });
    console.log('✅ View created');

    // Step 4: Map to condition
    console.log('\n[4/13] Creating flows_by_condition...');
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.flows_by_condition AS
      SELECT f.wallet, cc.condition_id_norm, f.cash_usd
      FROM shadow_v1.flows_by_market f
      JOIN shadow_v1.canonical_condition_uniq cc USING (market_id)
    ` });
    console.log('✅ View created');

    // Step 5: Positions at condition grain
    console.log('\n[5/13] Creating pos_by_condition...');
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.pos_by_condition AS
      SELECT lower(wallet) AS wallet, lower(condition_id_norm) AS condition_id_norm,
             toInt16(outcome_idx) AS outcome_idx, sum(toFloat64(net_shares)) AS net_shares
      FROM outcome_positions_v2
      GROUP BY wallet, condition_id_norm, outcome_idx
    ` });
    console.log('✅ View created');

    // Step 6: Winners (resolved conditions only)
    console.log('\n[6/13] Creating winners...');
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.winners AS
      SELECT lower(condition_id_norm) AS condition_id_norm, toInt16(win_idx) AS win_idx
      FROM winning_index WHERE win_idx IS NOT NULL
    ` });
    console.log('✅ View created');

    // Step 7: Per-condition OFFSET detection
    console.log('\n[7/13] Creating condition_offset (per-condition, not global)...');
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.condition_offset AS
      WITH votes AS (
        SELECT p.condition_id_norm AS cid,
               toInt16(p.outcome_idx) - toInt16(w.win_idx) AS delta,
               count() AS cnt
        FROM shadow_v1.pos_by_condition p
        JOIN shadow_v1.winners w USING (condition_id_norm)
        GROUP BY cid, delta
      )
      SELECT cid AS condition_id_norm, CAST(argMax(delta, cnt) AS Int16) AS offset
      FROM votes
      GROUP BY cid
    ` });
    console.log('✅ View created');

    // Step 8: Winning shares with per-condition offset
    console.log('\n[8/13] Creating winning_shares...');
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.winning_shares AS
      SELECT p.wallet, p.condition_id_norm,
             sumIf(p.net_shares, p.outcome_idx = w.win_idx + co.offset) AS win_shares
      FROM shadow_v1.pos_by_condition p
      JOIN shadow_v1.winners w USING (condition_id_norm)
      JOIN shadow_v1.condition_offset co USING (condition_id_norm)
      GROUP BY p.wallet, p.condition_id_norm
    ` });
    console.log('✅ View created');

    // Step 9-10: Wallet realized PnL (direct computation, skipping intermediate views)
    console.log('\n[9/13] Creating wallet_realized_pnl (direct computation)...');
    await clickhouse.command({ query: `
      CREATE OR REPLACE VIEW shadow_v1.realized_pnl_by_condition AS
      SELECT f.wallet, f.condition_id_norm,
             round(sum(f.cash_usd) + sumIf(p.net_shares, p.outcome_idx = w.win_idx + co.offset) * 1.00, 8) AS realized_pnl_usd
      FROM shadow_v1.flows_by_condition f
      INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
      LEFT JOIN shadow_v1.pos_by_condition p ON f.wallet = p.wallet AND f.condition_id_norm = p.condition_id_norm
      LEFT JOIN shadow_v1.condition_offset co ON f.condition_id_norm = co.condition_id_norm
      GROUP BY f.wallet, f.condition_id_norm
    ` });
    console.log('✅ View created');

    // Step 10: Wallet realized PnL
    console.log('\n[10/13] Creating wallet_realized_pnl...');
    await clickhouse.command({ query: `
      CREATE OR REPLACE TABLE shadow_v1.wallet_realized_pnl
      ORDER BY wallet AS
      SELECT f.wallet AS wallet, round(sum(f.cash_usd) + sumIf(p.net_shares, p.outcome_idx = w.win_idx + co.offset) * 1.00, 2) AS realized_pnl_usd,
             uniqExact(f.condition_id_norm) AS condition_count
      FROM shadow_v1.flows_by_condition f
      INNER JOIN shadow_v1.winners w ON f.condition_id_norm = w.condition_id_norm
      LEFT JOIN shadow_v1.pos_by_condition p ON f.wallet = p.wallet AND f.condition_id_norm = p.condition_id_norm
      LEFT JOIN shadow_v1.condition_offset co ON f.condition_id_norm = co.condition_id_norm
      GROUP BY wallet
    ` });
    console.log('✅ View created');

    // Step 11: Fanout measurement
    console.log('\n[11/13] Measuring fanout multiplier...');
    const fanoutResult = await (await clickhouse.query({
      query: `SELECT
        sum(f.cashflow_usdc) AS raw_sum,
        sum(f.cashflow_usdc * cc.cc_rows) AS fanout_sum,
        fanout_sum / nullIf(raw_sum,0) AS implied_multiplier
      FROM trade_flows_v2 f
      ANY LEFT JOIN (
        SELECT lower(market_id) AS market_id, count() AS cc_rows
        FROM canonical_condition
        GROUP BY market_id
      ) cc ON lower(f.market_id) = cc.market_id`,
      format: 'JSONEachRow'
    })).json() as any[];
    const fanout = fanoutResult[0];
    console.log('✅ Fanout Analysis:');
    console.log(`   Raw sum: $${parseFloat(fanout.raw_sum).toFixed(2)}`);
    console.log(`   Fanout sum: $${parseFloat(fanout.fanout_sum).toFixed(2)}`);
    console.log(`   Implied multiplier: ${parseFloat(fanout.implied_multiplier).toFixed(2)}x`);
    if (parseFloat(fanout.implied_multiplier) > 1.5) {
      console.log(`   ⚠️  HIGH FANOUT DETECTED - Investigate trade_cashflows_v3 structure`);
    } else {
      console.log(`   ✅ Fanout within acceptable range`);
    }

    // Step 12: Guardrail checks
    console.log('\n[12/13] Running guardrail checks (G1, G2, G3)...');

    // G1: No fanout at realized grain
    const g1Result = await (await clickhouse.query({
      query: `SELECT count() AS total_rows,
             uniqExact(wallet, condition_id_norm) AS unique_pairs
      FROM shadow_v1.realized_pnl_by_condition`,
      format: 'JSONEachRow'
    })).json() as any[];
    const g1 = g1Result[0];
    const g1Pass = g1.total_rows === g1.unique_pairs;
    console.log(`\n   G1 (No fanout): ${g1Pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`      Total rows: ${g1.total_rows}, Unique pairs: ${g1.unique_pairs}`);

    // G2: Settlement applied
    const g2Result = await (await clickhouse.query({
      query: `SELECT sum(coalesce(win_shares,0)) AS total_win_shares
      FROM shadow_v1.winning_shares`,
      format: 'JSONEachRow'
    })).json() as any[];
    const g2 = g2Result[0];
    const g2Pass = parseFloat(g2.total_win_shares) > 0;
    console.log(`\n   G2 (Settlement applied): ${g2Pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`      Total winning shares: ${parseFloat(g2.total_win_shares).toFixed(0)}`);

    // G3: Offset sanity
    const g3Result = await (await clickhouse.query({
      query: `SELECT count() AS condition_count,
             uniqExact(offset) AS unique_offsets,
             max(offset) AS max_offset,
             min(offset) AS min_offset
      FROM shadow_v1.condition_offset`,
      format: 'JSONEachRow'
    })).json() as any[];
    const g3 = g3Result[0];
    const g3Pass = Math.abs(g3.max_offset) <= 2; // Offsets should be small
    console.log(`\n   G3 (Offset sanity): ${g3Pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`      Conditions: ${g3.condition_count}, Unique offsets: ${g3.unique_offsets}`);
    console.log(`      Offset range: [${g3.min_offset}, ${g3.max_offset}]`);

    // Step 13: Compare 4 test wallets against Polymarket UI
    console.log('\n[13/13] Validating 4 test wallets against Polymarket UI...');
    console.log('\n' + '='.repeat(100));
    console.log('WALLET VALIDATION RESULTS');
    console.log('='.repeat(100));

    const shadowWallets = await (await clickhouse.query({
      query: `SELECT wallet, realized_pnl_usd, condition_count
      FROM shadow_v1.wallet_realized_pnl
      WHERE wallet IN (${TEST_WALLETS.map(w => `'${w.address.toLowerCase()}'`).join(',')})
      ORDER BY wallet`,
      format: 'JSONEachRow'
    })).json() as any[];

    let allPass = true;
    const results = [];

    for (const wallet of TEST_WALLETS) {
      const shadow = shadowWallets.find(w => w.wallet === wallet.address.toLowerCase());
      const shadowPnl = shadow ? parseFloat(shadow.realized_pnl_usd) : 0;
      const variance = ((shadowPnl - wallet.ui_pnl) / wallet.ui_pnl * 100);
      const withinThreshold = Math.abs(variance) <= 2;

      console.log(`\n${wallet.address}`);
      console.log(`  Polymarket UI:     $${wallet.ui_pnl.toLocaleString()}`);
      console.log(`  Shadow Schema:     $${shadowPnl.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
      console.log(`  Variance:          ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%`);
      console.log(`  Status:            ${withinThreshold ? '✅ PASS' : '❌ FAIL'} (threshold: ±2%)`);
      console.log(`  Conditions:        ${shadow?.condition_count || 0}`);

      results.push({
        wallet: wallet.address,
        ui_pnl: wallet.ui_pnl,
        shadow_pnl: shadowPnl,
        variance_pct: variance,
        pass: withinThreshold,
      });

      if (!withinThreshold) {
        allPass = false;
      }
    }

    console.log('\n' + '='.repeat(100));
    console.log('SUMMARY');
    console.log('='.repeat(100));

    const passCount = results.filter(r => r.pass).length;
    console.log(`\nWallet Validation: ${passCount}/4 PASS`);
    console.log(`Guardrails:        ${[g1Pass, g2Pass, g3Pass].filter(x => x).length}/3 PASS`);

    if (allPass && g1Pass && g2Pass && g3Pass) {
      console.log('\n✅ ALL CHECKS PASSED - Ready to proceed with 87→18 consolidation');
      console.log('\nNext steps:');
      console.log('  1. Create final marts based on shadow_v1 schema');
      console.log('  2. Archive old P&L tables');
      console.log('  3. Consolidate staging and base layers');
      console.log('  4. Run full schema validation');
    } else {
      console.log('\n❌ VALIDATION FAILED - Troubleshoot before proceeding');
      console.log('\nFailure analysis:');
      if (!g1Pass) console.log('  • G1 FAIL: Fanout detected in realized_pnl_by_condition');
      if (!g2Pass) console.log('  • G2 FAIL: Settlement not applied (0 winning shares)');
      if (!g3Pass) console.log('  • G3 FAIL: Offset values suspicious, manual review needed');
      results.filter(r => !r.pass).forEach(r => {
        console.log(`  • WALLET FAIL: ${r.wallet} - ${Math.abs(r.variance_pct).toFixed(2)}% variance`);
      });
    }

    console.log('\n' + '='.repeat(100));

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

execute();
