/**
 * Experiment: V16 Short Modes Comparison
 *
 * Tests three short handling modes to understand which matches Polymarket UI:
 * - full_shorts: Allow negative positions, shorts owe $1 at resolution
 * - no_shorts: Clamp sells to current long position, ignore excess
 * - clamped_shorts: Allow negative during trading, but treat as zero at resolution
 */

import { createV16Engine, ShortMode } from '../../lib/pnl/uiActivityEngineV16';

const TEST_WALLETS = [
  { wallet: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', ui_pnl: -10000000, name: 'Active Trader' },
  { wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486', ui_pnl: -6138.90, name: 'Theo (NegRisk)' },
  { wallet: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', ui_pnl: 22053934, name: 'Theo4 (whale)' },
  { wallet: '0x8c2758e0feed42fee2120c0099214e372dbba5e9', ui_pnl: -34.00, name: 'Small loss' },
  { wallet: '0xa60acdbd1dbbe9cbabcd2761f8680f57dad5304c', ui_pnl: 38.84, name: 'Small profit' },
  { wallet: '0xedc0f2cd1743914c4533368e15489c1a7a3d99f3', ui_pnl: 75507.94, name: 'Medium profit' },
  { wallet: '0x4ce73141dbfce41e65db3723e31059a730f0abad', ui_pnl: 332563, name: 'Smart money 1' },
  { wallet: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', ui_pnl: 216892, name: 'Smart money 2' },
];

const MODES: ShortMode[] = ['full_shorts', 'no_shorts', 'clamped_shorts'];

// Trump election condition (biggest impact for Smart Money 1)
const TRUMP_CONDITION = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';
// Second biggest market
const SECOND_CONDITION = 'c6485bb7ea46d7bb8b27c0e12a2ee866cf3f7df107a90cc3e0c4d56f70748b0c';

interface ModeResult {
  mode: ShortMode;
  wallet_pnl: number;
  trump_idx0_pnl: number;
  trump_idx1_pnl: number;
  second_idx0_pnl: number;
  second_idx1_pnl: number;
  total_trades: number;
  negrisk_filtered: number;
}

async function runExperiment() {
  console.log('='.repeat(100));
  console.log('V16 SHORT MODE EXPERIMENT');
  console.log('='.repeat(100));

  // Part 1: Smart Money 1 deep analysis
  console.log('\n' + '='.repeat(100));
  console.log('PART 1: Smart Money 1 Deep Analysis');
  console.log('='.repeat(100));

  const smartMoney1 = TEST_WALLETS.find(w => w.name === 'Smart money 1')!;
  const results: ModeResult[] = [];

  for (const mode of MODES) {
    console.log(`\nRunning ${mode}...`);
    const startTime = Date.now();
    const engine = createV16Engine({ shortMode: mode });
    const result = await engine.compute(smartMoney1.wallet);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Find Trump condition positions
    const trumpPos = result.positions.filter(p => p.condition_id === TRUMP_CONDITION);
    const trump_idx0 = trumpPos.find(p => p.outcome_index === 0);
    const trump_idx1 = trumpPos.find(p => p.outcome_index === 1);

    // Find second condition positions
    const secondPos = result.positions.filter(p => p.condition_id === SECOND_CONDITION);
    const second_idx0 = secondPos.find(p => p.outcome_index === 0);
    const second_idx1 = secondPos.find(p => p.outcome_index === 1);

    results.push({
      mode,
      wallet_pnl: result.realized_pnl,
      trump_idx0_pnl: trump_idx0?.realized_pnl ?? 0,
      trump_idx1_pnl: trump_idx1?.realized_pnl ?? 0,
      second_idx0_pnl: second_idx0?.realized_pnl ?? 0,
      second_idx1_pnl: second_idx1?.realized_pnl ?? 0,
      total_trades: result.total_trades,
      negrisk_filtered: result.negrisk_sell_legs_filtered,
    });

    console.log(`  Done in ${elapsed}s`);
  }

  // Print comparison table for Smart Money 1
  console.log('\n' + '-'.repeat(100));
  console.log('Smart Money 1 Results (UI PnL: $' + smartMoney1.ui_pnl.toLocaleString() + ')');
  console.log('-'.repeat(100));
  console.log('Mode           | Wallet PnL       | Error  | Trump idx0 PnL    | Trump idx1 PnL   ');
  console.log('-'.repeat(100));

  for (const r of results) {
    const error = Math.abs(r.wallet_pnl - smartMoney1.ui_pnl) / Math.abs(smartMoney1.ui_pnl) * 100;
    console.log(
      `${r.mode.padEnd(14)} | $${r.wallet_pnl.toLocaleString().padStart(14)} | ${error.toFixed(1).padStart(5)}% | $${r.trump_idx0_pnl.toLocaleString().padStart(15)} | $${r.trump_idx1_pnl.toLocaleString().padStart(14)}`
    );
  }

  console.log('\n' + '-'.repeat(100));
  console.log('Second biggest market (c6485bb7...)');
  console.log('-'.repeat(100));
  console.log('Mode           | Second idx0 PnL   | Second idx1 PnL');
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      `${r.mode.padEnd(14)} | $${r.second_idx0_pnl.toLocaleString().padStart(15)} | $${r.second_idx1_pnl.toLocaleString().padStart(14)}`
    );
  }

  // Part 2: All 8 wallets comparison
  console.log('\n' + '='.repeat(100));
  console.log('PART 2: All 8 Wallets Comparison');
  console.log('='.repeat(100));

  console.log('\nWallet          | UI PnL        | full_shorts    | no_shorts      | clamped_shorts | Best Mode');
  console.log('-'.repeat(120));

  const allResults: Map<string, Map<ShortMode, number>> = new Map();

  for (const w of TEST_WALLETS) {
    const modeResults = new Map<ShortMode, number>();

    for (const mode of MODES) {
      const engine = createV16Engine({ shortMode: mode });
      const result = await engine.compute(w.wallet);
      modeResults.set(mode, result.realized_pnl);
    }

    allResults.set(w.wallet, modeResults);

    // Find best mode
    let bestMode: ShortMode = 'full_shorts';
    let bestError = Infinity;
    for (const mode of MODES) {
      const pnl = modeResults.get(mode)!;
      const error = Math.abs(pnl - w.ui_pnl) / Math.abs(w.ui_pnl);
      if (error < bestError) {
        bestError = error;
        bestMode = mode;
      }
    }

    const full = modeResults.get('full_shorts')!;
    const no = modeResults.get('no_shorts')!;
    const clamped = modeResults.get('clamped_shorts')!;

    const fullErr = (Math.abs(full - w.ui_pnl) / Math.abs(w.ui_pnl) * 100).toFixed(1);
    const noErr = (Math.abs(no - w.ui_pnl) / Math.abs(w.ui_pnl) * 100).toFixed(1);
    const clampedErr = (Math.abs(clamped - w.ui_pnl) / Math.abs(w.ui_pnl) * 100).toFixed(1);

    console.log(
      `${w.name.substring(0, 15).padEnd(15)} | $${w.ui_pnl.toLocaleString().padStart(11)} | $${full.toLocaleString().padStart(11)} (${fullErr.padStart(5)}%) | $${no.toLocaleString().padStart(11)} (${noErr.padStart(5)}%) | $${clamped.toLocaleString().padStart(11)} (${clampedErr.padStart(5)}%) | ${bestMode}`
    );
  }

  // Part 3: Summary - Pass/Fail counts by mode
  console.log('\n' + '='.repeat(100));
  console.log('PART 3: Pass/Fail Summary (threshold: 25% error)');
  console.log('='.repeat(100));

  for (const mode of MODES) {
    let passed = 0;
    let failed = 0;
    for (const w of TEST_WALLETS) {
      const pnl = allResults.get(w.wallet)!.get(mode)!;
      const error = Math.abs(pnl - w.ui_pnl) / Math.abs(w.ui_pnl);
      const signMatch = (pnl >= 0) === (w.ui_pnl >= 0);
      if (error < 0.25 && signMatch) {
        passed++;
      } else {
        failed++;
      }
    }
    console.log(`${mode.padEnd(14)}: ${passed} passed, ${failed} failed`);
  }

  console.log('\n' + '='.repeat(100));
  console.log('EXPERIMENT COMPLETE');
  console.log('='.repeat(100));
}

runExperiment().catch(console.error);
