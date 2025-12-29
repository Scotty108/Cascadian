/**
 * V17 Test Against All 50 Benchmark Wallets
 *
 * Uses the same wallet set from comprehensive-v12-validation.ts
 * which contains manually collected UI PnL values from Polymarket.
 */

import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

// All 50 wallets with known UI PnL values from comprehensive-v12-validation.ts
const ALL_KNOWN_WALLETS = [
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
  { wallet: '0x56687bf447db6ffa42ffe2120c0099214e372dbba5e9', ui_pnl: 22053934, source: 'known' },
];

interface Result {
  wallet: string;
  ui_pnl: number;
  source: string;
  v17_realized: number;
  v17_unrealized: number;
  v17_total: number;
  error_pct: number;
  sign_match: boolean;
  positions: number;
}

async function main() {
  console.log('='.repeat(140));
  console.log('V17 TEST - ALL 50 BENCHMARK WALLETS');
  console.log('='.repeat(140));
  console.log(`Total wallets: ${ALL_KNOWN_WALLETS.length}`);
  console.log('');

  const engine = createV17Engine();
  const results: Result[] = [];
  let processed = 0;

  for (const w of ALL_KNOWN_WALLETS) {
    processed++;
    process.stdout.write(`[${processed}/${ALL_KNOWN_WALLETS.length}] ${w.wallet.substring(0, 12)}...`);
    const startTime = Date.now();

    try {
      const v17Result = await engine.compute(w.wallet);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      const v17_realized = v17Result.realized_pnl;
      const v17_unrealized = v17Result.unrealized_pnl;
      const v17_total = v17_realized + v17_unrealized;

      const error_pct = (Math.abs(v17_realized - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;
      const sign_match = (v17_realized >= 0) === (w.ui_pnl >= 0);

      results.push({
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        source: w.source,
        v17_realized,
        v17_unrealized,
        v17_total,
        error_pct,
        sign_match,
        positions: v17Result.positions_count,
      });

      console.log(` ${elapsed}s | ${v17Result.positions_count} pos | ${error_pct.toFixed(0)}% err`);
    } catch (err: any) {
      console.log(` ERROR: ${err.message.substring(0, 50)}`);
      results.push({
        wallet: w.wallet,
        ui_pnl: w.ui_pnl,
        source: w.source,
        v17_realized: 0,
        v17_unrealized: 0,
        v17_total: 0,
        error_pct: 100,
        sign_match: false,
        positions: 0,
      });
    }
  }

  // Sort by error
  const sorted = [...results].sort((a, b) => a.error_pct - b.error_pct);

  // Results table - top 20 best
  console.log('');
  console.log('='.repeat(140));
  console.log('TOP 20 BEST (lowest error)');
  console.log('='.repeat(140));
  console.log('Wallet (first 12)  | UI PnL           | V17 Realized     | Error %  | Sign | Source');
  console.log('-'.repeat(140));

  for (const r of sorted.slice(0, 20)) {
    const signStr = r.sign_match ? 'OK' : 'X';
    console.log(
      `${r.wallet.substring(0, 12)}... | $${r.ui_pnl.toLocaleString().padStart(14)} | $${r.v17_realized.toLocaleString().padStart(14)} | ${r.error_pct.toFixed(1).padStart(7)}% | ${signStr.padStart(4)} | ${r.source}`
    );
  }

  // Bottom 10 worst
  console.log('');
  console.log('='.repeat(140));
  console.log('TOP 10 WORST (highest error)');
  console.log('='.repeat(140));
  console.log('Wallet (first 12)  | UI PnL           | V17 Realized     | Error %  | Sign | Source');
  console.log('-'.repeat(140));

  for (const r of sorted.slice(-10).reverse()) {
    const signStr = r.sign_match ? 'OK' : 'X';
    console.log(
      `${r.wallet.substring(0, 12)}... | $${r.ui_pnl.toLocaleString().padStart(14)} | $${r.v17_realized.toLocaleString().padStart(14)} | ${r.error_pct.toFixed(1).padStart(7)}% | ${signStr.padStart(4)} | ${r.source}`
    );
  }

  // Summary statistics
  console.log('');
  console.log('='.repeat(140));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(140));

  const validResults = results.filter(r => r.positions > 0);
  const noData = results.filter(r => r.positions === 0);

  console.log(`Total wallets:     ${results.length}`);
  console.log(`With data:         ${validResults.length}`);
  console.log(`No data:           ${noData.length}`);

  // Sign match rate
  const signMatches = validResults.filter(r => r.sign_match).length;
  console.log(`Sign match rate:   ${signMatches}/${validResults.length} (${((signMatches / validResults.length) * 100).toFixed(1)}%)`);

  // Error statistics
  if (validResults.length > 0) {
    const errors = validResults.map(r => r.error_pct);
    const avgErr = errors.reduce((s, e) => s + e, 0) / errors.length;
    const sortedErrors = [...errors].sort((a, b) => a - b);
    const medianErr = sortedErrors[Math.floor(sortedErrors.length / 2)];
    const minErr = Math.min(...errors);
    const maxErr = Math.max(...errors);

    console.log('');
    console.log('Error distribution:');
    console.log(`  Min:     ${minErr.toFixed(1)}%`);
    console.log(`  Median:  ${medianErr.toFixed(1)}%`);
    console.log(`  Mean:    ${avgErr.toFixed(1)}%`);
    console.log(`  Max:     ${maxErr.toFixed(1)}%`);
  }

  // Pass rates at thresholds
  console.log('');
  console.log('Pass rates (error < threshold AND sign match):');
  const thresholds = [5, 10, 15, 25, 50, 100];
  for (const thresh of thresholds) {
    const passes = validResults.filter(r => r.error_pct < thresh && r.sign_match).length;
    console.log(`  <${thresh.toString().padStart(3)}%: ${passes}/${validResults.length} (${((passes / validResults.length) * 100).toFixed(1)}%)`);
  }

  // By source breakdown
  console.log('');
  console.log('By source:');
  const sources = ['fresh_ui', '1mo_old', 'known'];
  for (const src of sources) {
    const srcResults = validResults.filter(r => r.source === src);
    if (srcResults.length > 0) {
      const avgErr = srcResults.reduce((s, r) => s + r.error_pct, 0) / srcResults.length;
      const signMatch = srcResults.filter(r => r.sign_match).length;
      console.log(`  ${src.padEnd(10)}: ${srcResults.length} wallets, avg error ${avgErr.toFixed(1)}%, sign match ${signMatch}/${srcResults.length}`);
    }
  }

  console.log('');
  console.log('='.repeat(140));
  console.log('TEST COMPLETE');
  console.log('='.repeat(140));
}

main().catch(console.error);
