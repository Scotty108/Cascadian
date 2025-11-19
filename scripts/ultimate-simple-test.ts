#!/usr/bin/env npx tsx
/**
 * Ultimate Simple Test
 * The simplest possible check: Do traded condition_ids exist in resolution tables?
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
  console.log('\n🎯 ULTIMATE SIMPLE TEST\n');
  console.log('═'.repeat(80));

  // Sample ONE condition_id from trades
  console.log('\n1️⃣ Get one random traded condition_id:\n');

  const sample = await ch.query({
    query: `
      SELECT cid
      FROM default.fact_trades_clean
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const sampleData = await sample.json<any>();
  const testCid = sampleData[0].cid;

  console.log(`  Raw: ${testCid}`);
  console.log(`  Length: ${testCid.length}`);

  const normalized = testCid.toLowerCase().replace('0x', '');
  console.log(`  Normalized: ${normalized}`);
  console.log(`  Normalized length: ${normalized.length}\n`);

  // Check in market_resolutions_final
  console.log('2️⃣ Check in market_resolutions_final:\n');

  const check1 = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.market_resolutions_final
      WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${normalized}'
    `,
    format: 'JSONEachRow'
  });

  const check1Data = await check1.json<any>();
  console.log(`  Found: ${check1Data[0].count} matches\n`);

  // Check in resolutions_external_ingest
  console.log('3️⃣ Check in resolutions_external_ingest:\n');

  const check2 = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.resolutions_external_ingest
      WHERE lower(replaceAll(condition_id, '0x', '')) = '${normalized}'
    `,
    format: 'JSONEachRow'
  });

  const check2Data = await check2.json<any>();
  console.log(`  Found: ${check2Data[0].count} matches\n`);

  // Sample condition_ids from resolution tables
  console.log('4️⃣ Sample condition_ids from resolution tables:\n');

  const resSample1 = await ch.query({
    query: `
      SELECT condition_id_norm
      FROM default.market_resolutions_final
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });

  const resSample1Data = await resSample1.json<any>();
  console.log('  market_resolutions_final samples:');
  resSample1Data.forEach((row: any, i: number) => {
    console.log(`    ${i + 1}. ${row.condition_id_norm.substring(0, 32)}... (len: ${row.condition_id_norm.length})`);
  });

  const resSample2 = await ch.query({
    query: `
      SELECT condition_id
      FROM default.resolutions_external_ingest
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });

  const resSample2Data = await resSample2.json<any>();
  console.log('\n  resolutions_external_ingest samples:');
  resSample2Data.forEach((row: any, i: number) => {
    console.log(`    ${i + 1}. ${row.condition_id.substring(0, 32)}... (len: ${row.condition_id.length})`);
  });

  // Check if ANY traded IDs match
  console.log('\n5️⃣ Check if ANY traded IDs match resolution tables:\n');

  const anyMatch = await ch.query({
    query: `
      WITH
        traded AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
          LIMIT 1000
        ),
        resolved AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.market_resolutions_final
          UNION ALL
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
        )
      SELECT
        COUNT(*) as sampled,
        COUNT(CASE WHEN r.cid_norm IS NOT NULL THEN 1 END) as matched
      FROM traded t
      LEFT JOIN resolved r ON t.cid_norm = r.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const anyMatchData = await anyMatch.json<any>();
  console.log(`  Sampled: 1,000 traded condition_ids`);
  console.log(`  Matched: ${anyMatchData[0].matched}`);
  console.log(`  Match rate: ${(parseInt(anyMatchData[0].matched) / 1000 * 100).toFixed(1)}%\n`);

  console.log('═'.repeat(80));
  console.log('📊 THE TRUTH\n');

  const matchRate = parseInt(anyMatchData[0].matched) / 1000 * 100;

  if (matchRate > 80) {
    console.log('✅ Resolution data EXISTS and MATCHES!');
    console.log('   The P&L view must have a different issue\n');
  } else if (matchRate > 10 && matchRate < 50) {
    console.log('⚠️  Partial overlap');
    console.log(`   ${matchRate.toFixed(1)}% of traded IDs have resolutions`);
    console.log('   This matches the 11.88% P&L coverage\n');
  } else {
    console.log('❌ No meaningful overlap');
    console.log('   Traded IDs and resolution IDs are different sets\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
