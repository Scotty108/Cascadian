#!/usr/bin/env npx tsx
/**
 * Find the real mapping between trade IDs and resolution IDs
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('FINDING REAL MAPPING LOGIC');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Try normalization: remove 0x, lowercase, strip leading zeros
  console.log('Testing ID normalization (remove 0x, lowercase, no leading zeros):\n');

  // Get a sample trade ID and normalize it
  const tradeSample = await ch.query({
    query: `
      SELECT
        cid as original,
        lower(replaceAll(cid, '0x', '')) as without_0x,
        replaceRegexpOne(lower(replaceAll(cid, '0x', '')), '^0+', '') as no_leading_zeros
      FROM default.fact_trades_clean
      WHERE cid LIKE '0x0000%'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const trades = await tradeSample.json<any[]>();

  console.log('Sample trade IDs after normalization:');
  trades.forEach((t, i) => {
    console.log(`\n${i+1}.`);
    console.log(`   Original:           ${t.original}`);
    console.log(`   Without 0x:         ${t.without_0x}`);
    console.log(`   No leading zeros:   ${t.no_leading_zeros}`);
  });

  // Get a sample resolution ID
  const resSample = await ch.query({
    query: `
      SELECT
        condition_id_norm as original,
        replaceRegexpOne(condition_id_norm, '^0+', '') as no_leading_zeros
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const res = await resSample.json<any[]>();

  console.log('\n\nSample resolution IDs after normalization:');
  res.forEach((r, i) => {
    console.log(`\n${i+1}.`);
    console.log(`   Original:           ${r.original}`);
    console.log(`   No leading zeros:   ${r.no_leading_zeros}`);
  });

  // Test join with leading zero removal
  console.log('\n\nTest 1: Join with leading zeros stripped from both sides:\n');
  const test1 = await ch.query({
    query: `
      SELECT COUNT(*) as match_count
      FROM (
        SELECT DISTINCT
          replaceRegexpOne(lower(replaceAll(cid, '0x', '')), '^0+', '') as cid_norm
        FROM default.fact_trades_clean
        LIMIT 1000
      ) t
      INNER JOIN (
        SELECT DISTINCT
          replaceRegexpOne(condition_id_norm, '^0+', '') as cid_norm
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
      ) r ON t.cid_norm = r.cid_norm
    `,
    format: 'JSONEachRow',
  });
  const test1Data = await test1.json<any[]>();
  console.log(`   Matches: ${test1Data[0].match_count}/1000`);

  // Test join WITHOUT leading zero removal (just lowercase + remove 0x)
  console.log('\nTest 2: Join with just lowercase + remove 0x (keep leading zeros):\n');
  const test2 = await ch.query({
    query: `
      SELECT COUNT(*) as match_count
      FROM (
        SELECT DISTINCT
          lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM default.fact_trades_clean
        LIMIT 1000
      ) t
      INNER JOIN (
        SELECT DISTINCT
          lower(condition_id_norm) as cid_norm
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
      ) r ON t.cid_norm = r.cid_norm
    `,
    format: 'JSONEachRow',
  });
  const test2Data = await test2.json<any[]>();
  console.log(`   Matches: ${test2Data[0].match_count}/1000`);

  // Check if maybe we need to check vw_trades_canonical instead
  console.log('\n\nTest 3: Check if vw_trades_canonical has different IDs:\n');

  try {
    const vtcSample = await ch.query({
      query: `
        SELECT condition_id_norm
        FROM default.vw_trades_canonical
        LIMIT 3
      `,
      format: 'JSONEachRow',
    });
    const vtc = await vtcSample.json<any[]>();

    console.log('Sample IDs from vw_trades_canonical:');
    vtc.forEach((v, i) => console.log(`   ${i+1}. ${v.condition_id_norm}`));

    // Test join with canonical view
    const test3 = await ch.query({
      query: `
        SELECT COUNT(*) as match_count
        FROM (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.vw_trades_canonical
          LIMIT 1000
        ) t
        INNER JOIN (
          SELECT DISTINCT lower(condition_id_norm) as cid_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
        ) r ON t.cid_norm = r.cid_norm
      `,
      format: 'JSONEachRow',
    });
    const test3Data = await test3.json<any[]>();
    console.log(`\n   Matches with vw_trades_canonical: ${test3Data[0].match_count}/1000`);
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
  }

  console.log('\n═'.repeat(80));
  console.log('RECOMMENDATION');
  console.log('═'.repeat(80));

  const maxMatches = Math.max(
    parseInt(test1Data[0].match_count),
    parseInt(test2Data[0].match_count)
  );

  if (maxMatches > 100) {
    console.log(`\n✅ Found working normalization! ${maxMatches} matches out of 1000`);
  } else {
    console.log('\n❌ No normalization strategy worked');
    console.log('   The IDs in trades and resolutions are fundamentally different');
    console.log('   Need to find the actual mapping table or API source');
  }

  console.log('');

  await ch.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
