/**
 * Quick PnL Engine Test - 5 diverse wallets
 * Tests V1 and V7 against Polymarket API baseline
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// 5 diverse wallets - one from each cohort
const TEST_WALLETS = [
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', type: 'CLOB_ONLY' },
  { wallet: '0xe8dd7741ccb12350957ec71e9ee332e0d1e6ec86', type: 'NEGRISK_HEAVY' },
  { wallet: '0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba', type: 'SPLIT_HEAVY' },
  { wallet: '0x35c0732e069faea97c11aa9cab045562eaab81d6', type: 'REDEMPTION' },
  { wallet: '0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d', type: 'MAKER_HEAVY' },
];

async function fetchPolymarketPnL(wallet: string): Promise<number | null> {
  try {
    // Use user-pnl-api which returns time series - take latest value
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (!res.ok) return null;
    const data = await res.json();
    // Returns array of {t: timestamp, p: pnl}, take latest
    if (Array.isArray(data) && data.length > 0) {
      return data[data.length - 1].p;
    }
    return null;
  } catch (e) {
    console.log(`API error for ${wallet.slice(0,10)}:`, e);
    return null;
  }
}

async function main() {
  console.log('🚀 Quick PnL Engine Test\n');

  // Import engines
  const { getWalletPnLV1 } = await import('../lib/pnl/pnlEngineV1');
  const { getWalletPnLV7 } = await import('../lib/pnl/pnlEngineV7');

  const results: Array<{
    wallet: string;
    type: string;
    polymarket: number | null;
    v1: number | null;
    v7: number | null;
    v1_diff: string;
    v7_diff: string;
  }> = [];

  for (const { wallet, type } of TEST_WALLETS) {
    console.log(`Testing ${type}: ${wallet.slice(0,10)}...`);

    // Fetch all three
    const [polymarket, v1Result, v7Result] = await Promise.all([
      fetchPolymarketPnL(wallet),
      getWalletPnLV1(wallet).catch((e) => { console.log(`V1 error for ${wallet.slice(0,10)}:`, e.message); return null; }),
      getWalletPnLV7(wallet).catch((e) => { console.log(`V7 error for ${wallet.slice(0,10)}:`, e.message); return null; }),
    ]);

    const v1Pnl = v1Result?.total ?? v1Result?.totalPnl ?? null;
    const v7Pnl = v7Result?.totalPnl ?? v7Result?.total ?? null;

    const v1Diff = polymarket !== null && v1Pnl !== null
      ? `$${(v1Pnl - polymarket).toFixed(2)}`
      : 'N/A';
    const v7Diff = polymarket !== null && v7Pnl !== null
      ? `$${(v7Pnl - polymarket).toFixed(2)}`
      : 'N/A';

    results.push({
      wallet: wallet.slice(0, 12) + '...',
      type,
      polymarket,
      v1: v1Pnl,
      v7: v7Pnl,
      v1_diff: v1Diff,
      v7_diff: v7Diff,
    });

    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n' + '='.repeat(120));
  console.log('📊 RESULTS');
  console.log('='.repeat(120));

  console.log('\n| Wallet | Type | Polymarket | V1 | V1 Diff | V7 | V7 Diff |');
  console.log('|--------|------|------------|-------|---------|-------|---------|');

  for (const r of results) {
    const pm = r.polymarket !== null ? `$${r.polymarket.toFixed(2)}` : 'ERROR';
    const v1 = r.v1 !== null ? `$${r.v1.toFixed(2)}` : 'ERROR';
    const v7 = r.v7 !== null ? `$${r.v7.toFixed(2)}` : 'ERROR';
    console.log(`| ${r.wallet} | ${r.type.padEnd(12)} | ${pm.padStart(12)} | ${v1.padStart(12)} | ${r.v1_diff.padStart(10)} | ${v7.padStart(12)} | ${r.v7_diff.padStart(10)} |`);
  }

  // Summary
  let v1Match = 0, v7Match = 0, total = 0;
  for (const r of results) {
    if (r.polymarket === null) continue;
    total++;
    if (r.v1 !== null && Math.abs(r.v1 - r.polymarket) < Math.max(10, Math.abs(r.polymarket) * 0.05)) v1Match++;
    if (r.v7 !== null && Math.abs(r.v7 - r.polymarket) < Math.max(10, Math.abs(r.polymarket) * 0.05)) v7Match++;
  }

  console.log('\n📈 ACCURACY (5% tolerance):');
  console.log(`  V1: ${v1Match}/${total} wallets`);
  console.log(`  V7: ${v7Match}/${total} wallets`);
}

main().catch(console.error);
