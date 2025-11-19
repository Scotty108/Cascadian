#!/usr/bin/env tsx
/**
 * Sync Resolution Status from gamma_resolved to pm_markets
 *
 * CRITICAL FIX: Script 110 revealed that 8 markets with trade data are RESOLVED
 * in gamma_resolved (closed=1) but pm_markets still shows status='open'.
 *
 * This script:
 * 1. Verifies resolution data in gamma_resolved
 * 2. Updates pm_markets status from 'open' to 'resolved'
 * 3. Sets pm_markets.resolved_at timestamp
 * 4. Reports expected P&L impact
 *
 * SAFE: Uses atomic CREATE + RENAME approach for pm_markets update
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// 8 condition_ids that need resolution sync
const MARKETS_TO_SYNC = [
  '0xef00c9e8b1eb7eb322ccc13b67cfa35d4291017a0aa46d09f3e2f3e3b255e3d0', // Eggs $3.00-3.25 Sept
  '0xa491ceedf3da3e6e6b4913c8eff3362caf6dbfda9bbf299e5a628b223803c2e6', // Xi out before Oct
  '0x93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620', // Inflation 2.7% Aug
  '0x03bf5c66a49c7f44661d99dc3784f3cb4484c0aa8459723bd770680512e72f82', // Eggs $3.25-3.50 Aug
  '0xfae907b4c7d9b39fcd27683e3f9e4bdbbafc24f36765b6240a93b8c94ed206fa', // Lisa Cook Fed
  '0x340c700abfd4870e95683f1d45cf7cb28e77c284f41e69d385ed2cc52227b307', // Eggs $4.25-4.50 Aug
  '0x601141063589291af41d6811b9f20d544e1c24b3641f6996c21e8957dd43bcec', // Eggs $3.00-3.25 Aug
  '0x7bdc006d11b7dff2eb7ccbba5432c22b702c92aa570840f3555b5e4da86fed02'  // Eggs $3.75-4.00 Aug
];

async function main() {
  console.log('🔄 Syncing Resolution Status: gamma_resolved → pm_markets');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Verify all markets are in gamma_resolved
  console.log('Step 1: Verify resolution data in gamma_resolved...');
  console.log('');

  const normalizedIds = MARKETS_TO_SYNC.map(id => id.toLowerCase().replace(/^0x/, ''));
  const inClause = normalizedIds.map(id => `'${id}'`).join(', ');

  const verifyQuery = await clickhouse.query({
    query: `
      SELECT
        cid,
        winning_outcome,
        closed,
        fetched_at
      FROM gamma_resolved
      WHERE lower(replaceAll(cid, '0x', '')) IN (${inClause})
      ORDER BY cid
    `,
    format: 'JSONEachRow'
  });
  const resolved = await verifyQuery.json();

  console.log(`Found ${resolved.length}/8 markets in gamma_resolved:`);
  console.table(resolved.map((r: any) => ({
    'CID (short)': r.cid.substring(0, 16) + '...',
    'Winning': r.winning_outcome,
    'Closed': r.closed,
    'Fetched': r.fetched_at
  })));
  console.log('');

  if (resolved.length !== 8) {
    console.log(`❌ ERROR: Expected 8 markets in gamma_resolved, found ${resolved.length}`);
    console.log('   Cannot proceed with incomplete resolution data');
    process.exit(1);
  }

  // Step 2: Check current status in pm_markets
  console.log('Step 2: Check current status in pm_markets...');
  console.log('');

  const currentQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        status,
        resolved_at,
        winning_outcome_index
      FROM pm_markets
      WHERE lower(replaceAll(condition_id, '0x', '')) IN (${inClause})
      ORDER BY condition_id
    `,
    format: 'JSONEachRow'
  });
  const current = await currentQuery.json();

  console.log(`Current status in pm_markets (${current.length} rows):`);
  console.table(current.map((m: any) => ({
    'CID (short)': m.condition_id.substring(0, 16) + '...',
    'Status': m.status,
    'Resolved At': m.resolved_at || 'NULL',
    'Winning Index': m.winning_outcome_index
  })));
  console.log('');

  const needsUpdate = current.filter((m: any) => m.status === 'open').length;
  console.log(`Markets with status='open': ${needsUpdate}`);
  console.log('');

  if (needsUpdate === 0) {
    console.log('✅ All markets already marked resolved. No action needed.');
    process.exit(0);
  }

  // Step 3: Create updated pm_markets table
  console.log('Step 3: Create updated pm_markets table with synced resolution status...');
  console.log('');

  console.log('Using atomic CREATE + RENAME approach for safety...');

  await clickhouse.command({
    query: `
      CREATE TABLE pm_markets_new
      ENGINE = ReplacingMergeTree()
      ORDER BY (condition_id, outcome_index)
      AS
      SELECT
        pm.condition_id,
        pm.outcome_index,
        pm.market_slug,
        pm.question,
        pm.outcome_label,
        pm.outcomes_json,
        pm.total_outcomes,
        pm.market_type,
        -- Update status to 'resolved' if found in gamma_resolved
        if(gr.cid IS NOT NULL, 'resolved', pm.status) as status,
        -- Update resolved_at with fetched_at from gamma_resolved
        if(gr.cid IS NOT NULL, toDateTime(gr.fetched_at), pm.resolved_at) as resolved_at,
        pm.winning_outcome_index,
        pm.is_winning_outcome,
        pm.description,
        pm.category,
        pm.end_date,
        pm.data_source
      FROM pm_markets pm
      LEFT JOIN gamma_resolved gr
        ON lower(replaceAll(pm.condition_id, '0x', '')) = lower(replaceAll(gr.cid, '0x', ''))
        AND lower(replaceAll(pm.condition_id, '0x', '')) IN (${inClause})
    `
  });

  console.log('✅ Created pm_markets_new with updated resolution status');
  console.log('');

  // Step 4: Verify the new table
  console.log('Step 4: Verify updated rows in pm_markets_new...');
  console.log('');

  const verifyNewQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        status,
        resolved_at,
        winning_outcome_index
      FROM pm_markets_new
      WHERE lower(replaceAll(condition_id, '0x', '')) IN (${inClause})
      ORDER BY condition_id
    `,
    format: 'JSONEachRow'
  });
  const updated = await verifyNewQuery.json();

  console.log(`Updated status in pm_markets_new (${updated.length} rows):`);
  console.table(updated.map((m: any) => ({
    'CID (short)': m.condition_id.substring(0, 16) + '...',
    'Status': m.status,
    'Resolved At': m.resolved_at || 'NULL',
    'Winning Index': m.winning_outcome_index
  })));
  console.log('');

  const nowResolved = updated.filter((m: any) => m.status === 'resolved').length;
  console.log(`Markets now marked 'resolved': ${nowResolved}/8`);
  console.log('');

  if (nowResolved !== 8) {
    console.log(`❌ ERROR: Expected 8 resolved markets, found ${nowResolved}`);
    console.log('   Dropping pm_markets_new (safety measure)');
    await clickhouse.command({ query: 'DROP TABLE pm_markets_new' });
    process.exit(1);
  }

  // Step 5: Swap tables (two-step process for Shared database)
  console.log('Step 5: Swap tables...');
  console.log('');

  console.log('Renaming old pm_markets to pm_markets_backup...');
  await clickhouse.command({
    query: 'RENAME TABLE pm_markets TO pm_markets_backup'
  });

  console.log('Renaming pm_markets_new to pm_markets...');
  await clickhouse.command({
    query: 'RENAME TABLE pm_markets_new TO pm_markets'
  });

  console.log('✅ Tables swapped successfully');
  console.log('   pm_markets (old) → pm_markets_backup');
  console.log('   pm_markets_new → pm_markets (active)');
  console.log('');

  // Step 6: Estimate P&L impact
  console.log('Step 6: Estimate P&L impact...');
  console.log('');

  const tradesQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT wallet_address) as wallets,
        COUNT(*) as total_trades,
        SUM(shares) as total_shares
      FROM pm_trades
      WHERE lower(replaceAll(condition_id, '0x', '')) IN (${inClause})
    `,
    format: 'JSONEachRow'
  });
  const impact = await tradesQuery.json();

  console.log('Affected data:');
  console.log(`  Wallets: ${impact[0].wallets}`);
  console.log(`  Trades: ${impact[0].total_trades}`);
  console.log(`  Total shares: ${parseFloat(impact[0].total_shares).toFixed(2)}`);
  console.log('');

  // Summary
  console.log('='.repeat(80));
  console.log('✅ RESOLUTION SYNC COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Updated 8 markets from status='open' to status='resolved'`);
  console.log(`Set resolved_at timestamps from gamma_resolved.fetched_at`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Rebuild pm_wallet_market_pnl_resolved to include these markets');
  console.log('  2. Rebuild pm_wallet_pnl_summary to aggregate updated P&L');
  console.log('  3. Check xcnstrategy P&L to see if gap is reduced');
  console.log('');
  console.log('Safety:');
  console.log('  - Original table backed up as pm_markets_backup');
  console.log('  - To rollback: RENAME TABLE pm_markets TO pm_markets_new, pm_markets_backup TO pm_markets');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
