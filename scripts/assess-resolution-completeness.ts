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
  console.log('='.repeat(80));
  console.log('RESOLUTION DATA COMPLETENESS ASSESSMENT');
  console.log('='.repeat(80));
  console.log();

  // 1. Check resolution tables
  console.log('1. RESOLUTION TABLE INVENTORY\n');

  const tables = [
    'market_resolutions_final',
    'resolutions_external_ingest',
    'gamma_markets',
    'api_markets_staging'
  ];

  for (const table of tables) {
    try {
      const result = await client.query({
        query: `
          SELECT
            count() as total_rows,
            count(DISTINCT condition_id) as unique_cids,
            countIf(winning_index >= 0) as has_winner,
            countIf(length(toString(payout_numerators)) > 2) as has_payout
          FROM default.${table}
        `,
        format: 'JSONEachRow'
      });
      const data = await result.json<any>();
      if (data && data[0]) {
        console.log(`${table}:`);
        console.log(`  Total rows: ${data[0].total_rows.toLocaleString()}`);
        console.log(`  Unique condition_ids: ${data[0].unique_cids.toLocaleString()}`);
        console.log(`  Has winning_index: ${data[0].has_winner.toLocaleString()} (${(data[0].has_winner/data[0].total_rows*100).toFixed(1)}%)`);
        console.log(`  Has payout_vector: ${data[0].has_payout.toLocaleString()} (${(data[0].has_payout/data[0].total_rows*100).toFixed(1)}%)`);
        console.log();
      }
    } catch (err: any) {
      console.log(`${table}: ERROR - ${err.message}\n`);
    }
  }

  // 2. Check traded markets
  console.log('\n2. TRADED MARKETS BASELINE\n');

  try {
    const traded = await client.query({
      query: `
        SELECT
          count(DISTINCT condition_id) as unique_markets,
          count() as total_trades
        FROM default.vw_trades_canonical
        WHERE condition_id != '' AND condition_id IS NOT NULL
      `,
      format: 'JSONEachRow'
    });
    const data = await traded.json<any>();
    if (data && data[0]) {
      console.log(`Unique traded markets: ${data[0].unique_markets.toLocaleString()}`);
      console.log(`Total trades: ${data[0].total_trades.toLocaleString()}`);
    }
  } catch (err: any) {
    console.log(`Traded markets ERROR: ${err.message}`);
  }

  // 3. Check coverage from market_resolutions_final
  console.log('\n\n3. COVERAGE USING market_resolutions_final\n');

  try {
    const coverage = await client.query({
      query: `
        WITH
          traded AS (
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
            FROM default.vw_trades_canonical
            WHERE condition_id != '' AND condition_id IS NOT NULL
          ),
          resolved AS (
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
            FROM default.market_resolutions_final
            WHERE winning_index >= 0
          )
        SELECT
          (SELECT count() FROM traded) as total_traded,
          (SELECT count() FROM resolved) as total_resolved,
          (SELECT count() FROM traded INNER JOIN resolved USING(cid_norm)) as matched,
          round((SELECT count() FROM traded INNER JOIN resolved USING(cid_norm)) * 100.0 / (SELECT count() FROM traded), 2) as coverage_pct
      `,
      format: 'JSONEachRow'
    });
    const data = await coverage.json<any>();
    if (data && data[0]) {
      console.log(`Total traded markets: ${data[0].total_traded.toLocaleString()}`);
      console.log(`Total resolutions: ${data[0].total_resolved.toLocaleString()}`);
      console.log(`Matched (have resolutions): ${data[0].matched.toLocaleString()}`);
      console.log(`Coverage: ${data[0].coverage_pct}%`);
    }
  } catch (err: any) {
    console.log(`Coverage ERROR: ${err.message}`);
  }

  // 4. Check vw_resolutions_truth if it exists
  console.log('\n\n4. CHECKING vw_resolutions_truth (if exists)\n');

  try {
    const truth = await client.query({
      query: `
        WITH
          traded AS (
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
            FROM default.vw_trades_canonical
            WHERE condition_id != '' AND condition_id IS NOT NULL
          ),
          resolved AS (
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
            FROM default.vw_resolutions_truth
            WHERE winning_index >= 0
          )
        SELECT
          (SELECT count() FROM resolved) as total_in_truth,
          (SELECT count() FROM traded INNER JOIN resolved USING(cid_norm)) as matched,
          round((SELECT count() FROM traded INNER JOIN resolved USING(cid_norm)) * 100.0 / (SELECT count() FROM traded), 2) as coverage_pct
      `,
      format: 'JSONEachRow'
    });
    const data = await truth.json<any>();
    if (data && data[0]) {
      console.log(`vw_resolutions_truth exists!`);
      console.log(`Total resolutions in truth: ${data[0].total_in_truth.toLocaleString()}`);
      console.log(`Matched with trades: ${data[0].matched.toLocaleString()}`);
      console.log(`Coverage: ${data[0].coverage_pct}%`);
    }
  } catch (err: any) {
    console.log(`vw_resolutions_truth does not exist or error: ${err.message}`);
  }

  // 5. Sample 10 random markets to verify data quality
  console.log('\n\n5. DATA QUALITY SAMPLE (10 random markets)\n');

  try {
    const sample = await client.query({
      query: `
        SELECT
          condition_id,
          winning_index,
          winning_outcome,
          payout_numerators,
          payout_denominator,
          source,
          resolved_at
        FROM default.market_resolutions_final
        WHERE winning_index >= 0
        ORDER BY rand()
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const data = await sample.json<any>();
    if (data && data.length > 0) {
      console.log('Sample resolutions:');
      data.forEach((row: any, i: number) => {
        console.log(`\n${i+1}. ${row.condition_id.substring(0, 16)}...`);
        console.log(`   Winner: ${row.winning_outcome} (index ${row.winning_index})`);
        console.log(`   Payout: [${row.payout_numerators}] / ${row.payout_denominator}`);
        console.log(`   Source: ${row.source}`);
        console.log(`   Resolved: ${row.resolved_at}`);
      });
    }
  } catch (err: any) {
    console.log(`Sample query ERROR: ${err.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('ASSESSMENT COMPLETE');
  console.log('='.repeat(80));

  await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
