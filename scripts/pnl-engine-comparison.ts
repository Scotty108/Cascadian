/**
 * PnL Engine Comparison Test
 * Tests V1, V17, V20, V25 against Polymarket API baseline
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
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
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

function extractPnL(result: any): number | null {
  if (!result) return null;
  return result.total ?? result.totalPnl ?? result.realizedPnl ?? null;
}

async function main() {
  console.log('🚀 PnL Engine Comparison Test\n');

  // Fetch baseline first
  console.log('Fetching Polymarket baseline...');
  const baseline: Record<string, number | null> = {};
  for (const { wallet } of TEST_WALLETS) {
    baseline[wallet] = await fetchPolymarketPnL(wallet);
    await new Promise(r => setTimeout(r, 200));
  }

  // Test each engine
  const engines: Array<{ name: string; fn: (w: string) => Promise<any> }> = [];

  try {
    const { getWalletPnLV1 } = await import('../lib/pnl/pnlEngineV1');
    engines.push({ name: 'V1', fn: getWalletPnLV1 });
  } catch (e) { console.log('V1 import failed'); }

  try {
    const { getWalletPnLV17 } = await import('../lib/pnl/pnlEngineV17');
    engines.push({ name: 'V17', fn: getWalletPnLV17 });
  } catch (e) { console.log('V17 import failed:', (e as Error).message); }

  try {
    const { getWalletPnLV20 } = await import('../lib/pnl/pnlEngineV20');
    engines.push({ name: 'V20', fn: getWalletPnLV20 });
  } catch (e) { console.log('V20 import failed:', (e as Error).message); }

  try {
    const { getWalletPnLV25 } = await import('../lib/pnl/pnlEngineV25');
    engines.push({ name: 'V25', fn: getWalletPnLV25 });
  } catch (e) { console.log('V25 import failed:', (e as Error).message); }

  console.log(`Testing ${engines.length} engines...\n`);

  // Results matrix
  const results: Record<string, Record<string, number | null>> = {};
  for (const engine of engines) {
    results[engine.name] = {};
    console.log(`Testing ${engine.name}...`);

    for (const { wallet } of TEST_WALLETS) {
      try {
        const result = await engine.fn(wallet);
        results[engine.name][wallet] = extractPnL(result);
      } catch (e) {
        console.log(`  ${engine.name} error on ${wallet.slice(0,10)}: ${(e as Error).message}`);
        results[engine.name][wallet] = null;
      }
    }
  }

  // Print results table
  console.log('\n' + '='.repeat(140));
  console.log('📊 COMPARISON RESULTS');
  console.log('='.repeat(140));

  // Header
  const header = ['Type', 'Polymarket', ...engines.map(e => e.name)].map(h => h.padStart(14)).join(' | ');
  console.log(`\n| ${header} |`);
  console.log('|' + '-'.repeat(14 + (14 + 3) * (engines.length + 1)) + '|');

  // Data rows
  for (const { wallet, type } of TEST_WALLETS) {
    const pm = baseline[wallet];
    const pmStr = pm !== null ? `$${pm.toFixed(0)}` : 'ERROR';

    const engineVals = engines.map(e => {
      const val = results[e.name][wallet];
      if (val === null) return 'ERROR';
      const diff = pm !== null ? val - pm : 0;
      const pctDiff = pm !== null && pm !== 0 ? (diff / pm * 100).toFixed(0) : '0';
      return `$${val.toFixed(0)} (${pctDiff}%)`;
    });

    const row = [type.padEnd(14), pmStr.padStart(14), ...engineVals.map(v => v.padStart(14))].join(' | ');
    console.log(`| ${row} |`);
  }

  // Accuracy summary
  console.log('\n' + '='.repeat(80));
  console.log('📈 ACCURACY SUMMARY (5% tolerance)');
  console.log('='.repeat(80));

  for (const engine of engines) {
    let match = 0, total = 0;
    for (const { wallet } of TEST_WALLETS) {
      const pm = baseline[wallet];
      const val = results[engine.name][wallet];
      if (pm === null || val === null) continue;
      total++;
      const threshold = Math.max(100, Math.abs(pm) * 0.05);
      if (Math.abs(val - pm) < threshold) match++;
    }
    console.log(`${engine.name.padEnd(5)}: ${match}/${total} wallets (${(match/total*100).toFixed(0)}%)`);
  }
}

main().catch(console.error);
