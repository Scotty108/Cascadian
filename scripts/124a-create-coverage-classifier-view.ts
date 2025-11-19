#!/usr/bin/env tsx
/**
 * Create Internal Coverage Classifier View
 *
 * Creates pm_wallet_market_coverage_internal view to classify wallet-market pairs by data completeness.
 *
 * Categories:
 * - A_INTERNAL_OK: Wallet has trades + market is resolved
 * - B_INTERNAL_UNRESOLVED: Wallet has trades + market NOT resolved
 *
 * Note: Category C (NO_TRADES) is not in this view - it's the ABSENCE of a row.
 * When comparing against external data (like Dome), Category C is identified by finding
 * markets that external source shows but don't appear in this view.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('Creating Internal Coverage Classifier View');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Drop existing view if it exists
  console.log('Step 1: Drop existing view (if exists)...');
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_wallet_market_coverage_internal'
  });
  console.log('✅ Dropped existing view');
  console.log('');

  // Step 2: Create new view
  console.log('Step 2: Create pm_wallet_market_coverage_internal view...');
  console.log('');

  await clickhouse.command({
    query: `
      CREATE VIEW pm_wallet_market_coverage_internal AS
      WITH wallet_market_trades AS (
        -- Get all wallet-market pairs with their trade stats
        SELECT
          canonical_wallet_address as wallet_address,
          condition_id,
          COUNT(*) as trade_count,
          SUM(shares) as total_shares,
          MIN(block_time) as first_trade_at,
          MAX(block_time) as last_trade_at
        FROM pm_trades
        GROUP BY canonical_wallet_address, condition_id
      ),
      market_metadata AS (
        -- Get market resolution status (deduplicated)
        SELECT DISTINCT
          condition_id,
          status,
          resolved_at,
          market_type,
          question
        FROM pm_markets
      )
      SELECT
        wmt.wallet_address,
        wmt.condition_id,
        -- Coverage category based on resolution status
        CASE
          WHEN mm.status = 'resolved' AND mm.resolved_at IS NOT NULL THEN 'A_INTERNAL_OK'
          WHEN mm.status IS NULL THEN 'B_INTERNAL_UNRESOLVED_NO_MARKET'
          WHEN mm.status != 'resolved' OR mm.resolved_at IS NULL THEN 'B_INTERNAL_UNRESOLVED'
          ELSE 'UNKNOWN'
        END as coverage_category,
        -- Market metadata
        mm.status as market_status,
        mm.resolved_at,
        mm.market_type,
        mm.question as market_question,
        -- Trade stats
        wmt.trade_count,
        wmt.total_shares,
        wmt.first_trade_at,
        wmt.last_trade_at
      FROM wallet_market_trades wmt
      LEFT JOIN market_metadata mm ON wmt.condition_id = mm.condition_id
    `
  });

  console.log('✅ Created view');
  console.log('');

  // Step 3: Verify view with sample data
  console.log('Step 3: Verify view with sample queries...');
  console.log('');

  // Query 1: Count by category
  console.log('Query 1: Count wallet-market pairs by category...');
  const categoryCounts = await clickhouse.query({
    query: `
      SELECT
        coverage_category,
        COUNT(*) as pair_count,
        COUNT(DISTINCT wallet_address) as wallet_count,
        COUNT(DISTINCT condition_id) as market_count
      FROM pm_wallet_market_coverage_internal
      GROUP BY coverage_category
      ORDER BY coverage_category
    `,
    format: 'JSONEachRow'
  });
  const categories = await categoryCounts.json();

  console.table(categories);
  console.log('');

  // Query 2: Sample for xcnstrategy
  console.log('Query 2: Sample data for xcnstrategy wallet...');
  const xcnSample = await clickhouse.query({
    query: `
      SELECT
        coverage_category,
        left(condition_id, 16) || '...' as condition_id_short,
        market_status,
        trade_count,
        round(total_shares, 2) as total_shares,
        market_question
      FROM pm_wallet_market_coverage_internal
      WHERE lower(wallet_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      ORDER BY coverage_category, trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const xcnData = await xcnSample.json();

  if (xcnData.length > 0) {
    console.table(xcnData);
  } else {
    console.log('⚠️  No data for xcnstrategy wallet (0xcce...)');
  }
  console.log('');

  // Summary
  console.log('='.repeat(80));
  console.log('VIEW CREATED SUCCESSFULLY');
  console.log('='.repeat(80));
  console.log('');
  console.log('View name: pm_wallet_market_coverage_internal');
  console.log('');
  console.log('Schema:');
  console.log('  - wallet_address: Canonical wallet address');
  console.log('  - condition_id: Market condition ID');
  console.log('  - coverage_category: A_INTERNAL_OK | B_INTERNAL_UNRESOLVED | B_INTERNAL_UNRESOLVED_NO_MARKET');
  console.log('  - market_status: Status from pm_markets (open/resolved)');
  console.log('  - resolved_at: Resolution timestamp');
  console.log('  - market_type: binary/categorical');
  console.log('  - market_question: Market question text');
  console.log('  - trade_count: Number of trades for this wallet-market pair');
  console.log('  - total_shares: Sum of shares traded');
  console.log('  - first_trade_at: Timestamp of first trade');
  console.log('  - last_trade_at: Timestamp of last trade');
  console.log('');
  console.log('Categories:');
  console.log('  - A_INTERNAL_OK: Wallet has trades + market is resolved');
  console.log('  - B_INTERNAL_UNRESOLVED: Wallet has trades + market NOT resolved');
  console.log('  - B_INTERNAL_UNRESOLVED_NO_MARKET: Wallet has trades but market not in pm_markets');
  console.log('');
  console.log('Note: Category C (NO_TRADES) is not in this view.');
  console.log('      C is identified by comparing this view against external data (like Dome).');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Create scripts/125-dump-wallet-coverage.ts to query this view');
  console.log('  2. Generate WALLET_COVERAGE_xcnstrategy.md report');
  console.log('  3. Use this view for ongoing coverage monitoring');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
