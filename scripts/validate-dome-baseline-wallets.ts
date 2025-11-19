#!/usr/bin/env npx tsx

/**
 * Dome/UI Baseline Wallet Comparison
 *
 * Compares actual wallet P&L from wallet_pnl_summary_final against
 * expected values from Dome UI for 14 benchmark wallets.
 *
 * Pass criteria: <2% variance for each wallet
 *
 * Output: Comparison table with deltas logged to reconciliation report
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

// 14 Baseline wallets with expected realized P&L from Dome UI
// Loaded from tmp/dome-baseline-wallets.json (fetched via Dome API)
import baselineData from '../tmp/dome-baseline-wallets.json' assert { type: 'json' };

// Filter out wallets with 0 P&L (API errors during fetch)
const BASELINE_WALLETS = baselineData.filter((w: any) => w.expected_pnl !== 0);

interface ComparisonResult {
  wallet: string;
  label: string;
  expected_pnl: number;
  actual_pnl: number;
  delta: number;
  variance_pct: number;
  status: 'PASS' | 'FAIL';
}

async function main() {
  console.log('═'.repeat(80));
  console.log('DOME/UI BASELINE WALLET COMPARISON');
  console.log('═'.repeat(80));
  console.log('Comparing wallet_pnl_summary_final vs Dome expected values\n');

  const results: ComparisonResult[] = [];
  let passCount = 0;
  let failCount = 0;

  console.log('Querying wallet P&L for baseline wallets...\n');

  for (const baseline of BASELINE_WALLETS) {
    const walletResult = await clickhouse.query({
      query: `
        SELECT
          wallet,
          total_realized_pnl_usd,
          markets_traded,
          position_count
        FROM wallet_pnl_summary_final
        WHERE lower(wallet) = lower('${baseline.address}')
      `,
      format: 'JSONEachRow'
    });

    const wData = await walletResult.json();

    if (wData.length > 0) {
      const actual_pnl = parseFloat(wData[0].total_realized_pnl_usd);
      const delta = actual_pnl - baseline.expected_pnl;
      const variance_pct = baseline.expected_pnl !== 0
        ? Math.abs(delta / baseline.expected_pnl * 100)
        : (actual_pnl === 0 ? 0 : 100);

      const status = variance_pct < 2.0 ? 'PASS' : 'FAIL';

      if (status === 'PASS') passCount++;
      else failCount++;

      results.push({
        wallet: baseline.address,
        label: baseline.label,
        expected_pnl: baseline.expected_pnl,
        actual_pnl,
        delta,
        variance_pct,
        status
      });

      const statusIcon = status === 'PASS' ? '✅' : '❌';
      console.log(`${statusIcon} ${baseline.address.substring(0, 12)}... (${baseline.label})`);
      console.log(`   Expected P&L:  $${baseline.expected_pnl.toFixed(2)}`);
      console.log(`   Actual P&L:    $${actual_pnl.toFixed(2)}`);
      console.log(`   Delta:         $${delta.toFixed(2)}`);
      console.log(`   Variance:      ${variance_pct.toFixed(2)}%`);
      console.log(`   Status:        ${status}\n`);
    } else {
      console.log(`❌ ${baseline.address.substring(0, 12)}... (${baseline.label})`);
      console.log(`   NOT FOUND in wallet_pnl_summary_final\n`);

      failCount++;
      results.push({
        wallet: baseline.address,
        label: baseline.label,
        expected_pnl: baseline.expected_pnl,
        actual_pnl: 0,
        delta: -baseline.expected_pnl,
        variance_pct: 100,
        status: 'FAIL'
      });
    }
  }

  // Summary table
  console.log('═'.repeat(80));
  console.log('COMPARISON SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total wallets:     ${BASELINE_WALLETS.length}`);
  console.log(`Passed (<2%):      ${passCount}`);
  console.log(`Failed (≥2%):      ${failCount}`);
  console.log(`Success rate:      ${(passCount / BASELINE_WALLETS.length * 100).toFixed(1)}%\n`);

  // Generate markdown table for reconciliation report
  console.log('═'.repeat(80));
  console.log('MARKDOWN TABLE (Copy to FINAL_PNL_RECONCILIATION_REPORT.md)');
  console.log('═'.repeat(80));
  console.log();
  console.log('| Wallet | Label | Expected P&L | Actual P&L | Delta | Variance | Status |');
  console.log('|--------|-------|--------------|------------|-------|----------|--------|');

  results.forEach(r => {
    const wallet = r.wallet.substring(0, 12) + '...';
    const expected = `$${r.expected_pnl.toLocaleString()}`;
    const actual = `$${r.actual_pnl.toLocaleString()}`;
    const delta = `$${r.delta.toLocaleString()}`;
    const variance = `${r.variance_pct.toFixed(2)}%`;
    const status = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';

    console.log(`| ${wallet} | ${r.label} | ${expected} | ${actual} | ${delta} | ${variance} | ${status} |`);
  });

  console.log();
  console.log('═'.repeat(80));

  // Final verdict
  const allPassed = failCount === 0;

  if (allPassed) {
    console.log('✅ ALL BASELINE WALLETS PASSED');
    console.log();
    console.log('P&L calculations match Dome UI within 2% variance.');
    console.log('Ready for production certification.');
  } else {
    console.log('⚠️  SOME BASELINE WALLETS FAILED');
    console.log();
    console.log(`${failCount} wallet(s) exceeded 2% variance threshold.`);
    console.log('Review comparison table above for details.');
    console.log();
    console.log('Action required:');
    console.log('1. Verify expected Dome P&L values are correct');
    console.log('2. Investigate calculation differences for failed wallets');
    console.log('3. Re-run validation after fixes');
  }
  console.log('═'.repeat(80));
}

main().catch(console.error);
