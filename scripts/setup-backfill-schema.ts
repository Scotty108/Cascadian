#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function setupSchema() {
  console.log('SETUP: Creating views and tables for Option B backfill\n');
  console.log('═'.repeat(80));

  // Step 1: Token → Market mapping
  console.log('\n1. Creating vw_token_to_market view...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_token_to_market AS
      SELECT
        lower(condition_id_norm) AS token_cid_hex,
        -- Extract market ID by replacing last 2 hex chars (outcome index) with 00
        concat(substring(lower(condition_id_norm), 1, 64), '00') AS market_cid_hex
      FROM default.vw_trades_canonical
      WHERE length(replaceAll(condition_id_norm, '0x', '')) = 64
        AND lower(condition_id_norm) NOT IN (
          '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
      GROUP BY token_cid_hex, market_cid_hex
    `,
  });
  console.log('   ✅ vw_token_to_market created');

  // Step 2: Current resolved markets
  console.log('\n2. Creating vw_resolved_have view...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolved_have AS
      SELECT DISTINCT lower(concat('0x', condition_id_norm)) AS cid_hex
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0

      UNION DISTINCT

      SELECT DISTINCT lower(condition_id) AS cid_hex
      FROM default.gamma_markets
      WHERE length(outcome) > 0 AND closed = 1
    `,
  });
  console.log('   ✅ vw_resolved_have created');

  // Step 3: Unique markets from trades
  console.log('\n3. Creating vw_traded_markets view...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_traded_markets AS
      SELECT DISTINCT market_cid_hex AS cid_hex
      FROM cascadian_clean.vw_token_to_market
    `,
  });
  console.log('   ✅ vw_traded_markets created');

  // Step 4: Backfill targets
  console.log('\n4. Creating vw_backfill_targets view...');
  await client.exec({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_backfill_targets AS
      SELECT t.cid_hex
      FROM cascadian_clean.vw_traded_markets t
      LEFT ANTI JOIN cascadian_clean.vw_resolved_have h
        ON t.cid_hex = h.cid_hex
    `,
  });
  console.log('   ✅ vw_backfill_targets created');

  // Step 5: Storage table for API results
  console.log('\n5. Creating resolutions_src_api table...');
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS cascadian_clean.resolutions_src_api
      (
        cid_hex String,
        resolved UInt8,
        winning_index Int32,
        payout_numerators Array(Decimal(18,8)),
        payout_denominator Nullable(Decimal(18,8)),
        outcomes Array(String),
        title String,
        category String,
        tags Array(String),
        resolution_time Nullable(DateTime64(3, 'UTC')),
        source String DEFAULT 'gamma_api',
        inserted_at DateTime DEFAULT now()
      ) ENGINE = MergeTree
      ORDER BY cid_hex
    `,
  });
  console.log('   ✅ resolutions_src_api table created');

  // Step 6: Progress tracking table
  console.log('\n6. Creating backfill_progress table...');
  await client.exec({
    query: `
      CREATE TABLE IF NOT EXISTS cascadian_clean.backfill_progress
      (
        cid_hex String,
        status Enum8('pending'=0,'ok'=1,'error'=2),
        attempts UInt16,
        last_error String,
        updated_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY cid_hex
    `,
  });
  console.log('   ✅ backfill_progress table created');

  // Step 7: Check counts
  console.log('\n7. Verification:');

  const traded = await client.query({
    query: 'SELECT count(DISTINCT cid_hex) AS cnt FROM cascadian_clean.vw_traded_markets',
    format: 'JSONEachRow',
  });
  const tradedCnt = (await traded.json<Array<any>>())[0].cnt;
  console.log(`   Unique markets traded: ${tradedCnt.toLocaleString()}`);

  const have = await client.query({
    query: 'SELECT count(DISTINCT cid_hex) AS cnt FROM cascadian_clean.vw_resolved_have',
    format: 'JSONEachRow',
  });
  const haveCnt = (await have.json<Array<any>>())[0].cnt;
  console.log(`   Markets already resolved: ${haveCnt.toLocaleString()}`);

  const targets = await client.query({
    query: 'SELECT count(cid_hex) AS cnt FROM cascadian_clean.vw_backfill_targets',
    format: 'JSONEachRow',
  });
  const targetsCnt = (await targets.json<Array<any>>())[0].cnt;
  console.log(`   Markets to backfill: ${targetsCnt.toLocaleString()}`);
  console.log(`   Coverage before backfill: ${(100 * haveCnt / tradedCnt).toFixed(1)}%`);

  // Step 8: Seed progress table
  console.log('\n8. Seeding backfill_progress with pending targets...');
  await client.exec({
    query: `
      INSERT INTO cascadian_clean.backfill_progress (cid_hex, status, attempts, last_error)
      SELECT cid_hex, 'pending', 0, ''
      FROM cascadian_clean.vw_backfill_targets
    `,
  });
  console.log(`   ✅ Seeded ${targetsCnt.toLocaleString()} pending markets`);

  console.log('\n═'.repeat(80));
  console.log('SETUP COMPLETE!\n');
  console.log(`Ready to backfill ${targetsCnt.toLocaleString()} unique markets`);
  console.log(`Estimated time at 3 req/s: ~${Math.ceil(targetsCnt / 3 / 60)} minutes`);
  console.log(`Estimated time at 12 req/s: ~${Math.ceil(targetsCnt / 12 / 60)} minutes`);

  await client.close();
}

setupSchema().catch(console.error);
