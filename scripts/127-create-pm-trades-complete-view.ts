#!/usr/bin/env tsx
/**
 * Create pm_trades_complete View - Interface Layer for External Data
 *
 * Purpose:
 * - Acts as interface between PnL views and trade data sources
 * - Currently: Passthrough to pm_trades (CLOB-only)
 * - Future: Will union pm_trades (CLOB) + pm_trades_external (Dome/AMM)
 *
 * This allows C2 to plug in external trades without refactoring PnL logic.
 *
 * Phase: Phase 4 - Prepare Interface for C2
 * Status: Passthrough mode (CLOB-only)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('🔗 Creating pm_trades_complete View (Interface Layer)');
  console.log('='.repeat(80));
  console.log('');
  console.log('Purpose: Interface layer for PnL views with canonical wallet mapping');
  console.log('Mode: Active - CLOB + External trades from C2');
  console.log('Source: pm_trades_with_external (UNION of CLOB + external_trades_raw)');
  console.log('Enhancement: canonical_wallet_address for EOA + proxy aggregation');
  console.log('');

  console.log('Step 1: Dropping existing pm_trades_complete view if exists...');
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_trades_complete'
  });
  console.log('✅ Old view dropped');
  console.log('');

  console.log('Step 2: Creating pm_trades_complete view...');
  console.log('');
  console.log('Source: pm_trades_with_external (CLOB + external trades)');
  console.log('Enhancement: Adding canonical_wallet_address via JOIN');
  console.log('');

  await clickhouse.command({
    query: `
      CREATE VIEW pm_trades_complete AS
      SELECT
        t.*,
        CASE
          WHEN wim.canonical_wallet IS NOT NULL AND wim.canonical_wallet != '' THEN wim.canonical_wallet
          ELSE t.wallet_address
        END as canonical_wallet_address
      FROM pm_trades_with_external t
      LEFT JOIN wallet_identity_map wim
        ON t.wallet_address = wim.user_eoa OR t.wallet_address = wim.proxy_wallet
    `
  });

  console.log('✅ pm_trades_complete view created');
  console.log('');

  // Verify view works
  console.log('Step 3: Verifying view...');
  console.log('');

  const verifyQuery = await clickhouse.query({
    query: `
      SELECT
        data_source,
        COUNT(*) as total_trades,
        COUNT(DISTINCT wallet_address) as distinct_wallets,
        COUNT(DISTINCT canonical_wallet_address) as distinct_canonical,
        COUNT(DISTINCT condition_id) as distinct_markets,
        MIN(block_time) as earliest_trade,
        MAX(block_time) as latest_trade
      FROM pm_trades_complete
      GROUP BY data_source
      ORDER BY total_trades DESC
    `,
    format: 'JSONEachRow'
  });

  const stats = await verifyQuery.json();
  console.log('pm_trades_complete Statistics:');
  console.table(stats);
  console.log('');

  console.log('='.repeat(80));
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('✅ pm_trades_complete view created successfully');
  console.log('');
  console.log('Current Behavior:');
  console.log('  - Reads from pm_trades_with_external (CLOB + external)');
  console.log('  - CLOB trades: data_source = "clob_fills"');
  console.log('  - External trades: data_source = "polymarket_data_api", etc.');
  console.log('  - canonical_wallet_address added via canonical_wallet_map JOIN');
  console.log('  - EOA + proxy wallets properly aggregated');
  console.log('');
  console.log('Data Sources:');
  for (const row of stats) {
    console.log(`  - ${row.data_source}: ${parseInt(row.total_trades).toLocaleString()} trades`);
  }
  console.log('');
  const totalTrades = stats.reduce((sum, r) => sum + parseInt(r.total_trades), 0);
  const totalWallets = Math.max(...stats.map(r => parseInt(r.distinct_wallets)));
  const totalCanonical = Math.max(...stats.map(r => parseInt(r.distinct_canonical)));
  const totalMarkets = Math.max(...stats.map(r => parseInt(r.distinct_markets)));

  console.log('');
  console.log('Summary:');
  console.log(`  Total Trades: ${totalTrades.toLocaleString()}`);
  console.log(`  Distinct Wallets (EOA): ${totalWallets.toLocaleString()}`);
  console.log(`  Distinct Canonical (EOA+Proxy): ${totalCanonical.toLocaleString()}`);
  console.log(`  Distinct Markets: ${totalMarkets.toLocaleString()}`);
  console.log('');
  console.log('✅ PnL pipeline now includes external trades');
  console.log('✅ Ready for P&L recalculation with CLOB + external data');
  console.log('');
}

main().catch((error) => {
  console.error('❌ View creation failed:', error);
  process.exit(1);
});
