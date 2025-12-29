/**
 * Quick Batch V20b Validation
 * Tests V20b PnL engine on a batch of wallets
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

const wallets = [
  "0xb082f3c9148a62fe848f800687de23dce978f55e",
  "0x5116ee15e86bc8878b90ac8a8514e38511eb58c4",
  "0xdd45e705ee2c41bd1d81da5bcb8ed0e8b30259b2",
  "0x849ccb5907938ce8be18ed5dbf583288e2da4009",
  "0xb85e5c96b0fa57aa9d5ce7ca6ea72409034b6e0f",
  "0xfbfd14dd4bb607373119de95f1d4b21c3b6c0029",
  "0x93bc1f104bc72c9141fc41c2acb2265f54a28ca3",
  "0x53d2d3c78597a78402d4db455a680da7ef560c3f",
  "0x714912e23fdf2acdd4cfb3eea195306d6842e7ef",
  "0x16cbe223607a6513ae76d1e3751c78e4eabc2704"
];

async function main() {
  console.log('=== Quick Batch V20b Validation ===\n');

  for (const wallet of wallets) {
    try {
      const result = await calculateV20PnL(wallet);
      const pnlStr = result.total_pnl >= 0
        ? `+$${result.total_pnl.toLocaleString()}`
        : `-$${Math.abs(result.total_pnl).toLocaleString()}`;
      console.log(`${wallet.slice(0, 10)}... | ${pnlStr.padStart(12)} | ${result.positions} pos | ${result.resolved} resolved`);
    } catch (e: any) {
      console.log(`${wallet.slice(0, 10)}... | ERROR: ${e.message.slice(0, 50)}`);
    }
  }
}

main().catch(console.error);
