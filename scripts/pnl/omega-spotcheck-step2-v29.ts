/**
 * Step 2: Batch compute V29 PnL for omega top 50 wallets
 */
import fs from 'fs';
import { calculateV29PnL } from '../../lib/pnl/inventoryEngineV29';

async function main() {
  const wallets: string[] = JSON.parse(fs.readFileSync('tmp/omega_top50_wallets.json', 'utf8'));
  console.log(`Computing V29 PnL for ${wallets.length} wallets...`);

  const out: any[] = [];
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    try {
      const r = await calculateV29PnL(wallet);
      const realized = r?.realizedPnl ?? 0;
      const unrealized = r?.unrealizedPnl ?? 0;
      out.push({
        wallet,
        v29_realized: realized,
        v29_unrealized: unrealized,
        v29_total: realized + unrealized
      });
      if ((i + 1) % 10 === 0) {
        console.log(`  [${i + 1}/${wallets.length}] ${wallet.slice(0, 10)}... realized=$${realized.toFixed(0)}`);
      }
    } catch (err: any) {
      console.log(`  [${i + 1}/${wallets.length}] ${wallet.slice(0, 10)}... ERROR: ${err.message}`);
      out.push({
        wallet,
        v29_realized: null,
        v29_unrealized: null,
        v29_total: null,
        error: err.message
      });
    }
  }

  fs.writeFileSync('tmp/omega_top50_v29_pnl.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote tmp/omega_top50_v29_pnl.json with ${out.length} results`);

  // Show top 5
  const sorted = out.filter(r => r.v29_realized !== null).sort((a, b) => b.v29_realized - a.v29_realized);
  console.log('\nTop 5 by V29 Realized:');
  for (const r of sorted.slice(0, 5)) {
    console.log(`  ${r.wallet.slice(0, 10)}... realized=$${r.v29_realized.toFixed(0)} unrealized=$${r.v29_unrealized.toFixed(0)}`);
  }
}

main().catch(console.error);
