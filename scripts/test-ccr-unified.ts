#!/usr/bin/env npx tsx
/**
 * Test CCR-Unified: Hybrid PnL Engine
 *
 * Tests both wallet types to verify the hybrid approach works.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeUnified, createUnifiedEngine } from '../lib/pnl/ccrUnified';

const TEST_WALLETS = {
  splitHeavy: {
    address: '0xb2e4567925b79231265adf5d54687ddfb761bc51',
    uiPnl: -115409.28,
    description: 'Split+Sell Heavy Wallet (Maker-heavy)',
  },
  takerHeavy: {
    address: '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec',
    uiPnl: -1129,
    description: 'Taker-Heavy Wallet (PM Exchange API)',
  },
};

async function testWallet(name: string, wallet: typeof TEST_WALLETS.splitHeavy) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing: ${wallet.description}`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Expected UI PnL: $${wallet.uiPnl.toLocaleString()}`);
  console.log('='.repeat(70));

  // Detect pattern first
  const engine = createUnifiedEngine();
  const pattern = await engine.detectPattern(wallet.address);

  console.log(`\nPattern Detection:`);
  console.log(`  Maker trades: ${pattern.makerTrades}`);
  console.log(`  Taker trades: ${pattern.takerTrades}`);
  console.log(`  Maker ratio: ${(pattern.makerRatio * 100).toFixed(1)}%`);
  console.log(`  Markets: ${pattern.marketsCount}`);
  console.log(`  → Engine: ${pattern.makerRatio >= 0.5 ? 'CCR-v1 (cost-basis)' : 'CCR-v3 (cash-flow)'}`);

  // Run unified engine
  const result = await computeUnified(wallet.address);

  console.log(`\n--- Results ---`);
  console.log(`Total PnL: $${result.total_pnl.toLocaleString()}`);
  console.log(`  Realized: $${result.realized_pnl.toLocaleString()}`);
  console.log(`  Unrealized: $${result.unrealized_pnl.toLocaleString()}`);
  console.log(`Positions: ${result.positions_count}`);
  console.log(`  Resolved: ${result.resolved_count}`);
  console.log(`  Unresolved: ${result.unresolved_count}`);
  console.log(`Confidence: ${result.pnl_confidence}`);
  console.log(`Engine: ${result.engine_used}`);

  // Calculate error
  const diff = Math.abs(result.total_pnl - wallet.uiPnl);
  const pctError = (diff / Math.abs(wallet.uiPnl)) * 100;

  console.log(`\n--- Accuracy ---`);
  console.log(`Calculated: $${result.total_pnl.toFixed(2)}`);
  console.log(`Target: $${wallet.uiPnl.toFixed(2)}`);
  console.log(`Error: ${pctError.toFixed(2)}%`);
  console.log(`Status: ${pctError < 5 ? '✓ PASS (<5%)' : '✗ FAIL (≥5%)'}`);

  return {
    name,
    calculated: result.total_pnl,
    target: wallet.uiPnl,
    pctError,
    engineUsed: result.engine_used,
    makerRatio: result.maker_ratio,
    passed: pctError < 5,
  };
}

async function main() {
  console.log('CCR-Unified Test Suite: Hybrid PnL Engine');
  console.log('==========================================');
  console.log('Tests that maker-heavy wallets use CCR-v1 and taker-heavy use CCR-v3.');

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
  console.log('\n\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('Wallet           | Engine   | Maker% | Target       | Calculated   | Error     | Status');
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(
      `${r.name.padEnd(16)} | ${r.engineUsed.padEnd(8)} | ${(r.makerRatio * 100).toFixed(0).padStart(5)}% | ` +
      `$${r.target.toFixed(0).padStart(10)} | $${r.calculated.toFixed(0).padStart(10)} | ` +
      `${r.pctError.toFixed(2).padStart(7)}% | ${r.passed ? '✓ PASS' : '✗ FAIL'}`
    );
  }

  const allPassed = results.every(r => r.passed);
  console.log('\n' + (allPassed ? '🎉 ALL TESTS PASSED!' : '❌ SOME TESTS FAILED'));
}

main().catch(console.error);
