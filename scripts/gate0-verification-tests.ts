#!/usr/bin/env npx tsx
/**
 * GATE 0: VERIFICATION TESTS
 *
 * ChatGPT's reality checks to prove whether vw_trades_canonical
 * covers the "missing" transactions before committing to UNION vs backfill.
 *
 * Tests:
 * - G0.1: Format hygiene (tx_hash and condition_id formats)
 * - G0.2: Resolutions joinability (can vwc join to market_resolutions_final?)
 * - G0.3: Missing coverage sample (do vwc txs cover the "missing" 28.4M?)
 *
 * Decision criteria: If G0.3 shows >= 85% coverage, do UNION build. Else backfill.
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

// Load environment variables from .env.local
config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
  metrics?: Record<string, any>;
}

const results: TestResult[] = [];

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

async function testG01_FormatHygiene() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('G0.1: FORMAT HYGIENE');
  console.log('═══════════════════════════════════════════════════════════');

  // Test transaction hash formats
  const txFormatQuery = `
    SELECT
      'vwc' AS source,
      countIf(transaction_hash NOT ILIKE '0x%') AS bad_tx_format,
      count() AS total_rows
    FROM vw_trades_canonical
    UNION ALL
    SELECT
      'trenf' AS source,
      countIf(transaction_hash NOT ILIKE '0x%') AS bad_tx_format,
      count() AS total_rows
    FROM trades_raw_enriched_final
  `;

  const txResults = await runQuery(txFormatQuery, 'Checking tx_hash format hygiene');

  console.log('\nTransaction Hash Format Results:');
  for (const row of txResults) {
    console.log(`  ${row.source}: ${row.bad_tx_format.toLocaleString()} bad formats out of ${row.total_rows.toLocaleString()} rows`);

    const pctBad = (row.bad_tx_format / row.total_rows) * 100;
    if (pctBad > 1) {
      results.push({
        test: `G0.1 - ${row.source} tx_hash format`,
        status: 'FAIL',
        details: `${pctBad.toFixed(2)}% of tx_hashes have bad format (not 0x-prefixed)`,
        metrics: { bad_count: row.bad_tx_format, total: row.total_rows }
      });
    } else if (pctBad > 0.1) {
      results.push({
        test: `G0.1 - ${row.source} tx_hash format`,
        status: 'WARN',
        details: `${pctBad.toFixed(2)}% of tx_hashes have bad format`,
        metrics: { bad_count: row.bad_tx_format, total: row.total_rows }
      });
    } else {
      results.push({
        test: `G0.1 - ${row.source} tx_hash format`,
        status: 'PASS',
        details: `Only ${pctBad.toFixed(4)}% bad formats - acceptable`,
        metrics: { bad_count: row.bad_tx_format, total: row.total_rows }
      });
    }
  }

  // Test condition_id format in vw_trades_canonical
  const cidFormatQuery = `
    SELECT
      countIf(length(condition_id_norm) != 66 OR condition_id_norm NOT ILIKE '0x%') AS bad_cid_format,
      countIf(condition_id_norm = concat('0x', repeat('0', 64))) AS zero_cid,
      countIf(condition_id_norm != '' AND condition_id_norm != concat('0x', repeat('0', 64))
              AND length(condition_id_norm) = 66 AND condition_id_norm ILIKE '0x%') AS valid_cid,
      count() AS total_rows
    FROM vw_trades_canonical
  `;

  const cidResults = await runQuery(cidFormatQuery, 'Checking condition_id format in vw_trades_canonical');
  const cid = cidResults[0];

  console.log('\nCondition ID Format Results (vw_trades_canonical):');
  console.log(`  Bad format:  ${cid.bad_cid_format.toLocaleString()}`);
  console.log(`  Zero CIDs:   ${cid.zero_cid.toLocaleString()}`);
  console.log(`  Valid CIDs:  ${cid.valid_cid.toLocaleString()}`);
  console.log(`  Total rows:  ${cid.total_rows.toLocaleString()}`);

  const validPct = (cid.valid_cid / cid.total_rows) * 100;
  const badPct = (cid.bad_cid_format / cid.total_rows) * 100;

  if (badPct > 5) {
    results.push({
      test: 'G0.1 - vwc condition_id format',
      status: 'FAIL',
      details: `${badPct.toFixed(2)}% of condition_ids have bad format (> 5% threshold)`,
      metrics: cid
    });
  } else if (validPct < 50) {
    results.push({
      test: 'G0.1 - vwc condition_id format',
      status: 'WARN',
      details: `Only ${validPct.toFixed(2)}% valid condition_ids`,
      metrics: cid
    });
  } else {
    results.push({
      test: 'G0.1 - vwc condition_id format',
      status: 'PASS',
      details: `${validPct.toFixed(2)}% valid condition_ids, ${badPct.toFixed(2)}% bad format`,
      metrics: cid
    });
  }
}

async function testG02_ResolutionsJoinability() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('G0.2: RESOLUTIONS JOINABILITY');
  console.log('═══════════════════════════════════════════════════════════');

  const joinabilityQuery = `
    WITH vwc_cids AS (
      SELECT DISTINCT condition_id_norm
      FROM vw_trades_canonical
      WHERE condition_id_norm != ''
        AND condition_id_norm != concat('0x', repeat('0', 64))
        AND length(condition_id_norm) = 66
    ),
    res_cids AS (
      SELECT DISTINCT condition_id_norm
      FROM market_resolutions_final
    ),
    joinable AS (
      SELECT condition_id_norm
      FROM vwc_cids
      WHERE condition_id_norm IN (SELECT condition_id_norm FROM res_cids)
    )
    SELECT
      (SELECT count() FROM vwc_cids) AS vwc_unique_cids,
      (SELECT count() FROM res_cids) AS res_unique_cids,
      (SELECT count() FROM joinable) AS joinable_cids,
      (SELECT count() FROM vwc_cids) - (SELECT count() FROM joinable) AS vwc_cids_not_in_res
  `;

  const joinResults = await runQuery(joinabilityQuery, 'Checking vwc → market_resolutions_final joinability');
  const j = joinResults[0];

  console.log('\nJoinability Results:');
  console.log(`  VWC unique CIDs:          ${j.vwc_unique_cids.toLocaleString()}`);
  console.log(`  Resolutions unique CIDs:  ${j.res_unique_cids.toLocaleString()}`);
  console.log(`  Joinable CIDs:            ${j.joinable_cids.toLocaleString()}`);
  console.log(`  VWC CIDs not in res:      ${j.vwc_cids_not_in_res.toLocaleString()}`);

  const joinPct = (j.joinable_cids / j.vwc_unique_cids) * 100;
  const missingPct = (j.vwc_cids_not_in_res / j.vwc_unique_cids) * 100;

  console.log(`\n  Join rate: ${joinPct.toFixed(2)}%`);
  console.log(`  Missing:   ${missingPct.toFixed(2)}%`);

  // Diagnostic: If join rate is 0%, investigate why
  if (joinPct === 0) {
    console.log('\n⚠️  DIAGNOSTIC: 0% join rate detected, investigating...');

    const diagQuery = `
      SELECT
        'vwc_sample' AS source,
        condition_id_norm AS sample_cid
      FROM vw_trades_canonical
      WHERE condition_id_norm != ''
        AND condition_id_norm != concat('0x', repeat('0', 64))
        AND length(condition_id_norm) = 66
      LIMIT 5
      UNION ALL
      SELECT
        'res_sample' AS source,
        condition_id_norm AS sample_cid
      FROM market_resolutions_final
      LIMIT 5
    `;

    const diagResults = await runQuery(diagQuery, 'Sampling CIDs from both tables');
    console.log('\nSample CIDs:');
    for (const row of diagResults) {
      console.log(`  ${row.source}: ${row.sample_cid}`);
    }
  }

  if (missingPct > 20) {
    results.push({
      test: 'G0.2 - Resolutions joinability',
      status: 'FAIL',
      details: `${missingPct.toFixed(2)}% of vwc CIDs cannot join to resolutions (> 20% threshold)`,
      metrics: j
    });
  } else if (missingPct > 10) {
    results.push({
      test: 'G0.2 - Resolutions joinability',
      status: 'WARN',
      details: `${missingPct.toFixed(2)}% of vwc CIDs cannot join to resolutions`,
      metrics: j
    });
  } else {
    results.push({
      test: 'G0.2 - Resolutions joinability',
      status: 'PASS',
      details: `${joinPct.toFixed(2)}% of vwc CIDs join successfully to resolutions`,
      metrics: j
    });
  }
}

async function testG03_MissingCoverageSample() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('G0.3: MISSING COVERAGE SAMPLE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('This is the CRITICAL test for the UNION vs backfill decision.');

  // Step 1: Drop tmp table if exists
  console.log('\n📦 Preparing temporary table...');
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS tmp_missing_sample'
  });

  // Step 2: Create sample of "missing" txs from trades_raw
  console.log('📊 Sampling 1M "missing" transactions from trades_raw...');
  const createSampleQuery = `
    CREATE TABLE tmp_missing_sample
    ENGINE = MergeTree()
    ORDER BY tx_hash
    AS
    SELECT DISTINCT
      lower(replaceRegexpAll(transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx_hash
    FROM trades_raw
    WHERE transaction_hash != ''
      AND transaction_hash ILIKE 'txn-0x%'
      AND (
        market_id = ''
        OR market_id = '12'
        OR market_id = concat('0x', repeat('0', 64))
      )
    LIMIT 1000000
  `;

  await clickhouse.command({ query: createSampleQuery });

  // Count the sample
  const sampleCountQuery = 'SELECT count() AS n FROM tmp_missing_sample';
  const sampleCount = await runQuery(sampleCountQuery, 'Counting sampled missing txs');
  const nMissing = sampleCount[0].n;

  console.log(`  ✅ Sampled ${nMissing.toLocaleString()} missing transactions`);

  // Step 3: Check overlap with vw_trades_canonical
  console.log('\n🔗 Checking overlap with vw_trades_canonical...');
  const overlapQuery = `
    SELECT
      (SELECT count() FROM tmp_missing_sample) AS n_missing,
      (
        SELECT count()
        FROM tmp_missing_sample s
        INNER JOIN vw_trades_canonical v
          ON lower(v.transaction_hash) = s.tx_hash
      ) AS in_vwc
  `;

  const overlapResults = await runQuery(overlapQuery, 'Calculating vwc coverage of missing txs');
  const o = overlapResults[0];

  const coveragePct = (o.in_vwc / o.n_missing) * 100;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🎯 CRITICAL DECISION POINT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Missing txs sampled:      ${o.n_missing.toLocaleString()}`);
  console.log(`  Found in vwc:             ${o.in_vwc.toLocaleString()}`);
  console.log(`  Coverage:                 ${coveragePct.toFixed(2)}%`);
  console.log(`  Threshold:                85%`);

  if (coveragePct >= 85) {
    console.log('\n  ✅ PASS: Coverage >= 85% → PROCEED WITH UNION BUILD');
    results.push({
      test: 'G0.3 - Missing coverage sample (DECISION)',
      status: 'PASS',
      details: `${coveragePct.toFixed(2)}% coverage of missing txs → UNION build viable`,
      metrics: { n_missing: o.n_missing, in_vwc: o.in_vwc, coverage_pct: coveragePct }
    });
  } else {
    console.log('\n  ❌ FAIL: Coverage < 85% → GO STRAIGHT TO BLOCKCHAIN BACKFILL');
    results.push({
      test: 'G0.3 - Missing coverage sample (DECISION)',
      status: 'FAIL',
      details: `Only ${coveragePct.toFixed(2)}% coverage → UNION insufficient, need blockchain backfill`,
      metrics: { n_missing: o.n_missing, in_vwc: o.in_vwc, coverage_pct: coveragePct }
    });
  }

  // Cleanup
  console.log('\n🧹 Cleaning up temporary table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS tmp_missing_sample' });

  return coveragePct;
}

async function printFinalReport() {
  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 GATE 0 VERIFICATION FINAL REPORT');
  console.log('═══════════════════════════════════════════════════════════');

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const result of results) {
    const icon = result.status === 'PASS' ? '✅' : result.status === 'WARN' ? '⚠️' : '❌';
    console.log(`\n${icon} ${result.test}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   ${result.details}`);

    if (result.status === 'PASS') passCount++;
    else if (result.status === 'WARN') warnCount++;
    else failCount++;
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✅ Passed: ${passCount}`);
  console.log(`  ⚠️  Warnings: ${warnCount}`);
  console.log(`  ❌ Failed: ${failCount}`);

  // Find the G0.3 result for the final decision
  const g03Result = results.find(r => r.test.includes('G0.3'));

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🎯 FINAL RECOMMENDATION');
  console.log('═══════════════════════════════════════════════════════════');

  if (g03Result?.status === 'PASS') {
    console.log('\n  ✅ PROCEED WITH PHASE 1: UNION BUILD FROM EXISTING TABLES');
    console.log('     • vw_trades_canonical has sufficient coverage');
    console.log('     • Estimated timeline: 4-6 hours');
    console.log('     • Estimated cost: $0');
    console.log('     • Expected coverage: 85-95%');
    console.log('\n  📋 Next step: Run the Phase 1 UNION build script');
  } else {
    console.log('\n  ⚠️  SKIP PHASE 1, GO STRAIGHT TO PHASE 2: BLOCKCHAIN BACKFILL');
    console.log('     • vw_trades_canonical has insufficient coverage');
    console.log('     • Estimated timeline: 12-16 hours');
    console.log('     • Estimated cost: $50-200');
    console.log('     • Expected coverage: 95-100%');
    console.log('\n  📋 Next step: Run the blockchain backfill script (eth_getLogs)');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔬 GATE 0: VERIFICATION TESTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Testing whether vw_trades_canonical covers the "missing" txs');
  console.log('before committing to UNION build vs blockchain backfill.');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // Run all tests
    await testG01_FormatHygiene();
    await testG02_ResolutionsJoinability();
    const coveragePct = await testG03_MissingCoverageSample();

    // Print final report
    await printFinalReport();

    // Close connection
    await clickhouse.close();

    // Exit with appropriate code
    const g03Result = results.find(r => r.test.includes('G0.3'));
    process.exit(g03Result?.status === 'PASS' ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Fatal error during verification:', error);
    await clickhouse.close();
    process.exit(2);
  }
}

main();
