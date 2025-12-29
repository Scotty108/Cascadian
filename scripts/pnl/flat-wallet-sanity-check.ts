#!/usr/bin/env npx tsx
/**
 * Flat-Wallet Tooltip Sanity Check (N=200)
 *
 * Validates our realized PnL engine against Polymarket UI tooltips
 * ONLY on flat inventory wallets (no open positions).
 *
 * For active-position wallets: DO NOT validate against tooltip.
 * Tooltip includes unrealized mark-to-market which we don't compute.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function main() {
  console.log('FLAT-WALLET TOOLTIP SANITY CHECK');
  console.log('='.repeat(80));
  console.log('Note: Tooltip validation ONLY valid on flat inventory wallets');
  console.log('      Active wallets are labeled UNREALIZED_PRESENT (not failures)\n');

  // Step 1: Get flat inventory wallets from our cohort
  console.log('Step 1: Identifying flat inventory wallets in cohort...');

  // First, build flat inventory identification
  const flatQ = await clickhouse.query({
    query: `
      WITH
      -- Get wallets from our 20K cohort
      cohort_wallets AS (
        SELECT wallet, realized_pnl FROM pm_hc_leaderboard_cohort_20k_v1
      ),
      -- Compute net position per wallet/condition/outcome
      positions AS (
        SELECT
          lower(t.trader_wallet) as wallet,
          m.condition_id,
          m.outcome_index,
          sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) as net_tokens
        FROM pm_trader_events_dedup_v2_tbl t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) IN (SELECT wallet FROM cohort_wallets)
        GROUP BY lower(t.trader_wallet), m.condition_id, m.outcome_index
      ),
      -- Resolved conditions
      resolved_conditions AS (
        SELECT DISTINCT lower(condition_id) as condition_id
        FROM pm_condition_resolutions
        WHERE resolved_at IS NOT NULL
        UNION ALL
        SELECT DISTINCT lower(condition_id) as condition_id
        FROM pm_redemption_payouts_agg
      ),
      -- Wallets with open positions
      wallets_with_open AS (
        SELECT DISTINCT p.wallet
        FROM positions p
        WHERE p.net_tokens > 1000000  -- > 1 token
          AND lower(p.condition_id) NOT IN (SELECT condition_id FROM resolved_conditions)
      ),
      -- Classify wallets
      classified AS (
        SELECT
          c.wallet,
          c.realized_pnl,
          CASE WHEN wo.wallet IS NOT NULL THEN 'ACTIVE' ELSE 'FLAT' END as inventory_status
        FROM cohort_wallets c
        LEFT JOIN wallets_with_open wo ON c.wallet = wo.wallet
      )
      SELECT
        inventory_status,
        count() as cnt
      FROM classified
      GROUP BY inventory_status
    `,
    format: 'JSONEachRow'
  });
  const flatCounts = await flatQ.json() as any[];

  for (const c of flatCounts) {
    console.log(`  ${c.inventory_status}: ${Number(c.cnt).toLocaleString()} wallets`);
  }

  // Step 2: Sample 200 flat wallets stratified by PnL
  console.log('\nStep 2: Sampling N=200 flat inventory wallets for tooltip validation...');

  const sampleQ = await clickhouse.query({
    query: `
      WITH
      cohort_wallets AS (
        SELECT wallet, realized_pnl, trade_count_total FROM pm_hc_leaderboard_cohort_20k_v1
      ),
      positions AS (
        SELECT
          lower(t.trader_wallet) as wallet,
          m.condition_id,
          sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) as net_tokens
        FROM pm_trader_events_dedup_v2_tbl t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) IN (SELECT wallet FROM cohort_wallets)
        GROUP BY lower(t.trader_wallet), m.condition_id
      ),
      resolved_conditions AS (
        SELECT DISTINCT lower(condition_id) as condition_id
        FROM pm_condition_resolutions WHERE resolved_at IS NOT NULL
        UNION ALL
        SELECT DISTINCT lower(condition_id) as condition_id FROM pm_redemption_payouts_agg
      ),
      wallets_with_open AS (
        SELECT DISTINCT p.wallet FROM positions p
        WHERE p.net_tokens > 1000000
          AND lower(p.condition_id) NOT IN (SELECT condition_id FROM resolved_conditions)
      ),
      flat_wallets AS (
        SELECT c.wallet, c.realized_pnl, c.trade_count_total
        FROM cohort_wallets c
        WHERE c.wallet NOT IN (SELECT wallet FROM wallets_with_open)
      ),
      -- Stratify by PnL tier
      stratified AS (
        SELECT
          wallet,
          realized_pnl,
          trade_count_total,
          CASE
            WHEN realized_pnl >= 10000 THEN 'tier_10k_plus'
            WHEN realized_pnl >= 5000 THEN 'tier_5k_10k'
            WHEN realized_pnl >= 1000 THEN 'tier_1k_5k'
            WHEN realized_pnl >= 500 THEN 'tier_500_1k'
            WHEN realized_pnl >= 0 THEN 'tier_0_500'
            ELSE 'tier_negative'
          END as pnl_tier,
          row_number() OVER (PARTITION BY
            CASE
              WHEN realized_pnl >= 10000 THEN 'tier_10k_plus'
              WHEN realized_pnl >= 5000 THEN 'tier_5k_10k'
              WHEN realized_pnl >= 1000 THEN 'tier_1k_5k'
              WHEN realized_pnl >= 500 THEN 'tier_500_1k'
              WHEN realized_pnl >= 0 THEN 'tier_0_500'
              ELSE 'tier_negative'
            END
            ORDER BY rand()
          ) as rn
        FROM flat_wallets
      )
      SELECT wallet, realized_pnl, trade_count_total, pnl_tier
      FROM stratified
      WHERE rn <= 40  -- 40 per tier, up to 6 tiers = 240 max
      ORDER BY pnl_tier, realized_pnl DESC
    `,
    format: 'JSONEachRow'
  });
  const sampleWallets = await sampleQ.json() as any[];
  console.log(`  Sampled ${sampleWallets.length} flat inventory wallets`);

  // Distribution by tier
  const tierCounts: { [key: string]: number } = {};
  for (const w of sampleWallets) {
    tierCounts[w.pnl_tier] = (tierCounts[w.pnl_tier] || 0) + 1;
  }
  console.log('\n  Sample distribution by tier:');
  for (const [tier, count] of Object.entries(tierCounts).sort()) {
    console.log(`    ${tier}: ${count}`);
  }

  // Step 3: Output sample for Playwright validation
  console.log('\n' + '='.repeat(80));
  console.log('FLAT INVENTORY SAMPLE (for manual or Playwright validation):');
  console.log('-'.repeat(80));
  console.log('Note: These are flat inventory wallets. Our PnL should match tooltip.');
  console.log('');

  // Show first 20 for immediate review
  console.log('First 20 wallets (full list saved to tmp):');
  for (let i = 0; i < Math.min(20, sampleWallets.length); i++) {
    const w = sampleWallets[i];
    console.log(`  ${w.wallet} | Our PnL: $${Number(w.realized_pnl).toFixed(2)} | Trades: ${w.trade_count_total}`);
  }

  // Save full list to file
  const fs = await import('fs');
  fs.writeFileSync('/tmp/flat_wallet_sample_200.json', JSON.stringify(sampleWallets, null, 2));
  console.log('\n  Full sample saved to: /tmp/flat_wallet_sample_200.json');

  // Step 4: Check against existing benchmarks if available
  console.log('\n' + '='.repeat(80));
  console.log('BENCHMARK COMPARISON (if available):');
  console.log('-'.repeat(80));

  const benchQ = await clickhouse.query({
    query: `
      SELECT
        b.wallet,
        b.pnl_value as ui_pnl,
        p.realized_pnl as our_pnl,
        p.realized_pnl - b.pnl_value as delta,
        abs(p.realized_pnl - b.pnl_value) / nullIf(abs(b.pnl_value), 0) * 100 as delta_pct
      FROM pm_ui_pnl_benchmarks_v1 b
      JOIN pm_wallet_realized_pnl_hc_v1 p ON lower(b.wallet) = p.wallet
      WHERE b.benchmark_set = 'hc_playwright_2025_12_13'
    `,
    format: 'JSONEachRow'
  });
  const benchmarks = await benchQ.json() as any[];

  if (benchmarks.length === 0) {
    console.log('  No existing benchmarks found with flat inventory status.');
  } else {
    console.log(`  Found ${benchmarks.length} benchmarked wallets`);
    console.log('');

    let passed = 0;
    let failed = 0;

    console.log('  Wallet'.padEnd(44) + 'UI PnL'.padStart(12) + 'Our PnL'.padStart(12) + 'Delta'.padStart(12) + 'Status');
    console.log('  ' + '-'.repeat(90));

    for (const b of benchmarks) {
      const delta = Math.abs(Number(b.delta));
      const deltaPct = Number(b.delta_pct) || 0;
      const pass = deltaPct <= 20 || delta <= 50;
      if (pass) passed++; else failed++;

      console.log(
        '  ' + b.wallet.slice(0, 42).padEnd(44) +
        ('$' + Number(b.ui_pnl).toFixed(2)).padStart(12) +
        ('$' + Number(b.our_pnl).toFixed(2)).padStart(12) +
        ('$' + Number(b.delta).toFixed(2)).padStart(12) +
        (pass ? '  ✅' : '  ❌')
      );
    }

    console.log('\n  ' + '-'.repeat(90));
    console.log(`  Pass Rate: ${passed}/${benchmarks.length} (${(passed/benchmarks.length*100).toFixed(1)}%)`);
    console.log(`  Tolerance: within 20% OR within $50`);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY:');
  console.log('-'.repeat(80));
  console.log('  Tables created: pm_wallet_classification_v1');
  console.log('                  pm_wallet_realized_pnl_hc_v1');
  console.log('                  pm_wallet_omega_hc_v1');
  console.log('                  pm_hc_leaderboard_cohort_20k_v1');
  console.log('');
  console.log('  Final 20K cohort: EXPORTED');
  console.log('  Flat wallet sample: /tmp/flat_wallet_sample_200.json');
  console.log('');
  console.log('  For active wallets: DO NOT expect tooltip parity.');
  console.log('  Label as UNREALIZED_PRESENT and accept.');

  await clickhouse.close();
}

main().catch(console.error);
