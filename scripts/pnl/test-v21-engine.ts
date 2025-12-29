/**
 * Test V21 Synthetic Engine
 *
 * Tests the new V21 engine with real mark prices and synthetic resolutions.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateV21PnL } from '../../lib/pnl/v21SyntheticEngine';

// Test wallets from previous batch
const testWallets = [
  { wallet: '0xf5201f998333d228dafba270d01d8ff82b2c0637', name: '@rbnoftg', ui_net: 879268 },
  { wallet: '0xe9c6312464b52aa3eff13d822b003282075995c9', name: '@kingofcoinflips', ui_net: 618061 },
  { wallet: '0xc6aefc2cf3f95cc3859105203167fdd79bd4bd0a', name: 'wallet3', ui_net: null },
  { wallet: '0xdb32d3d83ec2638be539f768e31a3cc89250b646', name: 'wallet4', ui_net: null },
  { wallet: '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4', name: '@ForgetAboutBenjamin', ui_net: 10268 },
];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               V21 SYNTHETIC ENGINE TEST                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Features:');
  console.log('  - Wallet-scoped dedupe by event_id');
  console.log('  - External inventory clamp');
  console.log('  - Synthetic resolutions (settle at payout_norm)');
  console.log('  - Real mark prices from pm_latest_mark_price_v1\n');

  console.log('┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ Wallet                                       │ Gain       │ Loss       │ Net         │ UI Net      │ Delta %  │ Eligible │');
  console.log('├──────────────────────────────────────────────────────────────────────────────────────────────────────┤');

  for (const t of testWallets) {
    try {
      const result = await calculateV21PnL(t.wallet);

      const gainStr = `+$${result.gain.toLocaleString(undefined, { maximumFractionDigits: 0 })}`.padStart(10);
      const lossStr = `-$${result.loss.toLocaleString(undefined, { maximumFractionDigits: 0 })}`.padStart(10);
      const netStr = (result.net >= 0 ? '+' : '') + `$${result.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`.padStart(10);

      let uiStr = 'N/A'.padStart(11);
      let deltaStr = 'N/A'.padStart(8);

      if (t.ui_net !== null) {
        uiStr = `$${t.ui_net.toLocaleString()}`.padStart(11);
        const deltaPct = ((result.net - t.ui_net) / Math.abs(t.ui_net)) * 100;
        deltaStr = `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`.padStart(8);
      }

      const eligibleStr = result.is_eligible ? '✅' : '❌';

      console.log(
        `│ ${t.wallet.padEnd(44)} │ ${gainStr} │ ${lossStr} │ ${netStr} │ ${uiStr} │ ${deltaStr} │    ${eligibleStr}    │`
      );
    } catch (e: any) {
      console.log(
        `│ ${t.wallet.padEnd(44)} │ ERROR: ${e.message.slice(0, 60).padEnd(76)} │`
      );
    }
  }

  console.log('└──────────────────────────────────────────────────────────────────────────────────────────────────────┘\n');

  // Detailed output for first wallet
  console.log('Detailed result for @rbnoftg:');
  const detail = await calculateV21PnL(testWallets[0].wallet);
  console.log(JSON.stringify(detail, null, 2));
}

main().catch(console.error);
