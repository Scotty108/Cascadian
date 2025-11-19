#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

async function testInsert() {
  console.log('Testing simple insert into clob_fills_v2...\n');

  // Test 1: Direct simple insert
  try {
    console.log('1. Testing direct insert with minimal data:');
    await clickhouse.exec({
      query: `
        INSERT INTO clob_fills_v2 (
          fill_id, proxy_wallet, user_eoa, market_slug, condition_id, asset_id,
          outcome, side, price, size, fee_rate_bps, timestamp, order_hash,
          tx_hash, bucket_index, ingested_at
        ) VALUES (
          'test-fill-1',
          '0xtest',
          '0xtest',
          '',
          '0xtestcondition',
          'testasset',
          '',
          'BUY',
          toDecimal128('0.5', 18),
          toDecimal128('100', 18),
          0,
          now(),
          '',
          '0xtesthash',
          0,
          now()
        )
      `,
    });
    console.log('   ✅ Insert succeeded\n');
  } catch (e: any) {
    console.log(`   ❌ Insert failed: ${e.message}\n`);
  }

  // Test 2: Check count
  try {
    console.log('2. Checking row count:');
    const r = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM clob_fills_v2',
      format: 'JSONEachRow',
    });
    const d = await r.json();
    console.log(`   Rows: ${d[0].count}\n`);
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }

  // Test 3: Sample data
  try {
    console.log('3. Sample rows:');
    const r = await clickhouse.query({
      query: 'SELECT * FROM clob_fills_v2 LIMIT 3',
      format: 'JSONEachRow',
    });
    const d = await r.json();
    d.forEach((row: any, idx: number) => {
      console.log(`   Row ${idx + 1}: fill_id=${row.fill_id}, side=${row.side}, price=${row.price}`);
    });
    console.log();
  } catch (e: any) {
    console.log(`   ❌ ${e.message}\n`);
  }
}

testInsert().catch(console.error);
