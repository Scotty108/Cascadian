#!/usr/bin/env npx tsx
/**
 * GATE 0 CORRECTED - FINAL VERSION
 *
 * GPT's corrected checks with:
 * 1. DISTINCT views (not row counts)
 * 2. Proper normalization: cid64 (64 hex lowercase, no 0x), tx66 (0x...66 lowercase)
 * 3. Fallback market_id mapping if direct CID join fails
 *
 * Decision criteria:
 * - Gate A >= 85% AND Gate B >= 90% → Phase 1
 * - Gate A >= 85% AND mapped >= 90% → Phase 1 with market mapping
 * - Otherwise → Phase 2 backfill
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

async function createDistinctViews() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 1: CREATE DISTINCT NORMALIZED VIEWS');
  console.log('═══════════════════════════════════════════════════════════');

  // Drop existing views
  console.log('\n🧹 Dropping existing views...');
  const viewsToDrop = ['_vwc_tx', '_raw_missing_tx', '_vwc_cid', '_res_cid', '_market_map', '_vwc_market'];
  for (const view of viewsToDrop) {
    await clickhouse.command({ query: `DROP VIEW IF EXISTS ${view}` });
  }

  // 1. VWC distinct tx_hashes (0x...66 lowercase)
  console.log('\n📊 Creating _vwc_tx (distinct tx from vw_trades_canonical)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _vwc_tx AS
      SELECT DISTINCT lower(replaceRegexpAll(transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx66
      FROM vw_trades_canonical
      WHERE transaction_hash != ''
    `
  });
  console.log('  ✅ _vwc_tx created');

  // 2. Raw missing tx_hashes (distinct)
  console.log('\n📊 Creating _raw_missing_tx (distinct missing tx from trades_raw)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _raw_missing_tx AS
      SELECT DISTINCT lower(replaceRegexpAll(transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx66
      FROM trades_raw
      WHERE condition_id = '' OR condition_id = concat('0x', repeat('0', 64))
    `
  });
  console.log('  ✅ _raw_missing_tx created');

  // 3. VWC distinct condition_ids (64 hex lowercase, no 0x)
  console.log('\n📊 Creating _vwc_cid (distinct cid64 from vw_trades_canonical)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _vwc_cid AS
      SELECT DISTINCT lpad(lower(replaceAll(condition_id_norm, '0x', '')), 64, '0') AS cid64
      FROM vw_trades_canonical
      WHERE condition_id_norm != '' AND condition_id_norm IS NOT NULL
    `
  });
  console.log('  ✅ _vwc_cid created');

  // 4. Resolutions distinct condition_ids
  console.log('\n📊 Creating _res_cid (distinct cid64 from market_resolutions_final)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _res_cid AS
      SELECT DISTINCT lpad(lower(replaceAll(condition_id_norm, '0x', '')), 64, '0') AS cid64
      FROM market_resolutions_final
      WHERE condition_id_norm IS NOT NULL AND condition_id_norm != ''
    `
  });
  console.log('  ✅ _res_cid created');

  // 5. Market ID to CID mapping
  console.log('\n📊 Creating _market_map (market_id → cid64 mapping)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _market_map AS
      SELECT DISTINCT
        lower(replaceAll(market_id, '0x', '')) AS market_key,
        lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS cid64
      FROM market_id_mapping
      WHERE condition_id IS NOT NULL AND condition_id != ''
    `
  });
  console.log('  ✅ _market_map created');

  // 6. VWC distinct market_ids
  console.log('\n📊 Creating _vwc_market (distinct market keys from vw_trades_canonical)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _vwc_market AS
      SELECT DISTINCT lower(replaceAll(market_id_norm, '0x', '')) AS market_key
      FROM vw_trades_canonical
      WHERE market_id_norm IS NOT NULL AND market_id_norm != ''
    `
  });
  console.log('  ✅ _vwc_market created');

  console.log('\n✅ All distinct views created successfully');
}

async function runGateA() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE A: MISSING TX OVERLAP (DISTINCT COUNTS)');
  console.log('═══════════════════════════════════════════════════════════');

  const query = `
    WITH
      (SELECT count() FROM _raw_missing_tx) AS missing_cnt,
      (SELECT count() FROM _vwc_tx) AS vwc_cnt,
      (SELECT count() FROM _raw_missing_tx m INNER JOIN _vwc_tx v USING(tx66)) AS overlap_cnt
    SELECT
      missing_cnt,
      vwc_cnt,
      overlap_cnt,
      round(100.0 * overlap_cnt / nullIf(missing_cnt, 0), 2) AS pct_in_vwc_missing_overlap
  `;

  const results = await runQuery(query, 'Calculating distinct tx overlap');
  const r = results[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE A RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Distinct missing txs:     ${r.missing_cnt.toLocaleString()}`);
  console.log(`  Distinct vwc txs:         ${r.vwc_cnt.toLocaleString()}`);
  console.log(`  Overlap:                  ${r.overlap_cnt.toLocaleString()}`);
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
  console.log('GATE B: CID OVERLAP (DISTINCT COUNTS)');
  console.log('═══════════════════════════════════════════════════════════');

  const query = `
    WITH
      (SELECT count() FROM _vwc_cid) AS vwc_cids,
      (SELECT count() FROM _res_cid) AS res_cids,
      (SELECT count() FROM _vwc_cid v INNER JOIN _res_cid r USING(cid64)) AS overlap
    SELECT
      vwc_cids,
      res_cids,
      overlap,
      round(100.0 * overlap / nullIf(res_cids, 0), 2) AS pct_res_in_vwc,
      round(100.0 * overlap / nullIf(vwc_cids, 0), 2) AS pct_vwc_in_res
  `;

  const results = await runQuery(query, 'Calculating distinct CID overlap');
  const r = results[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE B RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Distinct vwc CIDs:        ${r.vwc_cids.toLocaleString()}`);
  console.log(`  Distinct res CIDs:        ${r.res_cids.toLocaleString()}`);
  console.log(`  Overlap:                  ${r.overlap.toLocaleString()}`);
  console.log(`  Res in VWC:               ${r.pct_res_in_vwc}%`);
  console.log(`  VWC in Res:               ${r.pct_vwc_in_res}%`);
  console.log(`  Threshold:                >= 90%`);

  if (r.pct_res_in_vwc >= 90) {
    console.log(`\n  ✅ PASS: ${r.pct_res_in_vwc}% >= 90%`);
  } else {
    console.log(`\n  ❌ FAIL: ${r.pct_res_in_vwc}% < 90%`);
  }

  return r;
}

async function runMarketMappingFallback() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('FALLBACK: MARKET ID MAPPING');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Testing if market_id mapping can recover CID coverage...');

  const query = `
    WITH mapped AS (
      SELECT DISTINCT m.cid64
      FROM _vwc_market v
      INNER JOIN _market_map m USING(market_key)
    )
    SELECT
      (SELECT count() FROM mapped) AS mapped_cids,
      (SELECT count() FROM mapped m INNER JOIN _res_cid r USING(cid64)) AS mapped_in_res,
      round(100.0 * mapped_in_res / nullIf(mapped_cids, 0), 2) AS pct_mapped_cids_in_res
  `;

  const results = await runQuery(query, 'Calculating market mapping coverage');
  const r = results[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('MARKET MAPPING RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Mapped CIDs:              ${r.mapped_cids.toLocaleString()}`);
  console.log(`  Mapped in resolutions:    ${r.mapped_in_res.toLocaleString()}`);
  console.log(`  Coverage:                 ${r.pct_mapped_cids_in_res}%`);
  console.log(`  Threshold:                >= 90%`);

  if (r.pct_mapped_cids_in_res >= 90) {
    console.log(`\n  ✅ PASS: ${r.pct_mapped_cids_in_res}% >= 90%`);
  } else {
    console.log(`\n  ❌ FAIL: ${r.pct_mapped_cids_in_res}% < 90%`);
  }

  return r;
}

async function printFinalDecision(gateA: any, gateB: any, marketMapping: any) {
  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🎯 FINAL DECISION');
  console.log('═══════════════════════════════════════════════════════════');

  console.log('\n📊 THE FOUR NUMBERS:');
  console.log(`  1. pct_in_vwc_missing_overlap:    ${gateA.pct_in_vwc_missing_overlap}%`);
  console.log(`  2. pct_res_in_vwc:                ${gateB.pct_res_in_vwc}%`);
  console.log(`  3. pct_vwc_in_res:                ${gateB.pct_vwc_in_res}%`);
  console.log(`  4. pct_mapped_cids_in_res:        ${marketMapping.pct_mapped_cids_in_res}%`);

  const gateAPassed = gateA.pct_in_vwc_missing_overlap >= 85;
  const gateBPassed = gateB.pct_res_in_vwc >= 90;
  const marketMappingPassed = marketMapping.pct_mapped_cids_in_res >= 90;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE STATUS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Gate A (tx overlap):      ${gateAPassed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Gate B (CID overlap):     ${gateBPassed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Market mapping fallback:  ${marketMappingPassed ? '✅ PASS' : '❌ FAIL'}`);

  console.log('\n═══════════════════════════════════════════════════════════');

  let decision = '';
  let shouldProceedPhase1 = false;

  if (gateAPassed && gateBPassed) {
    decision = '✅ PROCEED WITH PHASE 1: DIRECT CID JOIN';
    shouldProceedPhase1 = true;
    console.log(decision);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nStrategy: Build fact_trades_v1 using direct condition_id_norm joins');
    console.log('\nNext steps:');
    console.log('  1. Build from vw_trades_canonical (base, 157M rows)');
    console.log('  2. Enrich from trades_raw_enriched_final (token decoding)');
    console.log('  3. Fill gaps from trade_direction_assignments');
    console.log('  4. Run coverage gates (min_top100_pct >= 90, p50_pct >= 95)');
    console.log('\n  Timeline: 4-6 hours');
    console.log('  Cost: $0');
    console.log('  Expected coverage: 85-95%');
  } else if (gateAPassed && marketMappingPassed) {
    decision = '✅ PROCEED WITH PHASE 1: MARKET ID MAPPING STRATEGY';
    shouldProceedPhase1 = true;
    console.log(decision);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nStrategy: Use market_id_norm → condition_id mapping');
    console.log('\nNext steps:');
    console.log('  1. Join vw_trades_canonical to market_id_mapping');
    console.log('  2. Map market_ids to condition_ids');
    console.log('  3. Enrich and fill gaps as above');
    console.log('  4. Run coverage gates');
    console.log('\n  Timeline: 4-6 hours');
    console.log('  Cost: $0');
    console.log('  Expected coverage: 85-95%');
  } else {
    decision = '⚠️  SKIP PHASE 1, GO STRAIGHT TO PHASE 2: BLOCKCHAIN BACKFILL';
    shouldProceedPhase1 = false;
    console.log(decision);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nReasons:');
    if (!gateAPassed) {
      console.log(`  ❌ Gate A failed: Only ${gateA.pct_in_vwc_missing_overlap}% tx coverage (need >= 85%)`);
    }
    if (!gateBPassed && !marketMappingPassed) {
      console.log(`  ❌ Gate B failed: Only ${gateB.pct_res_in_vwc}% CID coverage (need >= 90%)`);
      console.log(`  ❌ Market mapping failed: Only ${marketMapping.pct_mapped_cids_in_res}% coverage (need >= 90%)`);
    }
    console.log('\nNext steps:');
    console.log('  1. Run blockchain backfill using eth_getLogs');
    console.log('  2. Fetch ERC1155 transfer events from Polygon');
    console.log('  3. Decode token_ids to (condition_id, outcome_index)');
    console.log('  4. Use 16 parallel workers with HTTP streaming');
    console.log('\n  Timeline: 12-16 hours');
    console.log('  Cost: $50-200');
    console.log('  Expected coverage: 95-100%');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');

  return shouldProceedPhase1;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔬 GATE 0 CORRECTED - FINAL VERSION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('GPT\'s corrected checks with DISTINCT counts and proper normalization');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // Step 1: Create distinct normalized views
    await createDistinctViews();

    // Step 2: Run Gate A (distinct tx overlap)
    const gateA = await runGateA();

    // Step 3: Run Gate B (distinct CID overlap)
    const gateB = await runGateB();

    // Step 4: Run market mapping fallback (always run to get all 4 numbers)
    const marketMapping = await runMarketMappingFallback();

    // Step 5: Print final decision
    const shouldProceedPhase1 = await printFinalDecision(gateA, gateB, marketMapping);

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
