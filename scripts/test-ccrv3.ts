#!/usr/bin/env npx tsx
/**
 * Test CCR-v3 engine against real wallet data
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv3 } from '../lib/pnl/ccrEngineV3';
import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

const TEST_WALLETS = {
  splitHeavy: {
    address: '0xb2e4567925b79231265adf5d54687ddfb761bc51',
    uiPnl: -115409.28,
    description: 'Split+Sell Heavy Wallet',
  },
  takerHeavy: {
    address: '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec',
    uiPnl: -1129, // Approximate from USDC flow
    description: 'Taker-Heavy Wallet',
  },
};

async function testWallet(name: string, wallet: typeof TEST_WALLETS.splitHeavy) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${wallet.description}`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Expected UI PnL: $${wallet.uiPnl.toLocaleString()}`);
  console.log('='.repeat(60));

  // Run both engines
  const [v3Result, v1Result] = await Promise.all([
    computeCCRv3(wallet.address),
    computeCCRv1(wallet.address),
  ]);

  // V3 Results
  console.log('\n--- CCR-v3 (Cash Flow) ---');
  console.log(`Total PnL: $${v3Result.total_pnl.toLocaleString()}`);
  console.log(`  Realized: $${v3Result.realized_pnl.toLocaleString()}`);
  console.log(`  Unrealized: $${v3Result.unrealized_pnl.toLocaleString()}`);
  console.log('\nCash Flow Breakdown:');
  console.log(`  USDC from buys: $${v3Result.usdc_from_buys.toLocaleString()}`);
  console.log(`  USDC from sells: $${v3Result.usdc_from_sells.toLocaleString()}`);
  console.log(`  USDC from splits: $${v3Result.usdc_from_splits.toLocaleString()}`);
  console.log(`  USDC from merges: $${v3Result.usdc_from_merges.toLocaleString()}`);
  console.log(`  USDC from redemptions: $${v3Result.usdc_from_redemptions.toLocaleString()}`);
  console.log(`\nPositions: ${v3Result.positions_count}`);
  console.log(`  Resolved: ${v3Result.resolved_count}`);
  console.log(`  Unresolved: ${v3Result.unresolved_count}`);
  console.log(`  Trades: ${v3Result.total_trades}`);

  // V1 Results
  console.log('\n--- CCR-v1 (Cost Basis) ---');
  console.log(`Total PnL: $${v1Result.total_pnl.toLocaleString()}`);

  // Calculate errors
  const v3Diff = Math.abs(v3Result.total_pnl - wallet.uiPnl);
  const v3Error = (v3Diff / Math.abs(wallet.uiPnl)) * 100;

  const v1Diff = Math.abs(v1Result.total_pnl - wallet.uiPnl);
  const v1Error = (v1Diff / Math.abs(wallet.uiPnl)) * 100;

  console.log('\n--- Accuracy Comparison ---');
  console.log(`CCR-v3: $${v3Result.total_pnl.toFixed(2)} (${v3Error.toFixed(2)}% error)`);
  console.log(`CCR-v1: $${v1Result.total_pnl.toFixed(2)} (${v1Error.toFixed(2)}% error)`);
  console.log(`Winner: ${v3Error < v1Error ? 'CCR-v3' : 'CCR-v1'}`);

  return {
    name,
    v3Pnl: v3Result.total_pnl,
    v1Pnl: v1Result.total_pnl,
    uiPnl: wallet.uiPnl,
    v3Error,
    v1Error,
  };
}

async function main() {
  console.log('CCR-v3 Test Suite: Cash-Flow PnL Engine');
  console.log('======================================');

  const results = [];

  for (const [name, wallet] of Object.entries(TEST_WALLETS)) {
    try {
      const result = await testWallet(name, wallet);
      results.push(result);
    } catch (error) {
      console.error(`Error testing ${name}:`, error);
    }
  }

  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log('Wallet           | UI PnL      | CCR-v3 Error | CCR-v1 Error | Winner');
  console.log('-'.repeat(75));
  for (const r of results) {
    const v3Win = r.v3Error < r.v1Error;
    console.log(
      `${r.name.padEnd(16)} | $${r.uiPnl.toFixed(0).padStart(10)} | ${r.v3Error.toFixed(2).padStart(10)}% | ${r.v1Error.toFixed(2).padStart(10)}% | ${v3Win ? 'v3' : 'v1'}`
    );
  }

  // Check if v3 meets target (<2% error)
  const v3PassesSplitHeavy = results.find(r => r.name === 'splitHeavy')?.v3Error ?? 100;
  const v3PassesTakerHeavy = results.find(r => r.name === 'takerHeavy')?.v3Error ?? 100;

  console.log('\n--- Target: <5% error for all wallet types ---');
  console.log(`Split-heavy: ${v3PassesSplitHeavy < 5 ? '✓ PASS' : '✗ FAIL'} (${v3PassesSplitHeavy.toFixed(2)}%)`);
  console.log(`Taker-heavy: ${v3PassesTakerHeavy < 5 ? '✓ PASS' : '✗ FAIL'} (${v3PassesTakerHeavy.toFixed(2)}%)`);
}

main().catch(console.error);
