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

async function checkCoverage(description: string, query: string) {
  try {
    const result = await client.query({
      query,
      format: 'JSONEachRow',
    });
    const cov = (await result.json<Array<any>>())[0];
    console.log(`${description}:`);
    console.log(`  Unique CIDs:  ${cov.unique_cids?.toLocaleString() || 'N/A'}`);
    console.log(`  Matched:      ${cov.matched.toLocaleString()}`);
    console.log(`  Coverage:     ${cov.coverage_pct}%`);
    console.log();
    return cov;
  } catch (error: any) {
    console.log(`${description}: ❌ Error - ${error.message.substring(0, 100)}`);
    console.log();
    return null;
  }
}

async function main() {
  console.log('Checking Coverage of Newly Discovered Tables');
  console.log('═'.repeat(80));
  console.log();

  const factCids = 227838; // Known from previous queries

  // 1. Check market_resolutions
  await checkCoverage(
    '1. market_resolutions (direct condition_id)',
    `
      SELECT
        count(DISTINCT condition_id) AS unique_cids,
        (SELECT count(DISTINCT f.cid_hex)
         FROM cascadian_clean.fact_trades_clean f
         INNER JOIN default.market_resolutions r
           ON lower(concat('0x', replaceAll(r.condition_id, '0x', ''))) = f.cid_hex) AS matched,
        round(100.0 * matched / ${factCids}, 2) AS coverage_pct
      FROM default.market_resolutions
    `
  );

  // 2. Check market_resolutions_by_market joined through market_key_map
  await checkCoverage(
    '2. market_resolutions_by_market + market_key_map',
    `
      SELECT
        count(DISTINCT k.condition_id) AS unique_cids,
        (SELECT count(DISTINCT f.cid_hex)
         FROM cascadian_clean.fact_trades_clean f
         INNER JOIN default.market_key_map k ON lower(concat('0x', replaceAll(k.condition_id, '0x', ''))) = f.cid_hex
         INNER JOIN default.market_resolutions_by_market r ON r.market_id = k.market_id
         WHERE r.winning_outcome IS NOT NULL) AS matched,
        round(100.0 * matched / ${factCids}, 2) AS coverage_pct
      FROM default.market_resolutions_by_market r
      INNER JOIN default.market_key_map k ON r.market_id = k.market_id
    `
  );

  // 3. Check outcome_positions_v2 coverage
  await checkCoverage(
    '3. outcome_positions_v2 (pre-computed positions)',
    `
      SELECT
        count(DISTINCT condition_id_norm) AS unique_cids,
        (SELECT count(DISTINCT f.cid_hex)
         FROM cascadian_clean.fact_trades_clean f
         INNER JOIN default.outcome_positions_v2 p
           ON lower(concat('0x', p.condition_id_norm)) = f.cid_hex) AS matched,
        round(100.0 * matched / ${factCids}, 2) AS coverage_pct
      FROM default.outcome_positions_v2
    `
  );

  // 4. Try UNION of all resolution sources
  console.log('4. UNION of all resolution sources:');
  const unionCoverage = await client.query({
    query: `
      WITH all_resolutions AS (
        SELECT DISTINCT
          lower(concat('0x', replaceAll(condition_id_norm, '0x', ''))) AS cid_hex
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0

        UNION DISTINCT

        SELECT DISTINCT
          lower(concat('0x', replaceAll(condition_id, '0x', ''))) AS cid_hex
        FROM default.market_resolutions

        UNION DISTINCT

        SELECT DISTINCT
          lower(concat('0x', replaceAll(k.condition_id, '0x', ''))) AS cid_hex
        FROM default.market_resolutions_by_market r
        INNER JOIN default.market_key_map k ON r.market_id = k.market_id
      )
      SELECT
        count() AS unique_cids,
        (SELECT count(DISTINCT f.cid_hex)
         FROM cascadian_clean.fact_trades_clean f
         INNER JOIN all_resolutions r ON f.cid_hex = r.cid_hex) AS matched,
        round(100.0 * matched / ${factCids}, 2) AS coverage_pct
      FROM all_resolutions
    `,
    format: 'JSONEachRow',
  });

  const unionCov = (await unionCoverage.json<Array<any>>())[0];
  console.log(`  Unique CIDs:  ${unionCov.unique_cids.toLocaleString()}`);
  console.log(`  Matched:      ${unionCov.matched.toLocaleString()}`);
  console.log(`  Coverage:     ${unionCov.coverage_pct}%`);
  console.log();

  console.log('═'.repeat(80));
  if (unionCov.coverage_pct > 30) {
    console.log('🎯 BREAKTHROUGH! Found higher coverage than 24.8%!');
  } else if (unionCov.coverage_pct > 24.8) {
    console.log('✅ Slight improvement over market_resolutions_final');
  } else {
    console.log('📊 Same coverage - all tables source from same data');
  }

  await client.close();
}

main().catch(console.error);
