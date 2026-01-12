/**
 * PnL Engine Retry Benchmark
 *
 * Tests retry candidates (V15, V25, V26, V27, V38) now that:
 * - ERC1155 is fresh (21 min)
 * - Token map has 99.9% coverage
 *
 * Each engine is tested against Polymarket API baseline.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// Test wallets from stratified cohort
const TEST_WALLETS = [
  { wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052', name: 'original', expected: 1.16 },
  { wallet: '0x204f72f35326db932158cba6adff0b9a1da95e14', name: 'CLOB_ONLY' },
  { wallet: '0xe8dd7741ccb12350957ec71e9ee332e0d1e6ec86', name: 'NEGRISK_HEAVY' },
  { wallet: '0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba', name: 'SPLIT_HEAVY' },
  { wallet: '0x35c0732e069faea97c11aa9cab045562eaab81d6', name: 'REDEMPTION' },
  { wallet: '0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d', name: 'MAKER_HEAVY' },
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
  // Try different output formats
  return result.total_pnl_mtm ?? result.totalPnl ?? result.total ?? result.realizedPnl ?? null;
}

function formatError(actual: number | null, expected: number | null): string {
  if (actual === null || expected === null) return 'N/A';
  if (expected === 0) return actual === 0 ? '0%' : 'INF%';
  const pctError = ((actual - expected) / Math.abs(expected)) * 100;
  return `${pctError >= 0 ? '+' : ''}${pctError.toFixed(0)}%`;
}

function formatValue(val: number | null): string {
  if (val === null) return 'ERROR';
  const abs = Math.abs(val);
  if (abs >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

async function main() {
  console.log('═'.repeat(100));
  console.log('📊 PnL Engine Retry Benchmark (Fresh Data: ERC1155 21min, Token Map 99.9%)');
  console.log('═'.repeat(100));

  // Import engines
  const engines: Record<string, any> = {};

  const engineVersions = ['V1', 'V15', 'V25', 'V26', 'V27', 'V38'];

  for (const v of engineVersions) {
    try {
      const modulePath = `../lib/pnl/pnlEngine${v}`;
      const module = await import(modulePath);
      const fnName = `getWalletPnL${v}`;
      if (module[fnName]) {
        engines[v] = module[fnName];
        console.log(`✓ ${v} engine loaded`);
      } else {
        console.log(`✗ ${v} engine: function ${fnName} not found`);
      }
    } catch (e) {
      console.log(`✗ ${v} engine failed to load:`, (e as Error).message.slice(0, 50));
    }
  }

  // Fetch Polymarket baselines
  console.log('\nFetching Polymarket API baselines...');
  const pmBaseline: Record<string, number | null> = {};
  for (const { wallet } of TEST_WALLETS) {
    pmBaseline[wallet] = await fetchPolymarketPnL(wallet);
    await new Promise(r => setTimeout(r, 150));
  }

  // Test each engine
  const results: Record<string, Record<string, number | null>> = {};

  for (const [version, engine] of Object.entries(engines)) {
    results[version] = {};
    console.log(`\nTesting ${version} engine...`);

    for (const { wallet, name } of TEST_WALLETS) {
      try {
        const result = await engine(wallet);
        results[version][wallet] = extractPnL(result);
        process.stdout.write('.');
      } catch (e) {
        results[version][wallet] = null;
        process.stdout.write('x');
      }
    }
    console.log(' done');
  }

  // Print results
  console.log('\n' + '═'.repeat(140));
  console.log('RESULTS BY WALLET TYPE');
  console.log('═'.repeat(140));

  // Header
  const header = 'Wallet'.padEnd(16) + ' | ' + 'Polymarket'.padStart(12);
  const headerParts = Object.keys(engines).map(v => `${v}`.padStart(10) + ' | ' + `Err`.padStart(7));
  console.log(header + ' | ' + headerParts.join(' | '));
  console.log('-'.repeat(140));

  // Results
  const accuracy: Record<string, { matches: number; total: number }> = {};
  for (const v of Object.keys(engines)) {
    accuracy[v] = { matches: 0, total: 0 };
  }

  for (const { wallet, name } of TEST_WALLETS) {
    const pm = pmBaseline[wallet];
    let row = name.padEnd(16) + ' | ' + formatValue(pm).padStart(12);

    for (const [version, _] of Object.entries(engines)) {
      const val = results[version][wallet];
      const err = formatError(val, pm);
      row += ' | ' + formatValue(val).padStart(10) + ' | ' + err.padStart(7);

      // Count accuracy
      if (pm !== null && val !== null) {
        accuracy[version].total++;
        const threshold = Math.max(100, Math.abs(pm) * 0.10);
        if (Math.abs(val - pm) < threshold) {
          accuracy[version].matches++;
        }
      }
    }

    console.log(row);
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('ACCURACY SUMMARY (10% or $100 tolerance)');
  console.log('═'.repeat(80));

  for (const [version, { matches, total }] of Object.entries(accuracy)) {
    const pct = total > 0 ? (matches / total * 100).toFixed(0) : '0';
    console.log(`${version.padEnd(6)}: ${matches}/${total} wallets (${pct}%)`);
  }
}

main().catch(console.error);
