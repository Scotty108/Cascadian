/**
 * V3 vs V5 PnL Accuracy Comparison
 *
 * Tests both V3 (CLOB + Redemptions) and V5 (+ Splits/Merges/Transfers)
 * against known UI values to see if V5 improves accuracy.
 */

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';
import { computeWalletActivityPnlV5Debug } from '../../lib/pnl/uiActivityEngineV5';

interface KnownWallet {
  wallet: string;
  ui_pnl: number;
  source: string;
}

// Same test wallets from V3/V4 comparison
const TEST_WALLETS: KnownWallet[] = [
  // V3 EXACT MATCHES
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.0, source: 'exact_v3' },
  { wallet: '0x7da9710476bf0d83239fcc1b306ee592aa563279', ui_pnl: 9.15, source: 'exact_v3' },
  { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', ui_pnl: 4404.92, source: 'exact_v3' },
  { wallet: '0xd748c701ad93cfec32a3420e10f3b08e68612125', ui_pnl: 142856, source: 'exact_v3' },

  // V3 GOOD (<10% error)
  { wallet: '0x7f3c8979d0afa00007bae4747d5347122af05613', ui_pnl: 179243, source: 'good_v3' },
  { wallet: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', ui_pnl: 93181, source: 'good_v3' },
  { wallet: '0x114d7a8e7a1dd2dde555744a432ddcb871454c92', ui_pnl: 733.87, source: 'good_v3' },

  // THEO4 & HIGH ERROR WALLETS - these should improve with splits/merges
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
  v5_pnl: number;
  v3_error: number;
  v5_error: number;
  v3_sign: boolean;
  v5_sign: boolean;
  improved: boolean;
  source: string;
  // V5 extra info
  splits: number;
  merges: number;
  transfers_in: number;
}

async function runComparison() {
  console.log('=== V3 vs V5 PnL ACCURACY COMPARISON ===\n');
  console.log('V3: CLOB + Redemptions + Resolution');
  console.log('V5: V3 + Splits + Merges + ERC1155 Transfers\n');
  console.log('Testing ' + TEST_WALLETS.length + ' wallets...\n');

  console.log(
    '| # | Wallet       | UI PnL    | V3 PnL    | V3 Err  | V5 PnL    | V5 Err  | Better | Splits | Merges | Xfers |'
  );
  console.log(
    '|---|--------------|-----------|-----------|---------|-----------|---------|--------|--------|--------|-------|'
  );

  const results: WalletResult[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const w = TEST_WALLETS[i];
    try {
      const v3 = await computeWalletActivityPnlV3Debug(w.wallet);
      const v5 = await computeWalletActivityPnlV5Debug(w.wallet);

      const v3_error = errorPct(v3.pnl_activity_total, w.ui_pnl);
      const v5_error = errorPct(v5.pnl_activity_total, w.ui_pnl);
      const v3_sign = Math.sign(v3.pnl_activity_total) === Math.sign(w.ui_pnl);
      const v5_sign = Math.sign(v5.pnl_activity_total) === Math.sign(w.ui_pnl);
      const improved = Math.abs(v5_error) < Math.abs(v3_error);

      const result: WalletResult = {
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v3_pnl: v3.pnl_activity_total,
        v5_pnl: v5.pnl_activity_total,
        v3_error,
        v5_error,
        v3_sign,
        v5_sign,
        improved,
        source: w.source,
        splits: v5.splits_count,
        merges: v5.merges_count,
        transfers_in: v5.transfers_in_count,
      };
      results.push(result);

      const better =
        improved ? 'V5 ✓' : Math.abs(v5_error) === Math.abs(v3_error) ? 'SAME' : 'V3';

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
          fmt(v5.pnl_activity_total).padEnd(9) +
          ' | ' +
          (v5_error >= 0 ? '+' : '') +
          v5_error.toFixed(1) +
          '%'.padEnd(3) +
          ' | ' +
          better.padEnd(6) +
          ' | ' +
          String(v5.splits_count).padStart(6) +
          ' | ' +
          String(v5.merges_count).padStart(6) +
          ' | ' +
          String(v5.transfers_in_count).padStart(5) +
          ' |'
      );
    } catch (e: any) {
      console.log(
        '| ' +
          String(i + 1).padStart(2) +
          ' | ' +
          w.wallet.substring(0, 12) +
          ' | ERROR: ' +
          e.message.substring(0, 50)
      );
    }
  }

  // Analysis
  console.log('\n=== ANALYSIS ===\n');

  const v3SignOk = results.filter((r) => r.v3_sign).length;
  const v5SignOk = results.filter((r) => r.v5_sign).length;
  console.log('Sign Accuracy:');
  console.log(
    '  V3: ' + v3SignOk + '/' + results.length + ' (' + ((v3SignOk / results.length) * 100).toFixed(0) + '%)'
  );
  console.log(
    '  V5: ' + v5SignOk + '/' + results.length + ' (' + ((v5SignOk / results.length) * 100).toFixed(0) + '%)'
  );

  const v3AvgErr = results.reduce((s, r) => s + Math.abs(r.v3_error), 0) / results.length;
  const v5AvgErr = results.reduce((s, r) => s + Math.abs(r.v5_error), 0) / results.length;
  console.log('\nMean Absolute Error:');
  console.log('  V3: ' + v3AvgErr.toFixed(1) + '%');
  console.log('  V5: ' + v5AvgErr.toFixed(1) + '%');

  // Median error
  const v3Errors = results.map((r) => Math.abs(r.v3_error)).sort((a, b) => a - b);
  const v5Errors = results.map((r) => Math.abs(r.v5_error)).sort((a, b) => a - b);
  const v3Median = v3Errors[Math.floor(v3Errors.length / 2)];
  const v5Median = v5Errors[Math.floor(v5Errors.length / 2)];
  console.log('\nMedian Absolute Error:');
  console.log('  V3: ' + v3Median.toFixed(1) + '%');
  console.log('  V5: ' + v5Median.toFixed(1) + '%');

  // Count improvements
  const improved = results.filter((r) => r.improved).length;
  const same = results.filter((r) => Math.abs(r.v5_error) === Math.abs(r.v3_error)).length;
  const worse = results.filter(
    (r) => !r.improved && Math.abs(r.v5_error) !== Math.abs(r.v3_error)
  ).length;
  console.log('\nImprovement Count:');
  console.log('  V5 better: ' + improved + ' wallets');
  console.log('  Same: ' + same + ' wallets');
  console.log('  V3 better: ' + worse + ' wallets');

  // Error buckets
  console.log('\nError Distribution:');
  const buckets = [1, 5, 10, 15, 25];
  for (const b of buckets) {
    const v3Count = results.filter((r) => Math.abs(r.v3_error) <= b).length;
    const v5Count = results.filter((r) => Math.abs(r.v5_error) <= b).length;
    console.log(
      '  Within ' + b + '%: V3=' + v3Count + '/' + results.length + ', V5=' + v5Count + '/' + results.length
    );
  }

  // V5 data usage stats
  console.log('\n=== V5 NEW DATA SOURCES ===\n');
  const totalSplits = results.reduce((s, r) => s + r.splits, 0);
  const totalMerges = results.reduce((s, r) => s + r.merges, 0);
  const totalTransfers = results.reduce((s, r) => s + r.transfers_in, 0);
  const walletsWithSplits = results.filter((r) => r.splits > 0).length;
  const walletsWithMerges = results.filter((r) => r.merges > 0).length;
  const walletsWithTransfers = results.filter((r) => r.transfers_in > 0).length;

  console.log('Splits:');
  console.log('  Total events: ' + totalSplits.toLocaleString());
  console.log('  Wallets with splits: ' + walletsWithSplits + '/' + results.length);

  console.log('\nMerges:');
  console.log('  Total events: ' + totalMerges.toLocaleString());
  console.log('  Wallets with merges: ' + walletsWithMerges + '/' + results.length);

  console.log('\nERC1155 Transfers In:');
  console.log('  Total events: ' + totalTransfers.toLocaleString());
  console.log('  Wallets with transfers: ' + walletsWithTransfers + '/' + results.length);

  // Correlation: Do wallets with splits/merges/transfers improve more?
  console.log('\n=== CORRELATION: SPLITS/MERGES → IMPROVEMENT ===\n');
  const walletsWithNewData = results.filter((r) => r.splits > 0 || r.merges > 0 || r.transfers_in > 0);
  const walletsWithoutNewData = results.filter(
    (r) => r.splits === 0 && r.merges === 0 && r.transfers_in === 0
  );

  if (walletsWithNewData.length > 0) {
    const improvedWithNew = walletsWithNewData.filter((r) => r.improved).length;
    console.log(
      'Wallets WITH splits/merges/transfers: ' +
        improvedWithNew +
        '/' +
        walletsWithNewData.length +
        ' improved'
    );

    const avgErrReductionWithNew =
      walletsWithNewData.reduce((s, r) => s + (Math.abs(r.v3_error) - Math.abs(r.v5_error)), 0) /
      walletsWithNewData.length;
    console.log('  Average error reduction: ' + avgErrReductionWithNew.toFixed(1) + ' percentage points');
  }

  if (walletsWithoutNewData.length > 0) {
    const improvedWithoutNew = walletsWithoutNewData.filter((r) => r.improved).length;
    console.log(
      'Wallets WITHOUT splits/merges/transfers: ' +
        improvedWithoutNew +
        '/' +
        walletsWithoutNewData.length +
        ' improved'
    );
  }

  // Summary
  console.log('\n=== SUMMARY ===\n');
  if (v5AvgErr < v3AvgErr) {
    const improvement = ((v3AvgErr - v5AvgErr) / v3AvgErr) * 100;
    console.log('✅ V5 IMPROVES accuracy by ' + improvement.toFixed(0) + '% on average.');
    console.log('   Mean error reduced from ' + v3AvgErr.toFixed(1) + '% to ' + v5AvgErr.toFixed(1) + '%.');
    console.log('   Median error: ' + v3Median.toFixed(1) + '% → ' + v5Median.toFixed(1) + '%');
  } else if (v5AvgErr > v3AvgErr) {
    const regression = ((v5AvgErr - v3AvgErr) / v3AvgErr) * 100;
    console.log('❌ V5 is ' + regression.toFixed(0) + '% WORSE than V3.');
    console.log('   Mean error increased from ' + v3AvgErr.toFixed(1) + '% to ' + v5AvgErr.toFixed(1) + '%.');
  } else {
    console.log('➡️ V5 has SAME accuracy as V3.');
  }

  // Recommendation
  console.log('\n=== RECOMMENDATION ===\n');
  if (v5Median < v3Median && v5SignOk >= v3SignOk) {
    console.log('RECOMMENDATION: Use V5 as the new production engine.');
  } else if (v5Median > v3Median) {
    console.log('RECOMMENDATION: Keep V3, V5 does not improve accuracy.');
  } else {
    console.log('RECOMMENDATION: V5 shows mixed results, investigate further.');
  }
}

runComparison().catch(console.error);
