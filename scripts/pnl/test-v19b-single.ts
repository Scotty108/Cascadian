/**
 * Test V19b engine against a single wallet
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateV19bPnL } from '../../lib/pnl/uiActivityEngineV19b';

async function main() {
  const wallets = [
    { address: '0x8fe70c889ce14f67acea5d597e3d0351d73b4f20', name: 'FALSE POSITIVE', uiPnl: -3538 },
    { address: '0x1ff26f9f8a048d4f6fb2e4283f32f6ca64d2dbbd', name: 'cozyfnf (accurate)', uiPnl: 1409525 },
    { address: '0x42592084120b0d5287059919d2a96b3b7acb936f', name: 'antman (124x over)', uiPnl: 30539 },
  ];

  for (const w of wallets) {
    console.log(`\n=== ${w.name} ===`);
    console.log(`Wallet: ${w.address}`);
    console.log(`UI PnL: $${w.uiPnl.toLocaleString()}`);

    try {
      const result = await calculateV19bPnL(w.address);
      console.log(`V19b Realized: $${Math.round(result.realized_pnl).toLocaleString()}`);
      console.log(`V19b Unrealized: $${Math.round(result.unrealized_pnl).toLocaleString()}`);
      console.log(`V19b Total: $${Math.round(result.total_pnl).toLocaleString()}`);
      console.log(`Positions: ${result.positions}, Resolved: ${result.resolved}`);

      const delta = ((result.total_pnl - w.uiPnl) / Math.abs(w.uiPnl)) * 100;
      console.log(`Delta vs UI: ${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`);
    } catch (err) {
      console.error('Error:', err);
    }
  }
}

main().catch(console.error);
