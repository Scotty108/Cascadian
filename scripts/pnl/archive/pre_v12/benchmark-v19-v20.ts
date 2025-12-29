/**
 * V19 vs V20 PnL Engine Benchmark
 *
 * Compares:
 * - V19: pm_unified_ledger_v6 (v3 token map)
 * - V20: pm_unified_ledger_v7 (v4 token map with 500 patched tokens)
 */

import { calculateV19PnL } from '../../lib/pnl/uiActivityEngineV19';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

// Test wallets - mix of problem wallets from previous benchmarks
const testWallets = [
  { wallet: '0x05673d2ee37fc0a05b8ca29d57c2b0bb21b54c55', name: 'comic11', ui_pnl: 36946.52 },
  { wallet: '0xa5e7deeb01d7a5fb0c66dfc31e8cfb3fb7e0a3cc', name: 'niggemon', ui_pnl: 54055.66 },
  { wallet: '0x9a0b4e85131b6c27faf8a28f1dd35f7e84912e38', name: 'dingalingts', ui_pnl: 103199.64 },
  { wallet: '0x62fadaf110588be0d8fcf2c711bae31051bb50a9', name: 'Anon', ui_pnl: 5403.91 },
  { wallet: '0xe44e1fc7e330f9dd9bbf5d5f632ef2a8bc57e359', name: 'John', ui_pnl: 43629.67 },
  { wallet: '0xbae00f67654c0a6f2ba3bd3f1f1e176da659a92a', name: 'Burrito338', ui_pnl: 10200.07 },
  { wallet: '0x42f2e56e22c7149a6e2d8c3a09d3f80a922f3943', name: 'BigBrainBets', ui_pnl: 12500.43 },
];

function errorPct(calculated: number, ui: number): number {
  if (ui === 0) return calculated === 0 ? 0 : 100;
  return (Math.abs(calculated - ui) / Math.abs(ui)) * 100;
}

async function main() {
  console.log('='.repeat(120));
  console.log('V19 vs V20 PNL ENGINE BENCHMARK');
  console.log('='.repeat(120));
  console.log('');
  console.log('V19: pm_unified_ledger_v6 (v3 token map - 358,617 tokens)');
  console.log('V20: pm_unified_ledger_v7 (v4 token map - 359,117 tokens, +500 patched)');
  console.log('');
  console.log('Username       | UI PnL       | V19 PnL      | V20 PnL      | V19 Err  | V20 Err  | Improvement');
  console.log('-'.repeat(110));

  const v19Errors: number[] = [];
  const v20Errors: number[] = [];

  for (const w of testWallets) {
    try {
      const v19 = await calculateV19PnL(w.wallet);
      const v20 = await calculateV20PnL(w.wallet);

      const v19Err = errorPct(v19.total_pnl, w.ui_pnl);
      const v20Err = errorPct(v20.total_pnl, w.ui_pnl);

      v19Errors.push(v19Err);
      v20Errors.push(v20Err);

      const improvement = v19Err - v20Err;
      const improvementStr = improvement > 0 ? `+${improvement.toFixed(1)}%` : `${improvement.toFixed(1)}%`;

      console.log(
        w.name.padEnd(14) +
          ' | ' +
          ('$' + w.ui_pnl.toFixed(2)).padStart(12) +
          ' | ' +
          ('$' + v19.total_pnl.toFixed(2)).padStart(12) +
          ' | ' +
          ('$' + v20.total_pnl.toFixed(2)).padStart(12) +
          ' | ' +
          (v19Err.toFixed(1) + '%').padStart(8) +
          ' | ' +
          (v20Err.toFixed(1) + '%').padStart(8) +
          ' | ' +
          improvementStr.padStart(11)
      );
    } catch (e) {
      console.log(`${w.name.padEnd(14)} | ERROR: ${e}`);
    }
  }

  // Calculate summary stats
  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const passCount = (arr: number[], threshold: number) => arr.filter((e) => e <= threshold).length;

  console.log('');
  console.log('-'.repeat(110));
  console.log('SUMMARY:');
  console.log(`  V19 Median Error: ${median(v19Errors).toFixed(2)}%`);
  console.log(`  V20 Median Error: ${median(v20Errors).toFixed(2)}%`);
  console.log(`  V19 Pass ≤1%: ${passCount(v19Errors, 1)}/${testWallets.length}`);
  console.log(`  V20 Pass ≤1%: ${passCount(v20Errors, 1)}/${testWallets.length}`);
  console.log(`  V19 Pass ≤5%: ${passCount(v19Errors, 5)}/${testWallets.length}`);
  console.log(`  V20 Pass ≤5%: ${passCount(v20Errors, 5)}/${testWallets.length}`);
  console.log('');
  console.log('LEGEND: Improvement = V19 error - V20 error (positive = V20 is better)');
  console.log('='.repeat(120));
}

main().catch(console.error);
