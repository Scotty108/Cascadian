/**
 * Comprehensive V3 vs V6 PnL Accuracy Validation
 *
 * Tests V3 (average cost) vs V6 (V3 + NegRisk conversions at $0.26 cost basis) against ALL known wallet PnL values.
 * This validates the hypothesis that tracking NegRisk acquisitions with proper cost basis improves accuracy.
 *
 * Key change in V6: Synthetic BUY events added for tokens received from NegRisk contracts:
 * - NegRisk Adapter: 0xd91e80cf2e7be2e162c6513ced06f1dd0da35296
 * - NegRisk CTF: 0xc5d563a36ae78145c45a50134d48a1215220f80a
 *
 * Cost basis: $0.26 per token (calibrated from worst sign-mismatch wallet)
 */

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';
import { computeWalletActivityPnlV6Debug } from '../../lib/pnl/uiActivityEngineV6';

interface KnownWallet {
  wallet: string;
  ui_pnl: number;
  source: string;
}

// All known wallets with UI PnL values (50 wallets)
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
  v6_pnl: number;
  v3_error: number;
  v6_error: number;
  v3_sign: boolean;
  v6_sign: boolean;
  source: string;
  negrisk_acquisitions: number;
  negrisk_tokens: number;
  negrisk_cost_basis: number;
}

