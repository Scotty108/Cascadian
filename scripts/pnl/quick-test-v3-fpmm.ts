/**
 * Quick test of V3+FPMM engine
 *
 * Tests a few wallets to verify the engine produces reasonable results.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { computeWalletActivityPnlV3Debug } from '../../lib/pnl/uiActivityEngineV3';
import { computeWalletActivityPnlV3WithFPMMDebug } from '../../lib/pnl/uiActivityEngineV3WithFPMM';

// Test wallets: mix of FPMM-heavy and CLOB-only
const testWallets = [
  // Original astronomical wallet (should now be reasonable)
  '0xb5fc4d5388952dc7a798fe784fe659f9a20e5ca4',
  // Another FPMM-heavy wallet from earlier test
  '0x4c0170c18fd89b2a05e0ac6a8cb7e54ef4c66ad8',
  // A standard CLOB wallet for comparison
  '0x8c2758e0fe16fa55c90b05d11c5ac89f0f4ade3a',
  // Wallet from V6 accuracy report
  '0xa60acdbd1d5a1df4a9be92f5434a9f5c6f5d9e1b',
];

async function quickTest() {
  console.log('=== QUICK TEST: V3 vs V3+FPMM ===\n');

  const fmt = (n: number) => {
    if (Math.abs(n) > 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    if (Math.abs(n) > 1000) return '$' + (n / 1000).toFixed(2) + 'K';
    return '$' + n.toFixed(2);
  };

  console.log('| Wallet | UI PnL (est) | V3 PnL | V3+FPMM PnL | FPMM Fills | Diff |');
  console.log('|--------|--------------|--------|-------------|------------|------|');

  for (const wallet of testWallets) {
    try {
      const [v3Result, v3FpmmResult] = await Promise.all([
        computeWalletActivityPnlV3Debug(wallet),
        computeWalletActivityPnlV3WithFPMMDebug(wallet),
      ]);

      const diff = v3FpmmResult.pnl_activity_total - v3Result.pnl_activity_total;
      const diffStr = diff > 0 ? '+' + fmt(diff) : fmt(diff);

      console.log(
        `| ${wallet.substring(0, 12)}... |      N/A     | ${fmt(v3Result.pnl_activity_total).padStart(8)} | ${fmt(v3FpmmResult.pnl_activity_total).padStart(11)} | ${String(v3FpmmResult.fpmm_fills_count).padStart(10)} | ${diffStr.padStart(6)} |`
      );
    } catch (e: any) {
      console.log(`| ${wallet.substring(0, 12)}... | ERROR: ${e.message.substring(0, 30)} |`);
    }
  }

  console.log('\n--- Analysis ---');
  console.log('If FPMM Fills > 0 and Diff is non-zero, V3+FPMM is capturing additional trading activity.');
  console.log('Reasonable Diff range: -$50K to +$50K for most wallets.');
  console.log('If Diff is astronomical ($100M+), there is still a bug in the engine.');
}

quickTest().catch(console.error);
