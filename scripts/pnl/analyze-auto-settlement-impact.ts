/**
 * Analyze the impact of auto-settlement on PnL calculation
 *
 * Hypothesis: The engine's auto-settlement of losing positions is causing
 * massive discrepancies vs UI, which may not book unredeemed losses.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { computePnL } from '../../lib/pnl/engineRouter';

const TEST_WALLETS = [
  { address: '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd', name: '@cozyfnf', uiPnl: 1409524.60 },
  { address: '0x8fe70c889ce14f67acea5d597e3d0351d73b4f20', name: '@amused85', uiPnl: -3405.14 },
  { address: '0x42592084120b0d5287059919d2a96b3b7acb936f', name: '@antman', uiPnl: 416895.80 },
  { address: '0xb744f56635b537e859152d14b022af5afe485210', name: 'wasianiversonworldchamp2025', uiPnl: 2860257 },
];

async function main() {
  console.log('=== AUTO-SETTLEMENT IMPACT ANALYSIS ===\n');

  console.log('Wallet                          | Engine PnL    | UI PnL        | Auto-Settle | Without AS    | Delta vs UI');
  console.log('-'.repeat(120));

  for (const wallet of TEST_WALLETS) {
    try {
      const result = await computePnL(wallet.address, 'polymarket_avgcost_v1');
      const autoSettled = (result.metadata?.autoSettledPnl as number) || 0;

      // What would PnL be WITHOUT auto-settlement?
      const withoutAutoSettle = result.totalPnl - autoSettled;

      const deltaEngine = wallet.uiPnl !== 0
        ? ((result.totalPnl - wallet.uiPnl) / Math.abs(wallet.uiPnl)) * 100
        : 0;

      const deltaWithoutAS = wallet.uiPnl !== 0
        ? ((withoutAutoSettle - wallet.uiPnl) / Math.abs(wallet.uiPnl)) * 100
        : 0;

      const formatNum = (n: number) => {
        const formatted = '$' + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
        return n < 0 ? '-' + formatted : '+' + formatted;
      };

      console.log(
        `${wallet.name.padEnd(30)} | ${formatNum(result.totalPnl).padStart(13)} | ${formatNum(wallet.uiPnl).padStart(13)} | ${formatNum(autoSettled).padStart(11)} | ${formatNum(withoutAutoSettle).padStart(13)} | ${deltaEngine > 0 ? '+' : ''}${deltaEngine.toFixed(0)}%`
      );

      // Extra analysis for worst case
      if (Math.abs(deltaEngine) > 100) {
        console.log(`   ^ Massive discrepancy! Auto-settlement = ${formatNum(autoSettled)}`);
        console.log(`   ^ Without AS: delta would be ${deltaWithoutAS > 0 ? '+' : ''}${deltaWithoutAS.toFixed(0)}%`);
      }
    } catch (error) {
      console.log(`${wallet.name.padEnd(30)} | ERROR: ${error}`);
    }
  }

  console.log('\n\nKEY INSIGHT:');
  console.log('If "Without AS" is closer to UI than "Engine PnL", then auto-settlement is the problem.');
  console.log('If neither is close to UI, then there\'s a more fundamental data/calculation issue.');
}

main().catch(console.error);
