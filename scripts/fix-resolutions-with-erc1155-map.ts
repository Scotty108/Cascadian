#!/usr/bin/env npx tsx
/**
 * FIX: Use erc1155_condition_map to rekey resolutions
 *
 * market_resolutions_final.condition_id_norm → matches token_id
 * erc1155_condition_map has: token_id → condition_id
 * We need: condition_id for joining to fact_trades_clean
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 600000,
});

async function main() {
console.log('═'.repeat(80));
console.log('FIX: REKEY RESOLUTIONS USING ERC1155_CONDITION_MAP');
console.log('═'.repeat(80));
console.log();

console.log('Step 1: Test the mapping hypothesis...');
console.log('─'.repeat(80));

// Check if market_resolutions_final.condition_id_norm matches erc1155_condition_map.token_id
const testResult = await client.query({
  query: `
    SELECT
      count() AS total_resolutions,
      countIf(m.token_id IS NOT NULL) AS found_in_map,
      round(100.0 * found_in_map / total_resolutions, 2) AS match_pct
    FROM default.market_resolutions_final r
    LEFT JOIN default.erc1155_condition_map m
      ON lower(concat('0x', r.condition_id_norm)) = lower(m.token_id)
  `,
  format: 'JSONEachRow',
});

const test = (await testResult.json<Array<{
  total_resolutions: number;
  found_in_map: number;
  match_pct: number;
}>>())[0];

console.log();
console.log(`Total resolutions:              ${test.total_resolutions.toLocaleString()}`);
console.log(`Found in erc1155_condition_map: ${test.found_in_map.toLocaleString()}`);
console.log(`Match rate:                     ${test.match_pct}%`);
console.log();

if (test.match_pct < 50) {
  console.log('❌ Low match rate - hypothesis may be wrong');
  console.log('   Checking alternative: market_resolutions may already be keyed by condition_id');
  console.log();

  // Test direct join
  const directTest = await client.query({
    query: `
      WITH fact_cids AS (
        SELECT DISTINCT cid_hex FROM cascadian_clean.fact_trades_clean LIMIT 1000
      )
      SELECT
        count() AS total,
        countIf(r.condition_id_norm IS NOT NULL) AS matched
      FROM fact_cids f
      LEFT JOIN default.market_resolutions_final r
        ON lower(concat('0x', r.condition_id_norm)) = f.cid_hex
    `,
    format: 'JSONEachRow',
  });

  const direct = (await directTest.json<Array<{ total: number; matched: number }>>())[0];
  console.log(`Direct match test (1000 fact CIDs):  ${direct.matched}/${direct.total}`);
  console.log();

  if (direct.matched > 200) {
    console.log('✅ Direct join works! No rekeying needed.');
    console.log('   Issue must be elsewhere (maybe just incomplete data)');
    await client.close();
    return;
  }
}

console.log('Step 2: Create rekeyed resolutions table...');
console.log('─'.repeat(80));

await client.command({
  query: `
    CREATE OR REPLACE TABLE cascadian_clean.resolutions_rekeyed
    ENGINE = ReplacingMergeTree()
    ORDER BY (cid_hex)
    AS
    SELECT
      lower(m.condition_id) AS cid_hex,
      r.winning_index,
      r.payout_numerators,
      r.payout_denominator,
      'rekeyed_via_erc1155_map' AS source,
      r.resolved_at
    FROM default.market_resolutions_final r
    INNER JOIN default.erc1155_condition_map m
      ON lower(concat('0x', r.condition_id_norm)) = lower(m.token_id)
    WHERE r.winning_index IS NOT NULL AND r.payout_denominator > 0
  `,
  clickhouse_settings: {
    max_execution_time: 600,
  }
});

console.log('✅ resolutions_rekeyed created');
console.log();

// Check row count
const countResult = await client.query({
  query: 'SELECT count() AS c FROM cascadian_clean.resolutions_rekeyed',
  format: 'JSONEachRow',
});
const count = (await countResult.json<Array<{ c: number }>>())[0].c;
console.log(`Rows in rekeyed table: ${count.toLocaleString()}`);
console.log();

console.log('Step 3: Test coverage with rekeyed resolutions...');
console.log('─'.repeat(80));

const coverageResult = await client.query({
  query: `
    WITH
    fact AS (SELECT DISTINCT cid_hex FROM cascadian_clean.fact_trades_clean),
    res  AS (SELECT DISTINCT cid_hex FROM cascadian_clean.resolutions_rekeyed)
    SELECT
      (SELECT count() FROM fact) AS traded_cids,
      (SELECT count() FROM res)  AS resolution_cids,
      (SELECT count() FROM fact f WHERE f.cid_hex IN (SELECT cid_hex FROM res)) AS joined,
      round(100.0 * joined / traded_cids, 2) AS coverage_pct
  `,
  format: 'JSONEachRow',
});

const c = (await coverageResult.json<Array<{
  traded_cids: number;
  resolution_cids: number;
  joined: number;
  coverage_pct: number;
}>>())[0];

console.log();
console.log('Coverage with rekeyed resolutions:');
console.log(`  Traded CIDs:      ${c.traded_cids.toLocaleString()}`);
console.log(`  Resolution CIDs:  ${c.resolution_cids.toLocaleString()}`);
console.log(`  Matched:          ${c.joined.toLocaleString()}`);
console.log(`  Coverage:         ${c.coverage_pct}%`);
console.log();

if (c.coverage_pct > 90) {
  console.log('✅✅✅ SUCCESS! Coverage >90%!');
} else if (c.coverage_pct > 50) {
  console.log('✅ IMPROVED! Coverage >50%');
  console.log('   May need API backfill for remaining markets');
} else {
  console.log('❌ Still poor coverage');
  console.log('   Need different approach or API backfill');
}

console.log();
console.log('═'.repeat(80));
console.log('NEXT STEPS');
console.log('═'.repeat(80));
console.log();
console.log('1. Create unified vw_resolutions_all view');
console.log('2. Rebuild PnL views using rekeyed resolutions');
console.log('3. Re-verify against Polymarket UI wallets');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
