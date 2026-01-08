#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv7 } from '../lib/pnl/ccrEngineV7';

// Enable debug
process.env.CCR_DEBUG = '1';

const TEST_WALLETS = [
  {
    name: 'Split-Heavy',
    address: '0xb2e4567925b79231265adf5d54687ddfb761bc51',
    ui_pnl: -115409.28,
  },
  {
    name: 'Taker-Heavy',
    address: '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec',
    ui_pnl: -26049.95, // Updated Jan 2026 - verified via Playwright, previous -1129 was stale
  },
];

async function main() {
  console.log('='.repeat(70));
  console.log('CCR-v7: Subgraph-Style Unified PnL Engine');
  console.log('='.repeat(70));
  console.log('');
  console.log('Based on Polymarket subgraph logic:');
  console.log('- Splits = buy at $0.50 per outcome');
  console.log('- Merges = sell at $0.50 per outcome');
  console.log('- CLOB trades = actual prices');
  console.log('- realizedPnl = amount × (price - avgPrice)');
  console.log('- **NEW**: Proxy splits attributed via tx_hash matching');

  let allPassed = true;

  for (const wallet of TEST_WALLETS) {
    console.log('\n' + '-'.repeat(70));
    console.log(`${wallet.name}: ${wallet.address}`);

    const result = await computeCCRv7(wallet.address);
    const error = Math.abs(result.total_pnl - wallet.ui_pnl) / Math.abs(wallet.ui_pnl) * 100;
    const passed = error < 5;

    console.log('');
    console.log(`  Event Processing:`);
    console.log(`    CLOB trades: ${result.clob_trades_processed}`);
    console.log(`    User splits: ${result.user_splits_processed}`);
    console.log(`    User merges: ${result.user_merges_processed}`);
    console.log(`    Proxy splits: ${result.proxy_splits_processed}`);
    console.log(`    Redemptions: ${result.redemptions_processed}`);
    console.log('');
    console.log(`  Position Tracking:`);
    console.log(`    Positions tracked: ${result.positions_tracked}`);
    console.log(`    Overcapped sells: ${result.overcapped_sells}`);
    console.log('');
    console.log(`  PnL Breakdown:`);
    console.log(`    Realized PnL: $${result.realized_pnl.toLocaleString()}`);
    console.log(`    Unrealized PnL: $${result.unrealized_pnl.toLocaleString()}`);
    console.log(`    Total PnL: $${result.total_pnl.toLocaleString()}`);
    console.log('');
    console.log(`  Comparison:`);
    console.log(`    Computed: $${result.total_pnl.toLocaleString()}`);
    console.log(`    UI PnL: $${wallet.ui_pnl.toLocaleString()}`);
    console.log(`    Error: ${error.toFixed(2)}%`);
    console.log(`    Result: ${passed ? 'PASS ✓' : 'FAIL ✗'}`);

    if (!passed) allPassed = false;
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY:');
  console.log('='.repeat(70));

  for (const wallet of TEST_WALLETS) {
    const result = await computeCCRv7(wallet.address);
    const error = Math.abs(result.total_pnl - wallet.ui_pnl) / Math.abs(wallet.ui_pnl) * 100;
    console.log(`  ${wallet.name}: ${error < 5 ? 'PASS' : 'FAIL'} (${error.toFixed(2)}% error)`);
  }

  console.log('');
  console.log(`All tests ${allPassed ? 'PASSED ✓' : 'FAILED ✗'}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
