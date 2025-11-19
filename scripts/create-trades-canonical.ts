#!/usr/bin/env npx tsx
/**
 * CREATE CANONICAL TRADES TABLE
 *
 * This script creates the production-ready trades table by:
 * 1. Normalizing condition_ids (strip 0x prefix)
 * 2. Casting enums properly
 * 3. Setting up proper partitioning
 *
 * Runtime: ~5 minutes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,  // 10 minutes
});

async function createCanonicalTable() {
  console.log('\n🚀 Creating trades_canonical table...\n');

  try {
    // Drop if exists
    console.log('1️⃣ Dropping existing table if it exists...');
    await client.command({
      query: 'DROP TABLE IF EXISTS trades_canonical',
    });
    console.log('   ✅ Dropped\n');

    // Create the table
    console.log('2️⃣ Creating new trades_canonical table...');
    console.log('   This will take ~3-5 minutes for 82M rows...\n');

    const startTime = Date.now();

    await client.command({
      query: `
        CREATE TABLE trades_canonical
        ENGINE = ReplacingMergeTree()
        ORDER BY (condition_id_norm, wallet_address, block_time, tx_hash)
        PARTITION BY toYYYYMM(block_time)
        AS
        SELECT
          -- Normalize condition_id: strip 0x prefix and lowercase
          lower(substring(condition_id_norm, 3)) as condition_id_norm,

          -- Transaction identifiers
          tx_hash,
          computed_at as block_time,

          -- Wallet
          wallet_address,

          -- Market identifiers
          market_id,
          outcome_index,
          side_token as token_id,

          -- Trade details
          direction_from_transfers as direction,
          shares,
          price,
          usd_value,

          -- Quality indicators
          confidence,
          data_source,

          -- Metadata
          reason,
          recovery_status,
          computed_at as created_at

        FROM trades_with_direction
        WHERE length(condition_id_norm) = 66
      `,
    });

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`   ✅ Created in ${elapsed} minutes\n`);

    // Verify row count
    console.log('3️⃣ Verifying row count...');
    const result = await client.query({
      query: 'SELECT count() as count FROM trades_canonical',
      format: 'JSONEachRow',
    });
    const data: any = await result.json();
    console.log(`   ✅ ${parseInt(data[0].count).toLocaleString()} rows created\n`);

    // Check sample
    console.log('4️⃣ Checking sample data...');
    const sample = await client.query({
      query: `
        SELECT
          condition_id_norm,
          length(condition_id_norm) as len,
          wallet_address,
          direction,
          usd_value
        FROM trades_canonical
        LIMIT 3
      `,
      format: 'JSONEachRow',
    });
    const sampleData = await sample.json();
    console.log('   Sample rows:');
    sampleData.forEach((row: any) => {
      console.log(`     - condition_id: ${row.condition_id_norm.substring(0, 16)}... (${row.len} chars)`);
      console.log(`       wallet: ${row.wallet_address.substring(0, 10)}...`);
      console.log(`       direction: ${row.direction}, value: $${row.usd_value}`);
    });

    console.log('\n✅ SUCCESS! trades_canonical table is ready.\n');
    console.log('Next step: Run `npx tsx scripts/create-pnl-view.ts`\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

createCanonicalTable().catch(console.error);
