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

async function main() {
console.log('═'.repeat(80));
console.log('FIX RESOLUTION JOIN - DIAGNOSTIC');
console.log('═'.repeat(80));
console.log();

// Step 1: Check raw formats
console.log('Step 1: Checking raw data formats...');
console.log('─'.repeat(80));

const factSample = await client.query({
  query: 'SELECT cid_hex, length(cid_hex) AS len FROM cascadian_clean.fact_trades_clean LIMIT 3',
  format: 'JSONEachRow',
});
const factRows = await factSample.json<Array<{ cid_hex: string; len: number }>>();

console.log('\nfact_trades_clean.cid_hex:');
factRows.forEach(r => console.log(`  ${r.cid_hex} (len: ${r.len})`));

const resSample = await client.query({
  query: 'SELECT condition_id_norm, length(condition_id_norm) AS len, toTypeName(condition_id_norm) AS type FROM default.market_resolutions_final LIMIT 3',
  format: 'JSONEachRow',
});
const resRows = await resSample.json<Array<{ condition_id_norm: string; len: number; type: string }>>();

console.log('\nmarket_resolutions_final.condition_id_norm:');
resRows.forEach(r => console.log(`  ${r.condition_id_norm} (len: ${r.len}, type: ${r.type})`));
console.log();

// Step 2: Test normalization approaches
console.log('Step 2: Testing normalization approaches...');
console.log('─'.repeat(80));
console.log();

const tests = [
  {
    name: 'Current (in PnL view)',
    sql: `lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))`,
  },
  {
    name: 'Cast to String first',
    sql: `lower('0x' || leftPad(replaceOne(lower(toString(condition_id_norm)),'0x',''),64,'0'))`,
  },
  {
    name: 'Simple concat',
    sql: `lower(concat('0x', condition_id_norm))`,
  },
  {
    name: 'With trim',
    sql: `lower(concat('0x', trim(TRAILING '\\0' FROM condition_id_norm)))`,
  },
];

for (const test of tests) {
  const result = await client.query({
    query: `
      SELECT ${test.sql} AS normalized, length(normalized) AS len
      FROM default.market_resolutions_final
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json<Array<{ normalized: string; len: number }>>();
  console.log(`${test.name}:`);
  rows.forEach(r => console.log(`  ${r.normalized} (len: ${r.len})`));
  console.log();
}

// Step 3: Test JOIN coverage with each approach
console.log('Step 3: Testing JOIN coverage with each approach...');
console.log('─'.repeat(80));
console.log();

for (const test of tests) {
  const coverage = await client.query({
    query: `
      WITH
      res_norm AS (
        SELECT DISTINCT
          ${test.sql} AS cid_hex
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

  const status = c.coverage_pct > 90 ? '✅ EXCELLENT' : c.coverage_pct > 50 ? '⚠️  MODERATE' : '❌ POOR';
  console.log(`${test.name}:`);
  console.log(`  Fact CIDs:    ${c.fact_cids.toLocaleString()}`);
  console.log(`  Res CIDs:     ${c.res_cids.toLocaleString()}`);
  console.log(`  Matched:      ${c.matched.toLocaleString()}`);
  console.log(`  Coverage:     ${c.coverage_pct}% ${status}`);
  console.log();
}

console.log('═'.repeat(80));
console.log('RECOMMENDATION');
console.log('═'.repeat(80));
console.log();
console.log('Based on test results above, use the approach with highest coverage');
console.log('to rebuild the PnL views.');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
