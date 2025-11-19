#!/usr/bin/env tsx
/**
 * Phase 6: Build Wallet Backfill Plan
 *
 * Purpose: Identify top wallets by notional volume from pm_trades and create
 *          a prioritized backfill plan for external trade ingestion.
 *
 * Strategy:
 *   1. Query pm_trades for wallets with highest notional volume
 *   2. Create wallet_backfill_plan table if it doesn't exist
 *   3. Seed plan with xcnstrategy (status='done') + top N wallets (status='pending')
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// Configuration
const TOP_N_WALLETS = 100; // Start with top 100 wallets
const XCN_EOA = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'; // Already ingested

interface WalletStats {
  wallet_address: string;
  trade_count: number;
  notional: number;
  priority_rank: number;
}

async function createBackfillPlanTable() {
  console.log('Creating wallet_backfill_plan table...');
  console.log('');

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS wallet_backfill_plan (
      wallet_address String,
      trade_count UInt64,
      notional Float64,
      priority_rank UInt32,
      status Enum8('pending' = 1, 'in_progress' = 2, 'done' = 3, 'error' = 4) DEFAULT 'pending',
      error_message String DEFAULT '',
      last_run_at Nullable(DateTime),
      ingested_at DateTime DEFAULT now(),
      updated_at DateTime DEFAULT now()
    )
    ENGINE = MergeTree()
    ORDER BY (priority_rank, wallet_address)
  `;

  await clickhouse.command({ query: createTableSQL });

  console.log('✅ Table created or already exists');
  console.log('');
}

async function getTopWallets(): Promise<WalletStats[]> {
  console.log(`Querying pm_trades for top ${TOP_N_WALLETS} wallets by notional volume...`);
  console.log('');

  const querySQL = `
    SELECT
      wallet_address,
      COUNT(*) as trade_count,
      SUM(abs(collateral_amount)) as notional
    FROM pm_trades
    WHERE wallet_address != ''
    GROUP BY wallet_address
    ORDER BY notional DESC
    LIMIT ${TOP_N_WALLETS}
  `;

  const result = await clickhouse.query({
    query: querySQL,
    format: 'JSONEachRow'
  });

  const rows = await result.json<Array<{
    wallet_address: string;
    trade_count: string;
    notional: string;
  }>>();

  console.log(`Found ${rows.length} wallets`);
  console.log('');

  // Add priority_rank (1-based)
  const wallets: WalletStats[] = rows.map((row, index) => ({
    wallet_address: row.wallet_address,
    trade_count: parseInt(row.trade_count),
    notional: parseFloat(row.notional),
    priority_rank: index + 1
  }));

  return wallets;
}

async function seedBackfillPlan(wallets: WalletStats[]) {
  console.log('Checking for existing plan...');
  console.log('');

  // Check if plan already has data
  const countResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM wallet_backfill_plan',
    format: 'JSONEachRow'
  });

  const existingCount = (await countResult.json())[0].cnt;

  if (existingCount > 0) {
    console.log(`⚠️  wallet_backfill_plan already has ${existingCount} rows`);
    console.log('');
    console.log('Options:');
    console.log('  1. DROP TABLE wallet_backfill_plan and re-run this script');
    console.log('  2. Manually UPDATE existing rows');
    console.log('');
    console.log('Aborting to prevent duplicates.');
    return;
  }

  console.log('Seeding wallet_backfill_plan...');
  console.log('');

  // Find xcnstrategy in the list
  const xcnIndex = wallets.findIndex(w => w.wallet_address === XCN_EOA);

  if (xcnIndex !== -1) {
    console.log(`✅ Found xcnstrategy at rank ${wallets[xcnIndex].priority_rank}`);
    console.log('');

    // Mark xcnstrategy as 'done' (already ingested in Phase 3)
    wallets[xcnIndex] = {
      ...wallets[xcnIndex],
      // Will set status='done' during insert
    };
  } else {
    console.log('⚠️  xcnstrategy not in top 100 wallets');
    console.log('   Adding it manually with priority_rank=0');
    console.log('');

    // Add xcnstrategy manually (rank 0 = highest priority, already done)
    wallets.unshift({
      wallet_address: XCN_EOA,
      trade_count: 0, // Will be updated after we query
      notional: 0,
      priority_rank: 0
    });

    // Renumber subsequent wallets
    for (let i = 1; i < wallets.length; i++) {
      wallets[i].priority_rank = i;
    }
  }

  // Prepare rows for insertion
  const rows = wallets.map(w => ({
    wallet_address: w.wallet_address,
    trade_count: w.trade_count,
    notional: w.notional,
    priority_rank: w.priority_rank,
    status: w.wallet_address === XCN_EOA ? 'done' : 'pending',
    error_message: '',
    last_run_at: w.wallet_address === XCN_EOA ? new Date() : null,
    ingested_at: new Date(),
    updated_at: new Date()
  }));

  console.log(`Inserting ${rows.length} wallets into wallet_backfill_plan...`);
  console.log('');

  await clickhouse.insert({
    table: 'wallet_backfill_plan',
    values: rows,
    format: 'JSONEachRow'
  });

  console.log('✅ Backfill plan seeded successfully');
  console.log('');

  // Show summary
  console.log('Summary:');
  console.log(`  Total wallets: ${rows.length}`);
  console.log(`  Status='done': ${rows.filter(r => r.status === 'done').length} (xcnstrategy)`);
  console.log(`  Status='pending': ${rows.filter(r => r.status === 'pending').length}`);
  console.log('');
}

async function showPlanSummary() {
  console.log('Backfill Plan Summary:');
  console.log('─'.repeat(80));
  console.log('');

  // Status breakdown
  const statusResult = await clickhouse.query({
    query: `
      SELECT
        status,
        COUNT(*) as wallet_count,
        SUM(trade_count) as total_trades,
        SUM(notional) as total_notional
      FROM wallet_backfill_plan
      GROUP BY status
      ORDER BY status
    `,
    format: 'JSONEachRow'
  });

  const statusBreakdown = await statusResult.json();
  console.table(statusBreakdown);
  console.log('');

  // Top 10 pending wallets
  const top10Result = await clickhouse.query({
    query: `
      SELECT
        priority_rank,
        wallet_address,
        trade_count,
        notional,
        status
      FROM wallet_backfill_plan
      WHERE status = 'pending'
      ORDER BY priority_rank ASC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const top10 = await top10Result.json();

  console.log('Top 10 Pending Wallets:');
  console.log('');
  console.table(top10.map((w: any) => ({
    rank: w.priority_rank,
    wallet: w.wallet_address.substring(0, 16) + '...',
    trades: parseInt(w.trade_count).toLocaleString(),
    notional: '$' + parseFloat(w.notional).toFixed(2)
  })));
  console.log('');
}

async function main() {
  console.log('═'.repeat(80));
  console.log('Phase 6: Build Wallet Backfill Plan');
  console.log('═'.repeat(80));
  console.log('');

  console.log('Configuration:');
  console.log(`  Top N Wallets: ${TOP_N_WALLETS}`);
  console.log(`  xcnstrategy EOA: ${XCN_EOA}`);
  console.log('');

  try {
    // Step 1: Create table
    await createBackfillPlanTable();

    // Step 2: Query top wallets
    const topWallets = await getTopWallets();

    // Step 3: Seed plan
    await seedBackfillPlan(topWallets);

    // Step 4: Show summary
    await showPlanSummary();

    console.log('═'.repeat(80));
    console.log('PHASE 6 COMPLETE');
    console.log('═'.repeat(80));
    console.log('');
    console.log('✅ wallet_backfill_plan table created and seeded');
    console.log('✅ xcnstrategy marked as status=\'done\'');
    console.log(`✅ ${TOP_N_WALLETS} wallets ready for backfill`);
    console.log('');
    console.log('Next Steps:');
    console.log('  1. Review wallet_backfill_plan contents');
    console.log('  2. Proceed to Phase 7: Create automated backfill driver');
    console.log('');

  } catch (error: any) {
    console.error('❌ Failed to build backfill plan:', error.message);
    throw error;
  }

  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
