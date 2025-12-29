/**
 * V3 vs V4 PnL Accuracy Comparison
 *
 * Tests both V3 (average cost) and V4 (FIFO) engines against known UI values.
 * This helps us understand whether FIFO improves accuracy.
 */

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';
import { computeWalletActivityPnlV4Debug } from '../../lib/pnl/uiActivityEngineV4';

interface KnownWallet {
  wallet: string;
  ui_pnl: number;
  source: string;
}

// Subset of wallets for quick testing - mix of exact matches and high-error from V3
const TEST_WALLETS: KnownWallet[] = [
  // V3 EXACT MATCHES - Should stay exact or improve
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00, source: 'exact_v3' },
  { wallet: '0x7da9710476bf0d83239fcc1b306ee592aa563279', ui_pnl: 9.15, source: 'exact_v3' },
  { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', ui_pnl: 4404.92, source: 'exact_v3' },
  { wallet: '0xd748c701ad93cfec32a3420e10f3b08e68612125', ui_pnl: 142856, source: 'exact_v3' },

  // V3 GOOD (<10% error) - Hoping to improve
  { wallet: '0x7f3c8979d0afa00007bae4747d5347122af05613', ui_pnl: 179243, source: 'good_v3' },
  { wallet: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', ui_pnl: 93181, source: 'good_v3' },
  { wallet: '0x114d7a8e7a1dd2dde555744a432ddcb871454c92', ui_pnl: 733.87, source: 'good_v3' },

  // V3 ACCEPTABLE (10-25% error) - Should improve significantly with FIFO
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', ui_pnl: 22053934, source: 'theo4' },
  { wallet: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, source: 'xcn' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94, source: 'fresh_ui' },

  // Fresh UI wallets
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, source: 'fresh_ui' },
  { wallet: '0xb0adc6b10fad31c5f039dc2bc909cda1e10c29c6', ui_pnl: 124.22, source: 'fresh_ui' },
  { wallet: '0xa7cfafa0db244f760436fcf83c8b1eb98904ba10', ui_pnl: 11969.73, source: 'fresh_ui' },
  { wallet: '0xbb49c8d518f71db91f7a0a61bc8a29d3364355bf', ui_pnl: -3.74, source: 'fresh_ui' },
  { wallet: '0x4eae829a112298efa38f4e66cc5a58787f4a9b12', ui_pnl: 65.63, source: 'fresh_ui' },
];

