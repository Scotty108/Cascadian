/**
 * Sanity Check for pm_wallet_pnl_ui_activity_v1
 *
 * Tests the V3 Activity PnL engine against known benchmark wallets.
 * Compares all 4 metrics: PnL, volume, gain, loss.
 *
 * Usage: npx tsx scripts/pnl/sanity-check-ui-activity-v1.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { computeWalletActivityPnlV3Extended } from '../../lib/pnl';
import {
  UI_BENCHMARK_WALLETS,
  UI_BENCHMARK_THRESHOLDS,
  type UIBenchmarkWallet,
} from './ui-benchmark-constants';

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number): string {
  return n.toFixed(1) + '%';
}

function calcErrorPct(computed: number, ui: number): number {
  return (Math.abs(computed - ui) / (Math.abs(ui) + 1e-9)) * 100;
}

async function materializeWallet(wallet: string): Promise<void> {
  const metrics = await computeWalletActivityPnlV3Extended(wallet);

  const query = `
    INSERT INTO pm_wallet_pnl_ui_activity_v1
    (wallet, pnl_activity_total, gain_activity, loss_activity, volume_traded, fills_count, redemptions_count, updated_at)
    VALUES (
      '${metrics.wallet}',
      ${metrics.pnl_activity_total},
      ${metrics.gain_activity},
      ${metrics.loss_activity},
      ${metrics.volume_traded},
      ${metrics.fills_count},
      ${metrics.redemptions_count},
      now()
    )
  `;

  await clickhouse.command({ query });
}

async function optimizeTable(): Promise<void> {
  await clickhouse.command({ query: 'OPTIMIZE TABLE pm_wallet_pnl_ui_activity_v1 FINAL' });
}

async function getFromView(wallet: string): Promise<any> {
  const query = `
    SELECT *
    FROM vw_wallet_pnl_ui_activity_v1
    WHERE wallet = '${wallet}'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows[0] || null;
}

interface MetricComparison {
  label: string;
  pnl_ui: number;
  pnl_ours: number;
  pnl_err: number;
  vol_ui: number;
  vol_ours: number;
  vol_err: number;
  gain_ui: number;
  gain_ours: number;
  gain_err: number;
  loss_ui: number;
  loss_ours: number;
  loss_err: number;
  fills: number;
  redemptions: number;
  passed: boolean;
}

async function main(): Promise<void> {
  console.log('='.repeat(100));
  console.log('SANITY CHECK: pm_wallet_pnl_ui_activity_v1 - ALL METRICS');
  console.log('='.repeat(100));
  console.log('');
  console.log('Testing V3 Activity PnL engine against 6 benchmark wallets...');
  console.log('Comparing: PnL, Volume, Gain, Loss');
  console.log('');

  // Step 1: Materialize all wallets
  console.log('Step 1: Materializing all benchmark wallets...');
  for (const bm of UI_BENCHMARK_WALLETS) {
    console.log(`  Computing ${bm.label}...`);
    await materializeWallet(bm.wallet);
  }

  console.log('  Optimizing table...');
  await optimizeTable();
  console.log('');

  // Step 2: Validate results
  console.log('Step 2: Validating results...');
  console.log('');

  const comparisons: MetricComparison[] = [];

  for (const bm of UI_BENCHMARK_WALLETS) {
    const fromView = await getFromView(bm.wallet);

    if (!fromView) {
      console.log(`${bm.label}: ERROR - No data in view!`);
      continue;
    }

    const pnl_ours = Number(fromView.pnl_activity_total);
    const vol_ours = Number(fromView.volume_traded);
    const gain_ours = Number(fromView.gain_activity);
    const loss_ours = Number(fromView.loss_activity);

    const pnl_err = calcErrorPct(pnl_ours, bm.profitLoss_all);
    const vol_err = calcErrorPct(vol_ours, bm.volume_all);
    const gain_err = calcErrorPct(gain_ours, bm.gain_all);
    const loss_err = calcErrorPct(loss_ours, bm.loss_all);

    const threshold = UI_BENCHMARK_THRESHOLDS[bm.label] || 100;
    const passed = pnl_err <= threshold;

    comparisons.push({
      label: bm.label,
      pnl_ui: bm.profitLoss_all,
      pnl_ours,
      pnl_err,
      vol_ui: bm.volume_all,
      vol_ours,
      vol_err,
      gain_ui: bm.gain_all,
      gain_ours,
      gain_err,
      loss_ui: bm.loss_all,
      loss_ours,
      loss_err,
      fills: Number(fromView.fills_count),
      redemptions: Number(fromView.redemptions_count),
      passed,
    });

    // Print detailed per-wallet comparison
    console.log(`${bm.label} (${bm.wallet.substring(0, 14)}...)`);
    console.log(
      `  PnL:    UI=${formatNumber(bm.profitLoss_all).padStart(12)}, ours=${formatNumber(pnl_ours).padStart(12)}, err=${formatPct(pnl_err).padStart(8)}`
    );
    console.log(
      `  Vol:    UI=${formatNumber(bm.volume_all).padStart(12)}, ours=${formatNumber(vol_ours).padStart(12)}, err=${formatPct(vol_err).padStart(8)}`
    );
    console.log(
      `  Gain:   UI=${formatNumber(bm.gain_all).padStart(12)}, ours=${formatNumber(gain_ours).padStart(12)}, err=${formatPct(gain_err).padStart(8)}`
    );
    console.log(
      `  Loss:   UI=${formatNumber(bm.loss_all).padStart(12)}, ours=${formatNumber(loss_ours).padStart(12)}, err=${formatPct(loss_err).padStart(8)}`
    );
    console.log(`  Fills: ${fromView.fills_count}, Redemptions: ${fromView.redemptions_count}`);
    console.log(`  Status: ${passed ? 'PASS' : 'FAIL'} (threshold: ${formatPct(threshold)})`);
    console.log('');
  }

  // Step 3: Summary tables
  console.log('='.repeat(100));
  console.log('SUMMARY TABLES');
  console.log('='.repeat(100));
  console.log('');

  // PnL comparison table
  console.log('PnL Comparison:');
  console.log('| Wallet | UI PnL | Our PnL | Error % | Status |');
  console.log('|--------|--------|---------|---------|--------|');
  for (const c of comparisons) {
    const status = c.passed ? 'PASS' : 'FAIL';
    console.log(
      `| ${c.label.padEnd(6)} | ${formatNumber(c.pnl_ui).padStart(10)} | ${formatNumber(c.pnl_ours).padStart(11)} | ${formatPct(c.pnl_err).padStart(7)} | ${status.padStart(6)} |`
    );
  }
  console.log('');

  // Volume comparison table
  console.log('Volume Comparison:');
  console.log('| Wallet | UI Volume | Our Volume | Error % | Delta |');
  console.log('|--------|-----------|------------|---------|-------|');
  for (const c of comparisons) {
    const delta = c.vol_ours - c.vol_ui;
    const deltaStr = delta >= 0 ? `+${formatNumber(delta)}` : formatNumber(delta);
    console.log(
      `| ${c.label.padEnd(6)} | ${formatNumber(c.vol_ui).padStart(12)} | ${formatNumber(c.vol_ours).padStart(12)} | ${formatPct(c.vol_err).padStart(7)} | ${deltaStr.padStart(12)} |`
    );
  }
  console.log('');

  // Gain comparison table
  console.log('Gain Comparison:');
  console.log('| Wallet | UI Gain | Our Gain | Error % | Delta |');
  console.log('|--------|---------|----------|---------|-------|');
  for (const c of comparisons) {
    const delta = c.gain_ours - c.gain_ui;
    const deltaStr = delta >= 0 ? `+${formatNumber(delta)}` : formatNumber(delta);
    console.log(
      `| ${c.label.padEnd(6)} | ${formatNumber(c.gain_ui).padStart(11)} | ${formatNumber(c.gain_ours).padStart(11)} | ${formatPct(c.gain_err).padStart(7)} | ${deltaStr.padStart(12)} |`
    );
  }
  console.log('');

  // Loss comparison table
  console.log('Loss Comparison:');
  console.log('| Wallet | UI Loss | Our Loss | Error % | Delta |');
  console.log('|--------|---------|----------|---------|-------|');
  for (const c of comparisons) {
    const delta = c.loss_ours - c.loss_ui;
    const deltaStr = delta >= 0 ? `+${formatNumber(delta)}` : formatNumber(delta);
    console.log(
      `| ${c.label.padEnd(6)} | ${formatNumber(c.loss_ui).padStart(11)} | ${formatNumber(c.loss_ours).padStart(11)} | ${formatPct(c.loss_err).padStart(7)} | ${deltaStr.padStart(12)} |`
    );
  }
  console.log('');

  // Overall summary
  const passCount = comparisons.filter((c) => c.passed).length;
  const failCount = comparisons.length - passCount;

  console.log('='.repeat(100));
  console.log('OVERALL SUMMARY');
  console.log('='.repeat(100));
  console.log(`  Passed: ${passCount}/${comparisons.length}`);
  console.log(`  Failed: ${failCount}/${comparisons.length}`);
  console.log('');

  // Key observations
  console.log('KEY OBSERVATIONS:');
  for (const c of comparisons) {
    const issues: string[] = [];

    if (c.vol_err > 50) issues.push(`volume off by ${formatPct(c.vol_err)}`);
    if (c.gain_err > 50) issues.push(`gain off by ${formatPct(c.gain_err)}`);
    if (c.loss_err > 50) issues.push(`loss off by ${formatPct(c.loss_err)}`);

    if (issues.length > 0) {
      console.log(`  ${c.label}: ${issues.join(', ')}`);
    }
  }
  console.log('');

  if (failCount === 0) {
    console.log('All sanity checks PASSED!');
  } else {
    console.log(`WARNING: ${failCount} sanity checks failed.`);
  }
}

main().catch(console.error);
