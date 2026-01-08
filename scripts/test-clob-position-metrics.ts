#!/usr/bin/env npx tsx
/**
 * Test CLOB Position Metrics on all wallet types:
 * - Maker-heavy (high taker_sell_ratio > 1.0)
 * - Taker-heavy (low taker_sell_ratio < 0.5)
 * - Mixed (ratio near 1.0)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeClobPositionMetrics, formatMetricsSummary } from '../lib/pnl/clobPositionMetrics';
import { computeCCRv6 } from '../lib/pnl/ccrEngineV6';

// Test wallets - categorized by their taker_sell_ratio from CCR-v6
const TEST_WALLETS = [
  {
    name: 'Maker-Heavy (Split-Heavy)',
    address: '0xb2e4567925b79231265adf5d54687ddfb761bc51',
    ui_pnl: -115409.28,
    expected_type: 'maker-heavy',
    description: 'Market maker with heavy CLOB activity',
  },
  {
    name: 'Taker-Heavy',
    address: '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec',
    ui_pnl: -26049.95,
    expected_type: 'taker-heavy',
    description: 'Single position from proxy split (limited CLOB data)',
  },
  {
    name: 'Mixed Wallet',
    address: '0x8c2758e05c97a0e9beec9788d2ba59e7f2b1b38d',
    ui_pnl: -34, // From benchmark search
    expected_type: 'mixed',
    description: 'Ratio ~1.0, neither maker-only nor all-trades works well',
  },
];

async function main() {
  console.log('='.repeat(80));
  console.log('CLOB Position Metrics - All Wallet Types');
  console.log('='.repeat(80));
  console.log('');
  console.log('This test validates per-position metrics calculation for:');
  console.log('  1. Maker-heavy wallets (market makers)');
  console.log('  2. Taker-heavy wallets (regular traders)');
  console.log('  3. Mixed wallets (balanced maker/taker activity)');
  console.log('');

  for (const wallet of TEST_WALLETS) {
    console.log('-'.repeat(80));
    console.log(`\n${wallet.name}`);
    console.log(`Address: ${wallet.address}`);
    console.log(`Description: ${wallet.description}`);
    console.log(`UI PnL benchmark: $${wallet.ui_pnl.toLocaleString()}`);
    console.log('');

    try {
      // First get the V6 classification
      const v6Result = await computeCCRv6(wallet.address);
      console.log(`CCR-v6 Classification:`);
      console.log(`  Taker sell ratio: ${v6Result.taker_sell_ratio.toFixed(3)}`);
      console.log(`  Method selected: ${v6Result.method}`);
      console.log(`  V6 PnL: $${v6Result.total_pnl.toLocaleString()}`);
      console.log(`  V6 Error: ${Math.abs(v6Result.total_pnl - wallet.ui_pnl) / Math.abs(wallet.ui_pnl) * 100}%`);
      console.log('');

      // Now run position-based metrics
      console.log('Position-Based Metrics:');
      console.log('-'.repeat(40));

      const result = await computeClobPositionMetrics(wallet.address);
      const m = result.metrics;

      console.log(`\n  POSITIONS`);
      console.log(`  Total:     ${m.total_positions}`);
      console.log(`  Resolved:  ${m.resolved_positions}`);
      console.log(`  Open:      ${m.open_positions}`);

      console.log(`\n  WIN/LOSS`);
      console.log(`  Wins:      ${m.wins}`);
      console.log(`  Losses:    ${m.losses}`);
      console.log(`  Breakeven: ${m.breakeven}`);
      console.log(`  Win Rate:  ${(m.win_rate * 100).toFixed(1)}%`);

      console.log(`\n  PNL`);
      console.log(`  Total:     $${m.total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Realized:  $${m.realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Unrealized: $${m.unrealized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

      console.log(`\n  RISK METRICS`);
      console.log(`  Avg Win:   $${m.avg_win.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Avg Loss:  $${m.avg_loss.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Payoff:    ${m.payoff_ratio.toFixed(2)}`);
      console.log(`  Expectancy: $${m.expectancy.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

      console.log(`\n  CAPITAL`);
      console.log(`  Cost:      $${m.total_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Proceeds:  $${m.total_proceeds.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  ROI:       ${m.roi_percent.toFixed(1)}%`);

      console.log(`\n  EXTREMES`);
      console.log(`  Largest Win:  $${m.largest_win.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Largest Loss: $${m.largest_loss.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

      if (m.missing_token_map_count > 0 || m.missing_resolution_count > 0) {
        console.log(`\n  DATA QUALITY`);
        if (m.missing_token_map_count > 0) {
          console.log(`  Missing token map: ${m.missing_token_map_count}`);
        }
        if (m.missing_resolution_count > 0) {
          console.log(`  Missing resolution: ${m.missing_resolution_count}`);
        }
      }

      // Compare to UI PnL
      const pnlError = wallet.ui_pnl !== 0
        ? Math.abs(m.total_pnl - wallet.ui_pnl) / Math.abs(wallet.ui_pnl) * 100
        : Math.abs(m.total_pnl);

      console.log(`\n  COMPARISON TO UI`);
      console.log(`  Position-based PnL: $${m.total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  UI PnL:            $${wallet.ui_pnl.toLocaleString()}`);
      console.log(`  Error:             ${pnlError.toFixed(1)}%`);

      // Show sample positions
      console.log(`\n  SAMPLE POSITIONS (top 5 by cost):`);
      let shown = 0;
      for (const p of result.positions.slice(0, 5)) {
        const status = p.result.toUpperCase().padEnd(4);
        const roi = p.roi_percent.toFixed(0).padStart(5);
        console.log(`    ${status} | cost=$${p.cost_usd.toFixed(0).padStart(7)} | pnl=$${p.pnl.toFixed(0).padStart(8)} | roi=${roi}%`);
        shown++;
      }

    } catch (error) {
      console.log(`  ERROR: ${error}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('Position-based metrics provide:');
  console.log('  ✓ Win rate, wins, losses');
  console.log('  ✓ Avg win/loss, payoff ratio, expectancy');
  console.log('  ✓ ROI, total cost, total proceeds');
  console.log('  ✓ Per-position breakdown');
  console.log('');
  console.log('Limitations:');
  console.log('  - Only counts CLOB trades (misses proxy splits)');
  console.log('  - Requires token → condition mapping');
  console.log('  - Requires resolution data for win/loss determination');
  console.log('');

  process.exit(0);
}

main().catch(console.error);
