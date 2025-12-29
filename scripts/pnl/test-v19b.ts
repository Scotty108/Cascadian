/**
 * Test V19b with synthetic resolution
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateV19bPnL } from '../../lib/pnl/uiActivityEngineV19b';
import { calculateV19PnL } from '../../lib/pnl/uiActivityEngineV19';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   V19b TEST - Synthetic Resolution                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Test wallet with known active positions
  const testWallets = [
    { wallet: '0x59c2a6bfcc65386bd0332f45822e45510482ad06', ui_pnl: 69.04, note: 'Has active positions at ~100¢' },
    { wallet: '0x16ea6d68c8305c1c8f95d247d0845d19c9cf6df7', ui_pnl: 2607.79, note: 'Original test wallet' },
    { wallet: '0x63a66916ffbe6cd9a9613664d83af0da352fd7dc', ui_pnl: -75.79, note: 'Perfect match in V19' },
  ];

  for (const { wallet, ui_pnl, note } of testWallets) {
    console.log('─'.repeat(70));
    console.log(`Wallet: ${wallet}`);
    console.log(`Note: ${note}`);
    console.log(`UI PnL: $${ui_pnl.toFixed(2)}`);
    console.log();

    try {
      // Test V19 (baseline)
      console.log('Testing V19 (baseline)...');
      const v19Start = Date.now();
      const v19Result = await calculateV19PnL(wallet);
      const v19Elapsed = Date.now() - v19Start;
      const v19Delta = ((v19Result.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100;

      console.log(`  V19: $${v19Result.total_pnl.toFixed(2)} (delta: ${v19Delta >= 0 ? '+' : ''}${v19Delta.toFixed(1)}%) [${v19Elapsed}ms]`);
      console.log(`       Resolved: ${v19Result.resolved}, Unrealized: $${v19Result.unrealized_pnl.toFixed(2)}`);

      // Test V19b (with synthetic resolution)
      console.log('\nTesting V19b (synthetic resolution)...');
      const v19bStart = Date.now();
      const v19bResult = await calculateV19bPnL(wallet);
      const v19bElapsed = Date.now() - v19bStart;
      const v19bDelta = ((v19bResult.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100;

      console.log(`  V19b: $${v19bResult.total_pnl.toFixed(2)} (delta: ${v19bDelta >= 0 ? '+' : ''}${v19bDelta.toFixed(1)}%) [${v19bElapsed}ms]`);
      console.log(`        Resolved: ${v19bResult.resolved}, Synthetic: ${v19bResult.synthetic_resolved}, Unrealized: $${v19bResult.unrealized_pnl.toFixed(2)}`);

      // Compare improvement
      const improvement = Math.abs(v19Delta) - Math.abs(v19bDelta);
      if (improvement > 0) {
        console.log(`\n  ✅ V19b improved by ${improvement.toFixed(1)} percentage points`);
      } else if (improvement < 0) {
        console.log(`\n  ⚠️  V19b delta increased by ${Math.abs(improvement).toFixed(1)} percentage points`);
      } else {
        console.log(`\n  → Same result`);
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e.message}`);
    }

    console.log();
  }
}

main().catch(console.error);
