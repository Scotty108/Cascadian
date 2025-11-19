#!/usr/bin/env npx tsx
/**
 * Debug Condition ID Mismatch
 * Check if condition_ids in resolutions_external_ingest actually match trades
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
  console.log('\n🔍 DEBUGGING CONDITION ID MISMATCH\n');
  console.log('═'.repeat(80));

  // 1. Sample condition_ids from trades
  console.log('\n1️⃣ Sampling condition_ids from fact_trades_clean:\n');

  const tradesSample = await ch.query({
    query: `
      SELECT DISTINCT
        cid as raw_cid,
        lower(cid) as normalized_cid,
        length(lower(cid)) as len
      FROM default.fact_trades_clean
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const tradesData = await tradesSample.json<any>();
  console.log('  Trade condition_ids:');
  tradesData.forEach((row: any, i: number) => {
    console.log(`  ${i+1}. Raw: ${row.raw_cid.substring(0, 32)}...`);
    console.log(`     Norm: ${row.normalized_cid.substring(0, 32)}... (len: ${row.len})`);
  });

  // 2. Sample condition_ids from resolutions_external_ingest
  console.log('\n2️⃣ Sampling condition_ids from resolutions_external_ingest:\n');

  const resSample = await ch.query({
    query: `
      SELECT
        condition_id as raw_cid,
        lower(condition_id) as normalized_cid,
        length(lower(condition_id)) as len
      FROM default.resolutions_external_ingest
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const resData = await resSample.json<any>();
  console.log('  Resolution condition_ids:');
  resData.forEach((row: any, i: number) => {
    console.log(`  ${i+1}. Raw: ${row.raw_cid.substring(0, 32)}...`);
    console.log(`     Norm: ${row.normalized_cid.substring(0, 32)}... (len: ${row.len})`);
  });

  // 3. Try direct join on a specific condition_id
  console.log('\n3️⃣ Testing direct join on specific IDs:\n');

  const testCid = tradesData[0].normalized_cid;
  console.log(`  Testing with: ${testCid.substring(0, 32)}...\n`);

  const joinTest = await ch.query({
    query: `
      SELECT
        'fact_trades_clean' as source,
        COUNT(*) as matches
      FROM default.fact_trades_clean
      WHERE lower(cid) = '${testCid}'

      UNION ALL

      SELECT
        'resolutions_external_ingest' as source,
        COUNT(*) as matches
      FROM default.resolutions_external_ingest
      WHERE lower(condition_id) = '${testCid}'
    `,
    format: 'JSONEachRow'
  });

  const joinData = await joinTest.json<any>();
  joinData.forEach((row: any) => {
    console.log(`  ${row.source}: ${row.matches} matches`);
  });

  // 4. Check if ANY trade condition_ids exist in resolutions_external_ingest
  console.log('\n4️⃣ Checking overlap between tables:\n');

  const overlapTest = await ch.query({
    query: `
      WITH traded_ids AS (
        SELECT DISTINCT lower(cid) as cid
        FROM default.fact_trades_clean
        LIMIT 1000
      )
      SELECT
        COUNT(*) as sampled,
        COUNT(CASE WHEN r.condition_id IS NOT NULL THEN 1 END) as in_resolutions
      FROM traded_ids t
      LEFT JOIN default.resolutions_external_ingest r
        ON t.cid = lower(r.condition_id)
    `,
    format: 'JSONEachRow'
  });

  const overlapData = await overlapTest.json<any>();
  console.log(`  Sampled 1,000 traded condition_ids`);
  console.log(`  Found in resolutions_external_ingest: ${overlapData[0].in_resolutions}`);
  console.log(`  Coverage: ${Math.round(parseInt(overlapData[0].in_resolutions)/1000*100)}%\n`);

  // 5. Check if resolutions_external_ingest has any data at all
  console.log('5️⃣ Checking resolutions_external_ingest data:\n');

  const resCount = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT condition_id) as unique_conditions,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as with_payouts
      FROM default.resolutions_external_ingest
    `,
    format: 'JSONEachRow'
  });

  const resCountData = await resCount.json<any>();
  console.log(`  Total rows: ${parseInt(resCountData[0].total_rows).toLocaleString()}`);
  console.log(`  Unique conditions: ${parseInt(resCountData[0].unique_conditions).toLocaleString()}`);
  console.log(`  With payouts: ${parseInt(resCountData[0].with_payouts).toLocaleString()}\n`);

  // 6. Sample a resolution and check if it exists in trades
  console.log('6️⃣ Reverse check - do resolutions exist in trades?\n');

  const resConditionId = resData[0].normalized_cid;
  console.log(`  Testing with: ${resConditionId.substring(0, 32)}...\n`);

  const reverseTest = await ch.query({
    query: `
      SELECT
        'resolutions_external_ingest' as source,
        COUNT(*) as matches
      FROM default.resolutions_external_ingest
      WHERE lower(condition_id) = '${resConditionId}'

      UNION ALL

      SELECT
        'fact_trades_clean' as source,
        COUNT(*) as matches
      FROM default.fact_trades_clean
      WHERE lower(cid) = '${resConditionId}'
    `,
    format: 'JSONEachRow'
  });

  const reverseData = await reverseTest.json<any>();
  reverseData.forEach((row: any) => {
    console.log(`  ${row.source}: ${row.matches} matches`);
  });

  console.log('\n' + '═'.repeat(80));
  console.log('📊 DIAGNOSIS\n');

  const overlap = parseInt(overlapData[0].in_resolutions);
  const resTotal = parseInt(resCountData[0].unique_conditions);

  if (resTotal === 0) {
    console.log('❌ PROBLEM: resolutions_external_ingest is empty');
    console.log('   Data insertion must have failed\n');
  } else if (overlap === 0) {
    console.log('❌ PROBLEM: No overlap between tables');
    console.log('   - resolutions_external_ingest has data');
    console.log('   - But none of the condition_ids match trades');
    console.log('   - Likely: Different condition_id format or source\n');
  } else if (overlap > 0 && overlap < 100) {
    console.log('⚠️  PROBLEM: Partial overlap');
    console.log(`   - Only ${overlap}/1000 sampled trades have resolutions`);
    console.log('   - May need more resolution data\n');
  } else {
    console.log('✅ Tables have good overlap');
    console.log('   - Issue must be in the view join logic\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
