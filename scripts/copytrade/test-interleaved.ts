/**
 * Test Interleaved Ledger P&L
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeInterleavedPnl } from '@/lib/pnl/interleavedLedger';

const TEST_WALLETS = [
  { address: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e', name: 'calibration', target: -86 },
  { address: '0x0d0e73b88444c21094421447451e15e9c4f14049', name: 'alexma11224', target: 375 },
  { address: '0xfb328b94ed05115259bbc48ba8182df1416edb85', name: 'winner1', target: 25594 },
];

async function main() {
  console.log('=== INTERLEAVED LEDGER TEST ===\n');
  console.log('Processes CLOB trades and CTF events in strict chronological order.\n');

  for (const w of TEST_WALLETS) {
    console.log(`--- ${w.name} ---`);
    console.log(`Target: $${w.target}`);

    try {
      const result = await computeInterleavedPnl(w.address);

      console.log(`Engine P&L: $${result.realizedPnl.toFixed(2)}`);
      console.log(`  Buys: $${result.buys.toFixed(0)}`);
      console.log(`  Sells: $${result.sells.toFixed(0)}`);
      console.log(`  Redemptions: $${result.redemptions.toFixed(0)}`);
      console.log(`  Merges: $${result.merges.toFixed(0)}`);
      console.log(`  Split Cost: $${result.splitCost.toFixed(0)}`);
      console.log(`  Mapping: ${(result.mappingCoveragePct * 100).toFixed(1)}%`);
      console.log(`  Events: ${result.trades} trades, ${result.ctfEvents} CTF`);

      const error = Math.abs(result.realizedPnl - w.target);
      const errorPct = (error / Math.abs(w.target)) * 100;
      const signMatch = (result.realizedPnl >= 0) === (w.target >= 0);

      console.log(`\n  Error: $${error.toFixed(0)} (${errorPct.toFixed(0)}%)`);
      console.log(`  Sign: ${signMatch ? '✅' : '❌'}`);
    } catch (err) {
      console.error(`  Error: ${err}`);
    }

    console.log('');
  }
}

main().catch(console.error);
