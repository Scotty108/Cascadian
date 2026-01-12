/**
 * V40 Benchmark Script
 *
 * Tests V40 against V1 and Polymarket API on all benchmark wallets.
 * Outputs per-wallet comparison with detailed stats.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// Benchmark wallets
const BENCHMARK_WALLETS = [
  // Original V1 test wallets (15)
  { wallet: '0xf918977ef9d3f101385eda508621d5f835fa9052', name: 'original' },
  { wallet: '0x105a54a721d475a5d2faaf7902c55475758ba63c', name: 'maker_heavy_1' },
  { wallet: '0x2e4a6d6dccff351fccfd404f368fa711d94b2e12', name: 'maker_heavy_2' },
  { wallet: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', name: 'taker_heavy_1' },
  { wallet: '0x94fabfc86594fffbf76996e2f66e5e19675a8164', name: 'taker_heavy_2' },
  { wallet: '0xee81df87bc51eebc6a050bb70638c5e56063ef68', name: 'spot_2' },
  { wallet: '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0', name: 'spot_4' },
  { wallet: '0xfd9497fe764af214076458e9651db9f39febb3bf', name: 'spot_8' },
  { wallet: '0x583537b26372c4527ff0eb9766da22fb6ab038cd', name: 'mixed_1' },
  { wallet: '0x969fdceba722e381776044c3b14ef1729511ad37', name: 'spot_1' },
  { wallet: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4', name: 'spot_3' },
  { wallet: '0x8d5bebb6dcf733f12200155c547cb9fa8d159069', name: 'spot_5' },
  { wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0', name: 'spot_6' },
  { wallet: '0x045b5748b78efe2988e4574fe362cf91a3ea1d11', name: 'spot_7' },
  { wallet: '0x61341f266a614cc511d2f606542b0774688998b0', name: 'spot_9' },
  // Stratified cohort (5)
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

function formatValue(val: number | null): string {
  if (val === null) return 'ERROR';
  const abs = Math.abs(val);
  if (abs >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function formatError(actual: number | null, expected: number | null): string {
  if (actual === null || expected === null) return 'N/A';
  if (expected === 0) return actual === 0 ? '0%' : 'INF%';
  const pctError = ((actual - expected) / Math.abs(expected)) * 100;
  return `${pctError >= 0 ? '+' : ''}${pctError.toFixed(0)}%`;
}

function isAccurate(actual: number | null, expected: number | null): boolean {
  if (actual === null || expected === null) return false;
  const threshold = Math.max(100, Math.abs(expected) * 0.10);
  return Math.abs(actual - expected) < threshold;
}

async function main() {
  console.log('═'.repeat(140));
  console.log('📊 V40 Benchmark - Polymarket Subgraph Logic Replica');
  console.log('═'.repeat(140));

  // Import engines
  const { getWalletPnLV1 } = await import('../lib/pnl/pnlEngineV1');
  const { getWalletPnLV40 } = await import('../lib/pnl/pnlEngineV40');

  console.log('✓ V1 engine loaded');
  console.log('✓ V40 engine loaded');

  // Fetch Polymarket baselines
  console.log('\nFetching Polymarket API baselines...');
  const pmBaseline: Record<string, number | null> = {};
  for (const { wallet } of BENCHMARK_WALLETS) {
    pmBaseline[wallet] = await fetchPolymarketPnL(wallet);
    await new Promise(r => setTimeout(r, 100));
  }

  // Test V1
  console.log('\nTesting V1 engine...');
  const v1Results: Record<string, number | null> = {};
  for (const { wallet, name } of BENCHMARK_WALLETS) {
    try {
      const result = await getWalletPnLV1(wallet);
      v1Results[wallet] = result.total;
      process.stdout.write('.');
    } catch {
      v1Results[wallet] = null;
      process.stdout.write('x');
    }
  }
  console.log(' done');

  // Test V40
  console.log('\nTesting V40 engine...');
  const v40Results: Record<string, { total: number | null; stats: any }> = {};
  for (const { wallet, name } of BENCHMARK_WALLETS) {
    try {
      const result = await getWalletPnLV40(wallet);
      v40Results[wallet] = { total: result.total_pnl_mtm, stats: result.stats };
      process.stdout.write('.');
    } catch (e) {
      v40Results[wallet] = { total: null, stats: null };
      process.stdout.write('x');
      console.error(`\n  Error for ${name}: ${(e as Error).message.slice(0, 50)}`);
    }
  }
  console.log(' done');

  // Print results
  console.log('\n' + '═'.repeat(140));
  console.log('RESULTS');
  console.log('═'.repeat(140));
  console.log(
    'Name'.padEnd(16) + ' | ' +
    'Polymarket'.padStart(12) + ' | ' +
    'V1'.padStart(12) + ' | ' +
    'V1 Err'.padStart(8) + ' | ' +
    'V40'.padStart(12) + ' | ' +
    'V40 Err'.padStart(8) + ' | ' +
    'Splits'.padStart(8) + ' | ' +
    'Merges'.padStart(8) + ' | ' +
    'Redeem'.padStart(8) + ' | ' +
    'Caps'.padStart(6)
  );
  console.log('-'.repeat(140));

  let v1Accurate = 0;
  let v40Accurate = 0;
  let total = 0;

  for (const { wallet, name } of BENCHMARK_WALLETS) {
    const pm = pmBaseline[wallet];
    const v1 = v1Results[wallet];
    const v40 = v40Results[wallet].total;
    const stats = v40Results[wallet].stats;

    if (pm !== null) {
      total++;
      if (isAccurate(v1, pm)) v1Accurate++;
      if (isAccurate(v40, pm)) v40Accurate++;
    }

    console.log(
      name.padEnd(16) + ' | ' +
      formatValue(pm).padStart(12) + ' | ' +
      formatValue(v1).padStart(12) + ' | ' +
      formatError(v1, pm).padStart(8) + ' | ' +
      formatValue(v40).padStart(12) + ' | ' +
      formatError(v40, pm).padStart(8) + ' | ' +
      (stats?.ctf_splits?.toString() || '0').padStart(8) + ' | ' +
      (stats?.ctf_merges?.toString() || '0').padStart(8) + ' | ' +
      (stats?.ctf_redemptions?.toString() || '0').padStart(8) + ' | ' +
      (stats?.sell_caps_applied?.toString() || '0').padStart(6)
    );
  }

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('ACCURACY SUMMARY (10% or $100 tolerance)');
  console.log('═'.repeat(80));
  console.log(`V1  : ${v1Accurate}/${total} wallets (${(v1Accurate / total * 100).toFixed(0)}%)`);
  console.log(`V40 : ${v40Accurate}/${total} wallets (${(v40Accurate / total * 100).toFixed(0)}%)`);

  // Highlight critical wallets
  console.log('\n' + '═'.repeat(80));
  console.log('CRITICAL WALLET ANALYSIS');
  console.log('═'.repeat(80));

  for (const name of ['SPLIT_HEAVY', 'NEGRISK_HEAVY']) {
    const entry = BENCHMARK_WALLETS.find(w => w.name === name);
    if (!entry) continue;

    const pm = pmBaseline[entry.wallet];
    const v1 = v1Results[entry.wallet];
    const v40 = v40Results[entry.wallet].total;
    const stats = v40Results[entry.wallet].stats;

    console.log(`\n${name}:`);
    console.log(`  Polymarket: ${formatValue(pm)}`);
    console.log(`  V1: ${formatValue(v1)} (${formatError(v1, pm)})`);
    console.log(`  V40: ${formatValue(v40)} (${formatError(v40, pm)})`);
    if (stats) {
      console.log(`  Stats: ${stats.clob_buys} buys, ${stats.clob_sells} sells, ${stats.ctf_splits} splits, ${stats.ctf_merges} merges, ${stats.ctf_redemptions} redemptions`);
      console.log(`  Sell caps: ${stats.sell_caps_applied}, Positions: ${stats.positions_tracked}`);
    }
  }
}

main().catch(console.error);
