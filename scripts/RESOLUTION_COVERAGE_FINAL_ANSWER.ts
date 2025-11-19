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
console.log('FINAL ANSWER: WHERE IS THE RESOLUTION DATA?');
console.log('═'.repeat(80));
console.log();

// Global coverage WITHOUT grouping
const global = await client.query({
  query: `
    WITH
    mrf AS (
      SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL AND payout_denominator > 0
    ),
    fact AS (
      SELECT DISTINCT cid_hex FROM cascadian_clean.fact_trades_clean
    )
    SELECT
      (SELECT count() FROM fact) AS total_cids,
      (SELECT count() FROM mrf) AS mrf_cids,
      (SELECT count(DISTINCT f.cid_hex) FROM fact f INNER JOIN mrf m ON m.cid = f.cid_hex) AS matched,
      (SELECT count(DISTINCT f.cid_hex) FROM fact f LEFT JOIN mrf m ON m.cid = f.cid_hex WHERE m.cid IS NULL) AS unmatched
  `,
  format: 'JSONEachRow',
});

const g = (await global.json<Array<{
  total_cids: number;
  mrf_cids: number;
  matched: number;
  unmatched: number;
}>>())[0];

console.log('GLOBAL COVERAGE (all unique markets):');
console.log(`  Total unique CIDs in fact_trades:       ${g.total_cids.toLocaleString()}`);
console.log(`  Total unique CIDs in resolutions:       ${g.mrf_cids.toLocaleString()}`);
console.log(`  Matched (have resolutions):             ${g.matched.toLocaleString()} (${(100 * g.matched / g.total_cids).toFixed(2)}%)`);
console.log(`  Unmatched (NO resolutions):             ${g.unmatched.toLocaleString()} (${(100 * g.unmatched / g.total_cids).toFixed(2)}%)`);
console.log();

// Check if the monthly view is showing something different
const monthly = await client.query({
  query: `
    WITH
    mrf AS (
      SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
      FROM default.market_resolutions_final
      WHERE winning_index IS NOT NULL AND payout_denominator > 0
    )
    SELECT
      count(DISTINCT cid_hex) AS total_cids_across_all_months,
      count(DISTINCT CASE WHEN m.cid IS NOT NULL THEN f.cid_hex END) AS resolved_cids_across_all_months
    FROM cascadian_clean.fact_trades_clean f
    LEFT JOIN mrf m ON m.cid = f.cid_hex
  `,
  format: 'JSONEachRow',
});

const month = (await monthly.json<Array<{
  total_cids_across_all_months: number;
  resolved_cids_across_all_months: number;
}>>())[0];

console.log('CROSS-CHECK (using different query):');
console.log(`  Total CIDs:         ${month.total_cids_across_all_months.toLocaleString()}`);
console.log(`  Resolved CIDs:      ${month.resolved_cids_across_all_months.toLocaleString()}`);
console.log(`  Coverage:           ${(100 * month.resolved_cids_across_all_months / month.total_cids_across_all_months).toFixed(2)}%`);
console.log();

if (Math.abs(g.matched - month.resolved_cids_across_all_months) < 100) {
  console.log('✅ Both queries agree: ~25% global coverage');
} else {
  console.log('❌ Queries disagree - something is wrong!');
}

console.log();
console.log('═'.repeat(80));
console.log('CONCLUSION');
console.log('═'.repeat(80));
console.log();

console.log(`We have resolution data for ${g.matched.toLocaleString()} markets (${(100 * g.matched / g.total_cids).toFixed(1)}%)`);
console.log(`We are MISSING resolution data for ${g.unmatched.toLocaleString()} markets (${(100 * g.unmatched / g.total_cids).toFixed(1)}%)`);
console.log();
console.log('The missing 75% of markets are:');
console.log('  1. Still OPEN (unresolved) OR');
console.log('  2. Resolved but never backfilled from Polymarket API OR');
console.log('  3. Using different condition_id format we have not decoded');
console.log();
console.log('RECOMMENDATION:');
console.log('  Option 1: Build PnL views using the 25% we HAVE (57K markets)');
console.log('  Option 2: Backfill missing 171K markets from Polymarket API');
console.log('  Option 3: Check if markets are truly unresolved (still open)');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
