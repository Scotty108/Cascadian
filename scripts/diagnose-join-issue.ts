#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

(async () => {
  console.log('\n🔍 Diagnosing Join Issue...\n');

  // 1. Check row count in resolutions_external_ingest
  const rowCount = await ch.query({
    query: 'SELECT COUNT(*) as count FROM default.resolutions_external_ingest',
    format: 'JSONEachRow',
  });
  const count = await rowCount.json();
  console.log(`1. Rows in resolutions_external_ingest: ${count[0].count}`);

  // 2. Sample condition_id format
  const sample = await ch.query({
    query: `
      SELECT condition_id, length(condition_id) as len
      FROM default.resolutions_external_ingest
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const samples = await sample.json();
  console.log('\n2. Sample condition_id formats:');
  samples.forEach((s: any) => {
    console.log(`   ${s.condition_id.substring(0, 20)}... (length: ${s.len})`);
  });

  // 3. Compare formats with fact_trades_clean
  const tradesSample = await ch.query({
    query: `
      SELECT 
        lower(replaceAll(cid, '0x', '')) as condition_id,
        length(lower(replaceAll(cid, '0x', ''))) as len
      FROM default.fact_trades_clean
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const tradeSamples = await tradesSample.json();
  console.log('\n3. Sample fact_trades_clean condition_id formats:');
  tradeSamples.forEach((s: any) => {
    console.log(`   ${s.condition_id.substring(0, 20)}... (length: ${s.len})`);
  });

  // 4. Check for matches
  const matchTest = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
        LIMIT 1000
      )
      SELECT
        COUNT(*) as total_sample,
        SUM(CASE WHEN r.condition_id IS NOT NULL THEN 1 ELSE 0 END) as matched_in_external
      FROM traded_markets tm
      LEFT JOIN default.resolutions_external_ingest r
        ON tm.condition_id = r.condition_id
    `,
    format: 'JSONEachRow',
  });
  const matches = await matchTest.json();
  console.log('\n4. Join test (1000 sample traded markets):');
  console.log(`   Total: ${matches[0].total_sample}`);
  console.log(`   Matched in external ingest: ${matches[0].matched_in_external}`);

  // 5. Check if condition_ids in external ingest actually match traded markets
  const overlapCheck = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      )
      SELECT COUNT(*) as overlap_count
      FROM default.resolutions_external_ingest r
      WHERE r.condition_id IN (SELECT condition_id FROM traded_markets)
    `,
    format: 'JSONEachRow',
  });
  const overlap = await overlapCheck.json();
  console.log('\n5. Overlap check:');
  console.log(`   Rows in external ingest that match traded markets: ${overlap[0].overlap_count}`);

  // 6. Check duplicates between market_resolutions_final and external_ingest
  const dupCheck = await ch.query({
    query: `
      SELECT COUNT(*) as dup_count
      FROM default.resolutions_external_ingest r
      WHERE r.condition_id IN (
        SELECT condition_id_norm FROM default.market_resolutions_final
      )
    `,
    format: 'JSONEachRow',
  });
  const dups = await dupCheck.json();
  console.log('\n6. Duplicate check:');
  console.log(`   Rows in external ingest that ALREADY exist in market_resolutions_final: ${dups[0].dup_count}`);

  await ch.close();
})();
