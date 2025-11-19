#!/usr/bin/env tsx
/**
 * Create ghost_market_wallets table and load discovered wallets
 *
 * Purpose: Persist the 636 wallet-market pairs discovered from trades_raw
 *          for the 6 known ghost markets
 *
 * Input: ghost_wallets_from_trades_raw.csv
 * Output: ghost_market_wallets table in ClickHouse
 */
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { readFileSync } from 'fs';

async function main() {
  console.log('═'.repeat(80));
  console.log('Phase 5.1: Create ghost_market_wallets Table');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Create table
  console.log('Step 1: Creating ghost_market_wallets table...');

  try {
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS ghost_market_wallets (
          condition_id String,
          wallet String,
          source_table String DEFAULT 'trades_raw',
          discovered_at DateTime DEFAULT now()
        ) ENGINE = MergeTree()
        ORDER BY (condition_id, wallet)
      `
    });

    console.log('  ✅ Table created or already exists');
  } catch (error: any) {
    console.error('  ❌ Failed to create table:', error.message);
    throw error;
  }
  console.log('');

  // Step 2: Read CSV data
  console.log('Step 2: Reading ghost_wallets_from_trades_raw.csv...');

  let csvContent: string;
  try {
    csvContent = readFileSync('ghost_wallets_from_trades_raw.csv', 'utf-8');
  } catch (error: any) {
    console.error('  ❌ Failed to read CSV:', error.message);
    console.error('  Make sure ghost_wallets_from_trades_raw.csv exists in the current directory');
    throw error;
  }

  const lines = csvContent.trim().split('\n');
  const header = lines[0];
  const dataLines = lines.slice(1);

  console.log(`  ✅ Read ${dataLines.length} rows from CSV`);
  console.log(`  Header: ${header}`);
  console.log('');

  // Step 3: Parse CSV into objects
  console.log('Step 3: Parsing CSV data...');

  const wallets = dataLines.map(line => {
    const [condition_id, wallet] = line.split(',');
    return {
      condition_id: condition_id.trim(),
      wallet: wallet.trim(),
      source_table: 'trades_raw'
    };
  });

  console.log(`  ✅ Parsed ${wallets.length} wallet-market pairs`);
  console.log(`  Sample:`);
  wallets.slice(0, 3).forEach(w => {
    console.log(`    ${w.condition_id.substring(0, 18)}... → ${w.wallet}`);
  });
  console.log('');

  // Step 4: Check for existing data
  console.log('Step 4: Checking for existing data...');

  const existingResult = await clickhouse.query({
    query: `SELECT COUNT(*) as cnt FROM ghost_market_wallets`,
    format: 'JSONEachRow'
  });

  const existingCount = (await existingResult.json())[0].cnt;
  console.log(`  Existing rows in table: ${existingCount}`);
  console.log('');

  // Step 5: Insert data (deduplication via MergeTree ORDER BY)
  console.log('Step 5: Inserting wallet-market pairs...');

  try {
    await clickhouse.insert({
      table: 'ghost_market_wallets',
      values: wallets,
      format: 'JSONEachRow'
    });

    console.log('  ✅ Inserted successfully');
  } catch (error: any) {
    console.error('  ❌ Failed to insert:', error.message);
    throw error;
  }
  console.log('');

  // Step 6: Verify final count
  console.log('Step 6: Verifying final count...');

  const finalResult = await clickhouse.query({
    query: `SELECT COUNT(*) as cnt FROM ghost_market_wallets`,
    format: 'JSONEachRow'
  });

  const finalCount = (await finalResult.json())[0].cnt;
  console.log(`  Final row count: ${finalCount}`);
  console.log('');

  // Step 7: Summary statistics
  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  const statsResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT condition_id) as unique_markets,
        COUNT(DISTINCT wallet) as unique_wallets,
        COUNT(*) as total_pairs
      FROM ghost_market_wallets
    `,
    format: 'JSONEachRow'
  });

  const stats: any = (await statsResult.json())[0];
  console.log(`Unique markets: ${stats.unique_markets}`);
  console.log(`Unique wallets: ${stats.unique_wallets}`);
  console.log(`Total wallet-market pairs: ${stats.total_pairs}`);
  console.log('');

  // Show breakdown by market
  const breakdownResult = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        COUNT(DISTINCT wallet) as wallet_count
      FROM ghost_market_wallets
      GROUP BY condition_id
      ORDER BY wallet_count DESC
    `,
    format: 'JSONEachRow'
  });

  const breakdown: any[] = await breakdownResult.json();
  console.log('Breakdown by market:');
  breakdown.forEach(row => {
    console.log(`  ${row.condition_id.substring(0, 18)}... → ${row.wallet_count} wallets`);
  });
  console.log('');

  console.log('✅ ghost_market_wallets table ready for Data-API ingestion');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
