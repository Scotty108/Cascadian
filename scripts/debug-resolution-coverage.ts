#!/usr/bin/env npx tsx
/**
 * DEBUG RESOLUTION COVERAGE
 *
 * Find why LEFT JOIN to market_resolutions_final is failing
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
console.log('RESOLUTION DATA COVERAGE CHECK');
console.log('═'.repeat(80));
console.log();

// Check resolution coverage
const coverage = await client.query({
  query: `
    WITH
    resolutions AS (
      SELECT
        lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid_hex,
        winning_index,
        payout_numerators,
        payout_denominator
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL
        AND payout_denominator > 0
    )
    SELECT
      (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean) AS total_cids_in_fact,
      (SELECT count() FROM resolutions) AS total_resolutions,
      (SELECT count(DISTINCT cid_hex) FROM resolutions) AS unique_cids_resolved,
      (SELECT count(DISTINCT f.cid_hex)
       FROM cascadian_clean.fact_trades_clean f
       INNER JOIN resolutions r ON r.cid_hex = f.cid_hex) AS cids_with_matching_resolution,
      round(100.0 * cids_with_matching_resolution / total_cids_in_fact, 2) AS match_pct
  `,
  format: 'JSONEachRow',
});

const c = (await coverage.json<Array<{
  total_cids_in_fact: number;
  total_resolutions: number;
  unique_cids_resolved: number;
  cids_with_matching_resolution: number;
  match_pct: number;
}>>())[0];

console.log('Resolution Coverage:');
console.log(`  Total CIDs in fact_trades_clean:     ${c.total_cids_in_fact.toLocaleString()}`);
console.log(`  Total resolution records:            ${c.total_resolutions.toLocaleString()}`);
console.log(`  Unique CIDs with resolution:         ${c.unique_cids_resolved.toLocaleString()}`);
console.log(`  CIDs with matching resolution:       ${c.cids_with_matching_resolution.toLocaleString()}`);
console.log(`  Match rate:                          ${c.match_pct}%`);
console.log();

if (c.match_pct < 50) {
  console.log('❌ CRITICAL: <50% of trades have resolution data');
  console.log('   This explains why all PnL calculations are negative');
  console.log();
}

// Check specific wallet's CIDs
console.log('Checking sample wallet CIDs against resolutions:');
console.log('─'.repeat(80));

const walletCids = await client.query({
  query: `
    WITH
    wallet_cids AS (
      SELECT DISTINCT cid_hex
      FROM cascadian_clean.fact_trades_clean
      WHERE wallet_address = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'
      LIMIT 10
    ),
    resolutions AS (
      SELECT
        lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid_hex,
        winning_index,
        payout_numerators,
        payout_denominator
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL
    )
    SELECT
      wc.cid_hex,
      r.winning_index,
      r.payout_numerators,
      r.payout_denominator,
      CASE WHEN r.cid_hex IS NOT NULL THEN 'FOUND' ELSE 'MISSING' END AS status
    FROM wallet_cids wc
    LEFT JOIN resolutions r ON r.cid_hex = wc.cid_hex
  `,
  format: 'JSONEachRow',
});

const cids = await walletCids.json<Array<{
  cid_hex: string;
  winning_index: number | null;
  payout_numerators: number[];
  payout_denominator: number | null;
  status: string;
}>>()

console.log();
cids.forEach((row, i) => {
  console.log(`${i + 1}. CID: ${row.cid_hex.substring(0, 20)}... → ${row.status}`);
  if (row.status === 'FOUND') {
    console.log(`   Winner: ${row.winning_index} | Payouts: ${row.payout_numerators} | Denom: ${row.payout_denominator}`);
  }
});

console.log();
const found = cids.filter(r => r.status === 'FOUND').length;
console.log(`Resolution Match: ${found} / ${cids.length} (${(found / cids.length * 100).toFixed(1)}%)`);
console.log();

// Check market_resolutions_final schema
console.log('Checking market_resolutions_final structure:');
console.log('─'.repeat(80));

const sampleRes = await client.query({
  query: `
    SELECT
      condition_id_norm,
      winning_index,
      payout_numerators,
      payout_denominator
    FROM default.market_resolutions_final
    WHERE winning_index IS NOT NULL
      AND payout_denominator > 0
    LIMIT 5
  `,
  format: 'JSONEachRow',
});

const res = await sampleRes.json<Array<{
  condition_id_norm: string;
  winning_index: number;
  payout_numerators: number[];
  payout_denominator: number;
}>>();

console.log();
res.forEach((row, i) => {
  const cid_hex = ('0x' + row.condition_id_norm.toLowerCase().replace('0x', '').padStart(64, '0'));
  console.log(`${i + 1}. CID (raw):       ${row.condition_id_norm}`);
  console.log(`   CID (normalized): ${cid_hex}`);
  console.log(`   Winner:           ${row.winning_index}`);
  console.log(`   Payouts:          ${row.payout_numerators}`);
  console.log(`   Denominator:      ${row.payout_denominator}`);
  console.log();
});

// Check if condition_id format is the issue
console.log('Checking ID format mismatches:');
console.log('─'.repeat(80));

const formatCheck = await client.query({
  query: `
    SELECT
      substring(condition_id_norm, 1, 10) AS id_format,
      count() AS count
    FROM default.market_resolutions_final
    GROUP BY id_format
    ORDER BY count DESC
    LIMIT 10
  `,
  format: 'JSONEachRow',
});

const formats = await formatCheck.json<Array<{ id_format: string; count: number }>>();

console.log();
console.log('Condition ID formats in market_resolutions_final:');
formats.forEach(row => {
  console.log(`  ${row.id_format.padEnd(15)} → ${row.count.toLocaleString()} records`);
});

console.log();
console.log('═'.repeat(80));
console.log('DIAGNOSIS');
console.log('═'.repeat(80));
console.log();

if (c.match_pct < 10) {
  console.log('❌ CRITICAL ISSUE: Resolution data is almost completely missing');
  console.log('   Possible causes:');
  console.log('   1. condition_id format mismatch (0x prefix, padding, case)');
  console.log('   2. market_resolutions_final incomplete');
  console.log('   3. Normalization logic broken');
  console.log();
} else if (c.match_pct < 50) {
  console.log('⚠️  MAJOR ISSUE: Only ~50% of markets have resolution data');
  console.log('   Need to backfill missing resolutions');
  console.log();
} else {
  console.log('✅ Resolution coverage looks good (>50%)');
  console.log('   Issue must be in PnL calculation logic');
  console.log();
}

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
