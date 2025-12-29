#!/usr/bin/env tsx
/**
 * P&L Consistency Validation (Multi-Wallet Support)
 *
 * Validates P&L pipeline consistency for one or multiple wallets.
 *
 * Modes:
 * 1. Single wallet: Detailed validation for one wallet
 * 2. Multi-wallet: Summary table for multiple wallets from file
 * 3. Default baseline: Uses config/baseline_wallets.txt if no args
 *
 * Usage:
 *   npx tsx scripts/125b-validate-pnl-consistency-multi.ts --wallet xcnstrategy
 *   npx tsx scripts/125b-validate-pnl-consistency-multi.ts --wallets-file wallets.txt
 *   npx tsx scripts/125b-validate-pnl-consistency-multi.ts (uses baseline)
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
      .filter(line => line && !line.startsWith('#'))
      .map(resolveWallet);
  } catch (error: any) {
    console.error(`❌ Error reading wallets file: ${error.message}`);
    process.exit(1);
  }
}

interface ValidationResult {
  check: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
}

async function validateWallet(walletAddress: string): Promise<{ results: ValidationResult[], summary: { pass: number, warn: number, fail: number } }> {
  const results: ValidationResult[] = [];
  const walletFilter = `WHERE lower(canonical_wallet_address) = '${walletAddress}'`;

  // Check 1a: Negative shares
  const negSharesQuery = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM pm_trades ${walletFilter} AND shares < 0`,
    format: 'JSONEachRow'
  });
  const negShares = (await negSharesQuery.json())[0];
  results.push({
    check: 'Negative shares',
    status: parseInt(negShares?.count || '0') === 0 ? 'PASS' : 'FAIL',
    details: parseInt(negShares?.count || '0') === 0 ? 'None found' : `${negShares.count} found`
  });

  // Check 1b: Invalid prices
  const invalidPriceQuery = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM pm_trades ${walletFilter} AND (price < 0 OR price > 1)`,
    format: 'JSONEachRow'
  });
  const invalidPrice = (await invalidPriceQuery.json())[0];
  results.push({
    check: 'Invalid prices',
    status: parseInt(invalidPrice?.count || '0') === 0 ? 'PASS' : 'FAIL',
    details: parseInt(invalidPrice?.count || '0') === 0 ? 'All valid' : `${invalidPrice.count} invalid`
  });

  // Check 2: Resolution coverage
  const coverageQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT condition_id) as total_markets,
        COUNT(DISTINCT CASE WHEN coverage_category = 'A_INTERNAL_OK' THEN condition_id END) as resolved_markets
      FROM pm_wallet_market_coverage_internal
      WHERE lower(wallet_address) = '${walletAddress}'
    `,
    format: 'JSONEachRow'
  });
  const coverage = (await coverageQuery.json())[0];
  const coverageRate = parseInt(coverage?.resolved_markets || '0') / Math.max(parseInt(coverage?.total_markets || '1'), 1) * 100;
  results.push({
    check: 'Resolution coverage',
    status: coverageRate === 100 ? 'PASS' : coverageRate >= 95 ? 'WARN' : 'FAIL',
    details: `${coverageRate.toFixed(1)}%`
  });

  // Check 3: P&L view populated
  const pnlViewQuery = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM pm_wallet_market_pnl_resolved WHERE lower(wallet_address) = '${walletAddress}'`,
    format: 'JSONEachRow'
  });
  const pnlView = (await pnlViewQuery.json())[0];
  results.push({
    check: 'P&L view populated',
    status: parseInt(pnlView?.count || '0') > 0 ? 'PASS' : 'FAIL',
    details: `${pnlView?.count || 0} rows`
  });

  const passCount = results.filter(r => r.status === 'PASS').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;

  return {
    results,
    summary: { pass: passCount, warn: warnCount, fail: failCount }
  };
}

async function runSingleWalletValidation(walletAddress: string, alias?: string) {
  console.log('P&L Consistency Validation (Detailed)');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Wallet: ${walletAddress}`);
  if (alias) {
    console.log(`Alias: ${alias}`);
  }
  console.log('');

  const { results, summary } = await validateWallet(walletAddress);

  console.table(results);
  console.log('');

  console.log('Summary:');
  console.log(`  ✅ PASS: ${summary.pass}`);
  console.log(`  ⚠️  WARN: ${summary.warn}`);
  console.log(`  ❌ FAIL: ${summary.fail}`);
  console.log('');

  if (summary.fail === 0 && summary.warn === 0) {
    console.log('✅ ALL CHECKS PASSED');
  } else if (summary.fail === 0) {
    console.log('✅ HEALTHY (with warnings)');
  } else {
    console.log('❌ CRITICAL ISSUES FOUND');
  }
  console.log('');

  process.exit(summary.fail > 0 ? 1 : 0);
}

async function runMultiWalletValidation(wallets: string[]) {
  console.log('P&L Consistency Validation (Multi-Wallet Summary)');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Validating ${wallets.length} wallet(s)...`);
  console.log('');

  const results = [];

  for (const wallet of wallets) {
    const { summary } = await validateWallet(wallet);

    results.push({
      wallet: wallet.substring(0, 12) + '...',
      checks_passed: summary.pass,
      checks_warned: summary.warn,
      checks_failed: summary.fail,
      status: summary.fail > 0 ? '❌ FAIL' : summary.warn > 0 ? '⚠️  WARN' : '✅ PASS'
    });
  }

  console.table(results);
  console.log('');

  const totalWallets = results.length;
  const cleanWallets = results.filter(r => r.checks_failed === 0 && r.checks_warned === 0).length;
  const warnWallets = results.filter(r => r.checks_failed === 0 && r.checks_warned > 0).length;
  const failWallets = results.filter(r => r.checks_failed > 0).length;

  console.log('Aggregate Summary:');
  console.log(`  Total wallets: ${totalWallets}`);
  console.log(`  ✅ Fully clean: ${cleanWallets} (${(cleanWallets/totalWallets*100).toFixed(1)}%)`);
  console.log(`  ⚠️  With warnings: ${warnWallets}`);
  console.log(`  ❌ With failures: ${failWallets}`);
  console.log('');

  if (failWallets === 0 && warnWallets === 0) {
    console.log('✅ ALL WALLETS PASSED');
  } else if (failWallets === 0) {
    console.log('✅ ALL WALLETS HEALTHY (some warnings)');
  } else {
    console.log('❌ CRITICAL ISSUES IN SOME WALLETS');
  }
  console.log('');

  process.exit(failWallets > 0 ? 1 : 0);
}

async function main() {
  const args = process.argv.slice(2);

  // Mode 1: --wallet <address>
  if (args.includes('--wallet')) {
    const walletIndex = args.indexOf('--wallet');
    const walletInput = args[walletIndex + 1];

    if (!walletInput) {
      console.error('❌ Error: --wallet requires an address');
      process.exit(1);
    }

    const alias = WALLET_ALIASES[walletInput.toLowerCase()] ? walletInput : undefined;
    const walletAddress = resolveWallet(walletInput);
    await runSingleWalletValidation(walletAddress, alias);
    return;
  }

  // Mode 2: --wallets-file <path>
  if (args.includes('--wallets-file')) {
    const fileIndex = args.indexOf('--wallets-file');
    const filePath = args[fileIndex + 1];

    if (!filePath) {
      console.error('❌ Error: --wallets-file requires a file path');
      process.exit(1);
    }

    const wallets = loadWalletsFromFile(filePath);
    await runMultiWalletValidation(wallets);
    return;
  }

  // Mode 3: Default baseline wallets
  if (args.length === 0) {
    console.log(`Using default baseline wallets from ${DEFAULT_WALLETS_FILE}`);
    console.log('');
    const wallets = loadWalletsFromFile(DEFAULT_WALLETS_FILE);
    await runMultiWalletValidation(wallets);
    return;
  }

  // Invalid usage
  console.error('❌ Error: Invalid arguments');
  console.error('');
  console.error('Usage:');
  console.error('  Single wallet:  npx tsx scripts/125b-validate-pnl-consistency-multi.ts --wallet xcnstrategy');
  console.error('  Multi-wallet:   npx tsx scripts/125b-validate-pnl-consistency-multi.ts --wallets-file wallets.txt');
  console.error('  Default:        npx tsx scripts/125b-validate-pnl-consistency-multi.ts');
  console.error('');
  process.exit(1);
}

main().catch((error) => {
  console.error('❌ Validation failed:', error);
  process.exit(1);
});
