#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('🔍 Checking resolution coverage across ALL trade tables...\n');

  // 1. trades_raw coverage
  console.log('━━━ trades_raw (80M rows) ━━━');
  const tradesRawResult = await clickhouse.query({
    query: `
      SELECT
        uniqExact(condition_id_norm) as total_markets,
        uniqExactIf(condition_id_norm, length(condition_id_norm) = 64) as valid_cid_markets,
        uniqExactIf(condition_id_norm, length(condition_id_norm) != 64 OR condition_id_norm = '') as invalid_cid_markets
      FROM (
        SELECT lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
        FROM default.trades_raw
        WHERE condition_id != ''
      )
    `,
    format: 'JSONEachRow'
  });
  const tradesRaw = await tradesRawResult.json<Array<any>>();
  console.log(`  Total unique markets: ${parseInt(tradesRaw[0].total_markets).toLocaleString()}`);
  console.log(`  Valid CIDs (64 char): ${parseInt(tradesRaw[0].valid_cid_markets).toLocaleString()}`);
  console.log(`  Invalid CIDs: ${parseInt(tradesRaw[0].invalid_cid_markets).toLocaleString()}`);

  // Check resolution coverage for valid CIDs
  const tradesRawResResult = await clickhouse.query({
    query: `
      WITH valid_cids AS (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
        FROM default.trades_raw
        WHERE length(replaceAll(condition_id, '0x', '')) = 64
      ),
      resolutions AS (
        SELECT DISTINCT condition_id_norm
        FROM default.market_resolutions_final
      )
      SELECT
        count() as total_valid_cids,
        countIf(r.condition_id_norm IS NOT NULL) as with_resolution,
        countIf(r.condition_id_norm IS NULL) as without_resolution,
        (countIf(r.condition_id_norm IS NOT NULL) * 100.0 / count()) as pct_coverage
      FROM valid_cids v
      LEFT JOIN resolutions r ON v.condition_id_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow'
  });
  const tradesRawRes = await tradesRawResResult.json<Array<any>>();
  console.log(`  With resolutions: ${parseInt(tradesRawRes[0].with_resolution).toLocaleString()} (${parseFloat(tradesRawRes[0].pct_coverage).toFixed(1)}%)`);
  console.log(`  Without resolutions: ${parseInt(tradesRawRes[0].without_resolution).toLocaleString()}\n`);

  // 2. trades_with_direction coverage
  console.log('━━━ trades_with_direction (82M rows) ━━━');
  const twdResult = await clickhouse.query({
    query: `
      SELECT
        uniqExact(condition_id_norm) as total_markets,
        uniqExactIf(condition_id_norm, length(condition_id_norm) = 64) as valid_cid_markets,
        uniqExactIf(condition_id_norm, length(condition_id_norm) != 64 OR condition_id_norm = '') as invalid_cid_markets
      FROM (
        SELECT condition_id_norm
        FROM default.trades_with_direction
        WHERE condition_id_norm != ''
      )
    `,
    format: 'JSONEachRow'
  });
  const twd = await twdResult.json<Array<any>>();
  console.log(`  Total unique markets: ${parseInt(twd[0].total_markets).toLocaleString()}`);
  console.log(`  Valid CIDs (64 char): ${parseInt(twd[0].valid_cid_markets).toLocaleString()}`);
  console.log(`  Invalid CIDs: ${parseInt(twd[0].invalid_cid_markets).toLocaleString()}`);

  // Check resolution coverage
  const twdResResult = await clickhouse.query({
    query: `
      WITH valid_cids AS (
        SELECT DISTINCT condition_id_norm
        FROM default.trades_with_direction
        WHERE length(condition_id_norm) = 64
      ),
      resolutions AS (
        SELECT DISTINCT condition_id_norm
        FROM default.market_resolutions_final
      )
      SELECT
        count() as total_valid_cids,
        countIf(r.condition_id_norm IS NOT NULL) as with_resolution,
        countIf(r.condition_id_norm IS NULL) as without_resolution,
        (countIf(r.condition_id_norm IS NOT NULL) * 100.0 / count()) as pct_coverage
      FROM valid_cids v
      LEFT JOIN resolutions r ON v.condition_id_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow'
  });
  const twdRes = await twdResResult.json<Array<any>>();
  console.log(`  With resolutions: ${parseInt(twdRes[0].with_resolution).toLocaleString()} (${parseFloat(twdRes[0].pct_coverage).toFixed(1)}%)`);
  console.log(`  Without resolutions: ${parseInt(twdRes[0].without_resolution).toLocaleString()}\n`);

  // 3. fact_trades_clean coverage
  console.log('━━━ fact_trades_clean (63M rows) ━━━');
  try {
    const factResult = await clickhouse.query({
      query: `
        SELECT
          uniqExact(condition_id_norm) as total_markets,
          uniqExactIf(condition_id_norm, length(condition_id_norm) = 64) as valid_cid_markets,
          uniqExactIf(condition_id_norm, length(condition_id_norm) != 64 OR condition_id_norm = '') as invalid_cid_markets
        FROM (
          SELECT condition_id_norm
          FROM cascadian_clean.fact_trades_clean
          WHERE condition_id_norm != ''
        )
      `,
      format: 'JSONEachRow'
    });
    const fact = await factResult.json<Array<any>>();
    console.log(`  Total unique markets: ${parseInt(fact[0].total_markets).toLocaleString()}`);
    console.log(`  Valid CIDs (64 char): ${parseInt(fact[0].valid_cid_markets).toLocaleString()}`);
    console.log(`  Invalid CIDs: ${parseInt(fact[0].invalid_cid_markets).toLocaleString()}`);

    // Check resolution coverage
    const factResResult = await clickhouse.query({
      query: `
        WITH valid_cids AS (
          SELECT DISTINCT condition_id_norm
          FROM cascadian_clean.fact_trades_clean
          WHERE length(condition_id_norm) = 64
        ),
        resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
          FROM default.market_resolutions_final
        )
        SELECT
          count() as total_valid_cids,
          countIf(r.condition_id_norm IS NOT NULL) as with_resolution,
          countIf(r.condition_id_norm IS NULL) as without_resolution,
          (countIf(r.condition_id_norm IS NOT NULL) * 100.0 / count()) as pct_coverage
        FROM valid_cids v
        LEFT JOIN resolutions r ON v.condition_id_norm = r.condition_id_norm
      `,
      format: 'JSONEachRow'
    });
    const factRes = await factResResult.json<Array<any>>();
    console.log(`  With resolutions: ${parseInt(factRes[0].with_resolution).toLocaleString()} (${parseFloat(factRes[0].pct_coverage).toFixed(1)}%)`);
    console.log(`  Without resolutions: ${parseInt(factRes[0].without_resolution).toLocaleString()}\n`);
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}\n`);
  }

  // 4. Summary
  console.log('━━━ SUMMARY ━━━');
  console.log(`Total resolutions available: ${parseInt(tradesRawRes[0].with_resolution).toLocaleString()}`);
  console.log(`Resolution coverage for trades_raw: ${parseFloat(tradesRawRes[0].pct_coverage).toFixed(1)}%`);
  console.log(`Resolution coverage for trades_with_direction: ${parseFloat(twdRes[0].pct_coverage).toFixed(1)}%`);
  console.log('\n✅ Resolution coverage check complete!\n');
}

main().catch(console.error);
