/**
 * V1 CLOB-Only Benchmark
 *
 * Tests V1 accuracy only on wallets that pass the CLOB-only filter.
 * This gives us a reliable subset for production.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';
import { checkClobOnly } from '../lib/pnl/walletClassifier';

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
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function errorPct(actual: number | null, expected: number | null): number | null {
  if (actual === null || expected === null) return null;
  if (expected === 0) return actual === 0 ? 0 : 100;
  return Math.abs((actual - expected) / expected) * 100;
}

async function main() {
  console.log('═'.repeat(100));
  console.log('📊 V1 CLOB-Only Benchmark');
  console.log('═'.repeat(100));

  // Step 1: Classify all wallets
  console.log('\n1. Classifying wallets...');
  const classifications: Array<{
    wallet: string;
    name: string;
    is_clob_only: boolean;
    clob_trades: number;
    split_merge: number;
  }> = [];

  for (const { wallet, name } of BENCHMARK_WALLETS) {
    const classification = await checkClobOnly(wallet);
    classifications.push({
      wallet,
      name,
      is_clob_only: classification.is_clob_only,
      clob_trades: classification.clob_trade_count,
      split_merge: classification.split_merge_count,
    });
    process.stdout.write('.');
  }
  console.log(' done');

  const clobOnly = classifications.filter(c => c.is_clob_only);
  const notClobOnly = classifications.filter(c => !c.is_clob_only);

  console.log(`\nCLOB-only wallets: ${clobOnly.length}/${classifications.length}`);
  console.log(`Non-CLOB wallets: ${notClobOnly.length}`);

  // Print classification
  console.log('\n' + '-'.repeat(100));
  console.log('Name'.padEnd(16) + ' | ' + 'CLOB-Only'.padStart(10) + ' | ' + 'CLOB'.padStart(8) + ' | ' + 'Split/Merge'.padStart(12));
  console.log('-'.repeat(100));
  for (const c of classifications) {
    console.log(
      c.name.padEnd(16) + ' | ' +
      (c.is_clob_only ? '✓' : '✗').padStart(10) + ' | ' +
      c.clob_trades.toString().padStart(8) + ' | ' +
      c.split_merge.toString().padStart(12)
    );
  }

  // Step 2: Test V1 on CLOB-only wallets
  console.log('\n' + '═'.repeat(100));
  console.log('2. Testing V1 on CLOB-Only Wallets');
  console.log('═'.repeat(100));

  let v1Accurate = 0;
  let v1Total = 0;

  console.log('\n' + 'Name'.padEnd(16) + ' | ' + 'Polymarket'.padStart(12) + ' | ' + 'V1'.padStart(12) + ' | ' + 'Error'.padStart(8));
  console.log('-'.repeat(60));

  for (const c of clobOnly) {
    const pm = await fetchPolymarketPnL(c.wallet);
    let v1: number | null = null;

    try {
      const result = await getWalletPnLV1(c.wallet);
      v1 = result.total;
    } catch {
      v1 = null;
    }

    const err = errorPct(v1, pm);
    const isAccurate = err !== null && err < 10;

    if (pm !== null) {
      v1Total++;
      if (isAccurate) v1Accurate++;
    }

    console.log(
      c.name.padEnd(16) + ' | ' +
      formatValue(pm).padStart(12) + ' | ' +
      formatValue(v1).padStart(12) + ' | ' +
      (err !== null ? `${err.toFixed(1)}%` : 'N/A').padStart(8) +
      (isAccurate ? ' ✓' : '')
    );

    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n' + '═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log(`CLOB-Only V1 Accuracy: ${v1Accurate}/${v1Total} (${(v1Accurate/v1Total*100).toFixed(0)}%)`);
  console.log(`\nNon-CLOB wallets (unsupported for local PnL):`);
  for (const c of notClobOnly) {
    console.log(`  - ${c.name}: ${c.split_merge} split/merge events`);
  }
}

main().catch(console.error);
