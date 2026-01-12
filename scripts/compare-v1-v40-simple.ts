import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';
import { getWalletPnLV40 } from '../lib/pnl/pnlEngineV40';

const WALLETS = [
  { wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052', name: 'original' },
  { wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', name: 'maker_heavy_1' },
  { wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', name: 'taker_heavy_1' },
];

async function fetchPolymarket(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[data.length - 1].p;
    return null;
  } catch { return null; }
}

async function main() {
  console.log('Comparing V1 vs V40 on simple wallets...\n');

  for (const { wallet, name } of WALLETS) {
    console.log(`\n${name}:`);

    const pm = await fetchPolymarket(wallet);
    const v1 = await getWalletPnLV1(wallet).catch(() => null);
    const v40 = await getWalletPnLV40(wallet).catch((e: Error) => {
      console.log(`  V40 error: ${e.message}`);
      return null;
    });

    console.log(`  Polymarket: $${pm?.toFixed(2) || 'ERROR'}`);
    console.log(`  V1 total:   $${v1?.total?.toFixed(2) || 'ERROR'}`);
    console.log(`  V40 MTM:    $${v40?.total_pnl_mtm?.toFixed(2) || 'ERROR'}`);

    if (pm && v1?.total) {
      const v1Err = Math.abs(v1.total - pm) / Math.abs(pm) * 100;
      console.log(`  V1 error:   ${v1Err.toFixed(1)}%`);
    }
    if (pm && v40?.total_pnl_mtm) {
      const v40Err = Math.abs(v40.total_pnl_mtm - pm) / Math.abs(pm) * 100;
      console.log(`  V40 error:  ${v40Err.toFixed(1)}%`);
    }
  }
}

main().catch(console.error);
