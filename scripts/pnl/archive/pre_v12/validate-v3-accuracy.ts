/**
 * Validate V3 PnL accuracy against known UI values
 */

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';

// Known UI PnL values (provided by user)
const knownValues = [
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84 },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00 },
  { wallet: '0xb0adc6b10fad31c5f039dc2bc909cda1e10c29c6', ui_pnl: 124.22 },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94 },
  { wallet: '0x114d7a8e7a1dd2dde555744a432ddcb871454c92', ui_pnl: 733.87 },
  { wallet: '0xa7cfafa0db244f760436fcf83c8b1eb98904ba10', ui_pnl: 11969.73 },
  { wallet: '0x18f343d8f03234321dbddd237e069b26aa45c87a', ui_pnl: -14.03 },
  { wallet: '0xbb49c8d518f71db91f7a0a61bc8a29d3364355bf', ui_pnl: -3.74 },
  { wallet: '0x8672768b9fadf29d8ad810ae2966d4e89e9ad2c1', ui_pnl: -4.98 },
  { wallet: '0x3c3c46c1442ddbafce15a0097d2f5a0f4d797d32', ui_pnl: -3.45 },
  { wallet: '0x71e96aad0fa2e55d7428bf46dfb2ee8978673d26', ui_pnl: -7.29 },
  { wallet: '0x4aec7657999ede3ba3a2f9c53f550cb7f1274508', ui_pnl: 5457.86 },
  { wallet: '0x99f8d8bad56ed2541d64fbbc3fc6c71873a17dd5', ui_pnl: 52.40 },
  { wallet: '0x7da9710476bf0d83239fcc1b306ee592aa563279', ui_pnl: 9.15 },
  { wallet: '0x12c879cf99ec301cd144839e798dc87e9c2e4a62', ui_pnl: -345.76 },
  { wallet: '0xa6e3af9b0baa3c39ad918e3600ebe507d8055893', ui_pnl: 3154.33 },
  { wallet: '0x7ea09d2d4e8fe05f748c1a7f553d90582b093583', ui_pnl: -233.25 },
  { wallet: '0x4eae829a112298efa38f4e66cc5a58787f4a9b12', ui_pnl: 65.63 },
  { wallet: '0x89915ad00d26caf10c642b0858d9cc527db835bf', ui_pnl: -4.39 },
  { wallet: '0xbc51223c95844063d31a71dd64e169df5b42f26c', ui_pnl: 20.55 },
];

