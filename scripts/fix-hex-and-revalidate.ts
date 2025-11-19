#!/usr/bin/env npx tsx
/**
 * FIX HEX PARSING & RE-VALIDATE GATES
 * Fixes token→UInt256 conversion and reruns Gate A/B
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || '',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
  clickhouse_settings: {
    send_progress_in_http_headers: 0,
    enable_http_compression: 1,
    max_execution_time: 600,
  },
});

async function fixAndRevalidate() {
  console.log('=== FIX HEX PARSING & RE-VALIDATE GATES ===\n');

  // Step 1: Fix vw_token_cid_map
  console.log('Step 1: Fixing vw_token_cid_map...');
  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_token_cid_map AS
SELECT
  CASE
    WHEN token_id ILIKE '0x%' THEN reinterpretAsUInt256(
      unhex(lpad(replaceOne(lower(token_id),'0x',''), 64, '0'))
    )
    ELSE toUInt256(token_id)
  END AS token_u256,
  lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''), 64, '0'))) AS cid
FROM ctf_token_map
WHERE token_id IS NOT NULL AND token_id != '' AND condition_id_norm IS NOT NULL AND condition_id_norm != ''

UNION ALL

SELECT
  CASE
    WHEN token_id ILIKE '0x%' THEN reinterpretAsUInt256(
      unhex(lpad(replaceOne(lower(token_id),'0x',''), 64, '0'))
    )
    ELSE toUInt256(token_id)
  END AS token_u256,
  lower(concat('0x', lpad(replaceOne(lower(condition_id),'0x',''), 64, '0'))) AS cid
FROM erc1155_condition_map
WHERE token_id IS NOT NULL AND token_id != '' AND condition_id IS NOT NULL AND condition_id != ''`,
  });
  console.log('✓ vw_token_cid_map fixed\n');

  // Step 2: Refresh dependent views
  console.log('Step 2: Refreshing dependent views...');

  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_vwc_token_src AS
SELECT DISTINCT
  transaction_hash AS tx_hash,
  toUInt256(
    replaceAll(
      lower(replaceOne(condition_id_norm,'0x','')),
      'token_',''
    )
  ) AS token_u256
FROM vw_trades_canonical
WHERE position(lower(replaceOne(condition_id_norm,'0x','')), 'token_') = 1`,
  });
  console.log('✓ vw_vwc_token_src');

  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_vwc_token_joined AS
SELECT s.tx_hash, m.cid
FROM cascadian_clean.vw_vwc_token_src s
JOIN cascadian_clean.vw_token_cid_map m USING (token_u256)`,
  });
  console.log('✓ vw_vwc_token_joined');

  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_vwc_token_decoded_fallback AS
SELECT
  s.tx_hash,
  concat('0x', lpad(lower(hex(intDiv(s.token_u256, 256))), 64, '0')) AS cid
FROM cascadian_clean.vw_vwc_token_src s
LEFT JOIN cascadian_clean.vw_token_cid_map m USING (token_u256)
WHERE m.token_u256 IS NULL`,
  });
  console.log('✓ vw_vwc_token_decoded_fallback\n');

  // Step 3: Smoke tests
  console.log('Step 3: Running smoke tests...\n');

  const smokeMap = await client.query({
    query: 'SELECT count() AS map_rows FROM cascadian_clean.vw_token_cid_map',
    format: 'JSONEachRow',
  });
  const smokeMapData = await smokeMap.json();
  console.log('Smoke Test 1 - Map rows:', JSON.stringify(smokeMapData[0], null, 2));

  const smokeCounts = await client.query({
    query: `
SELECT
  (SELECT count() FROM cascadian_clean.vw_vwc_token_src)        AS token_src_rows,
  (SELECT count() FROM cascadian_clean.vw_vwc_token_joined)     AS joined_rows,
  (SELECT count() FROM cascadian_clean.vw_vwc_token_decoded_fallback) AS fallback_rows`,
    format: 'JSONEachRow',
  });
  const smokeCountsData = await smokeCounts.json();
  console.log('Smoke Test 2 - Row counts:', JSON.stringify(smokeCountsData[0], null, 2));

  const smokeSample = await client.query({
    query: 'SELECT * FROM cascadian_clean.vw_vwc_token_joined LIMIT 10',
    format: 'JSONEachRow',
  });
  const smokeSampleData = await smokeSample.json();
  console.log('Smoke Test 3 - Sample joined pairs (10 rows):');
  console.log(JSON.stringify(smokeSampleData.slice(0, 3), null, 2));
  console.log(`... (${smokeSampleData.length} total rows sampled)\n`);

  // Step 4: Gate A
  console.log('Step 4: Recomputing Gate A...');
  const gateA = await client.query({
    query: `
WITH missing AS (
  SELECT DISTINCT transaction_hash AS tx
  FROM trades_raw
  WHERE (condition_id = '' OR condition_id = concat('0x', repeat('0',64)))
    AND transaction_hash != ''
),
covered AS (
  SELECT DISTINCT tx_hash AS tx FROM cascadian_clean.fact_trades_clean
)
SELECT
  (SELECT count() FROM missing) AS missing_cnt,
  (SELECT countDistinct(tx) FROM missing WHERE tx IN (SELECT tx FROM covered)) AS covered_cnt,
  round(100.0 * covered_cnt / missing_cnt, 2) AS pct_in_union_for_missing`,
    format: 'JSONEachRow',
  });
  const gateAData = await gateA.json();
  console.log('Gate A Result:', JSON.stringify(gateAData[0], null, 2));
  console.log();

  // Step 5: Gate B
  console.log('Step 5: Recomputing Gate B...');
  const gateB = await client.query({
    query: `
WITH res AS (
  SELECT DISTINCT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''), 64, '0'))) AS cid
  FROM market_resolutions_final
),
fact AS (
  SELECT DISTINCT cid FROM cascadian_clean.fact_trades_clean
)
SELECT
  (SELECT count() FROM res) AS res_cids,
  (SELECT count() FROM fact) AS fact_cids,
  (SELECT count() FROM res WHERE cid IN (SELECT cid FROM fact)) AS overlap_cids,
  round(100.0 * overlap_cids / res_cids, 2) AS pct_res_covered_by_fact,
  round(100.0 * overlap_cids / fact_cids, 2) AS pct_fact_in_res`,
    format: 'JSONEachRow',
  });
  const gateBData = await gateB.json();
  console.log('Gate B Result:', JSON.stringify(gateBData[0], null, 2));
  console.log();

  // Step 6: Check for remaining token_ strings
  console.log('Step 6: Checking for remaining token_ strings in fact_trades_clean...');
  const tokenCheck = await client.query({
    query: `
SELECT count() AS rows_with_token_prefix
FROM cascadian_clean.fact_trades_clean
WHERE cid LIKE '%token_%'`,
    format: 'JSONEachRow',
  });
  const tokenCheckData = await tokenCheck.json();
  console.log('Token prefix check:', JSON.stringify(tokenCheckData[0], null, 2));
  console.log();

  // Summary
  console.log('=== FINAL SUMMARY ===');
  console.log('\nSmoke Tests:');
  console.log(`  map_rows: ${smokeMapData[0].map_rows}`);
  console.log(`  token_src_rows: ${smokeCountsData[0].token_src_rows}`);
  console.log(`  joined_rows: ${smokeCountsData[0].joined_rows}`);
  console.log(`  fallback_rows: ${smokeCountsData[0].fallback_rows}`);
  console.log('\nGate A:');
  console.log(`  missing_cnt: ${gateAData[0].missing_cnt}`);
  console.log(`  covered_cnt: ${gateAData[0].covered_cnt}`);
  console.log(`  pct_in_union_for_missing: ${gateAData[0].pct_in_union_for_missing}%`);
  console.log('\nGate B:');
  console.log(`  res_cids: ${gateBData[0].res_cids}`);
  console.log(`  fact_cids: ${gateBData[0].fact_cids}`);
  console.log(`  overlap_cids: ${gateBData[0].overlap_cids}`);
  console.log(`  pct_res_covered_by_fact: ${gateBData[0].pct_res_covered_by_fact}%`);
  console.log(`  pct_fact_in_res: ${gateBData[0].pct_fact_in_res}%`);
  console.log('\nData Quality:');
  console.log(`  rows_with_token_prefix: ${tokenCheckData[0].rows_with_token_prefix}`);

  await client.close();
}

fixAndRevalidate().catch(console.error);
