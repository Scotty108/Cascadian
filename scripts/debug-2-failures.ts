/**
 * Debug the 2 failing wallets - compare V1 engine vs API
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

async function getApiPnL(wallet: string): Promise<number> {
  const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
  const data = await res.json();
  return data[data.length - 1]?.p || 0;
}

async function main() {
  const wallets = [
    { addr: '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d', name: 'wallet1_taker' },
    { addr: '0x6a31595989176ac4e4fb72c9ce2da63d0b97a21e', name: 'wallet2_random' }
  ];

  for (const w of wallets) {
    console.log(`\n=== ${w.name} (${w.addr.slice(0, 10)}...) ===`);

    const [api, v1] = await Promise.all([
      getApiPnL(w.addr),
      getWalletPnLV1(w.addr)
    ]);

    console.log(`API:        $${api.toFixed(2)}`);
    console.log(`V1 Total:   $${v1.total.toFixed(2)}`);
    console.log(`  Realized:   $${v1.realized.pnl.toFixed(2)} (${v1.realized.marketCount} markets)`);
    console.log(`  Synthetic:  $${v1.syntheticRealized.pnl.toFixed(2)} (${v1.syntheticRealized.marketCount} markets)`);
    console.log(`  Unrealized: $${v1.unrealized.pnl.toFixed(2)} (${v1.unrealized.marketCount} markets)`);
    console.log(`Gap: $${Math.abs(api - v1.total).toFixed(2)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
