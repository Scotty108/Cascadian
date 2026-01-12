/**
 * PnL Engine V39 Benchmark
 *
 * Tests V39 against V38, V1 and Polymarket API on:
 * - Original 15 wallets from V1 test suite
 * - 5 stratified cohort wallets (CLOB_ONLY, NEGRISK_HEAVY, SPLIT_HEAVY, etc.)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// Original 15 test wallets from V1
const V1_TEST_WALLETS = [
  { wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052', name: 'original', expected: 1.16 },
  { wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', name: 'maker_heavy_1', expected: -12.6 },
  { wallet: '0x2e4a6d6dccff351fccfd404f368fa711d94b2e12', name: 'maker_heavy_2', expected: null },
  { wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', name: 'taker_heavy_1', expected: -47.19 },
  { wallet: '0x94fabfc86594fffbf76996e2f66e5e19675a8164', name: 'taker_heavy_2', expected: -73.0 },
  { wallet: '0xee81df87bc51eebc6a050bb70638c5e56063ef68', name: 'spot_2', expected: 378.5 },
  { wallet: '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0', name: 'spot_4', expected: -41813.52 },
  { wallet: '0xfd9497fe764af214076458e9651db9f39febb3bf', name: 'spot_8', expected: -1505.5 },
  { wallet: '0x583537b26372c4527ff0eb9766da22fb6ab038cd', name: 'mixed_1', expected: 0.0 },
  { wallet: '0x969fdceba722e381776044c3b14ef1729511ad37', name: 'spot_1', expected: 2.4 },
  { wallet: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4', name: 'spot_3', expected: -322.49 },
  { wallet: '0x8d5bebb6dcf733f12200155c547cb9fa8d159069', name: 'spot_5', expected: -0.09 },
  { wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0', name: 'spot_6', expected: -37.23 },
  { wallet: '0x045b5748b78efe2988e4574fe362cf91a3ea1d11', name: 'spot_7', expected: -9.96 },
  { wallet: '0x61341f266a614cc511d2f606542b0774688998b0', name: 'spot_9', expected: -97.85 },
];

// Stratified cohort wallets (5)
const STRATIFIED_WALLETS = [
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
  return result.total_pnl_mtm ?? result.total ?? result.totalPnl ?? result.realizedPnl ?? null;
}

function formatError(actual: number | null, expected: number | null): string {
  if (actual === null || expected === null) return 'N/A';
  if (expected === 0) return actual === 0 ? '0%' : 'INF%';
  const pctError = ((actual - expected) / Math.abs(expected)) * 100;
  return `${pctError >= 0 ? '+' : ''}${pctError.toFixed(0)}%`;
}

function formatValue(val: number | null): string {
  if (val === null) return 'ERROR';
  return `$${val.toFixed(0)}`;
}

async function main() {
  console.log('═'.repeat(120));
  console.log('📊 PnL Engine V39 Benchmark (Fixes: no loser force-close, filter post-resolution CTF)');
  console.log('═'.repeat(120));

  // Import engines
  let getWalletPnLV1: any = null;
  let getWalletPnLV38: any = null;
  let getWalletPnLV39: any = null;

  try {
    const v1Module = await import('../lib/pnl/pnlEngineV1');
    getWalletPnLV1 = v1Module.getWalletPnLV1;
    console.log('✓ V1 engine loaded');
  } catch (e) {
    console.log('✗ V1 engine failed to load:', (e as Error).message);
  }

  try {
    const v38Module = await import('../lib/pnl/pnlEngineV38');
    getWalletPnLV38 = v38Module.getWalletPnLV38;
    console.log('✓ V38 engine loaded');
  } catch (e) {
    console.log('✗ V38 engine failed to load:', (e as Error).message);
  }

  try {
    const v39Module = await import('../lib/pnl/pnlEngineV39');
    getWalletPnLV39 = v39Module.getWalletPnLV39;
    console.log('✓ V39 engine loaded');
  } catch (e) {
    console.log('✗ V39 engine failed to load:', (e as Error).message);
  }

  // Combine all wallets
  const allWallets = [
    ...V1_TEST_WALLETS.map(w => ({ ...w, group: 'V1_TEST' })),
    ...STRATIFIED_WALLETS.map(w => ({ ...w, expected: null, group: 'STRATIFIED' })),
  ];

  // Fetch Polymarket baseline
  console.log('\nFetching Polymarket API baselines...');
  const pmBaseline: Record<string, number | null> = {};
  for (const { wallet } of allWallets) {
    pmBaseline[wallet] = await fetchPolymarketPnL(wallet);
    await new Promise(r => setTimeout(r, 150));
  }

  // Test each engine
  const results: Record<string, Record<string, number | null>> = {
    V1: {},
    V38: {},
    V39: {},
  };

  const engineRunners: [string, any][] = [
    ['V1', getWalletPnLV1],
    ['V38', getWalletPnLV38],
    ['V39', getWalletPnLV39],
  ];

  for (const [name, engine] of engineRunners) {
    if (!engine) continue;
    console.log(`\nTesting ${name} engine...`);
    for (const { wallet } of allWallets) {
      try {
        const result = await engine(wallet);
        results[name][wallet] = extractPnL(result);
        process.stdout.write('.');
      } catch {
        results[name][wallet] = null;
        process.stdout.write('x');
      }
    }
    console.log(' done');
  }

  // Print V1 Test Wallets results
  console.log('\n' + '═'.repeat(140));
  console.log('RESULTS: Original V1 Test Wallets (15)');
  console.log('═'.repeat(140));
  console.log(
    'Name'.padEnd(16) + ' | ' +
    'Polymarket'.padStart(12) + ' | ' +
    'V1'.padStart(12) + ' | ' +
    'V1 Err'.padStart(8) + ' | ' +
    'V38'.padStart(12) + ' | ' +
    'V38 Err'.padStart(8) + ' | ' +
    'V39'.padStart(12) + ' | ' +
    'V39 Err'.padStart(8)
  );
  console.log('-'.repeat(140));

  const accuracy: Record<string, { matches: number; total: number }> = {
    V1: { matches: 0, total: 0 },
    V38: { matches: 0, total: 0 },
    V39: { matches: 0, total: 0 },
  };

  for (const w of allWallets.filter(w => w.group === 'V1_TEST')) {
    const pm = pmBaseline[w.wallet];
    const v1 = results.V1[w.wallet];
    const v38 = results.V38[w.wallet];
    const v39 = results.V39[w.wallet];

    console.log(
      w.name.padEnd(16) + ' | ' +
      formatValue(pm).padStart(12) + ' | ' +
      formatValue(v1).padStart(12) + ' | ' +
      formatError(v1, pm).padStart(8) + ' | ' +
      formatValue(v38).padStart(12) + ' | ' +
      formatError(v38, pm).padStart(8) + ' | ' +
      formatValue(v39).padStart(12) + ' | ' +
      formatError(v39, pm).padStart(8)
    );

    if (pm !== null) {
      const threshold = Math.max(100, Math.abs(pm) * 0.10);
      for (const [name, val] of [['V1', v1], ['V38', v38], ['V39', v39]] as [string, number | null][]) {
        if (val !== null) {
          accuracy[name].total++;
          if (Math.abs(val - pm) < threshold) accuracy[name].matches++;
        }
      }
    }
  }

  // Print Stratified Cohort results
  console.log('\n' + '═'.repeat(140));
  console.log('RESULTS: Stratified Cohort (5)');
  console.log('═'.repeat(140));
  console.log(
    'Type'.padEnd(16) + ' | ' +
    'Polymarket'.padStart(12) + ' | ' +
    'V1'.padStart(12) + ' | ' +
    'V1 Err'.padStart(8) + ' | ' +
    'V38'.padStart(12) + ' | ' +
    'V38 Err'.padStart(8) + ' | ' +
    'V39'.padStart(12) + ' | ' +
    'V39 Err'.padStart(8)
  );
  console.log('-'.repeat(140));

  for (const w of allWallets.filter(w => w.group === 'STRATIFIED')) {
    const pm = pmBaseline[w.wallet];
    const v1 = results.V1[w.wallet];
    const v38 = results.V38[w.wallet];
    const v39 = results.V39[w.wallet];

    console.log(
      w.name.padEnd(16) + ' | ' +
      formatValue(pm).padStart(12) + ' | ' +
      formatValue(v1).padStart(12) + ' | ' +
      formatError(v1, pm).padStart(8) + ' | ' +
      formatValue(v38).padStart(12) + ' | ' +
      formatError(v38, pm).padStart(8) + ' | ' +
      formatValue(v39).padStart(12) + ' | ' +
      formatError(v39, pm).padStart(8)
    );

    if (pm !== null) {
      const threshold = Math.max(100, Math.abs(pm) * 0.10);
      for (const [name, val] of [['V1', v1], ['V38', v38], ['V39', v39]] as [string, number | null][]) {
        if (val !== null) {
          accuracy[name].total++;
          if (Math.abs(val - pm) < threshold) accuracy[name].matches++;
        }
      }
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('ACCURACY SUMMARY (10% or $100 tolerance)');
  console.log('═'.repeat(80));
  for (const name of ['V1', 'V38', 'V39']) {
    const { matches, total } = accuracy[name];
    const pct = total > 0 ? (matches / total * 100).toFixed(0) : '0';
    console.log(`${name.padEnd(4)}: ${matches}/${total} wallets (${pct}%)`);
  }
}

main().catch(console.error);
