/**
 * Quick test of 3 previously failing wallets with V3 fixes
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

const FAILING_WALLETS = [
  { wallet: '0x98fb352a4ddbee7cd112f81f13d80606be6ca26e', name: 'Wallet 1 (maker_heavy)', prevErr: -2005 },
  { wallet: '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d', name: 'Wallet 2 (taker_heavy)', prevErr: 283 },
  { wallet: '0x1d844fceef195f7ec230c6f816ab0ebe1fc3c5ce', name: 'Wallet 3 (open_positions)', prevErr: -995 },
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

async function testWallet(w: { wallet: string; name: string; prevErr: number }) {
  const { wallet, name, prevErr } = w;
  const start = Date.now();

  try {
    const [result, apiPnl] = await Promise.all([
      getWalletPnLV1(wallet),
      getApiPnL(wallet),
    ]);

    // Support both old interface (total) and new interface (totalPnl)
    const calcPnl = (result as any).totalPnl ?? (result as any).total ?? 0;
    const error = calcPnl - apiPnl;
    const status = Math.abs(error) <= 10 ? 'PASS' : Math.abs(error) <= 100 ? 'CLOSE' : 'FAIL';
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    return {
      name,
      wallet,
      prevErr,
      calcPnl,
      apiPnl,
      error,
      status,
      openPositions: (result as any).openPositionCount ?? (result as any).unrealized?.marketCount ?? 0,
      elapsed,
      err: null,
    };
  } catch (err) {
    return { name, wallet, prevErr, err: String(err) };
  }
}

async function testWallets() {
  console.log('Testing 3 previously failing wallets with hedge MTM fix\n');
  console.log('Running in PARALLEL for speed...\n');
  console.log('='.repeat(80));

  // Run all 3 in parallel
  const results = await Promise.all(FAILING_WALLETS.map(testWallet));

  for (const r of results) {
    console.log(`\n${r.name}`);
    console.log(`Wallet: ${r.wallet}`);
    console.log(`Previous Error: $${r.prevErr.toFixed(2)}`);

    if (r.err) {
      console.log(`ERROR: ${r.err}`);
    } else {
      console.log(`Calc PnL:  $${r.calcPnl!.toFixed(2)}`);
      console.log(`API PnL:   $${r.apiPnl!.toFixed(2)}`);
      console.log(`New Error: $${r.error!.toFixed(2)}`);
      console.log(`Status:    ${r.status} (${r.status === 'PASS' ? '✓ FIXED' : r.status === 'CLOSE' ? '~ IMPROVED' : '✗ STILL FAILING'})`);
      console.log(`Open Positions: ${r.openPositions}`);
      console.log(`Time: ${r.elapsed}s`);
    }
  }

  console.log('\n' + '='.repeat(80));
}

testWallets().catch(console.error);
