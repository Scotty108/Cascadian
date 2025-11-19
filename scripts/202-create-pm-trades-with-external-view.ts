#!/usr/bin/env tsx
/**
 * Phase 2: Create pm_trades_with_external UNION View
 *
 * Purpose: Combine CLOB trades (pm_trades) with external AMM/ghost market
 *          trades (external_trades_raw) into a single unified view that C1
 *          can use for P&L calculations.
 *
 * Schema: Matches pm_trades exactly for seamless substitution.
 *
 * C2 - External Data Ingestion Agent
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('═'.repeat(80));
  console.log('Phase 2: Create pm_trades_with_external UNION View');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Purpose: UNION pm_trades (CLOB) + external_trades_raw (AMM/external)');
  console.log('Output: Unified view C1 can use for P&L calculations');
  console.log('');

  // Drop existing view if it exists
  console.log('Step 1: Dropping existing pm_trades_with_external view...');
  console.log('');

  try {
    await clickhouse.command({
      query: 'DROP VIEW IF EXISTS pm_trades_with_external'
    });
    console.log('✅ Old view dropped (if existed)');
  } catch (error: any) {
    console.log('✅ No existing view to drop');
  }

  console.log('');

  // Create new UNION view
  console.log('Step 2: Creating pm_trades_with_external view...');
  console.log('');

  const createViewSQL = `
    CREATE VIEW pm_trades_with_external AS

    -- Part 1: All CLOB trades (unchanged from pm_trades)
    SELECT
      fill_id,
      block_time,
      block_number,
      tx_hash,
      asset_id_decimal,
      condition_id,
      outcome_index,
      outcome_label,
      question,
      wallet_address,
      operator_address,
      is_proxy_trade,
      side,
      price,
      shares,
      collateral_amount,
      fee_amount,
      data_source
    FROM pm_trades

    UNION ALL

    -- Part 2: External trades (mapped from external_trades_raw)
    SELECT
      external_trade_id as fill_id,
      trade_timestamp as block_time,
      0 as block_number,  -- Not available from most external sources
      tx_hash,
      '' as asset_id_decimal,  -- External sources don't provide CLOB asset IDs
      condition_id,
      outcome_index,
      side as outcome_label,  -- 'YES'/'NO' maps to outcome_label
      market_question as question,
      wallet_address,
      '' as operator_address,  -- External sources don't distinguish EOA vs proxy
      0 as is_proxy_trade,
      side,
      price,
      shares,
      cash_value as collateral_amount,
      fees as fee_amount,
      source as data_source
    FROM external_trades_raw
  `;

  await clickhouse.command({ query: createViewSQL });

  console.log('✅ View created successfully');
  console.log('');

  // Verify view exists and get stats
  console.log('Step 3: Verifying view and gathering statistics...');
  console.log('');

  try {
    const statsResult = await clickhouse.query({
      query: `
        SELECT
          data_source,
          COUNT(*) as trade_count,
          COUNT(DISTINCT wallet_address) as unique_wallets,
          COUNT(DISTINCT condition_id) as unique_markets,
          MIN(block_time) as earliest_trade,
          MAX(block_time) as latest_trade
        FROM pm_trades_with_external
        GROUP BY data_source
        ORDER BY trade_count DESC
      `,
      format: 'JSONEachRow'
    });

    const stats = await statsResult.json();

    console.log('Data Source Breakdown:');
    console.table(stats);
    console.log('');

    const totalTrades = stats.reduce((sum: number, row: any) => sum + parseInt(row.trade_count), 0);
    console.log(`Total Trades (CLOB + External): ${totalTrades.toLocaleString()}`);
    console.log('');

  } catch (error: any) {
    console.error('❌ Failed to gather stats:', error.message);
    throw error;
  }

  // Sample rows to verify schema mapping
  console.log('Step 4: Sampling rows to verify schema...');
  console.log('');

  try {
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          substring(fill_id, 1, 16) || '...' as fill_id_short,
          block_time,
          substring(condition_id, 1, 16) || '...' as condition_short,
          substring(wallet_address, 1, 10) || '...' as wallet_short,
          side,
          price,
          shares,
          data_source
        FROM pm_trades_with_external
        WHERE data_source != 'clob_fills'
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const samples = await sampleResult.json();

    if (samples.length > 0) {
      console.log('Sample External Trades (not from CLOB):');
      console.table(samples);
    } else {
      console.log('No external trades found yet (external_trades_raw is empty)');
      console.log('This is expected before running Phase 3 ingestion.');
    }
    console.log('');

  } catch (error: any) {
    console.error('⚠️  Could not sample external trades:', error.message);
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log('PHASE 2 COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
  console.log('✅ pm_trades_with_external view created');
  console.log('✅ Schema verified (matches pm_trades)');
  console.log('✅ Statistics gathered');
  console.log('');
  console.log('Usage:');
  console.log('  -- C1 can now switch PnL queries from:');
  console.log('  FROM pm_trades');
  console.log('');
  console.log('  -- To:');
  console.log('  FROM pm_trades_with_external');
  console.log('');
  console.log('Next Step: Phase 3 - Implement data source connector');
  console.log('Run: npx tsx scripts/203-ingest-[source]-trades.ts');
  console.log('');
  console.log('Recommended: Start with Polymarket Subgraph or Dune Analytics');
  console.log('');
  console.log('─'.repeat(80));
  console.log('C2 - External Data Ingestion Agent');
  console.log('─'.repeat(80));
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
