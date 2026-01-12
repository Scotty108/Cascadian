/**
 * Quick V38 test against Polymarket API
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV38 } from '../lib/pnl/pnlEngineV38';
import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

const wallet = process.argv[2] || '0x0015c5a76490d303e837d79dd5cf6a3825e4d5b0';

async function main() {
  console.log('Testing wallet:', wallet);

  // V1
  const v1 = await getWalletPnLV1(wallet);
  console.log('\nV1 Result:');
  console.log('  Total:', v1.total.toFixed(2));
  console.log('  Bundled Txs:', v1.bundledTxCount);
  console.log('  Confidence:', v1.confidence);

  // V38
  const v38 = await getWalletPnLV38(wallet);
  console.log('\nV38 Result:');
  console.log('  Realized Cash:', v38.realized_cash_pnl.toFixed(2));
  console.log('  Total MTM:', v38.total_pnl_mtm.toFixed(2));
  console.log('  Stats:', JSON.stringify(v38.stats, null, 2));

  // Polymarket API
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    const data = await res.json();
    const pmPnl = Array.isArray(data) && data.length > 0 ? data[data.length - 1].p : null;
    console.log('\nPolymarket API:', pmPnl !== null ? '$' + pmPnl.toFixed(2) : 'N/A');

    if (pmPnl !== null) {
      console.log('\n=== COMPARISON ===');
      const v1Error = Math.abs(v1.total - pmPnl);
      const v1ErrorPct = Math.abs(pmPnl) > 0 ? (v1Error / Math.abs(pmPnl)) * 100 : 0;
      console.log(`V1 Error: $${v1Error.toFixed(2)} (${v1ErrorPct.toFixed(1)}%)`);

      const v38Error = Math.abs(v38.total_pnl_mtm - pmPnl);
      const v38ErrorPct = Math.abs(pmPnl) > 0 ? (v38Error / Math.abs(pmPnl)) * 100 : 0;
      console.log(`V38 Error: $${v38Error.toFixed(2)} (${v38ErrorPct.toFixed(1)}%)`);
    }
  } catch (e) {
    console.log('\nPolymarket API Error:', e);
  }
}

main().catch(console.error);
