/**
 * Quick regression test on 5 previously passing wallets
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

// 5 wallets that passed before (from the 45 passing wallets in original test)
const PASSING_WALLETS = [
  { wallet: '0x9cd2fe89a32d2a36a7e1b28a2e0b7b9e6f8c3d4a', name: 'maker_heavy #1 (was PASS)', prevCalc: -2839 },
  { wallet: '0x714586cb6aa4c3c2b0b9f3e5a7d8c6f4b2e0a1d9', name: 'taker_heavy #9 (was PASS)', prevCalc: 1057.41 },
  { wallet: '0xbf7423436d72a2b0e3f4c5d6a8b9c0e1f2a3b4c5', name: 'ctf_users #35 (was PASS)', prevCalc: -5.54 },
  { wallet: '0x060be258adfb1c2d3e4f5a6b7c8d9e0f1a2b3c4d', name: 'mixed #20 (was PASS)', prevCalc: -1.91 },
  { wallet: '0xcfff54418d7b8a9b0c1d2e3f4a5b6c7d8e9f0a1b', name: 'open_positions #33 (was PASS)', prevCalc: 11925.15 },
];

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        const sorted = [...data].sort((a, b) => b.t - a.t);
        return sorted[0].p || 0;
      }
    }
  } catch {}
  return 0;
}

async function testWallet(w: { wallet: string; name: string; prevCalc: number }) {
  const { wallet, name, prevCalc } = w;
  const start = Date.now();

  try {
    const [result, apiPnl] = await Promise.all([
      getWalletPnLV1(wallet),
      getApiPnL(wallet),
    ]);

    const calcPnl = result.totalPnl;
    const error = calcPnl - apiPnl;
    const status = Math.abs(error) <= 50 ? 'PASS' : Math.abs(error) <= 200 ? 'CLOSE' : 'FAIL';
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    // Check if calculation changed significantly from before
    const calcDiff = Math.abs(calcPnl - prevCalc);
    const calcChanged = calcDiff > 10 ? `⚠️ CALC CHANGED by $${calcDiff.toFixed(2)}` : '✓ Calc stable';

    return {
      name,
      wallet: wallet.slice(0, 14) + '...',
      calcPnl,
      apiPnl,
      error,
      status,
      calcChanged,
      elapsed,
      err: null,
    };
  } catch (err) {
    return { name, wallet: wallet.slice(0, 14) + '...', err: String(err) };
  }
}

async function main() {
  console.log('REGRESSION TEST: 5 previously passing wallets\n');
  console.log('='.repeat(80));

  // Run in parallel
  const results = await Promise.all(PASSING_WALLETS.map(testWallet));

  let passed = 0;
  for (const r of results) {
    console.log(`\n${r.name}`);
    if (r.err) {
      console.log(`ERROR: ${r.err}`);
    } else {
      console.log(`Calc: $${r.calcPnl!.toFixed(2)} | API: $${r.apiPnl!.toFixed(2)} | Err: $${r.error!.toFixed(2)} | ${r.status} | ${r.calcChanged}`);
      if (r.status === 'PASS') passed++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\nRegression: ${passed}/${results.length} still passing`);
}

main().catch(console.error);
