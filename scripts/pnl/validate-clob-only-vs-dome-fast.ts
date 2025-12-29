#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * VALIDATE CLOB-ONLY VS DOME - FAST ITERATION
 * ============================================================================
 *
 * Quick iteration script to find the formula that matches Dome.
 * Filters to CLOB-only wallets (no splits/merges) and tests variations.
 *
 * Usage:
 *   npx tsx scripts/pnl/validate-clob-only-vs-dome-fast.ts --limit=20
 *
 * Terminal: Claude 2
 * Date: 2025-12-07
 */

import fs from 'fs';
import { calculateV29PnL, V29Result } from '../../lib/pnl/inventoryEngineV29';
import { preloadV29Data } from '../../lib/pnl/v29BatchLoaders';

const args = process.argv.slice(2);
let limit = 20;
for (const arg of args) {
  if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]);
}

interface DomeWallet {
  wallet: string;
  realizedPnl: number;
}

function loadDomeData(maxWallets: number): DomeWallet[] {
  const file = 'tmp/dome_realized_500_2025_12_07.json';
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const wallets: DomeWallet[] = [];
  for (const w of data.wallets || []) {
    if (w.confidence === 'high' && w.realizedPnl !== null && !w.isPlaceholder) {
      wallets.push({ wallet: w.wallet.toLowerCase(), realizedPnl: w.realizedPnl });
    }
    if (wallets.length >= maxWallets * 3) break; // Get extra to filter
  }
  return wallets;
}

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('CLOB-ONLY VS DOME - FAST ITERATION');
  console.log('='.repeat(80));
  console.log(`Target: ${limit} CLOB-only wallets\n`);

  // Load Dome data
  const allDome = loadDomeData(limit * 3);
  console.log(`Loaded ${allDome.length} Dome wallets to filter\n`);

  // Preload V29 data
  console.log('Preloading V29 data...');
  const walletList = allDome.map(w => w.wallet);
  const v29Data = await preloadV29Data(walletList);
  console.log('Preload complete\n');

  // Filter to CLOB-only and calculate
  console.log('Filtering to CLOB-only wallets...\n');

  interface Result {
    wallet: string;
    dome: number;
    v29Full: number;
    v29CashOnly: number;
    v29RawCash: number;  // Before rounding, pure cash events
    resolvedUnredeemed: number;
    isClobOnly: boolean;
    splits: number;
    merges: number;
    redemptions: number;
  }

  const results: Result[] = [];

  for (const dome of allDome) {
    if (results.filter(r => r.isClobOnly).length >= limit) break;

    const events = v29Data.eventsByWallet.get(dome.wallet) || [];
    if (events.length === 0) continue;

    const v29 = await calculateV29PnL(dome.wallet, {
      inventoryGuard: true,
      preload: { events, resolutionPrices: v29Data.resolutionPrices },
    });

    const isClobOnly = v29.walletEventCounts.splitEvents === 0 &&
                       v29.walletEventCounts.mergeEvents === 0;

    // V29's realizedPnl = raw cash + resolvedUnredeemed (see line 575)
    // So raw cash = realizedPnl - resolvedUnredeemed
    const rawCashPnl = v29.realizedPnl - v29.resolvedUnredeemedValue;

    results.push({
      wallet: dome.wallet,
      dome: dome.realizedPnl,
      v29Full: v29.realizedPnl,
      v29CashOnly: rawCashPnl,
      v29RawCash: rawCashPnl,
      resolvedUnredeemed: v29.resolvedUnredeemedValue,
      isClobOnly,
      splits: v29.walletEventCounts.splitEvents,
      merges: v29.walletEventCounts.mergeEvents,
      redemptions: v29.walletEventCounts.redemptionEvents,
    });
  }

  const clobOnly = results.filter(r => r.isClobOnly);
  const mixed = results.filter(r => !r.isClobOnly);

  console.log(`Found ${clobOnly.length} CLOB-only, ${mixed.length} mixed\n`);

  // Test different formulas
  const formulas = [
    { name: 'V29 Full (realizedPnl)', fn: (r: Result) => r.v29Full },
    { name: 'Cash-Only (- resolved)', fn: (r: Result) => r.v29CashOnly },
    { name: 'Raw Cash (no rounding)', fn: (r: Result) => r.v29RawCash },
  ];

  console.log('='.repeat(80));
  console.log('CLOB-ONLY WALLETS');
  console.log('='.repeat(80));

  for (const formula of formulas) {
    const errors = clobOnly.map(r => {
      const our = formula.fn(r);
      const delta = our - r.dome;
      const denom = Math.max(Math.abs(r.dome), 100);
      return { pct: (Math.abs(delta) / denom) * 100, abs: Math.abs(delta) };
    });

    const pass5pct = errors.filter(e => e.pct < 5 || e.abs < 5).length;
    const pass10usd = errors.filter(e => e.abs < 10).length;
    const pass1usd = errors.filter(e => e.abs < 1).length;
    const medianPct = median(errors.map(e => e.pct));
    const medianAbs = median(errors.map(e => e.abs));

    console.log(`\n${formula.name}:`);
    console.log(`  Pass <5%:    ${pass5pct}/${clobOnly.length} (${(pass5pct/clobOnly.length*100).toFixed(1)}%)`);
    console.log(`  Pass <$10:   ${pass10usd}/${clobOnly.length} (${(pass10usd/clobOnly.length*100).toFixed(1)}%)`);
    console.log(`  Pass <$1:    ${pass1usd}/${clobOnly.length} (${(pass1usd/clobOnly.length*100).toFixed(1)}%)`);
    console.log(`  Median %:    ${medianPct.toFixed(2)}%`);
    console.log(`  Median $:    $${medianAbs.toFixed(2)}`);
  }

  // Show individual CLOB-only results
  console.log('\n\nCLOB-ONLY WALLET DETAILS:');
  console.log('-'.repeat(120));
  console.log('Wallet           | Dome        | V29 Full    | Cash-Only   | Resolved    | Redemptions | Delta (Cash)');
  console.log('-'.repeat(120));

  for (const r of clobOnly.slice(0, 20)) {
    const delta = r.v29CashOnly - r.dome;
    console.log(
      `${r.wallet.slice(0, 15)}... | ${fmt(r.dome)} | ${fmt(r.v29Full)} | ${fmt(r.v29CashOnly)} | ${fmt(r.resolvedUnredeemed)} | ${r.redemptions.toString().padStart(11)} | ${fmt(delta)}`
    );
  }

  // Check if there's a pattern with redemptions
  console.log('\n\n='.repeat(80));
  console.log('ANALYSIS: Does excluding redemptions help?');
  console.log('='.repeat(80));

  const withRedemptions = clobOnly.filter(r => r.redemptions > 0);
  const noRedemptions = clobOnly.filter(r => r.redemptions === 0);

  console.log(`\nWith redemptions: ${withRedemptions.length} wallets`);
  console.log(`No redemptions: ${noRedemptions.length} wallets`);

  if (noRedemptions.length > 0) {
    const errors = noRedemptions.map(r => {
      const delta = r.v29CashOnly - r.dome;
      const denom = Math.max(Math.abs(r.dome), 100);
      return { pct: (Math.abs(delta) / denom) * 100, abs: Math.abs(delta) };
    });
    const pass5pct = errors.filter(e => e.pct < 5 || e.abs < 5).length;
    console.log(`  Pass <5% (no redemptions): ${pass5pct}/${noRedemptions.length} (${(pass5pct/noRedemptions.length*100).toFixed(1)}%)`);
  }

  // Save results
  fs.writeFileSync('tmp/clob_only_vs_dome_fast.json', JSON.stringify({ clobOnly, mixed }, null, 2));
  console.log('\n\nResults saved to: tmp/clob_only_vs_dome_fast.json');
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmt(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toFixed(0).padStart(9)}`;
}

main().catch(console.error);
