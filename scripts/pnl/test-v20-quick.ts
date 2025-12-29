import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

// The 5 wallets from V18 spot check (with their UI values)
const testWallets = [
  { addr: '0x35f0a66aeea6b22dce4b0e4fdea20e8d4de7b776', uiPnl: 3291.63, label: 'V18 overcounted' },
  { addr: '0x343934e5f1c2ba3f8f09cad21a1e83c8a74e3f64', uiPnl: 0, label: 'Bot (UI filters)' },
  { addr: '0x227c55e83eb5ae05e6f14bbfcc4f9bf6d6bda303', uiPnl: -278.07, label: 'Wrong sign' },
  { addr: '0x222adce7f89c1c69f1f0dca8a2bc3c87d9cc103c', uiPnl: 520.00, label: 'V18 was $0' },
  { addr: '0x0e5f63cc299bf78e46da9971aad9a36a13e5cf38', uiPnl: -399.79, label: 'V18 was -$1' },
];

async function main() {
  console.log('=== V20 Test (using v9_clob_tbl with 534M rows) ===\n');

  for (const wallet of testWallets) {
    try {
      const result = await calculateV20PnL(wallet.addr);
      const delta = result.total_pnl - wallet.uiPnl;
      const pctDiff = wallet.uiPnl !== 0 ? (Math.abs(delta) / Math.abs(wallet.uiPnl) * 100).toFixed(1) : 'N/A';
      const match = Math.abs(delta) < 100 ? '✅' : Math.abs(delta) < 500 ? '🟡' : '❌';
      const shortAddr = wallet.addr.slice(0, 10);

      console.log(match + ' ' + shortAddr + '... (' + wallet.label + ')');
      console.log('   V20: $' + result.total_pnl.toFixed(2) + ' | UI: $' + wallet.uiPnl.toFixed(2) + ' | Δ: $' + delta.toFixed(2) + ' (' + pctDiff + '%)');
      console.log('   Positions: ' + result.positions + ' | Resolved: ' + result.resolved);
      console.log('');
    } catch (err: any) {
      console.log('❌ ' + wallet.addr.slice(0, 10) + '... ERROR: ' + err.message);
    }
  }
}

main();
