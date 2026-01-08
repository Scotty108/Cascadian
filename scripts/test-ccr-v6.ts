#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv6 } from '../lib/pnl/ccrEngineV6';

// Test wallets with known UI PnL values
const TEST_WALLETS = [
  {
    name: 'Split-Heavy',
    address: '0xb2e4567925b79231265adf5d54687ddfb761bc51',
    ui_pnl: -115409.28,
    description: 'Heavy use of proxy splits, needs maker-only approach',
  },
  {
    name: 'Taker-Heavy',
    address: '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec',
    ui_pnl: -1129,
    description: 'Legitimate taker trades, needs all-trades approach',
  },
];

async function main() {
  console.log('='.repeat(70));
  console.log('CCR-v6: Unified PnL Engine Test');
  console.log('='.repeat(70));
  console.log('');
  console.log('Detection rule: if (taker_sell_tokens / total_buy_tokens > 1.0)');
  console.log('                  → use maker-only approach');
  console.log('                else');
  console.log('                  → use all-trades approach');

  let allPassed = true;

  for (const wallet of TEST_WALLETS) {
    console.log('\n' + '-'.repeat(70));
    console.log(`${wallet.name} (${wallet.description})`);
    console.log(`Address: ${wallet.address}`);

    const result = await computeCCRv6(wallet.address);
    const error = Math.abs(result.total_pnl - wallet.ui_pnl) / Math.abs(wallet.ui_pnl) * 100;
    const passed = error < 5;

    console.log('');
    console.log(`  Taker sell ratio: ${result.taker_sell_ratio.toFixed(2)}`);
    console.log(`  Selected method: ${result.method}`);
    console.log(`  Confidence: ${result.confidence}`);
    console.log('');
    console.log(`  Trade breakdown:`);
    console.log(`    Total trades: ${result.total_trades} (maker: ${result.maker_trades}, taker: ${result.taker_trades})`);
    console.log(`    Total buy USDC: $${result.total_buy_usdc.toLocaleString()}`);
    console.log(`    Total sell USDC: $${result.total_sell_usdc.toLocaleString()}`);
    console.log(`    Maker buy USDC: $${result.maker_buy_usdc.toLocaleString()}`);
    console.log(`    Maker sell USDC: $${result.maker_sell_usdc.toLocaleString()}`);
    console.log(`    Resolution payouts: $${result.payout_usdc.toLocaleString()}`);
    console.log('');
    console.log(`  Computed PnL: $${result.total_pnl.toLocaleString()}`);
    console.log(`  UI PnL: $${wallet.ui_pnl.toLocaleString()}`);
    console.log(`  Error: ${error.toFixed(2)}%`);
    console.log(`  Result: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

    if (!passed) allPassed = false;
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY:');
  console.log('='.repeat(70));

  for (const wallet of TEST_WALLETS) {
    const result = await computeCCRv6(wallet.address);
    const error = Math.abs(result.total_pnl - wallet.ui_pnl) / Math.abs(wallet.ui_pnl) * 100;
    const passed = error < 5;
    console.log(`  ${wallet.name}: ${passed ? 'PASS' : 'FAIL'} (${error.toFixed(2)}% error, method: ${result.method})`);
  }

  console.log('');
  console.log(`All tests ${allPassed ? 'PASSED ✓' : 'FAILED ✗'}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
