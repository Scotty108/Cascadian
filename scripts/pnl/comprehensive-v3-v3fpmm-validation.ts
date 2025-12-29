/**
 * Comprehensive V3 vs V3+FPMM PnL Accuracy Validation
 *
 * Tests V3 (CLOB only) vs V3+FPMM (CLOB + AMM trades) against 50 known wallet PnL values.
 * This validates whether adding FPMM data improves accuracy.
 *
 * Key changes in V3+FPMM:
 * - Includes FPMM (AMM) trades from pm_fpmm_trades
 * - Filters sub-penny trades (price >= $0.01) to avoid astronomical PnL
 * - Normalizes payout_numerators to handle inconsistent data formats (1e6 vs 1e18 scaling)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';
import { computeWalletActivityPnlV3WithFPMMDebug } from '../../lib/pnl/uiActivityEngineV3WithFPMM';

interface KnownWallet {
  wallet: string;
  ui_pnl: number;
  source: string;
}

// All known wallets with UI PnL values (50 wallets)
const ALL_KNOWN_WALLETS: KnownWallet[] = [
  // BATCH 1: Fresh exact UI values (most recent)
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, source: 'fresh_ui' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.0, source: 'fresh_ui' },
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
  { wallet: '0x99f8d8bad56ed2541d64fbbc3fc6c71873a17dd5', ui_pnl: 52.4, source: 'fresh_ui' },
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
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.9, source: 'fresh_ui' },
  { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', ui_pnl: 4404.92, source: 'fresh_ui' },
  { wallet: '0x418db17eaab13c6bfef00e3e9c66f60e54f7f546', ui_pnl: 5.44, source: 'fresh_ui' },
  { wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', ui_pnl: -294.61, source: 'fresh_ui' },
  { wallet: '0xeab03de44f5a2f33e5e8ea9f5c09c8f31b4b5ae7', ui_pnl: 146.9, source: 'fresh_ui' },
  { wallet: '0x7dca4d9f31fc38db98c7feebea9e0c8be1b39a71', ui_pnl: 470.4, source: 'fresh_ui' },

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
  v3fpmm_pnl: number;
  v3_error: number;
  v3fpmm_error: number;
  fpmm_fills: number;
  v3_sign_match: boolean;
  v3fpmm_sign_match: boolean;
  better_engine: 'V3' | 'V3+FPMM' | 'SAME' | 'BOTH_ZERO';
}

async function runValidation() {
  console.log('=== COMPREHENSIVE V3 vs V3+FPMM VALIDATION ===\n');
  console.log('Testing', ALL_KNOWN_WALLETS.length, 'wallets with known UI PnL values\n');

  const results: WalletResult[] = [];
  let processed = 0;
  let errors = 0;

  for (const w of ALL_KNOWN_WALLETS) {
    process.stdout.write(`Processing ${++processed}/${ALL_KNOWN_WALLETS.length}...\r`);

    try {
      const [v3Result, v3fpmmResult] = await Promise.all([
        computeWalletActivityPnlV3Debug(w.wallet),
        computeWalletActivityPnlV3WithFPMMDebug(w.wallet),
      ]);

      const v3Error = errorPct(v3Result.pnl_activity_total, w.ui_pnl);
      const v3fpmmError = errorPct(v3fpmmResult.pnl_activity_total, w.ui_pnl);

      const v3SignMatch =
        (w.ui_pnl >= 0 && v3Result.pnl_activity_total >= 0) ||
        (w.ui_pnl < 0 && v3Result.pnl_activity_total < 0);
      const v3fpmmSignMatch =
        (w.ui_pnl >= 0 && v3fpmmResult.pnl_activity_total >= 0) ||
        (w.ui_pnl < 0 && v3fpmmResult.pnl_activity_total < 0);

      let betterEngine: 'V3' | 'V3+FPMM' | 'SAME' | 'BOTH_ZERO';
      if (v3Result.pnl_activity_total === 0 && v3fpmmResult.pnl_activity_total === 0) {
        betterEngine = 'BOTH_ZERO';
      } else if (Math.abs(v3Error) < Math.abs(v3fpmmError)) {
        betterEngine = 'V3';
      } else if (Math.abs(v3fpmmError) < Math.abs(v3Error)) {
        betterEngine = 'V3+FPMM';
      } else {
        betterEngine = 'SAME';
      }

      results.push({
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        v3_pnl: v3Result.pnl_activity_total,
        v3fpmm_pnl: v3fpmmResult.pnl_activity_total,
        v3_error: v3Error,
        v3fpmm_error: v3fpmmError,
        fpmm_fills: v3fpmmResult.fpmm_fills_count,
        v3_sign_match: v3SignMatch,
        v3fpmm_sign_match: v3fpmmSignMatch,
        better_engine: betterEngine,
      });
    } catch (e: any) {
      errors++;
      console.log(`\nError processing ${w.wallet}: ${e.message}`);
    }
  }

  console.log('\n\n=== DETAILED RESULTS ===\n');

  // Sort by absolute error improvement
  results.sort((a, b) => {
    const aImprovement = Math.abs(a.v3_error) - Math.abs(a.v3fpmm_error);
    const bImprovement = Math.abs(b.v3_error) - Math.abs(b.v3fpmm_error);
    return bImprovement - aImprovement; // Most improved first
  });

  console.log(
    '| Wallet | UI PnL | V3 PnL | V3+FPMM PnL | V3 Err | FPMM Err | FPMM Fills | Winner |'
  );
  console.log(
    '|--------|--------|--------|-------------|--------|----------|------------|--------|'
  );

  for (const r of results) {
    const v3Sign = r.v3_sign_match ? '' : '!';
    const fpmmSign = r.v3fpmm_sign_match ? '' : '!';
    console.log(
      `| ${r.wallet.substring(0, 10)}... | ${fmt(r.ui_pnl).padStart(8)} | ${fmt(r.v3_pnl).padStart(8)}${v3Sign} | ${fmt(r.v3fpmm_pnl).padStart(11)}${fpmmSign} | ${r.v3_error.toFixed(0).padStart(5)}% | ${r.v3fpmm_error.toFixed(0).padStart(7)}% | ${String(r.fpmm_fills).padStart(10)} | ${r.better_engine.padStart(7)} |`
    );
  }

  // Summary statistics
  console.log('\n=== SUMMARY STATISTICS ===\n');

  const validResults = results.filter((r) => r.better_engine !== 'BOTH_ZERO');
  const v3WinCount = results.filter((r) => r.better_engine === 'V3').length;
  const fpmmWinCount = results.filter((r) => r.better_engine === 'V3+FPMM').length;
  const sameCount = results.filter((r) => r.better_engine === 'SAME').length;
  const bothZeroCount = results.filter((r) => r.better_engine === 'BOTH_ZERO').length;

  console.log('Engine comparison:');
  console.log(`  V3 better:       ${v3WinCount} wallets`);
  console.log(`  V3+FPMM better:  ${fpmmWinCount} wallets`);
  console.log(`  Same accuracy:   ${sameCount} wallets`);
  console.log(`  Both zero:       ${bothZeroCount} wallets (no data)`);

  // Sign accuracy
  const v3SignCorrect = results.filter((r) => r.v3_sign_match).length;
  const fpmmSignCorrect = results.filter((r) => r.v3fpmm_sign_match).length;

  console.log('\nSign accuracy:');
  console.log(`  V3:       ${v3SignCorrect}/${results.length} (${((v3SignCorrect / results.length) * 100).toFixed(1)}%)`);
  console.log(`  V3+FPMM:  ${fpmmSignCorrect}/${results.length} (${((fpmmSignCorrect / results.length) * 100).toFixed(1)}%)`);

  // Sign changes
  const signFixed = results.filter((r) => !r.v3_sign_match && r.v3fpmm_sign_match).length;
  const signBroken = results.filter((r) => r.v3_sign_match && !r.v3fpmm_sign_match).length;

  console.log('\nSign changes:');
  console.log(`  Fixed by V3+FPMM:  ${signFixed} wallets`);
  console.log(`  Broken by V3+FPMM: ${signBroken} wallets`);
  console.log(`  Net change:        ${signFixed - signBroken > 0 ? '+' : ''}${signFixed - signBroken}`);

  // Error distribution
  const v3Errors = validResults.map((r) => Math.abs(r.v3_error)).sort((a, b) => a - b);
  const fpmmErrors = validResults.map((r) => Math.abs(r.v3fpmm_error)).sort((a, b) => a - b);

  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  };

  const mean = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);

  console.log('\nError statistics (valid results only):');
  console.log(`  V3 median error:       ${median(v3Errors).toFixed(1)}%`);
  console.log(`  V3+FPMM median error:  ${median(fpmmErrors).toFixed(1)}%`);
  console.log(`  V3 mean error:         ${mean(v3Errors).toFixed(1)}%`);
  console.log(`  V3+FPMM mean error:    ${mean(fpmmErrors).toFixed(1)}%`);

  // Error buckets
  const errorBuckets = [1, 5, 10, 15, 25, 50, 100];

  console.log('\nError distribution:');
  console.log('| Threshold | V3 Count | V3+FPMM Count | Delta |');
  console.log('|-----------|----------|---------------|-------|');

  for (const threshold of errorBuckets) {
    const v3Count = validResults.filter((r) => Math.abs(r.v3_error) <= threshold).length;
    const fpmmCount = validResults.filter((r) => Math.abs(r.v3fpmm_error) <= threshold).length;
    const delta = fpmmCount - v3Count;
    console.log(
      `| Within ${String(threshold).padStart(2)}% | ${String(v3Count).padStart(8)} | ${String(fpmmCount).padStart(13)} | ${(delta >= 0 ? '+' : '') + delta.toString().padStart(5)} |`
    );
  }

  // FPMM impact analysis
  const walletsWithFpmm = results.filter((r) => r.fpmm_fills > 0);
  const fpmmImproved = walletsWithFpmm.filter(
    (r) => Math.abs(r.v3fpmm_error) < Math.abs(r.v3_error)
  ).length;
  const fpmmWorsened = walletsWithFpmm.filter(
    (r) => Math.abs(r.v3fpmm_error) > Math.abs(r.v3_error)
  ).length;

  console.log('\nFPMM impact analysis:');
  console.log(`  Wallets with FPMM data: ${walletsWithFpmm.length}`);
  console.log(`  Improved by FPMM:       ${fpmmImproved}`);
  console.log(`  Worsened by FPMM:       ${fpmmWorsened}`);
  console.log(
    `  Total FPMM fills:       ${results.reduce((sum, r) => sum + r.fpmm_fills, 0).toLocaleString()}`
  );

  // Top improvements
  const improvements = results
    .filter((r) => r.fpmm_fills > 0)
    .map((r) => ({
      wallet: r.wallet,
      improvement: Math.abs(r.v3_error) - Math.abs(r.v3fpmm_error),
      fpmm_fills: r.fpmm_fills,
      v3_error: r.v3_error,
      fpmm_error: r.v3fpmm_error,
    }))
    .sort((a, b) => b.improvement - a.improvement);

  console.log('\nTop 10 improvements from FPMM:');
  for (const imp of improvements.slice(0, 10)) {
    console.log(
      `  ${imp.wallet.substring(0, 12)}... | V3: ${imp.v3_error.toFixed(0)}% → FPMM: ${imp.fpmm_error.toFixed(0)}% | Δ${imp.improvement.toFixed(0)}pp | ${imp.fpmm_fills} fills`
    );
  }

  console.log('\nTop 10 regressions from FPMM:');
  for (const imp of improvements.slice(-10).reverse()) {
    if (imp.improvement < 0) {
      console.log(
        `  ${imp.wallet.substring(0, 12)}... | V3: ${imp.v3_error.toFixed(0)}% → FPMM: ${imp.fpmm_error.toFixed(0)}% | Δ${imp.improvement.toFixed(0)}pp | ${imp.fpmm_fills} fills`
      );
    }
  }

  if (errors > 0) {
    console.log(`\n⚠️  ${errors} wallets had errors during processing`);
  }

  console.log('\n=== VALIDATION COMPLETE ===');
}

runValidation().catch(console.error);