function fmt(n: number): string {
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

async function validate() {
  console.log('=== V3 PnL ACCURACY VALIDATION ===\n');
  console.log('Testing ' + knownValues.length + ' wallets with known UI PnL values\n');

  console.log('| #  | Wallet       | UI PnL     | V3 PnL     | Diff      | Error%   | Sign |');
  console.log('|----|--------------|------------|------------|-----------|----------|------|');

  const results: any[] = [];

  for (let i = 0; i < knownValues.length; i++) {
    const kv = knownValues[i];
    try {
      const r = await computeWalletActivityPnlV3Debug(kv.wallet);
      const v3 = r.pnl_activity_total;
      const diff = v3 - kv.ui_pnl;
      const errorPct = kv.ui_pnl !== 0 ? (diff / Math.abs(kv.ui_pnl) * 100) : (v3 === 0 ? 0 : 100);
      const signMatch = Math.sign(v3) === Math.sign(kv.ui_pnl) || (Math.abs(kv.ui_pnl) < 1 && Math.abs(v3) < 1);

      console.log(
        '| ' + String(i + 1).padStart(2) + ' | ' +
        kv.wallet.substring(0, 12) + ' | ' +
        fmt(kv.ui_pnl).padEnd(10) + ' | ' +
        fmt(v3).padEnd(10) + ' | ' +
        fmt(diff).padEnd(9) + ' | ' +
        (errorPct >= 0 ? '+' : '') + errorPct.toFixed(1) + '%'.padEnd(4) + ' | ' +
        (signMatch ? 'OK' : 'MISS') + '   |'
      );

      results.push({
        wallet: kv.wallet,
        ui_pnl: kv.ui_pnl,
        v3_pnl: v3,
        diff,
        error_pct: errorPct,
        sign_match: signMatch,
        abs_diff: Math.abs(diff)
      });
    } catch (e: any) {
      console.log('| ' + String(i + 1).padStart(2) + ' | ' + kv.wallet.substring(0, 12) + ' | ERROR: ' + e.message.substring(0, 30));
    }
  }

  // Analysis
  console.log('\n=== ACCURACY ANALYSIS ===\n');

  const signMatches = results.filter(r => r.sign_match).length;
  console.log('Sign matches: ' + signMatches + '/' + results.length + ' (' + (signMatches / results.length * 100).toFixed(0) + '%)');

  // Error distribution
  const within1 = results.filter(r => r.abs_diff <= 1).length;
  const within5 = results.filter(r => r.abs_diff <= 5).length;
  const within10 = results.filter(r => r.abs_diff <= 10).length;
  const within50 = results.filter(r => r.abs_diff <= 50).length;
  const within100 = results.filter(r => r.abs_diff <= 100).length;
  const within5pct = results.filter(r => Math.abs(r.error_pct) <= 5).length;
  const within10pct = results.filter(r => Math.abs(r.error_pct) <= 10).length;
  const within15pct = results.filter(r => Math.abs(r.error_pct) <= 15).length;

  console.log('\nAbsolute difference thresholds:');
  console.log('  Within $1:    ' + within1 + '/' + results.length + ' (' + (within1 / results.length * 100).toFixed(0) + '%)');
  console.log('  Within $5:    ' + within5 + '/' + results.length + ' (' + (within5 / results.length * 100).toFixed(0) + '%)');
  console.log('  Within $10:   ' + within10 + '/' + results.length + ' (' + (within10 / results.length * 100).toFixed(0) + '%)');
  console.log('  Within $50:   ' + within50 + '/' + results.length + ' (' + (within50 / results.length * 100).toFixed(0) + '%)');
  console.log('  Within $100:  ' + within100 + '/' + results.length + ' (' + (within100 / results.length * 100).toFixed(0) + '%)');

  console.log('\nPercentage error thresholds:');
  console.log('  Within 5%:   ' + within5pct + '/' + results.length + ' (' + (within5pct / results.length * 100).toFixed(0) + '%)');
  console.log('  Within 10%:  ' + within10pct + '/' + results.length + ' (' + (within10pct / results.length * 100).toFixed(0) + '%)');
  console.log('  Within 15%:  ' + within15pct + '/' + results.length + ' (' + (within15pct / results.length * 100).toFixed(0) + '%)');

  // Average error
  const avgError = results.reduce((s, r) => s + r.error_pct, 0) / results.length;
  const avgAbsDiff = results.reduce((s, r) => s + r.abs_diff, 0) / results.length;
  console.log('\nAverage error: ' + (avgError >= 0 ? '+' : '') + avgError.toFixed(1) + '%');
  console.log('Average absolute difference: ' + fmt(avgAbsDiff));

  // Worst cases
  console.log('\n=== WORST CASES ===\n');
  const worst = [...results].sort((a, b) => Math.abs(b.error_pct) - Math.abs(a.error_pct)).slice(0, 5);
  worst.forEach((r, i) => {
    console.log((i + 1) + '. ' + r.wallet.substring(0, 14) + ': UI=' + fmt(r.ui_pnl) + ', V3=' + fmt(r.v3_pnl) + ' (' + (r.error_pct >= 0 ? '+' : '') + r.error_pct.toFixed(1) + '%)');
  });

  // Best cases
  console.log('\n=== BEST CASES ===\n');
  const best = [...results].sort((a, b) => Math.abs(a.error_pct) - Math.abs(b.error_pct)).slice(0, 5);
  best.forEach((r, i) => {
    console.log((i + 1) + '. ' + r.wallet.substring(0, 14) + ': UI=' + fmt(r.ui_pnl) + ', V3=' + fmt(r.v3_pnl) + ' (' + (r.error_pct >= 0 ? '+' : '') + r.error_pct.toFixed(1) + '%)');
  });
}

validate().catch(console.error);
