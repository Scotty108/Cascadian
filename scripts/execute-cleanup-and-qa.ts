#!/usr/bin/env npx tsx
/**
 * DATABASE CLEANUP & QA EXECUTION
 * Runs the comprehensive cleanup script and reports results
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || '',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000, // 10 minutes
  clickhouse_settings: {
    send_progress_in_http_headers: 0,
    wait_end_of_query: 1,
    enable_http_compression: 1,
    max_execution_time: 600,
  },
});

async function executeCleanup() {
  console.log('=== DATABASE CLEANUP & QA EXECUTION ===\n');

  // 0) Session guards (already set in client config, skip)
  console.log('Step 0: Session guards already set in client config\n');

  // 1) Create namespaces
  console.log('Step 1: Creating namespaces...');
  await client.command({ query: 'CREATE DATABASE IF NOT EXISTS cascadian_clean' });
  await client.command({ query: 'CREATE DATABASE IF NOT EXISTS cascadian_archive' });
  await client.command({ query: 'CREATE DATABASE IF NOT EXISTS cascadian_ops' });
  console.log('✓ Namespaces created\n');

  // 2) Inventory (skip - not critical for cleanup)
  console.log('Step 2: Skipping inventory tables (not critical for cleanup)\n');

  // 3) Create normalization views
  console.log('Step 3: Creating normalization views...');

  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_cid AS
SELECT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''), 64, '0'))) AS cid,
       payout_numerators,
       payout_denominator,
       outcome_count,
       winning_outcome,
       resolved_at
FROM market_resolutions_final
WHERE condition_id_norm != ''`,
  });
  console.log('✓ vw_resolutions_cid');

  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_vwc_hex AS
SELECT
  transaction_hash AS tx_hash,
  toDateTime(timestamp) AS block_time,
  lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''), 64, '0'))) AS cid,
  outcome_index,
  wallet_address_norm AS wallet_address,
  trade_direction AS direction,
  shares,
  entry_price AS price,
  usd_value AS usdc_amount
FROM vw_trades_canonical
WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
  AND position(lower(replaceOne(condition_id_norm,'0x','')), 'token_') = 0`,
  });
  console.log('✓ vw_vwc_hex');

  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_token_cid_map AS
SELECT toUInt256(token_id) AS token_u256,
       lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))) AS cid
FROM ctf_token_map
WHERE token_id != '' AND condition_id_norm != ''`,
  });
  console.log('✓ vw_token_cid_map');

  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_vwc_token_src AS
SELECT DISTINCT
  transaction_hash AS tx_hash,
  replaceAll(lower(replaceOne(condition_id_norm,'0x','')), 'token_','') AS token_str
FROM vw_trades_canonical
WHERE position(lower(replaceOne(condition_id_norm,'0x','')), 'token_') = 1`,
  });
  console.log('✓ vw_vwc_token_src');

  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_vwc_token_joined AS
SELECT s.tx_hash, m.cid
FROM cascadian_clean.vw_vwc_token_src s
JOIN cascadian_clean.vw_token_cid_map m ON toUInt256(s.token_str) = m.token_u256`,
  });
  console.log('✓ vw_vwc_token_joined');

  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.vw_vwc_token_decoded_fallback AS
SELECT s.tx_hash,
       concat('0x', lpad(lower(hex(intDiv(toUInt256(s.token_str), 256))), 64, '0')) AS cid
FROM cascadian_clean.vw_vwc_token_src s
LEFT JOIN cascadian_clean.vw_token_cid_map m ON toUInt256(s.token_str) = m.token_u256
WHERE m.token_u256 IS NULL`,
  });
  console.log('✓ vw_vwc_token_decoded_fallback\n');

  // 4) Build clean fact view
  console.log('Step 4: Building fact_trades_clean view...');
  await client.command({
    query: `
CREATE OR REPLACE VIEW cascadian_clean.fact_trades_clean AS
SELECT * FROM cascadian_clean.vw_vwc_hex
UNION ALL
SELECT
  v.transaction_hash AS tx_hash,
  toDateTime(v.timestamp) AS block_time,
  j.cid,
  v.outcome_index,
  v.wallet_address_norm AS wallet_address,
  v.trade_direction AS direction,
  v.shares,
  v.entry_price AS price,
  v.usd_value AS usdc_amount
FROM vw_trades_canonical v
JOIN cascadian_clean.vw_vwc_token_joined j ON j.tx_hash = v.transaction_hash
UNION ALL
SELECT
  v.transaction_hash AS tx_hash,
  toDateTime(v.timestamp) AS block_time,
  f.cid,
  v.outcome_index,
  v.wallet_address_norm AS wallet_address,
  v.trade_direction AS direction,
  v.shares,
  v.entry_price AS price,
  v.usd_value AS usdc_amount
FROM vw_trades_canonical v
JOIN cascadian_clean.vw_vwc_token_decoded_fallback f ON f.tx_hash = v.transaction_hash`,
  });
  console.log('✓ fact_trades_clean created\n');

  // 5) Run QA checks
  console.log('Step 5: Running QA checks...\n');

  console.log('QA Check 6a: Gate A/B on clean view');
  const gateA = await client.query({
    query: `
WITH missing AS (
  SELECT DISTINCT transaction_hash AS tx
  FROM trades_raw
  WHERE (condition_id = '' OR condition_id = concat('0x', repeat('0',64)))
    AND transaction_hash != ''
)
SELECT
  (SELECT count() FROM missing) AS missing_cnt,
  (SELECT count(DISTINCT m.tx) FROM missing m INNER JOIN cascadian_clean.fact_trades_clean f ON m.tx = f.tx_hash) AS covered_cnt,
  round(100.0*covered_cnt/missing_cnt, 2) AS pct_in_union_for_missing`,
    format: 'JSONEachRow',
  });
  const gateAData = await gateA.json();
  console.log('Gate A Result:', JSON.stringify(gateAData[0], null, 2));

  const gateB = await client.query({
    query: `
WITH res AS (SELECT DISTINCT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))) AS cid FROM market_resolutions_final),
fact AS (SELECT DISTINCT cid FROM cascadian_clean.fact_trades_clean)
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

  console.log('QA Check 6b: Bad-ID hygiene');
  const hygiene = await client.query({
    query: `
SELECT
  countIf(cid = '0x' OR cid = concat('0x', repeat('0',64))) AS cid_zero,
  countIf(position(cid,'token_')=1) AS cid_token_strings,
  count() AS total_rows
FROM cascadian_clean.fact_trades_clean`,
    format: 'JSONEachRow',
  });
  const hygieneData = await hygiene.json();
  console.log('Hygiene Result:', JSON.stringify(hygieneData[0], null, 2));
  console.log();

  console.log('QA Check 6c: Per-wallet coverage (top 100 wallets)');
  const coverage = await client.query({
    query: `
WITH base AS (
  SELECT wallet_address, tx_hash FROM cascadian_clean.fact_trades_clean
),
topw AS (
  SELECT wallet_address FROM base GROUP BY wallet_address ORDER BY count() DESC LIMIT 100
)
SELECT
  quantileExact(0.05)(txs) AS p5,
  quantileExact(0.50)(txs) AS p50,
  quantileExact(0.95)(txs) AS p95
FROM (
  SELECT wallet_address, countDistinct(tx_hash) AS txs
  FROM base
  WHERE wallet_address IN (SELECT wallet_address FROM topw)
  GROUP BY wallet_address
)`,
    format: 'JSONEachRow',
  });
  const coverageData = await coverage.json();
  console.log('Coverage Percentiles (top 100 wallets):', JSON.stringify(coverageData[0], null, 2));
  console.log();

  // Summary
  console.log('=== FINAL SUMMARY ===');
  console.log('\nGate A (Missing TX Coverage):');
  console.log(`  pct_in_union_for_missing: ${gateAData[0].pct_in_union_for_missing}%`);
  console.log('\nGate B (Resolution Coverage):');
  console.log(`  pct_res_covered_by_fact: ${gateBData[0].pct_res_covered_by_fact}%`);
  console.log(`  pct_fact_in_res: ${gateBData[0].pct_fact_in_res}%`);
  console.log('\nData Quality:');
  console.log(`  total_rows: ${hygieneData[0].total_rows}`);
  console.log(`  cid_zero: ${hygieneData[0].cid_zero}`);
  console.log(`  cid_token_strings: ${hygieneData[0].cid_token_strings}`);
  console.log('\nTop 100 Wallets Coverage:');
  console.log(`  p5: ${coverageData[0].p5} txs`);
  console.log(`  p50: ${coverageData[0].p50} txs`);
  console.log(`  p95: ${coverageData[0].p95} txs`);

  await client.close();
}

executeCleanup().catch(console.error);
