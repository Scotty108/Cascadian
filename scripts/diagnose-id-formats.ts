#!/usr/bin/env npx tsx
/**
 * Diagnose ID formats across all tables to understand the mapping needed
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
  console.log('ID FORMAT DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // 1. Check fact_trades_clean ID format
  console.log('1️⃣  fact_trades_clean (trade data):\n');
  const trades = await ch.query({
    query: `
      SELECT cid, length(cid) as len
      FROM default.fact_trades_clean
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const tradesData = await trades.json<any[]>();
  console.log('   Sample IDs:');
  tradesData.forEach(t => console.log(`   ${t.cid} (length: ${t.len})`));

  // 2. Check market_resolutions_final ID format
  console.log('\n2️⃣  market_resolutions_final (resolution data):\n');
  const mrf = await ch.query({
    query: `
      SELECT condition_id_norm, length(condition_id_norm) as len
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const mrfData = await mrf.json<any[]>();
  console.log('   Sample IDs:');
  mrfData.forEach(m => console.log(`   ${m.condition_id_norm} (length: ${m.len})`));

  // 3. Check resolutions_external_ingest ID format
  console.log('\n3️⃣  resolutions_external_ingest (text-to-payout converter):\n');
  const rei = await ch.query({
    query: `
      SELECT condition_id, length(condition_id) as len
      FROM default.resolutions_external_ingest
      WHERE payout_denominator > 0
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const reiData = await rei.json<any[]>();
  console.log('   Sample IDs:');
  reiData.forEach(r => console.log(`   ${r.condition_id} (length: ${r.len})`));

  // 4. Check erc1155_condition_map formats
  console.log('\n4️⃣  erc1155_condition_map (mapping table):\n');
  const map = await ch.query({
    query: `
      SELECT
        token_id,
        condition_id,
        length(token_id) as token_len,
        length(condition_id) as cond_len
      FROM default.erc1155_condition_map
      WHERE token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const mapData = await map.json<any[]>();
  console.log('   Sample mappings:');
  mapData.forEach(m => {
    console.log(`   token_id:      ${m.token_id} (length: ${m.token_len})`);
    console.log(`   condition_id:  ${m.condition_id} (length: ${m.cond_len})`);
    console.log('');
  });

  // 5. Test if trades match map.token_id or map.condition_id
  console.log('5️⃣  Testing matches between tables:\n');

  // Test 1: fact_trades_clean.cid vs erc1155_condition_map.token_id
  const test1 = await ch.query({
    query: `
      SELECT COUNT(*) as match_count
      FROM (SELECT DISTINCT cid FROM default.fact_trades_clean LIMIT 1000) t
      INNER JOIN default.erc1155_condition_map m
        ON lower(t.cid) = lower(m.token_id)
    `,
    format: 'JSONEachRow',
  });
  const test1Data = await test1.json<any[]>();
  console.log(`   Test 1: fact_trades.cid = map.token_id`);
  console.log(`   Matches: ${test1Data[0].match_count}/1000\n`);

  // Test 2: fact_trades_clean.cid vs erc1155_condition_map.condition_id
  const test2 = await ch.query({
    query: `
      SELECT COUNT(*) as match_count
      FROM (SELECT DISTINCT cid FROM default.fact_trades_clean LIMIT 1000) t
      INNER JOIN default.erc1155_condition_map m
        ON lower(t.cid) = lower(m.condition_id)
    `,
    format: 'JSONEachRow',
  });
  const test2Data = await test2.json<any[]>();
  console.log(`   Test 2: fact_trades.cid = map.condition_id`);
  console.log(`   Matches: ${test2Data[0].match_count}/1000\n`);

  // Test 3: market_resolutions_final.condition_id_norm vs erc1155_condition_map.token_id
  const test3 = await ch.query({
    query: `
      SELECT COUNT(*) as match_count
      FROM (SELECT DISTINCT condition_id_norm FROM default.market_resolutions_final WHERE payout_denominator > 0 LIMIT 1000) r
      INNER JOIN default.erc1155_condition_map m
        ON lower(concat('0x', r.condition_id_norm)) = lower(m.token_id)
    `,
    format: 'JSONEachRow',
  });
  const test3Data = await test3.json<any[]>();
  console.log(`   Test 3: resolutions.condition_id_norm (with 0x) = map.token_id`);
  console.log(`   Matches: ${test3Data[0].match_count}/1000\n`);

  // Test 4: market_resolutions_final.condition_id_norm vs erc1155_condition_map.condition_id
  const test4 = await ch.query({
    query: `
      SELECT COUNT(*) as match_count
      FROM (SELECT DISTINCT condition_id_norm FROM default.market_resolutions_final WHERE payout_denominator > 0 LIMIT 1000) r
      INNER JOIN default.erc1155_condition_map m
        ON lower(concat('0x', r.condition_id_norm)) = lower(m.condition_id)
    `,
    format: 'JSONEachRow',
  });
  const test4Data = await test4.json<any[]>();
  console.log(`   Test 4: resolutions.condition_id_norm (with 0x) = map.condition_id`);
  console.log(`   Matches: ${test4Data[0].match_count}/1000\n`);

  console.log('═'.repeat(80));
  console.log('DIAGNOSIS COMPLETE');
  console.log('═'.repeat(80));
  console.log('\n✅ The test with the most matches shows the correct mapping path!\n');

  await ch.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
