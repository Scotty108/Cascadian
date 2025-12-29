/**
 * Comprehensive V3 PnL Accuracy Validation
 *
 * Tests V3 engine against ALL known wallet PnL values across multiple batches:
 * - Batch 1: Fresh UI values (exact, recent)
 * - Batch 2: Smart money wallets (~1 month old data)
 * - Batch 3: Additional fresh UI values
 */

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';

interface KnownWallet {
  wallet: string;
  ui_pnl: number;
  source: string;
  notes?: string;
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

  // BATCH 2: Smart money wallets (~1 month old, may have changed)
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, source: '1mo_old', notes: 'Win rate 67.7%' },
  { wallet: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', ui_pnl: 114087, source: '1mo_old', notes: 'Win rate 78.3%' },
  { wallet: '0x1f0a343513aa6060488fabe96960e6d1e177f7aa', ui_pnl: 101576, source: '1mo_old', notes: 'Win rate 85.6%' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, source: '1mo_old', notes: 'Win rate 71.9%' },
  { wallet: '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed', ui_pnl: 211748, source: '1mo_old', notes: 'Win rate 89.0%' },
  { wallet: '0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f', ui_pnl: 163277, source: '1mo_old', notes: 'Win rate 74.7%' },
  { wallet: '0xe542afd3881c4c330ba0ebbb603bb470b2ba0a37', ui_pnl: 73231, source: '1mo_old', notes: 'Win rate 71.5%' },
  { wallet: '0x12d6cccfc7470a3f4bafc53599a4779cbf2cf2a8', ui_pnl: 150023, source: '1mo_old', notes: 'Win rate 81.6%' },
  { wallet: '0x7c156bb0dbb44dcb7387a78778e0da313bf3c9db', ui_pnl: 114134, source: '1mo_old', notes: 'Win rate 80.5%' },
  { wallet: '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8', ui_pnl: 135153, source: '1mo_old', notes: 'Win rate 76.5%' },
  { wallet: '0x662244931c392df70bd064fa91f838eea0bfd7a9', ui_pnl: 131523, source: '1mo_old', notes: 'Win rate 65.6%' },
  { wallet: '0x2e0b70d482e6b389e81dea528be57d825dd48070', ui_pnl: 152389, source: '1mo_old', notes: 'Win rate 90.3%' },
  { wallet: '0x3b6fd06a595d71c70afb3f44414be1c11304340b', ui_pnl: 158864, source: '1mo_old', notes: 'Win rate 66.6%' },
  { wallet: '0xd748c701ad93cfec32a3420e10f3b08e68612125', ui_pnl: 142856, source: '1mo_old', notes: 'Win rate 81.3%' },
  { wallet: '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397', ui_pnl: 101164, source: '1mo_old', notes: 'Win rate 87.1%' },
  { wallet: '0xd06f0f7719df1b3b75b607923536b3250825d4a6', ui_pnl: 168621, source: '1mo_old', notes: 'Win rate 74.4%' },
  { wallet: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', ui_pnl: 93181, source: '1mo_old', notes: 'Win rate 79.7%' },
  { wallet: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', ui_pnl: 124705, source: '1mo_old', notes: 'Win rate 78.6%' },
  { wallet: '0x7f3c8979d0afa00007bae4747d5347122af05613', ui_pnl: 179243, source: '1mo_old', notes: 'Win rate 90.7%' },
  { wallet: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, source: '1mo_old', notes: 'Win rate 93.0%' },
  { wallet: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, source: '1mo_old', notes: 'Win rate 84.1%' },
  { wallet: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, source: '1mo_old', notes: 'xcnstrategy' },
  { wallet: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, source: '1mo_old', notes: 'GreekGamblerPM' },

  // BATCH 3: Additional fresh UI values
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.90, source: 'fresh_ui', notes: 'Volume $205K' },
  { wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', ui_pnl: 4404.92, source: 'fresh_ui', notes: 'Volume $23K' },
  { wallet: '0x418db17eaa8f25eaf2085657d0becd82462c6786', ui_pnl: 5.44, source: 'fresh_ui', notes: 'Volume $30K' },
  { wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15', ui_pnl: -294.61, source: 'fresh_ui', notes: 'Volume $141K' },
  { wallet: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', ui_pnl: 146.90, source: 'fresh_ui', notes: '9 predictions' },
  { wallet: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', ui_pnl: 470.40, source: 'fresh_ui', notes: '89 predictions' },

  // BATCH 4: Theo4 (known reference)
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', ui_pnl: 22053934, source: 'known', notes: 'Theo4 - big hedger' },
];

function fmt(n: number): string {
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

interface Result {
  wallet: string;
  ui_pnl: number;
  v3_pnl: number;
  diff: number;
  abs_diff: number;
  error_pct: number;
  sign_match: boolean;
  source: string;
  notes?: string;
  status: 'exact' | 'good' | 'acceptable' | 'poor' | 'error';
}

async function validate() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║           COMPREHENSIVE V3 PNL ENGINE ACCURACY VALIDATION                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Testing ' + ALL_KNOWN_WALLETS.length + ' wallets with known UI PnL values\n');

  const results: Result[] = [];
  let processed = 0;
  let errors = 0;

  console.log('┌────┬──────────────┬────────────┬────────────┬────────────┬──────────┬──────┬─────────┐');
  console.log('│ #  │ Wallet       │ UI PnL     │ V3 PnL     │ Diff       │ Error%   │ Sign │ Status  │');
  console.log('├────┼──────────────┼────────────┼────────────┼────────────┼──────────┼──────┼─────────┤');

  for (const kw of ALL_KNOWN_WALLETS) {
    processed++;
    try {
      const r = await computeWalletActivityPnlV3Debug(kw.wallet);
      const v3 = r.pnl_activity_total;
      const diff = v3 - kw.ui_pnl;
      const absDiff = Math.abs(diff);
      const errorPct = kw.ui_pnl !== 0 ? (diff / Math.abs(kw.ui_pnl) * 100) : (v3 === 0 ? 0 : 100);
      const signMatch = Math.sign(v3) === Math.sign(kw.ui_pnl) || (Math.abs(kw.ui_pnl) < 10 && Math.abs(v3) < 10);

      // Determine status
      let status: 'exact' | 'good' | 'acceptable' | 'poor' | 'error';
      if (Math.abs(errorPct) <= 1) status = 'exact';
      else if (Math.abs(errorPct) <= 10) status = 'good';
      else if (Math.abs(errorPct) <= 25) status = 'acceptable';
      else status = 'poor';
      if (!signMatch) status = 'error';

      const statusIcon = {
        exact: '★',
        good: '✓',
        acceptable: '~',
        poor: '✗',
        error: '⚠'
      }[status];

      console.log(
        '│ ' + String(processed).padStart(2) + ' │ ' +
        kw.wallet.substring(0, 12) + ' │ ' +
        fmt(kw.ui_pnl).padEnd(10) + ' │ ' +
        fmt(v3).padEnd(10) + ' │ ' +
        fmt(diff).padEnd(10) + ' │ ' +
        ((errorPct >= 0 ? '+' : '') + errorPct.toFixed(1) + '%').padEnd(8) + ' │ ' +
        (signMatch ? 'OK  ' : 'MISS') + ' │ ' +
        statusIcon + ' ' + status.padEnd(5) + ' │'
      );

      results.push({
        wallet: kw.wallet,
        ui_pnl: kw.ui_pnl,
        v3_pnl: v3,
        diff,
        abs_diff: absDiff,
        error_pct: errorPct,
        sign_match: signMatch,
        source: kw.source,
        notes: kw.notes,
        status
      });
    } catch (e: any) {
      errors++;
      console.log(
        '│ ' + String(processed).padStart(2) + ' │ ' +
        kw.wallet.substring(0, 12) + ' │ ' +
        'ERROR: ' + e.message.substring(0, 50).padEnd(55) + ' │'
      );
    }
  }

  console.log('└────┴──────────────┴────────────┴────────────┴────────────┴──────────┴──────┴─────────┘');

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          ACCURACY ANALYSIS                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Overall stats
  const total = results.length;
  const signMatches = results.filter(r => r.sign_match).length;
  const exact = results.filter(r => r.status === 'exact').length;
  const good = results.filter(r => r.status === 'good').length;
  const acceptable = results.filter(r => r.status === 'acceptable').length;
  const poor = results.filter(r => r.status === 'poor').length;
  const signErrors = results.filter(r => !r.sign_match).length;

  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ OVERALL RESULTS                                                            │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ Total tested:        ' + String(total).padStart(3) + '/' + ALL_KNOWN_WALLETS.length + ' wallets                                      │');
  console.log('│ Errors (couldn\'t compute): ' + String(errors).padStart(3) + '                                              │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ SIGN ACCURACY:       ' + String(signMatches).padStart(3) + '/' + total + ' (' + (signMatches/total*100).toFixed(1) + '%) correct direction                   │');
  console.log('│ Sign mismatches:     ' + String(signErrors).padStart(3) + '    (these are problematic)                       │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ QUALITY BREAKDOWN:                                                         │');
  console.log('│   ★ Exact (<1% error):      ' + String(exact).padStart(3) + ' (' + (exact/total*100).toFixed(1).padStart(5) + '%)                             │');
  console.log('│   ✓ Good (<10% error):      ' + String(good).padStart(3) + ' (' + (good/total*100).toFixed(1).padStart(5) + '%)                             │');
  console.log('│   ~ Acceptable (<25% error): ' + String(acceptable).padStart(2) + ' (' + (acceptable/total*100).toFixed(1).padStart(5) + '%)                             │');
  console.log('│   ✗ Poor (>25% error):      ' + String(poor).padStart(3) + ' (' + (poor/total*100).toFixed(1).padStart(5) + '%)                             │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  // Threshold analysis
  const within1 = results.filter(r => r.abs_diff <= 1).length;
  const within5 = results.filter(r => r.abs_diff <= 5).length;
  const within10 = results.filter(r => r.abs_diff <= 10).length;
  const within100 = results.filter(r => r.abs_diff <= 100).length;
  const within1K = results.filter(r => r.abs_diff <= 1000).length;
  const within10K = results.filter(r => r.abs_diff <= 10000).length;

  const within1pct = results.filter(r => Math.abs(r.error_pct) <= 1).length;
  const within5pct = results.filter(r => Math.abs(r.error_pct) <= 5).length;
  const within10pct = results.filter(r => Math.abs(r.error_pct) <= 10).length;
  const within15pct = results.filter(r => Math.abs(r.error_pct) <= 15).length;
  const within25pct = results.filter(r => Math.abs(r.error_pct) <= 25).length;

  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ THRESHOLD ANALYSIS                                                         │');
  console.log('├───────────────────────────────────┬─────────────────────────────────────────┤');
  console.log('│ ABSOLUTE DIFFERENCE               │ PERCENTAGE ERROR                        │');
  console.log('├───────────────────────────────────┼─────────────────────────────────────────┤');
  console.log('│ Within $1:     ' + String(within1).padStart(3) + '/' + total + ' (' + (within1/total*100).toFixed(0).padStart(3) + '%)  │ Within  1%:  ' + String(within1pct).padStart(3) + '/' + total + ' (' + (within1pct/total*100).toFixed(0).padStart(3) + '%)           │');
  console.log('│ Within $5:     ' + String(within5).padStart(3) + '/' + total + ' (' + (within5/total*100).toFixed(0).padStart(3) + '%)  │ Within  5%:  ' + String(within5pct).padStart(3) + '/' + total + ' (' + (within5pct/total*100).toFixed(0).padStart(3) + '%)           │');
  console.log('│ Within $10:    ' + String(within10).padStart(3) + '/' + total + ' (' + (within10/total*100).toFixed(0).padStart(3) + '%)  │ Within 10%:  ' + String(within10pct).padStart(3) + '/' + total + ' (' + (within10pct/total*100).toFixed(0).padStart(3) + '%)           │');
  console.log('│ Within $100:   ' + String(within100).padStart(3) + '/' + total + ' (' + (within100/total*100).toFixed(0).padStart(3) + '%)  │ Within 15%:  ' + String(within15pct).padStart(3) + '/' + total + ' (' + (within15pct/total*100).toFixed(0).padStart(3) + '%)           │');
  console.log('│ Within $1K:    ' + String(within1K).padStart(3) + '/' + total + ' (' + (within1K/total*100).toFixed(0).padStart(3) + '%)  │ Within 25%:  ' + String(within25pct).padStart(3) + '/' + total + ' (' + (within25pct/total*100).toFixed(0).padStart(3) + '%)           │');
  console.log('│ Within $10K:   ' + String(within10K).padStart(3) + '/' + total + ' (' + (within10K/total*100).toFixed(0).padStart(3) + '%)  │                                         │');
  console.log('└───────────────────────────────────┴─────────────────────────────────────────┘');

  // Statistics
  const avgError = results.reduce((s, r) => s + r.error_pct, 0) / total;
  const avgAbsDiff = results.reduce((s, r) => s + r.abs_diff, 0) / total;
  const medianError = [...results].sort((a, b) => a.error_pct - b.error_pct)[Math.floor(total / 2)].error_pct;

  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ STATISTICS                                                                 │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ Average error:        ' + ((avgError >= 0 ? '+' : '') + avgError.toFixed(1) + '%').padEnd(10) + '                                   │');
  console.log('│ Median error:         ' + ((medianError >= 0 ? '+' : '') + medianError.toFixed(1) + '%').padEnd(10) + '                                   │');
  console.log('│ Average abs diff:     ' + fmt(avgAbsDiff).padEnd(10) + '                                   │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  // By source
  console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ BY DATA SOURCE                                                             │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');

  const sources = ['fresh_ui', '1mo_old', 'known'];
  for (const src of sources) {
    const srcResults = results.filter(r => r.source === src);
    if (srcResults.length === 0) continue;
    const srcAvgErr = srcResults.reduce((s, r) => s + r.error_pct, 0) / srcResults.length;
    const srcSignMatch = srcResults.filter(r => r.sign_match).length;
    const srcExact = srcResults.filter(r => Math.abs(r.error_pct) <= 10).length;
    console.log('│ ' + src.padEnd(12) + ': ' + String(srcResults.length).padStart(2) + ' wallets | Avg err: ' + ((srcAvgErr >= 0 ? '+' : '') + srcAvgErr.toFixed(1) + '%').padEnd(8) + ' | <10% err: ' + String(srcExact).padStart(2) + ' | Sign OK: ' + String(srcSignMatch).padStart(2) + ' │');
  }
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  // Best matches
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          TOP 10 BEST MATCHES                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  const best = [...results].sort((a, b) => Math.abs(a.error_pct) - Math.abs(b.error_pct)).slice(0, 10);
  console.log('┌────┬──────────────────────────────────────────┬────────────┬────────────┬──────────┐');
  console.log('│ #  │ Wallet                                   │ UI PnL     │ V3 PnL     │ Error    │');
  console.log('├────┼──────────────────────────────────────────┼────────────┼────────────┼──────────┤');
  best.forEach((r, i) => {
    console.log('│ ' + String(i + 1).padStart(2) + ' │ ' + r.wallet.substring(0, 40) + ' │ ' + fmt(r.ui_pnl).padEnd(10) + ' │ ' + fmt(r.v3_pnl).padEnd(10) + ' │ ' + ((r.error_pct >= 0 ? '+' : '') + r.error_pct.toFixed(1) + '%').padEnd(8) + ' │');
  });
  console.log('└────┴──────────────────────────────────────────┴────────────┴────────────┴──────────┘');

  // Worst matches
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          TOP 10 WORST MATCHES                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  const worst = [...results].sort((a, b) => Math.abs(b.error_pct) - Math.abs(a.error_pct)).slice(0, 10);
  console.log('┌────┬──────────────────────────────────────────┬────────────┬────────────┬──────────┐');
  console.log('│ #  │ Wallet                                   │ UI PnL     │ V3 PnL     │ Error    │');
  console.log('├────┼──────────────────────────────────────────┼────────────┼────────────┼──────────┤');
  worst.forEach((r, i) => {
    const signFlag = r.sign_match ? '' : ' ⚠';
    console.log('│ ' + String(i + 1).padStart(2) + ' │ ' + r.wallet.substring(0, 40) + ' │ ' + fmt(r.ui_pnl).padEnd(10) + ' │ ' + fmt(r.v3_pnl).padEnd(10) + ' │ ' + ((r.error_pct >= 0 ? '+' : '') + r.error_pct.toFixed(1) + '%').padEnd(8) + signFlag + ' │');
  });
  console.log('└────┴──────────────────────────────────────────┴────────────┴────────────┴──────────┘');

  // Sign mismatches detail
  if (signErrors > 0) {
    console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    ⚠ SIGN MISMATCHES (CRITICAL)                            ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝');
    const mismatches = results.filter(r => !r.sign_match);
    mismatches.forEach(r => {
      console.log('  ' + r.wallet);
      console.log('    UI says: ' + fmt(r.ui_pnl) + ' | V3 says: ' + fmt(r.v3_pnl));
      if (r.notes) console.log('    Notes: ' + r.notes);
    });
  }

  // Final summary
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          FINAL SUMMARY                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  V3 Engine Overall Grade: ' + (
    within10pct/total >= 0.8 ? 'A (EXCELLENT)' :
    within10pct/total >= 0.6 ? 'B (GOOD)' :
    within15pct/total >= 0.5 ? 'C (ACCEPTABLE)' :
    within25pct/total >= 0.5 ? 'D (NEEDS WORK)' : 'F (FAILING)'
  ));
  console.log('');
  console.log('  Key metrics:');
  console.log('    • ' + (signMatches/total*100).toFixed(0) + '% of wallets have correct PnL direction');
  console.log('    • ' + (within10pct/total*100).toFixed(0) + '% of wallets are within 10% error');
  console.log('    • Average error: ' + (avgError >= 0 ? '+' : '') + avgError.toFixed(1) + '%');
  console.log('');
  console.log('  Production readiness:');
  if (signMatches/total >= 0.9 && within15pct/total >= 0.5) {
    console.log('    ✓ READY for production use');
    console.log('    ✓ Suitable for leaderboards and rankings');
    console.log('    ~ Use with disclaimer for absolute PnL display');
  } else {
    console.log('    ✗ Needs improvement before production');
  }
  console.log('');
}

validate().catch(console.error);
