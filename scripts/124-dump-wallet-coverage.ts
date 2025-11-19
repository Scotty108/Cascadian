#!/usr/bin/env tsx
/**
 * Dump Wallet Coverage Report
 *
 * Queries pm_wallet_market_coverage_internal view for a specific wallet and generates
 * a detailed coverage report showing:
 * - Category A (INTERNAL_OK): Markets with trades + resolved
 * - Category B (INTERNAL_UNRESOLVED): Markets with trades but not resolved
 * - Summary statistics
 *
 * Usage:
 *   npx tsx scripts/124-dump-wallet-coverage.ts <wallet_address>
 *   npx tsx scripts/124-dump-wallet-coverage.ts 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
 *   npx tsx scripts/124-dump-wallet-coverage.ts xcnstrategy
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// Known wallet aliases
const WALLET_ALIASES: Record<string, string> = {
  'xcnstrategy': '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'xcn': '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
};

async function main() {
  const walletInput = process.argv[2];

  if (!walletInput) {
    console.error('❌ Error: Wallet address required');
    console.error('');
    console.error('Usage:');
    console.error('  npx tsx scripts/124-dump-wallet-coverage.ts <wallet_address>');
    console.error('  npx tsx scripts/124-dump-wallet-coverage.ts 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b');
    console.error('  npx tsx scripts/124-dump-wallet-coverage.ts xcnstrategy');
    process.exit(1);
  }

  // Resolve alias or normalize address
  const walletAddress = (WALLET_ALIASES[walletInput.toLowerCase()] || walletInput).toLowerCase();

  console.log('Wallet Coverage Report');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Wallet: ${walletAddress}`);
  if (WALLET_ALIASES[walletInput.toLowerCase()]) {
    console.log(`Alias: ${walletInput}`);
  }
  console.log('');

  // Step 1: Summary statistics
  console.log('Step 1: Summary Statistics');
  console.log('-'.repeat(80));
  console.log('');

  const summaryQuery = await clickhouse.query({
    query: `
      SELECT
        coverage_category,
        COUNT(*) as market_count,
        SUM(trade_count) as total_trades,
        round(SUM(total_shares), 2) as total_shares
      FROM pm_wallet_market_coverage_internal
      WHERE lower(wallet_address) = '${walletAddress}'
      GROUP BY coverage_category
      ORDER BY coverage_category
    `,
    format: 'JSONEachRow'
  });
  const summary = await summaryQuery.json();

  if (summary.length === 0) {
    console.log('⚠️  No coverage data found for this wallet');
    console.log('');
    console.log('Possible reasons:');
    console.log('1. Wallet has no trades in pm_trades');
    console.log('2. Wallet address is incorrect or not normalized');
    console.log('3. pm_wallet_market_coverage_internal view is empty');
    console.log('');
    process.exit(0);
  }

  console.table(summary);
  console.log('');

  // Calculate totals
  const totalMarkets = summary.reduce((sum, row) => sum + parseInt(row.market_count), 0);
  const totalTrades = summary.reduce((sum, row) => sum + parseInt(row.total_trades), 0);
  const totalShares = summary.reduce((sum, row) => sum + parseFloat(row.total_shares), 0);

  console.log('Overall Totals:');
  console.log(`  Markets: ${totalMarkets}`);
  console.log(`  Trades: ${totalTrades}`);
  console.log(`  Shares: ${totalShares.toFixed(2)}`);
  console.log('');

  // Step 2: Category A (INTERNAL_OK) - Top markets
  console.log('Step 2: Category A (INTERNAL_OK) - Trades + Resolved');
  console.log('-'.repeat(80));
  console.log('');

  const categoryAQuery = await clickhouse.query({
    query: `
      SELECT
        left(condition_id, 16) || '...' as condition_id_short,
        market_question,
        trade_count,
        round(total_shares, 2) as total_shares,
        first_trade_at,
        last_trade_at,
        resolved_at
      FROM pm_wallet_market_coverage_internal
      WHERE lower(wallet_address) = '${walletAddress}'
        AND coverage_category = 'A_INTERNAL_OK'
      ORDER BY trade_count DESC, total_shares DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const categoryA = await categoryAQuery.json();

  if (categoryA.length > 0) {
    console.log(`Top ${categoryA.length} markets by trade count:`);
    console.log('');
    console.table(categoryA.map((row, i) => ({
      '#': i + 1,
      'Condition ID': row.condition_id_short,
      'Question': row.market_question?.substring(0, 50) + (row.market_question?.length > 50 ? '...' : ''),
      'Trades': row.trade_count,
      'Shares': row.total_shares,
      'First Trade': row.first_trade_at,
      'Resolved': row.resolved_at
    })));
  } else {
    console.log('No Category A markets found');
  }
  console.log('');

  // Step 3: Category B (INTERNAL_UNRESOLVED) - Markets with trades but not resolved
  console.log('Step 3: Category B (INTERNAL_UNRESOLVED) - Trades but Not Resolved');
  console.log('-'.repeat(80));
  console.log('');

  const categoryBQuery = await clickhouse.query({
    query: `
      SELECT
        left(condition_id, 16) || '...' as condition_id_short,
        market_question,
        market_status,
        trade_count,
        round(total_shares, 2) as total_shares,
        first_trade_at,
        last_trade_at
      FROM pm_wallet_market_coverage_internal
      WHERE lower(wallet_address) = '${walletAddress}'
        AND (coverage_category = 'B_INTERNAL_UNRESOLVED' OR coverage_category = 'B_INTERNAL_UNRESOLVED_NO_MARKET')
      ORDER BY trade_count DESC, total_shares DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const categoryB = await categoryBQuery.json();

  if (categoryB.length > 0) {
    console.log(`Found ${categoryB.length} unresolved markets:`);
    console.log('');
    console.table(categoryB.map((row, i) => ({
      '#': i + 1,
      'Condition ID': row.condition_id_short,
      'Question': row.market_question?.substring(0, 50) + (row.market_question?.length > 50 ? '...' : ''),
      'Status': row.market_status || 'NO_MARKET',
      'Trades': row.trade_count,
      'Shares': row.total_shares,
      'First Trade': row.first_trade_at
    })));
    console.log('');
    console.log('⚠️  These markets have trades but are not resolved!');
    console.log('    Consider running resolution sync to update these markets.');
  } else {
    console.log('✅ No Category B markets - all markets with trades are resolved!');
  }
  console.log('');

  // Step 4: Market type breakdown
  console.log('Step 4: Market Type Breakdown');
  console.log('-'.repeat(80));
  console.log('');

  const marketTypeQuery = await clickhouse.query({
    query: `
      SELECT
        market_type,
        COUNT(*) as market_count,
        SUM(trade_count) as total_trades,
        round(SUM(total_shares), 2) as total_shares
      FROM pm_wallet_market_coverage_internal
      WHERE lower(wallet_address) = '${walletAddress}'
      GROUP BY market_type
      ORDER BY market_count DESC
    `,
    format: 'JSONEachRow'
  });
  const marketTypes = await marketTypeQuery.json();

  console.table(marketTypes);
  console.log('');

  // Summary
  console.log('='.repeat(80));
  console.log('COVERAGE SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Wallet: ${walletAddress}`);
  console.log('');
  console.log('Internal Coverage:');
  console.log(`  Total markets traded: ${totalMarkets}`);
  console.log(`  Category A (OK): ${summary.find(r => r.coverage_category === 'A_INTERNAL_OK')?.market_count || 0}`);
  console.log(`  Category B (Unresolved): ${summary.filter(r => r.coverage_category.startsWith('B_')).reduce((sum, r) => sum + parseInt(r.market_count), 0)}`);
  console.log('');
  console.log('Trading Activity:');
  console.log(`  Total trades: ${totalTrades}`);
  console.log(`  Total shares: ${totalShares.toFixed(2)}`);
  console.log('');
  console.log('Health:');
  const percentResolved = (parseInt(summary.find(r => r.coverage_category === 'A_INTERNAL_OK')?.market_count || '0') / totalMarkets * 100).toFixed(1);
  console.log(`  Resolution coverage: ${percentResolved}%`);
  console.log('');
  console.log('Notes:');
  console.log('  - Category C (NO_TRADES) requires external data comparison (not shown here)');
  console.log('  - Use DOME_COVERAGE_INVESTIGATION_REPORT.md to identify missing markets');
  console.log('  - This report shows only INTERNAL coverage (our data vs our data)');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
