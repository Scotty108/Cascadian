/**
 * Quick 5-wallet test of NegRisk-aware engine with dedupe fix
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { calculateWalletPnL } from '../lib/pnl/pnlEngineNegRiskAware';

// The 4 wallets that showed 2x error pattern
const TEST_WALLETS = [
  '0x80cd0939e0f5ca565a7c1ae40caca1ea2a932b4e',  // API: -0.39, was calc: -0.78 (2x)
  '0x6d1245d7fa771d3d8bec4ae9f843ed762f22a15e',  // API: -0.41, was calc: -0.83 (2x)
  '0x27c73b1b7bbc676f9482b26a7be5c2526121f8b7',  // API: -2.07, was calc: -4.14 (2x)
  '0x73ca420a8165966b21ed8f5db4d098d748abf7ef',  // API: -3.70, was calc: -7.39 (2x)
  '0x58f2b2e4787dfb67aabb3b4046f0d9e14b9c786f',  // API: 47.90, was calc: 53.65 (close)
];

const API_BASELINE: Record<string, number> = {
  '0x80cd0939e0f5ca565a7c1ae40caca1ea2a932b4e': -0.39,
  '0x6d1245d7fa771d3d8bec4ae9f843ed762f22a15e': -0.41,
  '0x27c73b1b7bbc676f9482b26a7be5c2526121f8b7': -2.07,
  '0x73ca420a8165966b21ed8f5db4d098d748abf7ef': -3.70,
  '0x58f2b2e4787dfb67aabb3b4046f0d9e14b9c786f': 47.90,
};

async function main() {
  console.log('=== Quick NegRisk-Aware Engine Test (with dedupe fix) ===\n');
  console.log('Testing 5 wallets that showed 2x error pattern...\n');

  console.log('Wallet                                     | API       | Calc      | Error     | Ratio');
  console.log('-'.repeat(95));

  for (const wallet of TEST_WALLETS) {
    try {
      const result = await calculateWalletPnL(wallet);
      const api = API_BASELINE[wallet];
      const error = result.total_pnl - api;
      const ratio = api !== 0 ? result.total_pnl / api : 0;

      console.log(
        `${wallet} | ` +
        `$${api.toFixed(2).padStart(7)} | ` +
        `$${result.total_pnl.toFixed(2).padStart(7)} | ` +
        `$${error.toFixed(2).padStart(7)} | ` +
        `${ratio.toFixed(2)}x`
      );
    } catch (e: any) {
      console.error(`${wallet} | ERROR: ${e.message}`);
    }
  }

  console.log('\n✅ Test complete');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