async function runComparison() {
  console.log('=== COMPREHENSIVE V3 vs V6 PnL ACCURACY COMPARISON ===\n');
  console.log('V3: Average cost basis (CLOB + Redemptions + Resolution)');
  console.log('V6: V3 + NegRisk acquisitions (at $0.26 cost basis)\n');
  console.log('Hypothesis: NegRisk conversions are the main source of sign mismatches.');
  console.log('Expected improvement: Sign accuracy from 77.6% to 85%+, median error <15%\n');
  console.log('Testing ' + ALL_KNOWN_WALLETS.length + ' wallets...\n');

  const results: WalletResult[] = [];
  let tested = 0;
  let errors = 0;

  for (const w of ALL_KNOWN_WALLETS) {
    tested++;
    try {
      const v3 = await computeWalletActivityPnlV3Debug(w.wallet);
      const v6 = await computeWalletActivityPnlV6Debug(w.wallet);

      const v3_error = errorPct(v3.pnl_activity_total, w.ui_pnl);
      const v6_error = errorPct(v6.pnl_activity_total, w.ui_pnl);
      const v3_sign = Math.sign(v3.pnl_activity_total) === Math.sign(w.ui_pnl) || (v3.pnl_activity_total === 0 && w.ui_pnl === 0);
      const v6_sign = Math.sign(v6.pnl_activity_total) === Math.sign(w.ui_pnl) || (v6.pnl_activity_total === 0 && w.ui_pnl === 0);

      results.push({
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v3_pnl: v3.pnl_activity_total,
        v6_pnl: v6.pnl_activity_total,
        v3_error,
        v6_error,
        v3_sign,
        v6_sign,
        source: w.source,
        negrisk_acquisitions: v6.negrisk_acquisition_count,
        negrisk_tokens: v6.negrisk_tokens_acquired,
        negrisk_cost_basis: v6.negrisk_cost_basis,
      });

      // Progress indicator
      process.stdout.write(`\r${tested}/${ALL_KNOWN_WALLETS.length} wallets processed...`);
    } catch (e: any) {
      errors++;
      console.log(`\nError processing wallet ${w.wallet}: ${e.message}`);
      process.stdout.write(`\r${tested}/${ALL_KNOWN_WALLETS.length} wallets (${errors} errors)...`);
    }
  }

  console.log('\n');

  // Results table
  console.log('=== RESULTS TABLE ===\n');
  console.log(
    '| # | Wallet       | UI PnL    | V3 PnL    | V3 Err  | V6 PnL    | V6 Err  | Better | NR Acq | NR Tokens |'
  );
  console.log(
    '|---|--------------|-----------|-----------|---------|-----------|---------|--------|--------|-----------|'
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const improved = Math.abs(r.v6_error) < Math.abs(r.v3_error);
    const same = Math.abs(r.v6_error - r.v3_error) < 0.1;
    const better = same ? 'SAME' : improved ? 'V6 ✓' : 'V3';

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
        fmt(r.v6_pnl).padEnd(9) +
        ' | ' +
        (r.v6_error >= 0 ? '+' : '') +
        r.v6_error.toFixed(1) +
        '%'.padEnd(3) +
        ' | ' +
        better.padEnd(6) +
        ' | ' +
        String(r.negrisk_acquisitions).padStart(6) +
        ' | ' +
        fmt(r.negrisk_tokens).padStart(9) +
        ' |'
    );
  }

  // Analysis
  console.log('\n=== ANALYSIS ===\n');

  console.log('Tested: ' + results.length + '/' + ALL_KNOWN_WALLETS.length + ' (' + errors + ' errors)\n');

  // Sign accuracy - KEY METRIC
  const v3SignOk = results.filter((r) => r.v3_sign).length;
  const v6SignOk = results.filter((r) => r.v6_sign).length;
  console.log('SIGN ACCURACY (Target: 85%+):');
  console.log('  V3: ' + v3SignOk + '/' + results.length + ' (' + ((v3SignOk / results.length) * 100).toFixed(1) + '%)');
  console.log('  V6: ' + v6SignOk + '/' + results.length + ' (' + ((v6SignOk / results.length) * 100).toFixed(1) + '%)');
  console.log('  Delta: ' + (v6SignOk - v3SignOk) + ' wallets (' + (((v6SignOk - v3SignOk) / results.length) * 100).toFixed(1) + ' pp)');

  // Mean/Median error
  const v3AvgErr = results.reduce((s, r) => s + Math.abs(r.v3_error), 0) / results.length;
  const v6AvgErr = results.reduce((s, r) => s + Math.abs(r.v6_error), 0) / results.length;
  const v3Errors = results.map((r) => Math.abs(r.v3_error)).sort((a, b) => a - b);
  const v6Errors = results.map((r) => Math.abs(r.v6_error)).sort((a, b) => a - b);
  const v3Median = v3Errors[Math.floor(v3Errors.length / 2)];
  const v6Median = v6Errors[Math.floor(v6Errors.length / 2)];

  console.log('\nMEAN ABSOLUTE ERROR:');
  console.log('  V3: ' + v3AvgErr.toFixed(1) + '%');
  console.log('  V6: ' + v6AvgErr.toFixed(1) + '%');
  console.log('  Delta: ' + (v6AvgErr - v3AvgErr).toFixed(1) + '% (' + (v6AvgErr < v3AvgErr ? 'IMPROVED' : 'WORSE') + ')');

  console.log('\nMEDIAN ABSOLUTE ERROR (Target: <15%):');
  console.log('  V3: ' + v3Median.toFixed(1) + '%');
  console.log('  V6: ' + v6Median.toFixed(1) + '%');
  console.log('  Delta: ' + (v6Median - v3Median).toFixed(1) + '% (' + (v6Median < v3Median ? 'IMPROVED' : 'WORSE') + ')');

  // Improvement count
  const improved = results.filter((r) => Math.abs(r.v6_error) < Math.abs(r.v3_error) - 0.1).length;
  const same = results.filter((r) => Math.abs(Math.abs(r.v6_error) - Math.abs(r.v3_error)) <= 0.1).length;
  const worse = results.filter((r) => Math.abs(r.v6_error) > Math.abs(r.v3_error) + 0.1).length;

  console.log('\nIMPROVEMENT COUNT:');
  console.log('  V6 better: ' + improved + ' wallets (' + ((improved / results.length) * 100).toFixed(0) + '%)');
  console.log('  Same: ' + same + ' wallets (' + ((same / results.length) * 100).toFixed(0) + '%)');
  console.log('  V3 better: ' + worse + ' wallets (' + ((worse / results.length) * 100).toFixed(0) + '%)');

  // Error buckets
  console.log('\nERROR DISTRIBUTION:');
  const buckets = [1, 5, 10, 15, 25, 50];
  for (const b of buckets) {
    const v3Count = results.filter((r) => Math.abs(r.v3_error) <= b).length;
    const v6Count = results.filter((r) => Math.abs(r.v6_error) <= b).length;
    console.log(
      '  Within ' +
        String(b).padStart(2) +
        '%: V3=' +
        v3Count +
        '/' +
        results.length +
        ' (' +
        ((v3Count / results.length) * 100).toFixed(0) +
        '%), V6=' +
        v6Count +
        '/' +
        results.length +
        ' (' +
        ((v6Count / results.length) * 100).toFixed(0) +
        '%)'
    );
  }

  // Exact matches
  const v3Exact = results.filter((r) => Math.abs(r.v3_error) < 1).length;
  const v6Exact = results.filter((r) => Math.abs(r.v6_error) < 1).length;
  console.log('\nEXACT MATCHES (<1% error):');
  console.log('  V3: ' + v3Exact + ' wallets');
  console.log('  V6: ' + v6Exact + ' wallets');

  // NegRisk correlation
  console.log('\n=== NEGRISK ACQUISITION CORRELATION ===\n');
  const walletsWithNegRisk = results.filter((r) => r.negrisk_acquisitions > 0);
  const walletsWithoutNegRisk = results.filter((r) => r.negrisk_acquisitions === 0);

  console.log('Total NegRisk acquisitions: ' + results.reduce((s, r) => s + r.negrisk_acquisitions, 0).toLocaleString());
  console.log('Total NegRisk tokens: ' + results.reduce((s, r) => s + r.negrisk_tokens, 0).toLocaleString());
  console.log('Total NegRisk cost basis: $' + results.reduce((s, r) => s + r.negrisk_cost_basis, 0).toLocaleString());
  console.log('Wallets with NegRisk activity: ' + walletsWithNegRisk.length + '/' + results.length);

  if (walletsWithNegRisk.length > 0) {
    const improvedWithNegRisk = walletsWithNegRisk.filter(
      (r) => Math.abs(r.v6_error) < Math.abs(r.v3_error)
    ).length;
    const signFixedWithNegRisk = walletsWithNegRisk.filter(
      (r) => !r.v3_sign && r.v6_sign
    ).length;
    const v3AvgErrWithNegRisk =
      walletsWithNegRisk.reduce((s, r) => s + Math.abs(r.v3_error), 0) / walletsWithNegRisk.length;
    const v6AvgErrWithNegRisk =
      walletsWithNegRisk.reduce((s, r) => s + Math.abs(r.v6_error), 0) / walletsWithNegRisk.length;

    console.log(
      '\nWallets WITH NegRisk activity (' + walletsWithNegRisk.length + '):'
    );
    console.log('  V6 better: ' + improvedWithNegRisk + '/' + walletsWithNegRisk.length);
    console.log('  Sign FIXED (V3 wrong -> V6 correct): ' + signFixedWithNegRisk);
    console.log('  V3 avg error: ' + v3AvgErrWithNegRisk.toFixed(1) + '%');
    console.log('  V6 avg error: ' + v6AvgErrWithNegRisk.toFixed(1) + '%');
    console.log(
      '  Error reduction: ' +
        (v3AvgErrWithNegRisk - v6AvgErrWithNegRisk).toFixed(1) +
        ' percentage points'
    );
  }

  if (walletsWithoutNegRisk.length > 0) {
    const improvedWithoutNegRisk = walletsWithoutNegRisk.filter(
      (r) => Math.abs(r.v6_error) < Math.abs(r.v3_error)
    ).length;
    console.log(
      '\nWallets WITHOUT NegRisk activity (' + walletsWithoutNegRisk.length + '):'
    );
    console.log('  V6 better: ' + improvedWithoutNegRisk + '/' + walletsWithoutNegRisk.length);
    console.log('  (These should be identical to V3 since no NegRisk events)');
  }

  // Sign mismatch deep dive
  console.log('\n=== SIGN MISMATCH DEEP DIVE ===\n');
  const v3SignWrong = results.filter((r) => !r.v3_sign);
  const v6SignWrong = results.filter((r) => !r.v6_sign);
  const signFixed = results.filter((r) => !r.v3_sign && r.v6_sign);
  const signBroken = results.filter((r) => r.v3_sign && !r.v6_sign);

  console.log('V3 sign mismatches: ' + v3SignWrong.length);
  console.log('V6 sign mismatches: ' + v6SignWrong.length);
  console.log('Sign FIXED by V6: ' + signFixed.length);
  console.log('Sign BROKEN by V6: ' + signBroken.length);

  if (signFixed.length > 0) {
    console.log('\nWallets where V6 FIXED the sign:');
    for (const r of signFixed) {
      console.log(
        '  ' +
          r.wallet.substring(0, 14) +
          ': UI=' +
          fmt(r.ui_pnl) +
          ', V3=' +
          fmt(r.v3_pnl) +
          ', V6=' +
          fmt(r.v6_pnl) +
          ' (NR: ' +
          r.negrisk_acquisitions +
          ' events, ' +
          fmt(r.negrisk_tokens) +
          ' tokens)'
      );
    }
  }

  if (signBroken.length > 0) {
    console.log('\nWallets where V6 BROKE the sign (regressions):');
    for (const r of signBroken) {
      console.log(
        '  ' +
          r.wallet.substring(0, 14) +
          ': UI=' +
          fmt(r.ui_pnl) +
          ', V3=' +
          fmt(r.v3_pnl) +
          ', V6=' +
          fmt(r.v6_pnl) +
          ' (NR: ' +
          r.negrisk_acquisitions +
          ' events)'
      );
    }
  }

  // Top improvements
  console.log('\n=== TOP 10 IMPROVEMENTS (V6 vs V3) ===\n');
  const sortedByImprovement = [...results]
    .map((r) => ({ ...r, delta: Math.abs(r.v3_error) - Math.abs(r.v6_error) }))
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);

  for (const r of sortedByImprovement) {
    console.log(
      r.wallet.substring(0, 14) +
        ': V3=' +
        (r.v3_error >= 0 ? '+' : '') +
        r.v3_error.toFixed(1) +
        '% -> V6=' +
        (r.v6_error >= 0 ? '+' : '') +
        r.v6_error.toFixed(1) +
        '% (improved by ' +
        r.delta.toFixed(1) +
        'pp, NR=' +
        r.negrisk_acquisitions +
        ' events)'
    );
  }

  // Top regressions
  const regressions = [...results]
    .map((r) => ({ ...r, delta: Math.abs(r.v6_error) - Math.abs(r.v3_error) }))
    .filter((r) => r.delta > 0.1)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);

  if (regressions.length > 0) {
    console.log('\n=== TOP 10 REGRESSIONS (V6 worse than V3) ===\n');
    for (const r of regressions) {
      console.log(
        r.wallet.substring(0, 14) +
          ': V3=' +
          (r.v3_error >= 0 ? '+' : '') +
          r.v3_error.toFixed(1) +
          '% -> V6=' +
          (r.v6_error >= 0 ? '+' : '') +
          r.v6_error.toFixed(1) +
          '% (worse by ' +
          r.delta.toFixed(1) +
          'pp, NR=' +
          r.negrisk_acquisitions +
          ' events)'
      );
    }
  }

  // Focus wallets (from the implementation plan)
  console.log('\n=== FOCUS WALLETS (From Implementation Plan) ===\n');
  const focusWallets = [
    '0x4ce73141dbfce41e65db3723e31059a730f0abad', // UI=$332K, V3=-$282K
    '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', // UI=$360K, V3=-$73K
    '0x12d6cccfc766d3c43a8f7fddb17ee10c5e47a5ed', // UI=$150K, V3=$0
  ];

  for (const fw of focusWallets) {
    const r = results.find((x) => x.wallet === fw);
    if (r) {
      const signStatus = r.v3_sign === r.v6_sign
        ? (r.v6_sign ? 'Both correct' : 'Both wrong')
        : (r.v6_sign ? 'V6 FIXED!' : 'V6 broke it');
      console.log(r.wallet.substring(0, 14) + ':');
      console.log('  UI PnL:   ' + fmt(r.ui_pnl));
      console.log('  V3 PnL:   ' + fmt(r.v3_pnl) + ' (error: ' + (r.v3_error >= 0 ? '+' : '') + r.v3_error.toFixed(1) + '%)');
      console.log('  V6 PnL:   ' + fmt(r.v6_pnl) + ' (error: ' + (r.v6_error >= 0 ? '+' : '') + r.v6_error.toFixed(1) + '%)');
      console.log('  Sign:     ' + signStatus);
      console.log('  NegRisk:  ' + r.negrisk_acquisitions + ' events, ' + fmt(r.negrisk_tokens) + ' tokens, $' + r.negrisk_cost_basis.toFixed(2) + ' cost basis');
      console.log('');
    } else {
      console.log(fw.substring(0, 14) + ': Not in results (error during processing)\n');
    }
  }

  // Final verdict
  console.log('=== FINAL VERDICT ===\n');

  const signAccuracyImproved = v6SignOk > v3SignOk;
  const medianImproved = v6Median < v3Median;
  const meanImproved = v6AvgErr < v3AvgErr;

  const signTarget = ((v6SignOk / results.length) * 100) >= 85;
  const medianTarget = v6Median <= 15;

  console.log('SUCCESS CRITERIA CHECK:');
  console.log('  Sign accuracy >= 85%: ' + ((v6SignOk / results.length) * 100).toFixed(1) + '% ' + (signTarget ? '✅' : '❌'));
  console.log('  Median error <= 15%: ' + v6Median.toFixed(1) + '% ' + (medianTarget ? '✅' : '❌'));
  console.log('  Sign accuracy improved: ' + (signAccuracyImproved ? '✅' : '❌'));
  console.log('  Median error improved: ' + (medianImproved ? '✅' : '❌'));
  console.log('  Mean error improved: ' + (meanImproved ? '✅' : '❌'));
  console.log('');

  if (signAccuracyImproved && medianImproved) {
    console.log('✅ V6 (NegRisk) IMPROVES accuracy over V3!');
    console.log('   Sign accuracy: ' + ((v3SignOk / results.length) * 100).toFixed(1) + '% -> ' + ((v6SignOk / results.length) * 100).toFixed(1) + '%');
    console.log('   Median error: ' + v3Median.toFixed(1) + '% -> ' + v6Median.toFixed(1) + '%');
    console.log('\n   RECOMMENDATION: Promote V6 to production');
  } else if (signAccuracyImproved || medianImproved) {
    console.log('➡️ V6 (NegRisk) shows PARTIAL improvement');
    console.log('   Sign accuracy: ' + (signAccuracyImproved ? 'IMPROVED' : 'same/worse'));
    console.log('   Median error: ' + (medianImproved ? 'IMPROVED' : 'same/worse'));
    console.log('\n   RECOMMENDATION: Review results, may need cost basis adjustment');
  } else {
    console.log('❌ V6 (NegRisk) did NOT improve over V3');
    console.log('   Sign accuracy: ' + ((v3SignOk / results.length) * 100).toFixed(1) + '% -> ' + ((v6SignOk / results.length) * 100).toFixed(1) + '%');
    console.log('   Median error: ' + v3Median.toFixed(1) + '% -> ' + v6Median.toFixed(1) + '%');
    console.log('\n   RECOMMENDATION: Keep V3, investigate other error sources');
  }

  console.log('\n--- Report generated ' + new Date().toISOString() + ' ---');
  console.log('Signed: Claude 1');
}

runComparison().catch(console.error);
