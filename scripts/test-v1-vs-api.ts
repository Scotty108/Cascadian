/**
 * Quick test: V1 PnL engine vs Polymarket API on 5 wallets
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';

// Clean pool wallets (non-NegRisk, no splits/merges)
const TEST_WALLETS = [
  '0x8cb54e6f4d635a9f2272c8ef7c771e4a0efe76e5',
  '0x709c6ea6795ad88c28e8a7fc5a984e6fb02570ad',
  '0x66ab81f28af34bc2d99027df38125f2618e1b998',
  '0x9aabbf0c2d40568476357c0391b7edcfb8c17b0a',
  '0x7b44a6bae54f57a2dc7128b9d83d4b7260a05198',
];

async function getApiPnL(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[data.length - 1].p;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== V1 Engine vs Polymarket API ===\n');
  console.log('Wallet                                     |   V1 Total |       API | Diff %');
  console.log('-'.repeat(85));

  let matches = 0;
  let total = 0;

  for (const wallet of TEST_WALLETS) {
    try {
      const [v1Result, api] = await Promise.all([
        getWalletPnLV1(wallet),
        getApiPnL(wallet),
      ]);

      const v1Total = v1Result.total;

      if (api !== null) {
        total++;
        const diff = api !== 0 ? Math.abs((v1Total - api) / api * 100) : (v1Total === 0 ? 0 : 100);
        const match = diff < 20 ? '✓' : '✗';
        if (diff < 20) matches++;

        console.log(
          `${wallet} | ${v1Total.toFixed(2).padStart(10)} | ${api.toFixed(2).padStart(9)} | ${diff.toFixed(1).padStart(5)}% ${match}`
        );
      } else {
        console.log(`${wallet} | ${v1Total.toFixed(2).padStart(10)} |    NO API |   N/A`);
      }
    } catch (e: any) {
      console.log(`${wallet} | ERROR: ${e.message.slice(0, 30)}`);
    }
  }

  console.log('-'.repeat(85));
  console.log(`\nAccuracy: ${matches}/${total} within 20% of API`);
}

main().catch(console.error);
