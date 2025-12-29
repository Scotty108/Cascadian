/**
 * Calculate Omega Ratios for Benchmark Wallets (W1-W6)
 *
 * Uses V7 asymmetric mode (safe for leaderboards)
 * Quick test with known wallets before scaling to larger sets.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { computeWalletPnlV7 } from '@/lib/pnl/uiActivityEngineV7';

// Real mid-tier wallets from DB ($5k-$100k volume, 50-2000 trades)
const BENCHMARK_WALLETS = [
  { id: 'R1', address: '0x66b7d9893660d18740bbfc3b28c947235b250bc6' },  // 930 trades, $100k vol
  { id: 'R2', address: '0x953d7ca2da5da044ec400bf98a97e40483b3a685' },  // 298 trades
  { id: 'R3', address: '0xcd0e1cead42dac9bd797157ab1a054b29812c894' },  // 521 trades
  { id: 'R4', address: '0xd82831ad36c7ffbe862620c87b333cb58ccb9520' },  // 641 trades
  { id: 'R5', address: '0x93b3cb33192eb148e9f2e5b267a3f1f07fea02b4' },  // 316 trades
  { id: 'R6', address: '0x3feb7f10729b719ef24374ec2ad1268ab4b7f4aa' },  // 1328 trades
  { id: 'R7', address: '0xf64fbc2695da125a0eb6a735ef3bc6ac1e61cc73' },  // 102 trades
  { id: 'R8', address: '0x0cbbc26a28ce1a5615d45a38121b54dd96bdae02' },  // 751 trades
];

function calculateOmega(gain: number, loss: number): number {
  const absLoss = Math.abs(loss);
  if (absLoss === 0) {
    return gain > 0 ? Infinity : 0;
  }
  return gain / absLoss;
}

async function main() {
  console.log('='.repeat(70));
  console.log('OMEGA RATIO - V7 BENCHMARK WALLETS');
  console.log('='.repeat(70));
  console.log('\nUsing V7 asymmetric mode (conservative, safe for leaderboards)\n');

  console.log(
    'ID | Wallet       | PnL        | Gain       | Loss       | Omega | ROI%'
  );
  console.log('-'.repeat(70));

  const results = [];

  for (const wallet of BENCHMARK_WALLETS) {
    try {
      const metrics = await computeWalletPnlV7(wallet.address, {
        mode: 'asymmetric',
      });

      const omega = calculateOmega(metrics.gain, metrics.loss);
      const roi =
        metrics.volume_traded > 0
          ? (metrics.pnl_total / metrics.volume_traded) * 100
          : 0;

      results.push({
        id: wallet.id,
        address: wallet.address,
        pnl: metrics.pnl_total,
        gain: metrics.gain,
        loss: metrics.loss,
        omega,
        roi,
        volume: metrics.volume_traded,
      });

      const omegaStr =
        omega === Infinity ? '∞' : omega.toFixed(2).padStart(5);
      console.log(
        `${wallet.id} | ${wallet.address.slice(0, 12)}... | $${metrics.pnl_total.toFixed(0).padStart(9)} | $${metrics.gain.toFixed(0).padStart(9)} | $${metrics.loss.toFixed(0).padStart(9)} | ${omegaStr} | ${roi.toFixed(1)}%`
      );
    } catch (err) {
      console.log(`${wallet.id} | ${wallet.address.slice(0, 12)}... | ERROR: ${err}`);
    }
  }

  // Summary stats
  const validResults = results.filter(
    (r) => r.omega !== Infinity && !isNaN(r.omega)
  );
  if (validResults.length > 0) {
    const avgOmega =
      validResults.reduce((s, r) => s + r.omega, 0) / validResults.length;
    const avgRoi =
      validResults.reduce((s, r) => s + r.roi, 0) / validResults.length;
    const totalPnl = results.reduce((s, r) => s + r.pnl, 0);
    const profitable = results.filter((r) => r.omega > 1).length;

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Wallets analyzed: ${results.length}`);
    console.log(`Profitable (Omega > 1): ${profitable}/${results.length}`);
    console.log(`Average Omega ratio: ${avgOmega.toFixed(2)}`);
    console.log(`Average ROI: ${avgRoi.toFixed(1)}%`);
    console.log(`Total PnL: $${totalPnl.toFixed(0)}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('V7 ASYMMETRIC MODE BENEFITS');
  console.log('='.repeat(70));
  console.log('1. Conservative - winners may look worse but losers CANNOT look like winners');
  console.log('2. Safe for leaderboards - no false positives for "smart money" detection');
  console.log('3. Matches Polymarket UI cash-basis accounting');
  console.log('\nTo scale to top 100/50/10 wallets, need to optimize resolution query.');
  console.log('Current V7 engine has O(n) queries for condition_ids which times out');
  console.log('on high-volume wallets. Solution: batch resolution lookups.\n');
}

main().catch(console.error);