function fmt(n: number): string {
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function errorPct(actual: number, expected: number): number {
  if (expected === 0) return actual === 0 ? 0 : 100;
  return ((actual - expected) / Math.abs(expected)) * 100;
}

interface WalletResult {
  wallet: string;
  ui_pnl: number;
  v3_pnl: number;
  v4_pnl: number;
  v3_error: number;
  v4_error: number;
  v3_sign: boolean;
  v4_sign: boolean;
  improved: boolean;
  source: string;
}

async function runComparison() {
  console.log('=== V3 vs V4 PnL ACCURACY COMPARISON ===\n');
  console.log('V3: Average cost basis');
  console.log('V4: FIFO (First-In-First-Out) cost basis\n');
  console.log('Testing ' + TEST_WALLETS.length + ' wallets...\n');

  console.log('| # | Wallet       | UI PnL    | V3 PnL    | V3 Err  | V4 PnL    | V4 Err  | Better |');
  console.log('|---|--------------|-----------|-----------|---------|-----------|---------|--------|');

  const results: WalletResult[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const w = TEST_WALLETS[i];
    try {
      const v3 = await computeWalletActivityPnlV3Debug(w.wallet);
      const v4 = await computeWalletActivityPnlV4Debug(w.wallet);

      const v3_error = errorPct(v3.pnl_activity_total, w.ui_pnl);
      const v4_error = errorPct(v4.pnl_activity_total, w.ui_pnl);
      const v3_sign = Math.sign(v3.pnl_activity_total) === Math.sign(w.ui_pnl);
      const v4_sign = Math.sign(v4.pnl_activity_total) === Math.sign(w.ui_pnl);
      const improved = Math.abs(v4_error) < Math.abs(v3_error);

      const result: WalletResult = {
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v3_pnl: v3.pnl_activity_total,
        v4_pnl: v4.pnl_activity_total,
        v3_error,
        v4_error,
        v3_sign,
        v4_sign,
        improved,
        source: w.source,
      };
      results.push(result);

      const better = improved ? 'V4 ✓' : Math.abs(v4_error) === Math.abs(v3_error) ? 'SAME' : 'V3';

      console.log(
        '| ' +
          String(i + 1).padStart(2) +
          ' | ' +
          w.wallet.substring(0, 12) +
          ' | ' +
          fmt(w.ui_pnl).padEnd(9) +
          ' | ' +
          fmt(v3.pnl_activity_total).padEnd(9) +
          ' | ' +
          (v3_error >= 0 ? '+' : '') +
          v3_error.toFixed(1) +
          '%'.padEnd(3) +
          ' | ' +
          fmt(v4.pnl_activity_total).padEnd(9) +
          ' | ' +
          (v4_error >= 0 ? '+' : '') +
          v4_error.toFixed(1) +
          '%'.padEnd(3) +
          ' | ' +
          better.padEnd(6) +
          ' |'
      );
    } catch (e: any) {
      console.log(
        '| ' +
          String(i + 1).padStart(2) +
          ' | ' +
          w.wallet.substring(0, 12) +
          ' | ERROR: ' +
          e.message.substring(0, 40)
      );
    }
  }

  // Analysis
  console.log('\n=== ANALYSIS ===\n');

  const v3SignOk = results.filter((r) => r.v3_sign).length;
  const v4SignOk = results.filter((r) => r.v4_sign).length;
  console.log('Sign Accuracy:');
  console.log('  V3: ' + v3SignOk + '/' + results.length + ' (' + ((v3SignOk / results.length) * 100).toFixed(0) + '%)');
  console.log('  V4: ' + v4SignOk + '/' + results.length + ' (' + ((v4SignOk / results.length) * 100).toFixed(0) + '%)');

  const v3AvgErr = results.reduce((s, r) => s + Math.abs(r.v3_error), 0) / results.length;
  const v4AvgErr = results.reduce((s, r) => s + Math.abs(r.v4_error), 0) / results.length;
  console.log('\nMean Absolute Error:');
  console.log('  V3: ' + v3AvgErr.toFixed(1) + '%');
  console.log('  V4: ' + v4AvgErr.toFixed(1) + '%');

  // Median error
  const v3Errors = results.map((r) => Math.abs(r.v3_error)).sort((a, b) => a - b);
  const v4Errors = results.map((r) => Math.abs(r.v4_error)).sort((a, b) => a - b);
  const v3Median = v3Errors[Math.floor(v3Errors.length / 2)];
  const v4Median = v4Errors[Math.floor(v4Errors.length / 2)];
  console.log('\nMedian Absolute Error:');
  console.log('  V3: ' + v3Median.toFixed(1) + '%');
  console.log('  V4: ' + v4Median.toFixed(1) + '%');

  // Count improvements
  const improved = results.filter((r) => r.improved).length;
  const same = results.filter((r) => Math.abs(r.v4_error) === Math.abs(r.v3_error)).length;
  const worse = results.filter((r) => !r.improved && Math.abs(r.v4_error) !== Math.abs(r.v3_error)).length;
  console.log('\nImprovement Count:');
  console.log('  V4 better: ' + improved + ' wallets');
  console.log('  Same: ' + same + ' wallets');
  console.log('  V3 better: ' + worse + ' wallets');

  // Error buckets
  console.log('\nError Distribution:');
  const buckets = [1, 5, 10, 15, 25];
  for (const b of buckets) {
    const v3Count = results.filter((r) => Math.abs(r.v3_error) <= b).length;
    const v4Count = results.filter((r) => Math.abs(r.v4_error) <= b).length;
    console.log(
      '  Within ' +
        b +
        '%: V3=' +
        v3Count +
        '/' +
        results.length +
        ', V4=' +
        v4Count +
        '/' +
        results.length
    );
  }

  // Exact matches
  const v3Exact = results.filter((r) => Math.abs(r.v3_error) < 1).length;
  const v4Exact = results.filter((r) => Math.abs(r.v4_error) < 1).length;
  console.log('\nExact Matches (<1% error):');
  console.log('  V3: ' + v3Exact + ' wallets');
  console.log('  V4: ' + v4Exact + ' wallets');

  // Biggest improvements
  console.log('\n=== BIGGEST IMPROVEMENTS (V4 vs V3) ===\n');
  const sortedByImprovement = [...results]
    .filter((r) => r.improved)
    .sort((a, b) => Math.abs(a.v3_error) - Math.abs(a.v4_error) - (Math.abs(b.v3_error) - Math.abs(b.v4_error)))
    .reverse()
    .slice(0, 5);

  for (const r of sortedByImprovement) {
    const improvement = Math.abs(r.v3_error) - Math.abs(r.v4_error);
    console.log(
      r.wallet.substring(0, 14) +
        ': V3=' +
        r.v3_error.toFixed(1) +
        '% → V4=' +
        r.v4_error.toFixed(1) +
        '% (improved by ' +
        improvement.toFixed(1) +
        '%)'
    );
  }

  // Biggest regressions (if any)
  const regressions = results.filter(
    (r) => !r.improved && Math.abs(r.v4_error) !== Math.abs(r.v3_error)
  );
  if (regressions.length > 0) {
    console.log('\n=== REGRESSIONS (V4 worse than V3) ===\n');
    for (const r of regressions.slice(0, 5)) {
      const regression = Math.abs(r.v4_error) - Math.abs(r.v3_error);
      console.log(
        r.wallet.substring(0, 14) +
          ': V3=' +
          r.v3_error.toFixed(1) +
          '% → V4=' +
          r.v4_error.toFixed(1) +
          '% (worse by ' +
          regression.toFixed(1) +
          '%)'
      );
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===\n');
  if (v4AvgErr < v3AvgErr) {
    const improvement = ((v3AvgErr - v4AvgErr) / v3AvgErr) * 100;
    console.log('V4 (FIFO) IMPROVES accuracy by ' + improvement.toFixed(0) + '% on average.');
    console.log('Mean error reduced from ' + v3AvgErr.toFixed(1) + '% to ' + v4AvgErr.toFixed(1) + '%.');
  } else if (v4AvgErr > v3AvgErr) {
    const regression = ((v4AvgErr - v3AvgErr) / v3AvgErr) * 100;
    console.log('V4 (FIFO) is ' + regression.toFixed(0) + '% WORSE than V3.');
    console.log('Mean error increased from ' + v3AvgErr.toFixed(1) + '% to ' + v4AvgErr.toFixed(1) + '%.');
  } else {
    console.log('V4 (FIFO) has SAME accuracy as V3.');
  }
}

runComparison().catch(console.error);
