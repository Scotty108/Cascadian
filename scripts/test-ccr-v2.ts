/**
 * Test CCR-v2 Universal Engine
 *
 * Tests against known wallets to verify accuracy:
 * - Latina (taker-heavy): Should be close to +$165K UI
 * - ChangoChango (maker-heavy): Should be close to +$37K UI
 * - TheLARPDestroyer (73% maker): Should be close to -$387 UI
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv2 } from '../lib/pnl/ccrEngineV2';
import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

const TEST_WALLETS = [
  {
    name: 'Latina',
    wallet: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae',
    ui_pnl: 165000, // Approximate from UI
  },
  {
    name: 'ChangoChango',
    wallet: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28',
    ui_pnl: 37000, // Approximate from UI
  },
  {
    name: 'TheLARPDestroyer',
    wallet: '0x3f52c2cd815b20f7557c173b76c2956b422543de',
    ui_pnl: -387, // From UI
  },
];

async function main() {
  console.log('═'.repeat(80));
  console.log('CCR-v2 UNIVERSAL ENGINE TEST');
  console.log('═'.repeat(80));
  console.log();

  for (const test of TEST_WALLETS) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Testing: ${test.name} (${test.wallet.slice(0, 10)}...)`);
    console.log(`UI PnL: $${test.ui_pnl.toLocaleString()}`);
    console.log('─'.repeat(80));

    try {
      // Test CCR-v2
      console.log('\n[CCR-v2] Computing...');
      const v2Start = Date.now();
      const v2 = await computeCCRv2(test.wallet);
      const v2Time = ((Date.now() - v2Start) / 1000).toFixed(1);

      console.log(`\n[CCR-v2 Results] (${v2Time}s)`);
      console.log(`  Realized PnL:   $${v2.realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Unrealized PnL: $${v2.unrealized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Total PnL:      $${v2.total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log();
      console.log(`  Token Sources:`);
      console.log(`    CLOB Buys:    ${v2.clob_buys.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens`);
      console.log(`    Split Buys:   ${v2.split_buys.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens`);
      console.log(`    CLOB Sells:   ${v2.clob_sells.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens`);
      console.log(`    Merge Sells:  ${v2.merge_sells.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens`);
      console.log(`    Redemptions:  ${v2.redemption_tokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens`);
      console.log();
      console.log(`  External Sells: ${v2.external_sell_tokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens (${(v2.external_sell_ratio * 100).toFixed(1)}%)`);
      console.log(`  Confidence:     ${v2.pnl_confidence.toUpperCase()}`);
      console.log(`  Win Rate:       ${(v2.win_rate * 100).toFixed(1)}%`);

      // Compare to UI
      const v2Diff = v2.realized_pnl - test.ui_pnl;
      const v2DiffPct = test.ui_pnl !== 0 ? (v2Diff / Math.abs(test.ui_pnl)) * 100 : 0;
      const v2Status = Math.abs(v2DiffPct) < 20 ? '✅' : Math.abs(v2DiffPct) < 50 ? '⚠️' : '❌';
      console.log(`\n  vs UI: ${v2Status} ${v2Diff >= 0 ? '+' : ''}$${v2Diff.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${v2DiffPct >= 0 ? '+' : ''}${v2DiffPct.toFixed(1)}%)`);

      // Also run CCR-v1 for comparison
      console.log('\n[CCR-v1] Computing for comparison...');
      const v1Start = Date.now();
      const v1 = await computeCCRv1(test.wallet);
      const v1Time = ((Date.now() - v1Start) / 1000).toFixed(1);

      const v1Diff = v1.realized_pnl - test.ui_pnl;
      const v1DiffPct = test.ui_pnl !== 0 ? (v1Diff / Math.abs(test.ui_pnl)) * 100 : 0;
      const v1Status = Math.abs(v1DiffPct) < 20 ? '✅' : Math.abs(v1DiffPct) < 50 ? '⚠️' : '❌';

      console.log(`[CCR-v1 Results] (${v1Time}s)`);
      console.log(`  Realized PnL: $${v1.realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  External Sells: ${(v1.external_sell_ratio * 100).toFixed(1)}%`);
      console.log(`  vs UI: ${v1Status} ${v1Diff >= 0 ? '+' : ''}$${v1Diff.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${v1DiffPct >= 0 ? '+' : ''}${v1DiffPct.toFixed(1)}%)`);

      // Show improvement
      if (Math.abs(v2DiffPct) < Math.abs(v1DiffPct)) {
        console.log(`\n  🎯 V2 IMPROVED by ${(Math.abs(v1DiffPct) - Math.abs(v2DiffPct)).toFixed(1)} percentage points`);
      } else if (Math.abs(v2DiffPct) > Math.abs(v1DiffPct)) {
        console.log(`\n  ⚠️ V1 was better by ${(Math.abs(v2DiffPct) - Math.abs(v1DiffPct)).toFixed(1)} percentage points`);
      }

    } catch (e: any) {
      console.error(`  Error: ${e.message}`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('TEST COMPLETE');
  console.log('═'.repeat(80));

  process.exit(0);
}

main().catch(console.error);
