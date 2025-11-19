#!/usr/bin/env npx tsx
/**
 * ASYNC REBUILD of fact_trades_clean
 * For 80M rows, we start the query and monitor progress separately
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
console.log('═'.repeat(80));
console.log('ASYNC REBUILD fact_trades_clean (80M rows - will take 2-5 minutes)');
console.log('═'.repeat(80));
console.log();

// Check if table already exists
const check = await client.query({
  query: `
    SELECT count() AS c
    FROM system.tables
    WHERE database = 'cascadian_clean' AND name = 'fact_trades_clean'
  `,
  format: 'JSONEachRow',
});
const exists = (await check.json<Array<{ c: number }>>())[0].c > 0;

if (exists) {
  console.log('Table fact_trades_clean already exists!');
  console.log();

  // Check row count
  const count = await client.query({
    query: 'SELECT count() AS c FROM cascadian_clean.fact_trades_clean',
    format: 'JSONEachRow',
  });
  const rows = (await count.json<Array<{ c: number }>>())[0].c;
  console.log(`Current row count: ${rows.toLocaleString()}`);
  console.log();

  if (rows > 75000000) {
    console.log('✅ Table appears to be fully populated!');
    console.log();
    console.log('Testing join coverage...');

    const coverage = await client.query({
      query: `
        WITH
        res_norm AS (
          SELECT DISTINCT
            lower(concat('0x', condition_id_norm)) AS cid_hex
          FROM default.market_resolutions_final
          WHERE winning_index IS NOT NULL AND payout_denominator > 0
        )
        SELECT
          (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean) AS fact_cids,
          (SELECT count() FROM res_norm) AS res_cids,
          (SELECT count(DISTINCT f.cid_hex)
           FROM cascadian_clean.fact_trades_clean f
           INNER JOIN res_norm r ON r.cid_hex = f.cid_hex) AS matched,
          round(100.0 * matched / fact_cids, 2) AS coverage_pct
      `,
      format: 'JSONEachRow',
    });

    const c = (await coverage.json<Array<{
      fact_cids: number;
      res_cids: number;
      matched: number;
      coverage_pct: number;
    }>>())[0];

    console.log();
    console.log('Join Coverage:');
    console.log(`  Fact CIDs:    ${c.fact_cids.toLocaleString()}`);
    console.log(`  Res CIDs:     ${c.res_cids.toLocaleString()}`);
    console.log(`  Matched:      ${c.matched.toLocaleString()}`);
    console.log(`  Coverage:     ${c.coverage_pct}%`);
    console.log();

    if (c.coverage_pct > 90) {
      console.log('✅✅✅ SUCCESS! Coverage is >90%! Join is FIXED!');
    } else if (c.coverage_pct > 50) {
      console.log('✅ IMPROVED! Coverage is >50%');
    } else {
      console.log('❌ Still poor coverage');
    }
  } else {
    console.log('⚠️  Table exists but has low row count - may still be building');
    console.log('   Run this script again in 1-2 minutes to check progress');
  }
} else {
  console.log('Starting table creation (this will run in background)...');
  console.log();

  // Start the query without waiting (fire and forget)
  client.query({
    query: `
      CREATE TABLE cascadian_clean.fact_trades_clean
      ENGINE = ReplacingMergeTree()
      ORDER BY (tx_hash, cid_hex, wallet_address)
      AS
      SELECT
        transaction_hash AS tx_hash,
        toDateTime(timestamp) AS block_time,
        lower(condition_id_norm) AS cid_hex,
        outcome_index,
        wallet_address_norm AS wallet_address,
        trade_direction AS direction,
        shares,
        entry_price AS price,
        usd_value AS usdc_amount,
        'VW_CANONICAL' AS source
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
    }
  }).catch(err => {
    console.error('Error starting table creation:', err.message);
  });

  console.log('✅ Table creation started in background!');
  console.log();
  console.log('This will take 2-5 minutes for 80M rows.');
  console.log();
  console.log('To check progress, run this script again or use:');
  console.log('  npx tsx check-table-build-progress.ts');
  console.log();
}

console.log('═'.repeat(80));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
