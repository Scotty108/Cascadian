#!/usr/bin/env npx tsx
/**
 * GATE VALIDATION - CLEAN RUN
 * Fix header overflow, run Gate A and Gate B
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

// Create client with NO progress headers
const client = createClient({
  url: process.env.CLICKHOUSE_HOST || '',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000, // 5 minutes
  clickhouse_settings: {
    send_progress_in_http_headers: 0,
    wait_end_of_query: 1,
    enable_http_compression: 1,
    max_execution_time: 300, // 5 minutes
  },
});

async function runGates() {
  console.log('=== GATE VALIDATION ===\n');

  // Step 1: Sanity format checks
  console.log('Step 1: Sanity Format Checks');

  const sanityRes = await client.query({
    query: `SELECT anyHeavy(condition_id_norm) AS eg, count() AS cnt FROM market_resolutions_final`,
    format: 'JSONEachRow',
  });
  const sanityResData = await sanityRes.json();
  console.log('market_resolutions_final sample:', JSON.stringify(sanityResData[0], null, 2));

  const sanityVwc = await client.query({
    query: `
SELECT
  count() AS rows,
  countIf(condition_id_norm IN ('', '0x', concat('0x', repeat('0',64)))) AS cid_bad,
  round(100*cid_bad/rows,2) AS cid_bad_pct,
  countIf(market_id_norm IN ('', '0x', '0x12', '12', concat('0x', repeat('0',64)))) AS mid_bad,
  round(100*mid_bad/rows,2) AS mid_bad_pct
FROM vw_trades_canonical`,
    format: 'JSONEachRow',
  });
  const sanityVwcData = await sanityVwc.json();
  console.log('vw_trades_canonical sanity:', JSON.stringify(sanityVwcData[0], null, 2));
  console.log();

  // Step 2: Create normalized views
  console.log('Step 2: Creating Normalized Views');

  await client.command({
    query: `
CREATE OR REPLACE VIEW _res_norm AS
SELECT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''), 64, '0'))) AS cid
FROM market_resolutions_final`,
  });
  console.log('✓ Created _res_norm');

  await client.command({
    query: `
CREATE OR REPLACE VIEW _vwc_norm AS
SELECT
  transaction_hash AS tx_hash,
  lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''), 64, '0'))) AS cid
FROM vw_trades_canonical`,
  });
  console.log('✓ Created _vwc_norm');
  console.log();

  // Step 3: Gate A - pct_in_union_for_missing
  console.log('Step 3: Gate A - Missing TX Coverage');

  const gateA = await client.query({
    query: `
WITH missing AS (
  SELECT DISTINCT transaction_hash AS tx
  FROM trades_raw
  WHERE (condition_id = '' OR condition_id = concat('0x', repeat('0',64)))
    AND transaction_hash != ''
),
vwc_tx AS (
  SELECT DISTINCT tx_hash FROM _vwc_norm
)
SELECT
  count() AS missing_cnt,
  countIf(tx IN (SELECT tx_hash FROM vwc_tx)) AS covered_cnt,
  round(100.0*covered_cnt/missing_cnt, 2) AS pct_in_union_for_missing
FROM missing`,
    format: 'JSONEachRow',
  });
  const gateAData = await gateA.json();
  console.log('GATE A RESULT:', JSON.stringify(gateAData[0], null, 2));
  console.log();

  // Step 4: Gate B - pct_res_covered_by_union
  console.log('Step 4: Gate B - Resolution Coverage');

  const gateB = await client.query({
    query: `
WITH res AS (SELECT DISTINCT cid FROM _res_norm),
vwc AS (SELECT DISTINCT cid FROM _vwc_norm)
SELECT
  (SELECT count() FROM res) AS res_cids,
  (SELECT count() FROM vwc) AS vwc_cids,
  (SELECT count() FROM res r WHERE r.cid IN (SELECT cid FROM vwc)) AS overlap_cids,
  round(100.0 * overlap_cids / res_cids, 2) AS pct_res_covered_by_union,
  round(100.0 * overlap_cids / vwc_cids, 2) AS pct_vwc_in_res
FROM res, vwc
LIMIT 1`,
    format: 'JSONEachRow',
  });
  const gateBData = await gateB.json();
  console.log('GATE B RESULT:', JSON.stringify(gateBData[0], null, 2));
  console.log();

  const pct_res_covered = gateBData[0].pct_res_covered_by_union;

  // Step 5: If Gate B is low, show why
  if (pct_res_covered < 50) {
    console.log('Step 5: Gate B < 50% - Showing Samples\n');

    console.log('Sample: CIDs in resolutions but NOT in vwc (50 random)');
    const missingInVwc = await client.query({
      query: `
WITH res AS (SELECT DISTINCT cid FROM _res_norm)
SELECT cid
FROM res
WHERE cid NOT IN (SELECT cid FROM _vwc_norm)
ORDER BY rand()
LIMIT 50`,
      format: 'JSONEachRow',
    });
    const missingInVwcData = await missingInVwc.json();
    console.log(JSON.stringify(missingInVwcData.slice(0, 10), null, 2));
    console.log(`... (${missingInVwcData.length} total sampled)\n`);

    console.log('Sample: CIDs in vwc but NOT in resolutions (50 random)');
    const missingInRes = await client.query({
      query: `
WITH vwc AS (SELECT DISTINCT cid FROM _vwc_norm)
SELECT cid
FROM vwc
WHERE cid NOT IN (SELECT cid FROM _res_norm)
ORDER BY rand()
LIMIT 50`,
      format: 'JSONEachRow',
    });
    const missingInResData = await missingInRes.json();
    console.log(JSON.stringify(missingInResData.slice(0, 10), null, 2));
    console.log(`... (${missingInResData.length} total sampled)\n`);
  }

  // Summary
  console.log('=== SUMMARY ===');
  console.log(`rows: ${sanityVwcData[0].rows}`);
  console.log(`cid_bad_pct: ${sanityVwcData[0].cid_bad_pct}%`);
  console.log(`mid_bad_pct: ${sanityVwcData[0].mid_bad_pct}%`);
  console.log();
  console.log(`GATE A - pct_in_union_for_missing: ${gateAData[0].pct_in_union_for_missing}%`);
  console.log(`GATE B - pct_res_covered_by_union: ${gateBData[0].pct_res_covered_by_union}%`);
  console.log(`GATE B - pct_vwc_in_res: ${gateBData[0].pct_vwc_in_res}%`);

  await client.close();
}

runGates().catch(console.error);
