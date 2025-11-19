#!/usr/bin/env npx tsx
/**
 * Deep diagnosis of why inserts aren't landing
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n🔍 Diagnosing insert issue...\n');

  // Check query log for recent INSERT attempts
  console.log('1. Checking query_log for recent INSERT attempts:');
  const queryLog = await ch.query({
    query: `
      SELECT
        event_time,
        query,
        exception,
        written_rows,
        written_bytes,
        type
      FROM system.query_log
      WHERE
        query LIKE '%INSERT INTO default.erc1155_transfers%'
        AND event_time > now() - INTERVAL 10 MINUTE
      ORDER BY event_time DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const queryLogData = await queryLog.json();

  if (queryLogData.length === 0) {
    console.log('   ❌ No INSERT queries found in last 10 minutes\n');
  } else {
    for (const row of queryLogData) {
      console.log(`   Time: ${row.event_time}`);
      console.log(`   Type: ${row.type}`);
      console.log(`   Rows written: ${row.written_rows}`);
      console.log(`   Bytes: ${row.written_bytes}`);
      console.log(`   Query: ${row.query.substring(0, 100)}...`);
      if (row.exception) {
        console.log(`   ⚠️  Exception: ${row.exception}`);
      }
      console.log('');
    }
  }

  // Check async insert log
  console.log('2. Checking asynchronous_insert_log:');
  const asyncLog = await ch.query({
    query: `
      SELECT
        event_time,
        query,
        status,
        data_kind,
        rows,
        bytes,
        exception
      FROM system.asynchronous_insert_log
      WHERE event_time > now() - INTERVAL 10 MINUTE
      ORDER BY event_time DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const asyncLogData = await asyncLog.json();

  if (asyncLogData.length === 0) {
    console.log('   ❌ No async inserts found in last 10 minutes\n');
  } else {
    for (const row of asyncLogData) {
      console.log(`   Time: ${row.event_time}`);
      console.log(`   Status: ${row.status}`);
      console.log(`   Data kind: ${row.data_kind}`);
      console.log(`   Rows: ${row.rows}`);
      console.log(`   Bytes: ${row.bytes}`);
      if (row.exception) {
        console.log(`   ⚠️  Exception: ${row.exception}`);
      }
      console.log('');
    }
  }

  // Try a test insert manually
  console.log('3. Testing manual insert:');
  try {
    const testInsert = `INSERT INTO default.erc1155_transfers (tx_hash, log_index, block_number, contract, token_id, from_address, to_address, value) VALUES ('0xtest123', 1, 99999999, '0xtest', '0xtest', '0xtest', '0xtest', 0)`;

    await ch.query({ query: testInsert });
    console.log('   ✅ Manual insert successful\n');

    // Check if it landed
    const check = await ch.query({
      query: `SELECT COUNT(*) as count FROM default.erc1155_transfers WHERE tx_hash = '0xtest123'`,
      format: 'JSONEachRow'
    });
    const checkData = (await check.json())[0];

    if (parseInt(checkData.count) > 0) {
      console.log('   ✅ Test row found in table\n');
      // Clean up test row
      await ch.query({ query: `ALTER TABLE default.erc1155_transfers DELETE WHERE tx_hash = '0xtest123'` });
    } else {
      console.log('   ⚠️  Test row not found in table (may be pending)\n');
    }
  } catch (e: any) {
    console.log(`   ❌ Manual insert failed: ${e.message}\n`);
  }

  await ch.close();
}

main().catch(console.error);
