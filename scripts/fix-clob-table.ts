#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

async function fixTable() {
  console.log('Recreating clob_fills_v2 with correct types...\n');

  // Drop existing table
  try {
    console.log('1. Dropping existing table...');
    await clickhouse.exec({ query: 'DROP TABLE IF EXISTS clob_fills_v2' });
    console.log('   ✅ Dropped\n');
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Recreate with simpler MergeTree (not Replacing) and correct types
  try {
    console.log('2. Creating new table...');
    await clickhouse.exec({
      query: `
        CREATE TABLE clob_fills_v2 (
          fill_id String,
          proxy_wallet String,
          user_eoa String,
          market_slug String,
          condition_id String,
          asset_id String,
          outcome LowCardinality(String),
          side LowCardinality(String),
          price Float64,
          size Float64,
          fee_rate_bps UInt32,
          timestamp DateTime,
          order_hash String,
          tx_hash String,
          bucket_index UInt32,
          ingested_at DateTime DEFAULT now()
        )
        ENGINE = MergeTree()
        ORDER BY (proxy_wallet, timestamp, fill_id)
        PARTITION BY toYYYYMM(timestamp)
      `,
    });
    console.log('   ✅ Created\n');
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Test simple insert
  try {
    console.log('3. Testing simple insert...');
    await clickhouse.exec({
      query: `
        INSERT INTO clob_fills_v2 (
          fill_id, proxy_wallet, user_eoa, condition_id, asset_id,
          side, price, size, timestamp
        ) VALUES (
          'test-1',
          '0xtest',
          '0xtest',
          '0xcond',
          'asset',
          'BUY',
          0.5,
          100,
          now()
        )
      `,
    });
    console.log('   ✅ Inserted\n');
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Verify
  try {
    console.log('4. Verifying...');
    const r = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM clob_fills_v2',
      format: 'JSONEachRow',
    });
    const d = await r.json();
    console.log(`   Rows: ${d[0].count}\n`);
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }
}

fixTable().catch(console.error);
