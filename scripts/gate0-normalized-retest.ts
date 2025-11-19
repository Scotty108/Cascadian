#!/usr/bin/env npx tsx
/**
 * GATE 0 RETEST WITH NORMALIZATION FIX
 *
 * GPT identified the issue: normalization mismatch between tables
 * - vwc has 0x prefix, res doesn't
 * - tx_hash has inconsistent formats (txn-0x... vs 0x...)
 *
 * This script:
 * 1. Creates normalized views (cid64 format, tx66 format)
 * 2. Re-runs Gate A: missing tx overlap with vwc
 * 3. Re-runs Gate B: vwc CIDs not in resolutions
 * 4. Reports decision criteria
 *
 * Decision: If Gate A >= 85% AND Gate B <= 5%, proceed with Phase 1 build
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function runQuery<T = any>(query: string, description: string): Promise<T[]> {
  console.log(`\n🔍 ${description}...`);
  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json<T>();
    return data;
  } catch (error) {
    console.error(`❌ Error: ${error}`);
    throw error;
  }
}

async function createNormalizedViews() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 1: CREATE NORMALIZED VIEWS');
  console.log('═══════════════════════════════════════════════════════════');

  // Drop existing views
  console.log('\n🧹 Dropping existing normalized views...');
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS tmp_vwc_norm' });
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS tmp_trenf_norm' });
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS tmp_res_norm' });
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS tmp_raw_bad' });

  // Create tmp_vwc_norm
  console.log('\n📊 Creating tmp_vwc_norm (normalized vw_trades_canonical)...');
  const vwcNormQuery = `
    CREATE VIEW tmp_vwc_norm AS
    SELECT
      lower(replaceRegexpAll(transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx66,
      lpad(lower(replaceAll(condition_id_norm, '0x', '')), 64, '0') AS cid64,
      *
    FROM vw_trades_canonical
    WHERE transaction_hash != ''
  `;
  await clickhouse.command({ query: vwcNormQuery });
  console.log('  ✅ tmp_vwc_norm created');

  // Create tmp_trenf_norm
  console.log('\n📊 Creating tmp_trenf_norm (normalized trades_raw_enriched_final)...');
  const trenfNormQuery = `
    CREATE VIEW tmp_trenf_norm AS
    SELECT
      lower(replaceRegexpAll(transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx66,
      CASE
        WHEN condition_id LIKE 'token_%' THEN
          lpad(lower(hex(intDiv(toUInt256(replaceAll(condition_id, 'token_', '')), 256))), 64, '0')
        WHEN condition_id LIKE '0x%' THEN
          lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0')
        ELSE ''
      END AS cid64,
      *
    FROM trades_raw_enriched_final
    WHERE transaction_hash != ''
  `;
  await clickhouse.command({ query: trenfNormQuery });
  console.log('  ✅ tmp_trenf_norm created');

  // Create tmp_res_norm
  console.log('\n📊 Creating tmp_res_norm (normalized market_resolutions_final)...');
  const resNormQuery = `
    CREATE VIEW tmp_res_norm AS
    SELECT
      lpad(lower(replaceAll(condition_id_norm, '0x', '')), 64, '0') AS cid64,
      *
    FROM market_resolutions_final
  `;
  await clickhouse.command({ query: resNormQuery });
  console.log('  ✅ tmp_res_norm created');

  // Create tmp_raw_bad (missing transactions)
  console.log('\n📊 Creating tmp_raw_bad (missing/bad condition_ids from trades_raw)...');
  const rawBadQuery = `
    CREATE VIEW tmp_raw_bad AS
    SELECT DISTINCT
      lower(replaceRegexpAll(transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx66
    FROM trades_raw
    WHERE condition_id = '' OR condition_id = concat('0x', repeat('0', 64))
  `;
  await clickhouse.command({ query: rawBadQuery });
  console.log('  ✅ tmp_raw_bad created');

  console.log('\n✅ All normalized views created successfully');
}

async function runGateA() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE A: MISSING TX OVERLAP WITH VWC (NORMALIZED)');
  console.log('═══════════════════════════════════════════════════════════');

  const gateAQuery = `
    WITH total_missing AS (
      SELECT count() AS total FROM tmp_raw_bad
    ),
    found_in_vwc AS (
      SELECT count() AS found
      FROM tmp_raw_bad rb
      INNER JOIN tmp_vwc_norm v ON rb.tx66 = v.tx66
    )
    SELECT
      (SELECT total FROM total_missing) AS total_missing_txs,
      (SELECT found FROM found_in_vwc) AS found_in_vwc,
      round(100.0 * (SELECT found FROM found_in_vwc) / nullIf((SELECT total FROM total_missing), 0), 2) AS pct_in_vwc_missing_overlap
  `;

  const results = await runQuery(gateAQuery, 'Calculating missing tx overlap with vwc (normalized)');
  const r = results[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE A RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total missing txs:        ${r.total_missing_txs.toLocaleString()}`);
  console.log(`  Found in vwc:             ${r.found_in_vwc.toLocaleString()}`);
  console.log(`  Coverage:                 ${r.pct_in_vwc_missing_overlap}%`);
  console.log(`  Threshold:                >= 85%`);

  if (r.pct_in_vwc_missing_overlap >= 85) {
    console.log(`\n  ✅ PASS: ${r.pct_in_vwc_missing_overlap}% >= 85%`);
  } else {
    console.log(`\n  ❌ FAIL: ${r.pct_in_vwc_missing_overlap}% < 85%`);
  }

  return r;
}

async function runGateB() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE B: VWC CIDS NOT IN RESOLUTIONS (NORMALIZED)');
  console.log('═══════════════════════════════════════════════════════════');

  const gateBQuery = `
    WITH valid_vwc_cids AS (
      SELECT cid64
      FROM tmp_vwc_norm
      WHERE length(cid64) = 64 AND cid64 NOT IN ('', repeat('0', 64))
    ),
    res_cids AS (
      SELECT cid64 FROM tmp_res_norm
    )
    SELECT
      count() AS total_vwc_cids,
      countIf(cid64 NOT IN (SELECT cid64 FROM res_cids)) AS vwc_cids_not_in_res,
      round(
        100.0 * countIf(cid64 NOT IN (SELECT cid64 FROM res_cids)) / nullIf(count(), 0),
        2
      ) AS vwc_cids_not_in_res_ratio
    FROM valid_vwc_cids
  `;

  const results = await runQuery(gateBQuery, 'Calculating vwc CIDs not in resolutions (normalized)');
  const r = results[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE B RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total valid vwc CIDs:     ${r.total_vwc_cids.toLocaleString()}`);
  console.log(`  Not in resolutions:       ${r.vwc_cids_not_in_res.toLocaleString()}`);
  console.log(`  Not in res ratio:         ${r.vwc_cids_not_in_res_ratio}%`);
  console.log(`  Threshold:                <= 5%`);

  if (r.vwc_cids_not_in_res_ratio <= 5) {
    console.log(`\n  ✅ PASS: ${r.vwc_cids_not_in_res_ratio}% <= 5%`);
  } else {
    console.log(`\n  ❌ FAIL: ${r.vwc_cids_not_in_res_ratio}% > 5%`);
  }

  return r;
}

async function getRowCounts() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('TABLE ROW COUNTS');
  console.log('═══════════════════════════════════════════════════════════');

  const countsQuery = `
    SELECT
      (SELECT count() FROM vw_trades_canonical) AS vwc_rows,
      (SELECT count() FROM trades_raw_enriched_final) AS trenf_rows,
      (SELECT count() FROM trade_direction_assignments) AS tda_rows
  `;

  const results = await runQuery(countsQuery, 'Getting table row counts');
  const r = results[0];

  console.log(`  vw_trades_canonical:              ${r.vwc_rows.toLocaleString()} rows`);
  console.log(`  trades_raw_enriched_final:        ${r.trenf_rows.toLocaleString()} rows`);
  console.log(`  trade_direction_assignments:      ${r.tda_rows.toLocaleString()} rows`);

  return r;
}

async function printFinalDecision(gateA: any, gateB: any) {
  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🎯 FINAL DECISION');
  console.log('═══════════════════════════════════════════════════════════');

  console.log('\nGate Results:');
  console.log(`  Gate A (missing tx overlap):      ${gateA.pct_in_vwc_missing_overlap}% (need >= 85%)`);
  console.log(`  Gate B (CIDs not in res):         ${gateB.vwc_cids_not_in_res_ratio}% (need <= 5%)`);

  const gateAPassed = gateA.pct_in_vwc_missing_overlap >= 85;
  const gateBPassed = gateB.vwc_cids_not_in_res_ratio <= 5;
  const bothPassed = gateAPassed && gateBPassed;

  console.log('\nGate Status:');
  console.log(`  Gate A: ${gateAPassed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Gate B: ${gateBPassed ? '✅ PASS' : '❌ FAIL'}`);

  console.log('\n═══════════════════════════════════════════════════════════');

  if (bothPassed) {
    console.log('✅ PROCEED WITH PHASE 1: UNION BUILD FROM EXISTING TABLES');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nNext steps:');
    console.log('  1. Run the Phase 1 build script to create fact_trades_v1');
    console.log('  2. Build from tmp_vwc_norm (base)');
    console.log('  3. Enrich from tmp_trenf_norm (with token decoding)');
    console.log('  4. Fill gaps from trade_direction_assignments');
    console.log('  5. Run coverage gates (min_top100_pct >= 90, p50_pct >= 95)');
    console.log('\n  Estimated timeline: 4-6 hours');
    console.log('  Cost: $0');
    console.log('  Expected coverage: 85-95%');
  } else {
    console.log('⚠️  SKIP PHASE 1, GO STRAIGHT TO PHASE 2: BLOCKCHAIN BACKFILL');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nReasons:');
    if (!gateAPassed) {
      console.log(`  ❌ Gate A failed: Only ${gateA.pct_in_vwc_missing_overlap}% coverage (need >= 85%)`);
    }
    if (!gateBPassed) {
      console.log(`  ❌ Gate B failed: ${gateB.vwc_cids_not_in_res_ratio}% CIDs missing (need <= 5%)`);
    }
    console.log('\nNext steps:');
    console.log('  1. Run blockchain backfill using eth_getLogs');
    console.log('  2. Use 16 parallel workers');
    console.log('  3. Stream inserts via HTTP');
    console.log('\n  Estimated timeline: 12-16 hours');
    console.log('  Cost: $50-200');
    console.log('  Expected coverage: 95-100%');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');

  return bothPassed;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔬 GATE 0 RETEST WITH NORMALIZATION FIX');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Implementing GPT\'s normalization fix:');
  console.log('  • tx_hash: plain 0x...66 lowercase');
  console.log('  • cid64: 64 hex chars lowercase, no 0x prefix');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // Create normalized views
    await createNormalizedViews();

    // Run Gate A
    const gateA = await runGateA();

    // Run Gate B
    const gateB = await runGateB();

    // Get row counts
    await getRowCounts();

    // Print final decision
    const shouldProceedPhase1 = await printFinalDecision(gateA, gateB);

    // Close connection
    await clickhouse.close();

    // Exit with appropriate code
    process.exit(shouldProceedPhase1 ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Fatal error during verification:', error);
    await clickhouse.close();
    process.exit(2);
  }
}

main();
