/**
 * Test V12 Realized PnL Engine
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateRealizedPnlV12, closeClient } from '../../lib/pnl/realizedPnlV12';

const WALLETS = [
  { address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', name: 'W2', expected: 4404.92 },
  { address: '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', name: 'darkrider11', expected: 604472 },
];

async function main() {
  console.log('\n=== V12 Realized PnL Engine Test ===\n');

  for (const wallet of WALLETS) {
    console.log(`Testing ${wallet.name} (${wallet.address.slice(0, 10)}...):`);

    // Test with maker only (default)
    const makerResult = await calculateRealizedPnlV12(wallet.address, { makerOnly: true });
    console.log(`  Maker-only: $${makerResult.realizedPnl.toLocaleString()}`);
    console.log(`    Events: ${makerResult.eventCount} (${makerResult.resolvedEvents} resolved, ${makerResult.unresolvedEvents} unresolved)`);
    console.log(`    Unresolved %: ${makerResult.unresolvedPct.toFixed(1)}%`);

    // Test with all roles
    const allResult = await calculateRealizedPnlV12(wallet.address, { makerOnly: false });
    console.log(`  All roles: $${allResult.realizedPnl.toLocaleString()}`);
    console.log(`    Events: ${allResult.eventCount} (${allResult.resolvedEvents} resolved, ${allResult.unresolvedEvents} unresolved)`);
    console.log(`    Maker: ${allResult.makerEvents}, Taker: ${allResult.takerEvents}`);

    // Compare to expected
    const error = ((allResult.realizedPnl - wallet.expected) / wallet.expected) * 100;
    console.log(`  Expected: $${wallet.expected.toLocaleString()}`);
    console.log(`  Error: ${error.toFixed(2)}%`);
    console.log('');
  }

  await closeClient();
}

main().catch(console.error);
