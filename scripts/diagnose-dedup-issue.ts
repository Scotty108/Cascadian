#!/usr/bin/env tsx
/**
 * Diagnose P0 Deduplication Issue
 * Why is ROW_NUMBER() producing 88M rows instead of 67M?
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
  request_timeout: 120000,
});

async function diagnose() {
  console.log('🔍 Diagnosing deduplication row count mismatch...\n');

  // Check 1: Verify unique trade_id count in source table
  console.log('Check 1: Unique trade_ids in SOURCE table');
  const uniqueSource = await clickhouse.query({
    query: `SELECT count(DISTINCT trade_id) AS unique_ids FROM pm_trades_canonical_v3`,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].unique_ids);

  console.log(`  Result: ${uniqueSource} unique trade_ids\n`);

  // Check 2: Verify unique trade_id count in deduped table
  console.log('Check 2: Stats in DEDUPED table');
  try {
    const [uniqueDeduped, totalDeduped] = await Promise.all([
      clickhouse.query({
        query: `SELECT count(DISTINCT trade_id) AS unique_ids FROM pm_trades_canonical_v3_deduped`,
        format: 'JSONEachRow'
      }).then(r => r.json<any>()).then(d => d[0].unique_ids),
      clickhouse.query({
        query: `SELECT count() AS total FROM pm_trades_canonical_v3_deduped`,
        format: 'JSONEachRow'
      }).then(r => r.json<any>()).then(d => d[0].total)
    ]);

    console.log(`  Total rows: ${totalDeduped}`);
    console.log(`  Unique trade_ids: ${uniqueDeduped}`);
    console.log(`  Excess rows: ${totalDeduped - uniqueDeduped} (${((totalDeduped - uniqueDeduped) / totalDeduped * 100).toFixed(1)}%)\n`);
  } catch (e) {
    console.log('  ⚠️ Deduped table does not exist\n');
  }

  // Check 3: Look for NULL or empty trade_ids
  console.log('Check 3: NULL/empty trade_ids in SOURCE');
  const nullTradeIds = await clickhouse.query({
    query: `SELECT count() AS null_count FROM pm_trades_canonical_v3 WHERE trade_id IS NULL OR trade_id = ''`,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].null_count);

  console.log(`  Result: ${nullTradeIds} NULL/empty trade_ids\n`);

  // Check 4: Sample trade_ids with most duplicates
  console.log('Check 4: Top 5 trade_ids by duplicate count in SOURCE');
  const topDups = await clickhouse.query({
    query: `
      SELECT
        trade_id,
        count() AS dup_count,
        min(created_at) AS first_ts,
        max(created_at) AS last_ts,
        count(DISTINCT created_at) AS unique_timestamps
      FROM pm_trades_canonical_v3
      GROUP BY trade_id
      ORDER BY dup_count DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  }).then(r => r.json<any>());

  topDups.forEach((row: any) => {
    console.log(`  ${row.trade_id.substring(0, 20)}...`);
    console.log(`    Duplicates: ${row.dup_count}`);
    console.log(`    Unique timestamps: ${row.unique_timestamps}`);
    console.log(`    First: ${row.first_ts}, Last: ${row.last_ts}\n`);
  });

  // Check 5: Check if deduped table still has duplicates
  console.log('Check 5: Are there still duplicates in DEDUPED table?');
  try {
    const stillDups = await clickhouse.query({
      query: `
        SELECT count() AS dup_trade_ids
        FROM (
          SELECT trade_id, count() AS cnt
          FROM pm_trades_canonical_v3_deduped
          GROUP BY trade_id
          HAVING cnt > 1
        )
      `,
      format: 'JSONEachRow'
    }).then(r => r.json<any>()).then(d => d[0].dup_trade_ids);

    console.log(`  Result: ${stillDups} trade_ids still have duplicates\n`);

    if (stillDups > 0) {
      console.log('Check 5b: Sample of remaining duplicates in DEDUPED table');
      const sampleDups = await clickhouse.query({
        query: `
          SELECT
            trade_id,
            count() AS dup_count,
            groupArray(created_at) AS timestamps
          FROM pm_trades_canonical_v3_deduped
          GROUP BY trade_id
          HAVING dup_count > 1
          LIMIT 3
        `,
        format: 'JSONEachRow'
      }).then(r => r.json<any>());

      sampleDups.forEach((row: any) => {
        console.log(`  ${row.trade_id.substring(0, 20)}... has ${row.dup_count} copies`);
        console.log(`    Timestamps: ${row.timestamps.slice(0, 5).join(', ')}\n`);
      });
    }
  } catch (e) {
    console.log('  ⚠️ Deduped table does not exist\n');
  }

  // Check 6: Verify the ROW_NUMBER query logic with a sample
  console.log('Check 6: Testing ROW_NUMBER logic on a sample trade_id');
  const sampleTradeId = await clickhouse.query({
    query: `
      SELECT trade_id
      FROM pm_trades_canonical_v3
      GROUP BY trade_id
      HAVING count() > 10
      LIMIT 1
    `,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].trade_id);

  console.log(`  Sample trade_id: ${sampleTradeId.substring(0, 30)}...`);

  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        trade_id,
        created_at,
        ROW_NUMBER() OVER (PARTITION BY trade_id ORDER BY created_at ASC) AS rn
      FROM pm_trades_canonical_v3
      WHERE trade_id = {trade_id:String}
      ORDER BY created_at ASC
      LIMIT 10
    `,
    query_params: { trade_id: sampleTradeId },
    format: 'JSONEachRow'
  }).then(r => r.json<any>());

  console.log('  Results (first 10 rows):');
  sampleResult.forEach((row: any) => {
    console.log(`    rn=${row.rn}, created_at=${row.created_at}`);
  });

  await clickhouse.close();
}

diagnose().catch(console.error);
