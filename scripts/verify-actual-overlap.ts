#!/usr/bin/env npx tsx
/**
 * Verify if resolutions_external_ingest actually overlaps with traded markets
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n🔍 VERIFYING ACTUAL OVERLAP\n');
  console.log('═'.repeat(80));

  // Normalize condition_ids properly before comparing
  console.log('\n1️⃣ Testing with proper normalization:\n');

  const overlapTest = await ch.query({
    query: `
      WITH
        traded_ids AS (
          SELECT DISTINCT
            lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
          LIMIT 1000
        ),
        resolution_ids AS (
          SELECT DISTINCT
            lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
        )
      SELECT
        COUNT(*) as sampled_trades,
        COUNT(CASE WHEN r.cid_norm IS NOT NULL THEN 1 END) as with_resolution,
        ROUND(with_resolution / sampled_trades * 100, 1) as coverage_pct
      FROM traded_ids t
      LEFT JOIN resolution_ids r ON t.cid_norm = r.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const overlapData = await overlapTest.json<any>();
  console.log(`  Sampled trades: 1,000`);
  console.log(`  With resolution: ${overlapData[0].with_resolution}`);
  console.log(`  Coverage: ${overlapData[0].coverage_pct}%\n`);

  // Check if ANY overlap exists
  console.log('2️⃣ Checking if ANY markets overlap:\n');

  const anyOverlap = await ch.query({
    query: `
      WITH
        traded_ids AS (
          SELECT DISTINCT
            lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
        ),
        resolution_ids AS (
          SELECT DISTINCT
            lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
        )
      SELECT COUNT(*) as overlap_count
      FROM traded_ids t
      INNER JOIN resolution_ids r ON t.cid_norm = r.cid_norm
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const anyOverlapData = await anyOverlap.json<any>();
  console.log(`  Markets with both trades AND resolutions: ${parseInt(anyOverlapData[0].overlap_count).toLocaleString()}\n`);

  // Sample 5 overlapping markets (if any)
  if (parseInt(anyOverlapData[0].overlap_count) > 0) {
    console.log('3️⃣ Sampling overlapping markets:\n');

    const samples = await ch.query({
      query: `
        WITH
          traded_ids AS (
            SELECT DISTINCT
              lower(replaceAll(cid, '0x', '')) as cid_norm
            FROM default.fact_trades_clean
          ),
          resolution_ids AS (
            SELECT DISTINCT
              lower(replaceAll(condition_id, '0x', '')) as cid_norm,
              payout_numerators,
              payout_denominator
            FROM default.resolutions_external_ingest
          )
        SELECT
          t.cid_norm,
          r.payout_numerators,
          r.payout_denominator
        FROM traded_ids t
        INNER JOIN resolution_ids r ON t.cid_norm = r.cid_norm
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const samplesData = await samples.json<any>();
    samplesData.forEach((row: any, i: number) => {
      console.log(`  ${i+1}. ${row.cid_norm.substring(0, 32)}...`);
      console.log(`     Payout: ${JSON.stringify(row.payout_numerators)} / ${row.payout_denominator}`);
    });
  } else {
    console.log('3️⃣ No overlapping markets found\n');
  }

  console.log('\n' + '═'.repeat(80));
  console.log('📊 DIAGNOSIS\n');

  const overlapCount = parseInt(anyOverlapData[0].overlap_count);

  if (overlapCount === 0) {
    console.log('❌ CRITICAL PROBLEM: Zero overlap!');
    console.log('   - resolutions_external_ingest has 132K markets');
    console.log('   - fact_trades_clean has 227K+ markets');
    console.log('   - But NONE of them are the same markets!');
    console.log('   - The text-to-payout conversion converted the wrong markets\n');
    console.log('💡 Root Cause:');
    console.log('   The conversion likely used condition_ids from resolution_candidates');
    console.log('   that don\'t match the condition_ids in fact_trades_clean\n');
  } else if (overlapCount < 10000) {
    console.log('⚠️  LOW OVERLAP:');
    console.log(`   Only ${overlapCount.toLocaleString()} markets overlap`);
    console.log('   Most resolutions are for markets we don\'t trade\n');
  } else {
    console.log('✅ Good overlap detected');
    console.log(`   ${overlapCount.toLocaleString()} markets have both trades and resolutions\n`);
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
