/**
 * PnL Engine V9 Tests
 *
 * Test-first approach: Define expected behavior, then implement to pass.
 *
 * Root cause of V1/V6 failures:
 * - CTF split transactions contain CLOB trades that are internal bookkeeping
 * - These trades inflate buy/sell counts without representing real user intent
 * - Solution: Exclude CLOB trades from split tx_hashes, use CTF events instead
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV9 } from './pnlEngineV9';
import { getWalletPnLV7 } from './pnlEngineV7';

// Test wallets with known API values (from V7)
const TEST_CASES = [
  // Passing in V1 (0 splits) - should still pass
  { wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', name: 'maker_heavy_1', splits: 0 },
  { wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', name: 'taker_heavy_1', splits: 0 },

  // Failing in V1 (has splits) - V9 should fix these
  { wallet: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4', name: 'spot_3_failing', splits: 43 },
  { wallet: '0x8d5bebb6dcf733f12200155c547cb9fa8d159069', name: 'spot_5_failing', splits: 144 },
  { wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0', name: 'spot_6_failing', splits: 50 },
];

async function runTests() {
  console.log('=== V9 vs V7 (API) Test Suite ===\n');
  console.log('Testing hypothesis: Exclude CLOB trades from split tx_hashes\n');

  let passed = 0;
  const results: Array<{
    name: string;
    v9: number;
    v7: number;
    diff: number;
    pass: boolean;
  }> = [];

  for (const tc of TEST_CASES) {
    try {
      const [v9, v7] = await Promise.all([
        getWalletPnLV9(tc.wallet),
        getWalletPnLV7(tc.wallet),
      ]);

      const diff =
        v7.totalPnl !== 0
          ? ((v9.totalPnl - v7.totalPnl) / Math.abs(v7.totalPnl)) * 100
          : v9.totalPnl === 0
            ? 0
            : 999;
      const pass = Math.abs(diff) < 10;
      if (pass) passed++;

      results.push({
        name: tc.name,
        v9: v9.totalPnl,
        v7: v7.totalPnl,
        diff,
        pass,
      });

      console.log(
        `${pass ? '✅' : '❌'} ${tc.name.padEnd(20)} | V9: $${v9.totalPnl.toFixed(2).padStart(10)} | API: $${v7.totalPnl.toFixed(2).padStart(10)} | Diff: ${diff.toFixed(1).padStart(6)}%`
      );
    } catch (error) {
      console.log(`❌ ${tc.name.padEnd(20)} | ERROR: ${error}`);
    }
  }

  console.log(`\n=== Results: ${passed}/${TEST_CASES.length} passed ===`);

  // Exit with error code if any test failed
  if (passed < TEST_CASES.length) {
    process.exit(1);
  }
}

runTests();
