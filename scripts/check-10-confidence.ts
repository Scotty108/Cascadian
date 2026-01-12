import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

const wallets = [
  { wallet: '0x969fdceba722e381776044c3b14ef1729511ad37', ui: 2.40 },
  { wallet: '0xee81df87bc51eebc6a050bb70638c5e56063ef68', ui: 378.50 },
  { wallet: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4', ui: -362.67 },
  { wallet: '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0', ui: -41813.52 },
  { wallet: '0x8d5bebb6dcf733f12200155c547cb9fa8d159069', ui: -0.09 },
  { wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0', ui: -37.23 },
  { wallet: '0x045b5748b78efe2988e4574fe362cf91a3ea1d11', ui: -9.96 },
  { wallet: '0xfd9497fe764af214076458e9651db9f39febb3bf', ui: -1505.50 },
  { wallet: '0x61341f266a614cc511d2f606542b0774688998b0', ui: -97.85 },
  { wallet: '0x8302a1109f398b6003990a325228315993242815', ui: -11.74 },
];

async function main() {
  console.log('# | Conf   | Bundled | Our PnL      | UI PnL       | Match');
  console.log('--|--------|---------|--------------|--------------|------');

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const r = await getWalletPnLV1(w.wallet);
    const diff = Math.abs((r.total - w.ui) / Math.abs(w.ui)) * 100;
    const match = diff < 5 ? '✅' : '❌';
    const conf = r.confidence === 'high' ? '🟢 high' : (r.confidence === 'medium' ? '🟡 med ' : '🔴 low ');
    console.log(`${i+1}  | ${conf} | ${r.bundledTxCount.toString().padStart(5)}   | $${r.total.toFixed(2).padStart(11)} | $${w.ui.toFixed(2).padStart(11)} | ${match} ${diff.toFixed(1)}%`);
  }
}
main();
