#!/usr/bin/env npx tsx
/**
 * REBUILD using client.command() which is designed for DDL
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 600000,  // 10 minutes
  max_open_connections: 10,
});

async function main() {
  console.log('═'.repeat(80));
  console.log('REBUILD fact_trades_clean (80M rows - may take 2-5 minutes)');
  console.log('═'.repeat(80));
  console.log();

  console.log('Starting table creation...');
  console.log();

  const startTime = Date.now();

  try {
    // Use command() for DDL operations - it's designed for this
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS cascadian_clean.fact_trades_clean
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
        max_execution_time: 600,  // 10 minutes in seconds
      }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Table created successfully! (${elapsed}s)`);
    console.log();

    console.log('Checking row count...');
    const countResult = await client.query({
      query: 'SELECT count() AS c FROM cascadian_clean.fact_trades_clean',
      format: 'JSONEachRow',
    });
    const count = (await countResult.json<Array<{ c: number }>>())[0].c;
    console.log(`Rows: ${count.toLocaleString()}`);
    console.log();

    console.log('Checking sample CIDs...');
    const sampleResult = await client.query({
      query: 'SELECT cid_hex, length(cid_hex) AS len FROM cascadian_clean.fact_trades_clean LIMIT 5',
      format: 'JSONEachRow',
    });
    const samples = await sampleResult.json<Array<{ cid_hex: string; len: number }>>();
    samples.forEach((s, i) => console.log(`  ${i + 1}. ${s.cid_hex} (len: ${s.len})`));
    console.log();

    console.log('Testing join coverage...');
    const coverageResult = await client.query({
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

    const c = (await coverageResult.json<Array<{
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
      console.log('✅✅✅ SUCCESS! Coverage jumped to >90%! Join is FIXED!');
    } else if (c.coverage_pct > 50) {
      console.log('✅ IMPROVED! Coverage is >50%');
    } else {
      console.log('❌ Still poor coverage - need more investigation');
    }

  } catch (error: any) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\nError after ${elapsed}s:`, error.message);
    process.exit(1);
  }

  console.log();
  console.log('═'.repeat(80));
  console.log('NEXT STEPS');
  console.log('═'.repeat(80));
  console.log();
  console.log('1. Rebuild PnL views');
  console.log('2. Re-verify against Polymarket UI');
  console.log();

  await client.close();
}

main();
