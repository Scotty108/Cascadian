/**
 * Comprehensive V3 vs V4 PnL Accuracy Validation
 *
 * Tests BOTH V3 (average cost) and V4 (FIFO) engines against ALL known wallet PnL values.
 * This provides a complete picture of whether FIFO improves accuracy.
 */

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';
import { computeWalletActivityPnlV4Debug } from '../../lib/pnl/uiActivityEngineV4';

interface KnownWallet {
  wallet: string;
  ui_pnl: number;
  source: string;
}

// All known wallets with UI PnL values
const ALL_KNOWN_WALLETS: KnownWallet[] = [
  // BATCH 1: Fresh exact UI values (most recent)
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, source: 'fresh_ui' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00, source: 'fresh_ui' },
  { wallet: '0xb0adc6b10fad31c5f039dc2bc909cda1e10c29c6', ui_pnl: 124.22, source: 'fresh_ui' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94, source: 'fresh_ui' },
  { wallet: '0x114d7a8e7a1dd2dde555744a432ddcb871454c92', ui_pnl: 733.87, source: 'fresh_ui' },
  { wallet: '0xa7cfafa0db244f760436fcf83c8b1eb98904ba10', ui_pnl: 11969.73, source: 'fresh_ui' },
  { wallet: '0x18f343d8f03234321dbddd237e069b26aa45c87a', ui_pnl: -14.03, source: 'fresh_ui' },
  { wallet: '0xbb49c8d518f71db91f7a0a61bc8a29d3364355bf', ui_pnl: -3.74, source: 'fresh_ui' },
  { wallet: '0x8672768b9fadf29d8ad810ae2966d4e89e9ad2c1', ui_pnl: -4.98, source: 'fresh_ui' },
  { wallet: '0x3c3c46c1442ddbafce15a0097d2f5a0f4d797d32', ui_pnl: -3.45, source: 'fresh_ui' },
  { wallet: '0x71e96aad0fa2e55d7428bf46dfb2ee8978673d26', ui_pnl: -7.29, source: 'fresh_ui' },
  { wallet: '0x4aec7657999ede3ba3a2f9c53f550cb7f1274508', ui_pnl: 5457.86, source: 'fresh_ui' },
  { wallet: '0x99f8d8bad56ed2541d64fbbc3fc6c71873a17dd5', ui_pnl: 52.40, source: 'fresh_ui' },
  { wallet: '0x7da9710476bf0d83239fcc1b306ee592aa563279', ui_pnl: 9.15, source: 'fresh_ui' },
  { wallet: '0x12c879cf99ec301cd144839e798dc87e9c2e4a62', ui_pnl: -345.76, source: 'fresh_ui' },
  { wallet: '0xa6e3af9b0baa3c39ad918e3600ebe507d8055893', ui_pnl: 3154.33, source: 'fresh_ui' },
  { wallet: '0x7ea09d2d4e8fe05f748c1a7f553d90582b093583', ui_pnl: -233.25, source: 'fresh_ui' },
  { wallet: '0x4eae829a112298efa38f4e66cc5a58787f4a9b12', ui_pnl: 65.63, source: 'fresh_ui' },
  { wallet: '0x89915ad00d26caf10c642b0858d9cc527db835bf', ui_pnl: -4.39, source: 'fresh_ui' },
  { wallet: '0xbc51223c95844063d31a71dd64e169df5b42f26c', ui_pnl: 20.55, source: 'fresh_ui' },

  // BATCH 2: Smart money wallets (~1 month old)
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, source: '1mo_old' },
  { wallet: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', ui_pnl: 114087, source: '1mo_old' },
  { wallet: '0x1f0a343513aa6060488fabe96960e6d1e177f7aa', ui_pnl: 101576, source: '1mo_old' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, source: '1mo_old' },
  { wallet: '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed', ui_pnl: 211748, source: '1mo_old' },
  { wallet: '0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f', ui_pnl: 163277, source: '1mo_old' },
  { wallet: '0xe542afd3881c4c330ba0ebbb603bb470b2ba0a37', ui_pnl: 73231, source: '1mo_old' },
  { wallet: '0x12d6cccfc766d3c43a8f7fddb17ee10c5e47a5ed', ui_pnl: 150010, source: '1mo_old' },
  { wallet: '0x7c156bb0dbb44dcb7387a78778e0da313bf3c9db', ui_pnl: 114134, source: '1mo_old' },
  { wallet: '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8', ui_pnl: 135153, source: '1mo_old' },
  { wallet: '0x662244931c16cb1e6c72d91f26cc1b2af0d25b06', ui_pnl: 131531, source: '1mo_old' },
  { wallet: '0x2e0b70d482e6b389e81dea528be57d825dd48070', ui_pnl: 152389, source: '1mo_old' },
  { wallet: '0x3b6fd06a5915ab90d01b052b6937f4eb7ffa1c07', ui_pnl: 158878, source: '1mo_old' },
  { wallet: '0xd748c701ad93cfec32a3420e10f3b08e68612125', ui_pnl: 142856, source: '1mo_old' },
  { wallet: '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397', ui_pnl: 101164, source: '1mo_old' },
  { wallet: '0xd06f0f7719df1b3b75b607923536b3250825d4a6', ui_pnl: 168621, source: '1mo_old' },
  { wallet: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', ui_pnl: 93181, source: '1mo_old' },
  { wallet: '0xeb6f0a13ea3f0eb8fb8c5d45c703cbf74d0d2f34', ui_pnl: 124739, source: '1mo_old' },
  { wallet: '0x7f3c8979d0afa00007bae4747d5347122af05613', ui_pnl: 179243, source: '1mo_old' },
  { wallet: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, source: '1mo_old' },
  { wallet: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, source: '1mo_old' },
  { wallet: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, source: '1mo_old' },
  { wallet: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, source: '1mo_old' },

  // BATCH 3: Additional fresh UI values
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.90, source: 'fresh_ui' },
  { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', ui_pnl: 4404.92, source: 'fresh_ui' },
  { wallet: '0x418db17eaab13c6bfef00e3e9c66f60e54f7f546', ui_pnl: 5.44, source: 'fresh_ui' },
  { wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', ui_pnl: -294.61, source: 'fresh_ui' },
  { wallet: '0xeab03de44f5a2f33e5e8ea9f5c09c8f31b4b5ae7', ui_pnl: 146.90, source: 'fresh_ui' },
  { wallet: '0x7dca4d9f31fc38db98c7feebea9e0c8be1b39a71', ui_pnl: 470.40, source: 'fresh_ui' },

  // BATCH 4: Theo4 (known reference)
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', ui_pnl: 22053934, source: 'known' },
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
  source: string;
}

async function runComparison() {
  console.log('=== COMPREHENSIVE V3 vs V4 PnL ACCURACY COMPARISON ===\n');
  console.log('V3: Average cost basis');
  console.log('V4: FIFO (First-In-First-Out) cost basis\n');
  console.log('Testing ' + ALL_KNOWN_WALLETS.length + ' wallets...\n');

  const results: WalletResult[] = [];
  let tested = 0;
  let errors = 0;

  for (const w of ALL_KNOWN_WALLETS) {
    tested++;
    try {
      const v3 = await computeWalletActivityPnlV3Debug(w.wallet);
      const v4 = await computeWalletActivityPnlV4Debug(w.wallet);

      const v3_error = errorPct(v3.pnl_activity_total, w.ui_pnl);
      const v4_error = errorPct(v4.pnl_activity_total, w.ui_pnl);
      const v3_sign = Math.sign(v3.pnl_activity_total) === Math.sign(w.ui_pnl);
      const v4_sign = Math.sign(v4.pnl_activity_total) === Math.sign(w.ui_pnl);

      results.push({
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v3_pnl: v3.pnl_activity_total,
        v4_pnl: v4.pnl_activity_total,
        v3_error,
        v4_error,
        v3_sign,
        v4_sign,
        source: w.source,
      });

      // Progress indicator
      process.stdout.write(`\r${tested}/${ALL_KNOWN_WALLETS.length} wallets processed...`);
    } catch (e: any) {
      errors++;
      process.stdout.write(`\r${tested}/${ALL_KNOWN_WALLETS.length} wallets (${errors} errors)...`);
    }
  }

  console.log('\n');

  // Results table
  console.log('=== RESULTS TABLE ===\n');
  console.log('| # | Wallet       | UI PnL    | V3 PnL    | V3 Err  | V4 PnL    | V4 Err  | Better |');
  console.log('|---|--------------|-----------|-----------|---------|-----------|---------|--------|');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const improved = Math.abs(r.v4_error) < Math.abs(r.v3_error);
    const same = Math.abs(r.v4_error - r.v3_error) < 0.1;
    const better = same ? 'SAME' : improved ? 'V4 ✓' : 'V3';

    console.log(
      '| ' +
        String(i + 1).padStart(2) +
        ' | ' +
        r.wallet.substring(0, 12) +
        ' | ' +
        fmt(r.ui_pnl).padEnd(9) +
        ' | ' +
        fmt(r.v3_pnl).padEnd(9) +
        ' | ' +
        (r.v3_error >= 0 ? '+' : '') +
        r.v3_error.toFixed(1) +
        '%'.padEnd(3) +
        ' | ' +
        fmt(r.v4_pnl).padEnd(9) +
        ' | ' +
        (r.v4_error >= 0 ? '+' : '') +
        r.v4_error.toFixed(1) +
        '%'.padEnd(3) +
        ' | ' +
        better.padEnd(6) +
        ' |'
    );
  }

  // Analysis
  console.log('\n=== ANALYSIS ===\n');

  console.log('Tested: ' + results.length + '/' + ALL_KNOWN_WALLETS.length + ' (' + errors + ' errors)\n');

  // Sign accuracy
  const v3SignOk = results.filter((r) => r.v3_sign).length;
  const v4SignOk = results.filter((r) => r.v4_sign).length;
  console.log('SIGN ACCURACY:');
  console.log('  V3: ' + v3SignOk + '/' + results.length + ' (' + ((v3SignOk / results.length) * 100).toFixed(1) + '%)');
  console.log('  V4: ' + v4SignOk + '/' + results.length + ' (' + ((v4SignOk / results.length) * 100).toFixed(1) + '%)');
  console.log('  Δ: ' + (v4SignOk - v3SignOk) + ' wallets');

  // Mean/Median error
  const v3AvgErr = results.reduce((s, r) => s + Math.abs(r.v3_error), 0) / results.length;
  const v4AvgErr = results.reduce((s, r) => s + Math.abs(r.v4_error), 0) / results.length;
  const v3Errors = results.map((r) => Math.abs(r.v3_error)).sort((a, b) => a - b);
  const v4Errors = results.map((r) => Math.abs(r.v4_error)).sort((a, b) => a - b);
  const v3Median = v3Errors[Math.floor(v3Errors.length / 2)];
  const v4Median = v4Errors[Math.floor(v4Errors.length / 2)];

  console.log('\nMEAN ABSOLUTE ERROR:');
  console.log('  V3: ' + v3AvgErr.toFixed(1) + '%');
  console.log('  V4: ' + v4AvgErr.toFixed(1) + '%');
  console.log('  Δ: ' + (v4AvgErr - v3AvgErr).toFixed(1) + '% (' + (v4AvgErr < v3AvgErr ? 'IMPROVED' : 'WORSE') + ')');

  console.log('\nMEDIAN ABSOLUTE ERROR:');
  console.log('  V3: ' + v3Median.toFixed(1) + '%');
  console.log('  V4: ' + v4Median.toFixed(1) + '%');
  console.log('  Δ: ' + (v4Median - v3Median).toFixed(1) + '% (' + (v4Median < v3Median ? 'IMPROVED' : 'WORSE') + ')');

  // Improvement count
  const improved = results.filter((r) => Math.abs(r.v4_error) < Math.abs(r.v3_error) - 0.1).length;
  const same = results.filter((r) => Math.abs(Math.abs(r.v4_error) - Math.abs(r.v3_error)) <= 0.1).length;
  const worse = results.filter((r) => Math.abs(r.v4_error) > Math.abs(r.v3_error) + 0.1).length;

  console.log('\nIMPROVEMENT COUNT:');
  console.log('  V4 better: ' + improved + ' wallets (' + ((improved / results.length) * 100).toFixed(0) + '%)');
  console.log('  Same: ' + same + ' wallets (' + ((same / results.length) * 100).toFixed(0) + '%)');
  console.log('  V3 better: ' + worse + ' wallets (' + ((worse / results.length) * 100).toFixed(0) + '%)');

  // Error buckets
  console.log('\nERROR DISTRIBUTION:');
  const buckets = [1, 5, 10, 15, 25, 50];
  for (const b of buckets) {
    const v3Count = results.filter((r) => Math.abs(r.v3_error) <= b).length;
    const v4Count = results.filter((r) => Math.abs(r.v4_error) <= b).length;
    console.log(
      '  Within ' +
        String(b).padStart(2) +
        '%: V3=' +
        v3Count +
        '/' +
        results.length +
        ' (' +
        ((v3Count / results.length) * 100).toFixed(0) +
        '%), V4=' +
        v4Count +
        '/' +
        results.length +
        ' (' +
        ((v4Count / results.length) * 100).toFixed(0) +
        '%)'
    );
  }

  // Exact matches
  const v3Exact = results.filter((r) => Math.abs(r.v3_error) < 1).length;
  const v4Exact = results.filter((r) => Math.abs(r.v4_error) < 1).length;
  console.log('\nEXACT MATCHES (<1% error):');
  console.log('  V3: ' + v3Exact + ' wallets');
  console.log('  V4: ' + v4Exact + ' wallets');

  // Sign mismatches
  const v3SignMiss = results.filter((r) => !r.v3_sign);
  const v4SignMiss = results.filter((r) => !r.v4_sign);
  console.log('\nSIGN MISMATCHES:');
  console.log('  V3: ' + v3SignMiss.length + ' wallets');
  console.log('  V4: ' + v4SignMiss.length + ' wallets');

  // Biggest improvements
  console.log('\n=== TOP 10 IMPROVEMENTS (V4 vs V3) ===\n');
  const sortedByImprovement = [...results]
    .map((r) => ({ ...r, delta: Math.abs(r.v3_error) - Math.abs(r.v4_error) }))
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);

  for (const r of sortedByImprovement) {
    console.log(
      r.wallet.substring(0, 14) +
        ': V3=' +
        (r.v3_error >= 0 ? '+' : '') +
        r.v3_error.toFixed(1) +
        '% → V4=' +
        (r.v4_error >= 0 ? '+' : '') +
        r.v4_error.toFixed(1) +
        '% (improved by ' +
        r.delta.toFixed(1) +
        '%)'
    );
  }

  // Biggest regressions
  const regressions = [...results]
    .map((r) => ({ ...r, delta: Math.abs(r.v4_error) - Math.abs(r.v3_error) }))
    .filter((r) => r.delta > 0.1)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);

  if (regressions.length > 0) {
    console.log('\n=== TOP 10 REGRESSIONS (V4 worse than V3) ===\n');
    for (const r of regressions) {
      console.log(
        r.wallet.substring(0, 14) +
          ': V3=' +
          (r.v3_error >= 0 ? '+' : '') +
          r.v3_error.toFixed(1) +
          '% → V4=' +
          (r.v4_error >= 0 ? '+' : '') +
          r.v4_error.toFixed(1) +
          '% (worse by ' +
          r.delta.toFixed(1) +
          '%)'
      );
    }
  }

  // Final verdict
  console.log('\n=== FINAL VERDICT ===\n');
  if (v4Median < v3Median && v4AvgErr < v3AvgErr) {
    const medianImprovement = ((v3Median - v4Median) / v3Median) * 100;
    console.log('✅ V4 (FIFO) IMPROVES accuracy');
    console.log('   Median error: ' + v3Median.toFixed(1) + '% → ' + v4Median.toFixed(1) + '% (-' + medianImprovement.toFixed(0) + '%)');
    console.log('   Mean error: ' + v3AvgErr.toFixed(1) + '% → ' + v4AvgErr.toFixed(1) + '%');
    console.log('\n   RECOMMENDATION: Promote V4 to production');
  } else if (Math.abs(v4Median - v3Median) < 1 && Math.abs(v4AvgErr - v3AvgErr) < 1) {
    console.log('➡️ V4 (FIFO) has SIMILAR accuracy to V3');
    console.log('   Median error: V3=' + v3Median.toFixed(1) + '%, V4=' + v4Median.toFixed(1) + '%');
    console.log('   Mean error: V3=' + v3AvgErr.toFixed(1) + '%, V4=' + v4AvgErr.toFixed(1) + '%');
    console.log('\n   RECOMMENDATION: Keep V3 as default (simpler). FIFO alone does not significantly improve accuracy.');
    console.log('   The error likely comes from other sources:');
    console.log('   - Split/merge handling');
    console.log('   - Data gaps');
    console.log('   - Polymarket internal adjustments');
  } else {
    console.log('❌ V4 (FIFO) is WORSE than V3');
    console.log('   Median error: ' + v3Median.toFixed(1) + '% → ' + v4Median.toFixed(1) + '%');
    console.log('   Mean error: ' + v3AvgErr.toFixed(1) + '% → ' + v4AvgErr.toFixed(1) + '%');
    console.log('\n   RECOMMENDATION: Keep V3 as default');
  }
}

runComparison().catch(console.error);
