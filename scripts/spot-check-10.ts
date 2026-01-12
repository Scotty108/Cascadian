import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

const wallets = [
  '0x969fdceba722e381776044c3b14ef1729511ad37',
  '0xee81df87bc51eebc6a050bb70638c5e56063ef68',
  '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4',
  '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0',
  '0x8d5bebb6dcf733f12200155c547cb9fa8d159069',
  '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0',
  '0x045b5748b78efe2988e4574fe362cf91a3ea1d11',
  '0xfd9497fe764af214076458e9651db9f39febb3bf',
  '0x61341f266a614cc511d2f606542b0774688998b0',
  '0x8302a1109f398b6003990a325228315993242815',
];

async function main() {
  console.log('| # | Wallet | Realized | Synthetic | Unrealized | TOTAL | UI |');
  console.log('|---|--------|----------|-----------|------------|-------|----|');

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const r = await getWalletPnLV1(w);
    const short = w.slice(0,10);
    console.log(`| ${i+1} | ${short} | ${r.realized.pnl.toFixed(2)} | ${r.syntheticRealized.pnl.toFixed(2)} | ${r.unrealized.pnl.toFixed(2)} | **${r.total.toFixed(2)}** | polymarket.com/profile/${w} |`);
  }
}

main();
