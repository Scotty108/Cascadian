#!/usr/bin/env tsx
/**
 * Dump Wallet Coverage Report (Multi-Wallet Support)
 *
 * Queries pm_wallet_market_coverage_internal view and generates coverage reports.
 *
 * Modes:
 * 1. Single wallet: Detailed report for one wallet
 * 2. Multi-wallet: Summary table for multiple wallets from file
 * 3. Default baseline: Uses config/baseline_wallets.txt if no args
 *
 * Usage:
 *   npx tsx scripts/124b-dump-wallet-coverage-multi.ts <wallet>
 *   npx tsx scripts/124b-dump-wallet-coverage-multi.ts --wallets-file wallets.txt
 *   npx tsx scripts/124b-dump-wallet-coverage-multi.ts (uses baseline)
 */

import { resolve } from 'path';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// Known wallet aliases
const WALLET_ALIASES: Record<string, string> = {
  'xcnstrategy': '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'xcn': '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
};

const DEFAULT_WALLETS_FILE = 'config/baseline_wallets.txt';

function resolveWallet(input: string): string {
  return (WALLET_ALIASES[input.toLowerCase()] || input).toLowerCase();
}

function loadWalletsFromFile(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))  // Remove comments and empty lines
      .map(resolveWallet);
  } catch (error: any) {
    console.error(`❌ Error reading wallets file: ${error.message}`);
    process.exit(1);
  }
}

async function getSingleWalletCoverage(walletAddress: string) {
  const query = await clickhouse.query({
    query: `
      SELECT
        coverage_category,
        COUNT(*) as market_count,
        SUM(trade_count) as total_trades,
        round(SUM(total_shares), 2) as total_shares,
        min(first_trade_at) as first_trade_at,
        max(last_trade_at) as last_trade_at
      FROM pm_wallet_market_coverage_internal
      WHERE lower(wallet_address) = '${walletAddress}'
      GROUP BY coverage_category
      ORDER BY coverage_category
    `,
    format: 'JSONEachRow'
  });
  return await query.json();
}

async function runSingleWalletReport(walletAddress: string, alias?: string) {
  console.log('Wallet Coverage Report (Detailed)');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Wallet: ${walletAddress}`);
  if (alias) {
    console.log(`Alias: ${alias}`);
  }
  console.log('');

  const summary = await getSingleWalletCoverage(walletAddress);

  if (summary.length === 0) {
    console.log('⚠️  No coverage data found for this wallet');
    console.log('');
    return;
  }

  console.table(summary);
  console.log('');

  const totalMarkets = summary.reduce((sum, row) => sum + parseInt(row.market_count), 0);
  const totalTrades = summary.reduce((sum, row) => sum + parseInt(row.total_trades), 0);
  const totalShares = summary.reduce((sum, row) => sum + parseFloat(row.total_shares), 0);

  const categoryA = summary.find(r => r.coverage_category === 'A_INTERNAL_OK');
  const coveragePercent = categoryA ? (parseInt(categoryA.market_count) / totalMarkets * 100).toFixed(1) : '0.0';

  console.log('Summary:');
  console.log(`  Markets traded: ${totalMarkets}`);
  console.log(`  Total trades: ${totalTrades}`);
  console.log(`  Total shares: ${totalShares.toFixed(2)}`);
  console.log(`  Resolution coverage: ${coveragePercent}%`);
  console.log('');
}

async function runMultiWalletReport(wallets: string[]) {
  console.log('Wallet Coverage Report (Multi-Wallet Summary)');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Analyzing ${wallets.length} wallet(s)...`);
  console.log('');

  const results = [];

  for (const wallet of wallets) {
    const summary = await getSingleWalletCoverage(wallet);

    if (summary.length === 0) {
      results.push({
        wallet: wallet.substring(0, 12) + '...',
        markets_traded: 0,
        category_A_count: 0,
        category_B_count: 0,
        first_trade_at: null,
        last_trade_at: null,
        status: 'NO_DATA'
      });
      continue;
    }

    const totalMarkets = summary.reduce((sum, row) => sum + parseInt(row.market_count), 0);
    const categoryA = summary.find(r => r.coverage_category === 'A_INTERNAL_OK');
    const categoryB = summary.filter(r => r.coverage_category.startsWith('B_'));

    const firstTrade = summary.reduce((min, row) => {
      const rowTime = row.first_trade_at;
      return !min || (rowTime && rowTime < min) ? rowTime : min;
    }, null as any);

    const lastTrade = summary.reduce((max, row) => {
      const rowTime = row.last_trade_at;
      return !max || (rowTime && rowTime > max) ? rowTime : max;
    }, null as any);

    results.push({
      wallet: wallet.substring(0, 12) + '...',
      markets_traded: totalMarkets,
      category_A_count: categoryA ? parseInt(categoryA.market_count) : 0,
      category_B_count: categoryB.reduce((sum, r) => sum + parseInt(r.market_count), 0),
      first_trade_at: firstTrade,
      last_trade_at: lastTrade,
      status: categoryB.length > 0 ? 'UNRESOLVED' : 'OK'
    });
  }

  console.table(results);
  console.log('');

  // Summary stats
  const totalWallets = results.length;
  const activeWallets = results.filter(r => r.markets_traded > 0).length;
  const healthyWallets = results.filter(r => r.status === 'OK' && r.markets_traded > 0).length;

  console.log('Aggregate Summary:');
  console.log(`  Total wallets: ${totalWallets}`);
  console.log(`  Active wallets: ${activeWallets} (${(activeWallets/totalWallets*100).toFixed(1)}%)`);
  console.log(`  Healthy wallets: ${healthyWallets} (100% resolved)`);
  console.log(`  Wallets with unresolved markets: ${activeWallets - healthyWallets}`);
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);

  // Mode 1: --wallets-file <path>
  if (args.includes('--wallets-file')) {
    const fileIndex = args.indexOf('--wallets-file');
    const filePath = args[fileIndex + 1];

    if (!filePath) {
      console.error('❌ Error: --wallets-file requires a file path');
      process.exit(1);
    }

    const wallets = loadWalletsFromFile(filePath);
    await runMultiWalletReport(wallets);
    return;
  }

  // Mode 2: Single wallet
  if (args.length === 1 && !args[0].startsWith('--')) {
    const walletInput = args[0];
    const alias = WALLET_ALIASES[walletInput.toLowerCase()] ? walletInput : undefined;
    const walletAddress = resolveWallet(walletInput);
    await runSingleWalletReport(walletAddress, alias);
    return;
  }

  // Mode 3: Default baseline wallets
  if (args.length === 0) {
    console.log(`Using default baseline wallets from ${DEFAULT_WALLETS_FILE}`);
    console.log('');
    const wallets = loadWalletsFromFile(DEFAULT_WALLETS_FILE);
    await runMultiWalletReport(wallets);
    return;
  }

  // Invalid usage
  console.error('❌ Error: Invalid arguments');
  console.error('');
  console.error('Usage:');
  console.error('  Single wallet:  npx tsx scripts/124b-dump-wallet-coverage-multi.ts xcnstrategy');
  console.error('  Multi-wallet:   npx tsx scripts/124b-dump-wallet-coverage-multi.ts --wallets-file wallets.txt');
  console.error('  Default:        npx tsx scripts/124b-dump-wallet-coverage-multi.ts');
  console.error('');
  process.exit(1);
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
