/**
 * Net Flow P&L - Test Script
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeNetFlowPnl } from '@/lib/pnl/netFlowPnl';

const TEST_WALLETS = [
  {
    address: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e',
    name: 'calibration',
    targetPnl: -86,
    tolerance: 5,
  },
  {
    address: '0x0d0e73b88444c21094421447451e15e9c4f14049',
    name: 'alexma11224',
    targetPnl: 375,
    tolerance: Infinity, // Sign only
  },
  {
    address: '0xfb328b94ed05115259bbc48ba8182df1416edb85',
    name: 'winner1',
    targetPnl: 25594,
    tolerance: Infinity, // Sign only
  },
];

async function runTests() {
  console.log('=== NET FLOW P&L TEST ===\n');
  console.log('Aggregate-first approach: only infer splits for NET deficits.\n');

  for (const wallet of TEST_WALLETS) {
    console.log(`--- ${wallet.name} ---`);
    console.log(`Target: $${wallet.targetPnl}`);

    try {
      const result = await computeNetFlowPnl(wallet.address);

      console.log(`\nResults:`);
      console.log(`  Buys: $${result.buys.toFixed(2)}`);
      console.log(`  Sells: $${result.sells.toFixed(2)}`);
      console.log(`  Redemptions: $${result.redemptions.toFixed(2)}`);
      console.log(`  Merges: $${result.merges.toFixed(2)}`);
      console.log(`  Explicit Splits: $${result.explicitSplits.toFixed(2)}`);
      console.log(`  Inferred Split Cost: $${result.inferredSplitCost.toFixed(2)}`);
      console.log(`  Total Split Cost: $${result.totalSplitCost.toFixed(2)}`);
      console.log(`  ---`);
      console.log(`  Realized P&L: $${result.realizedPnl.toFixed(2)}`);
      console.log(`  ---`);
      console.log(`  Trades: ${result.trades}`);
      console.log(`  Conditions with deficit: ${result.conditions}`);
      console.log(`  Tokens with deficit: ${result.tokensWithDeficit}`);

      const error = Math.abs(result.realizedPnl - wallet.targetPnl);
      const signMatch = (result.realizedPnl >= 0) === (wallet.targetPnl >= 0);
      const passed = wallet.tolerance === Infinity ? signMatch : error <= wallet.tolerance;

      console.log(`\n  Target: $${wallet.targetPnl}`);
      console.log(`  Actual: $${result.realizedPnl.toFixed(2)}`);
      console.log(`  Error: $${error.toFixed(2)}`);
      console.log(`  Sign Match: ${signMatch ? 'YES' : 'NO'}`);
      console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
    } catch (err) {
      console.error(`  Error: ${err}`);
    }

    console.log('');
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
