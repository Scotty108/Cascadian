/**
 * V15 PnL Engine Tests - TDD for Neg Risk Synthetic Cost Adjustment
 *
 * Goal: 15/15 accuracy against Polymarket API
 *
 * Key insight from Polymarket subgraph:
 * - For bundled trades (Buy X + Sell Y in same tx_hash), the sell proceeds
 *   should reduce the cost basis of the bought position (synthetic cost adjustment)
 *   NOT count as realized PnL.
 *
 * Formula: new_avgPrice = old_avgPrice - (credit / amount)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV15 } from './pnlEngineV15';
import { getWalletPnLV7 } from './pnlEngineV7';

// All 15 test wallets - V6 passes 8, fails 7
const TEST_WALLETS = [
  // 8 PASSING wallets (V6 matches API within 10%)
  { name: 'original', wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052', v6Pass: true },
  { name: 'maker_heavy_1', wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', v6Pass: true },
  { name: 'taker_heavy_1', wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', v6Pass: true },
  { name: 'taker_heavy_2', wallet: '0x94fabfc86594fffbf76996e2f66e5e19675a8164', v6Pass: true },
  { name: 'mixed_1', wallet: '0x583537b26372c4527ff0eb9766da22fb6ab038cd', v6Pass: true },
  { name: 'spot_1', wallet: '0x969fdceba722e381776044c3b14ef1729511ad37', v6Pass: true },
  { name: 'spot_2', wallet: '0xee81df87bc51eebc6a050bb70638c5e56063ef68', v6Pass: true },
  { name: 'spot_3', wallet: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4', v6Pass: true },

  // 7 FAILING wallets (V6 does NOT match API - these are Neg Risk heavy)
  { name: 'spot_4', wallet: '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0', v6Pass: false },
  { name: 'spot_5', wallet: '0x8d5bebb6dcf733f12200155c547cb9fa8d159069', v6Pass: false },
  { name: 'spot_6', wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0', v6Pass: false },
  { name: 'spot_7', wallet: '0x045b5748b78efe2988e4574fe362cf91a3ea1d11', v6Pass: false },
  { name: 'spot_8', wallet: '0xfd9497fe764af214076458e9651db9f39febb3bf', v6Pass: false },
  { name: 'spot_9', wallet: '0x61341f266a614cc511d2f606542b0774688998b0', v6Pass: false },
  { name: 'spot_10', wallet: '0x8302a1109f398b6003990a325228315993242815', v6Pass: false },
];

// Tolerance: 10% diff from API or $1 absolute (for small values near zero)
function isMatch(calculated: number, api: number): boolean {
  if (Math.abs(api) < 1) {
    // For small values, use absolute tolerance
    return Math.abs(calculated - api) < 1;
  }
  const pctDiff = Math.abs((calculated - api) / api) * 100;
  return pctDiff < 10;
}

async function runTests() {
  console.log('=== V15 PnL Engine Test Suite ===\n');
  console.log('Testing synthetic cost adjustment for Neg Risk bundled trades\n');
  console.log('Name           | V15 Calc     | API (truth)  | Diff      | Status');
  console.log('---------------|--------------|--------------|-----------|-------');

  let passed = 0;
  let failed = 0;
  const results: Array<{
    name: string;
    wallet: string;
    v15: number;
    api: number;
    diff: number;
    match: boolean;
    v6Pass: boolean;
  }> = [];

  for (const w of TEST_WALLETS) {
    try {
      const [v15Result, apiResult] = await Promise.all([
        getWalletPnLV15(w.wallet),
        getWalletPnLV7(w.wallet),
      ]);

      const v15Total = v15Result.totalPnl;
      const apiTotal = apiResult.totalPnl;
      const diff =
        apiTotal !== 0 ? ((v15Total - apiTotal) / Math.abs(apiTotal)) * 100 : v15Total === 0 ? 0 : 999;

      const match = isMatch(v15Total, apiTotal);
      if (match) passed++;
      else failed++;

      results.push({
        name: w.name,
        wallet: w.wallet,
        v15: v15Total,
        api: apiTotal,
        diff,
        match,
        v6Pass: w.v6Pass,
      });

      const status = match ? '✅ PASS' : '❌ FAIL';
      console.log(
        `${w.name.padEnd(14)} | $${v15Total.toFixed(2).padStart(11)} | $${apiTotal.toFixed(2).padStart(11)} | ${diff.toFixed(1).padStart(8)}% | ${status}`
      );
    } catch (error) {
      console.log(`${w.name.padEnd(14)} | ERROR: ${error}`);
      failed++;
    }
  }

  console.log(`\n=== RESULTS: ${passed}/${TEST_WALLETS.length} passed ===\n`);

  // Show improvement from V6
  const v6Passing = results.filter((r) => r.v6Pass).length;
  const newlyFixed = results.filter((r) => !r.v6Pass && r.match).length;
  const stillFailing = results.filter((r) => !r.match);

  console.log(`V6 baseline: ${v6Passing}/15 passing`);
  console.log(`V15 result: ${passed}/15 passing`);
  console.log(`Newly fixed: ${newlyFixed} wallets`);

  if (stillFailing.length > 0) {
    console.log('\n=== STILL FAILING ===');
    for (const f of stillFailing) {
      console.log(`${f.name}: V15=$${f.v15.toFixed(2)} API=$${f.api.toFixed(2)} (${f.diff.toFixed(1)}%)`);
    }
  }

  // Exit with error if not all pass
  if (passed < TEST_WALLETS.length) {
    process.exit(1);
  }
}

runTests().catch(console.error);
