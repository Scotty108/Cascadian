#!/usr/bin/env npx tsx
/**
 * TARGETED CID REPAIR - USE EXISTING ON-CHAIN DATA
 *
 * GPT's directive: Repair the 60.79% gap (87K residual CIDs) using existing tables.
 * No blockchain backfill yet - exhaust what we have first.
 *
 * Strategy:
 * 1. Canonicalize CIDs (0x prefix, 64 hex lowercase)
 * 2. Find residual resolved CIDs not in vwc
 * 3. Map residual → tx via ERC1155 transfers + token decoding
 * 4. Build fact_trades_clean with patched CIDs
 * 5. Recompute gates
 *
 * Target: Gate B >= 85%
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
  clickhouse_settings: {
    send_progress_in_http_headers: 0,
    wait_end_of_query: 1,
    enable_http_compression: 1,
  }
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

async function step1_CanonicalizeCIDs() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 1: CANONICALIZE CIDS (0x + 64 hex lowercase)');
  console.log('═══════════════════════════════════════════════════════════');

  // Drop existing views
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _res_cid' });
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _vwc_cid' });

  // Resolutions CIDs
  console.log('\n📊 Creating _res_cid...');
  await clickhouse.command({
    query: `
      CREATE VIEW _res_cid AS
      SELECT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm), '0x', ''), 64, '0'))) AS cid
      FROM market_resolutions_final
      WHERE condition_id_norm != ''
    `
  });
  console.log('  ✅ _res_cid created');

  // VWC CIDs with transaction context
  console.log('\n📊 Creating _vwc_cid...');
  await clickhouse.command({
    query: `
      CREATE VIEW _vwc_cid AS
      SELECT DISTINCT
        transaction_hash AS tx_hash,
        lower(concat('0x', lpad(replaceOne(lower(condition_id_norm), '0x', ''), 64, '0'))) AS cid
      FROM vw_trades_canonical
      WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0', 64)))
    `
  });
  console.log('  ✅ _vwc_cid created');

  const counts = await runQuery(`
    SELECT
      (SELECT count() FROM _res_cid) AS res_cids,
      (SELECT count() FROM _vwc_cid) AS vwc_pairs,
      (SELECT count() FROM (SELECT DISTINCT cid FROM _vwc_cid)) AS vwc_cids
  `, 'Counting canonicalized CIDs');

  const c = counts[0];
  console.log(`\n  Resolutions CIDs:     ${c.res_cids.toLocaleString()}`);
  console.log(`  VWC tx-CID pairs:     ${c.vwc_pairs.toLocaleString()}`);
  console.log(`  VWC distinct CIDs:    ${c.vwc_cids.toLocaleString()}`);
}

async function step2_FindResidualCIDs() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 2: FIND RESIDUAL RESOLVED CIDS');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS _residual_cids' });

  console.log('\n📊 Creating _residual_cids (resolved CIDs not in vwc)...');
  await clickhouse.command({
    query: `
      CREATE TABLE _residual_cids ENGINE = Memory AS
      SELECT cid FROM _res_cid
      WHERE cid NOT IN (SELECT cid FROM _vwc_cid)
    `
  });

  const count = await runQuery('SELECT count() AS cnt FROM _residual_cids', 'Counting residual CIDs');
  console.log(`\n  ✅ Residual CIDs to recover: ${count[0].cnt.toLocaleString()}`);

  return count[0].cnt;
}

async function step3_BuildTokenCIDMap() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 3: BUILD TOKEN → CID MAP');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _token_cid' });

  console.log('\n📊 Creating _token_cid from ctf_token_map + erc1155_condition_map...');
  await clickhouse.command({
    query: `
      CREATE VIEW _token_cid AS
      SELECT
        lower(token_id) AS token_str,
        lower(concat('0x', lpad(replaceOne(lower(condition_id_norm), '0x', ''), 64, '0'))) AS cid
      FROM ctf_token_map
      WHERE condition_id_norm IS NOT NULL AND condition_id_norm != ''
      UNION ALL
      SELECT
        lower(token_id) AS token_str,
        lower(concat('0x', lpad(replaceOne(lower(condition_id), '0x', ''), 64, '0'))) AS cid
      FROM erc1155_condition_map
      WHERE condition_id IS NOT NULL AND condition_id != ''
    `
  });

  const count = await runQuery('SELECT count() AS cnt FROM _token_cid', 'Counting token→CID mappings');
  console.log(`\n  ✅ Token→CID mappings: ${count[0].cnt.toLocaleString()}`);
}

async function step4_MapViaERC1155() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 4: MAP RESIDUAL CIDS VIA ERC1155 TRANSFERS');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS _tx_cid_from_erc1155' });

  console.log('\n📊 Mapping residual CIDs to transactions via erc1155_transfers...');
  await clickhouse.command({
    query: `
      CREATE TABLE _tx_cid_from_erc1155 ENGINE = Memory AS
      SELECT DISTINCT e.tx_hash, t.cid
      FROM erc1155_transfers e
      JOIN _token_cid t ON lower(e.token_id) = t.token_str
      WHERE t.cid IN (SELECT cid FROM _residual_cids)
    `
  });

  const count = await runQuery('SELECT count() AS cnt FROM _tx_cid_from_erc1155', 'Counting ERC1155 repair pairs');
  console.log(`\n  ✅ Repair pairs from ERC1155: ${count[0].cnt.toLocaleString()}`);

  return count[0].cnt;
}

async function step5_MapViaTokenDecoding() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 5: MAP RESIDUAL CIDS VIA TOKEN DECODING');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS _tx_cid_from_tokens' });

  console.log('\n📊 Decoding token_... values in trades_raw_enriched_final...');
  await clickhouse.command({
    query: `
      CREATE TABLE _tx_cid_from_tokens ENGINE = Memory AS
      WITH src AS (
        SELECT
          transaction_hash AS tx_hash,
          replaceAll(condition_id, 'token_', '') AS token_str
        FROM trades_raw_enriched_final
        WHERE startsWith(condition_id, 'token_')
      ),
      decoded AS (
        SELECT
          tx_hash,
          -- condition_id is token_id >> 8 (divide by 256 = remove last 2 hex digits)
          -- Token is 66 chars total (0x + 64 hex). Remove last 2 hex digits, pad back to 64.
          concat('0x', lpad(lower(substring(replaceOne(token_str, '0x', ''), 1, length(replaceOne(token_str, '0x', '')) - 2)), 64, '0')) AS cid
        FROM src
        WHERE token_str != '' AND token_str IS NOT NULL AND length(replaceOne(token_str, '0x', '')) > 2
      )
      SELECT DISTINCT tx_hash, lower(cid) AS cid
      FROM decoded
      WHERE cid IN (SELECT cid FROM _residual_cids)
    `
  });

  const count = await runQuery('SELECT count() AS cnt FROM _tx_cid_from_tokens', 'Counting token decode repair pairs');
  console.log(`\n  ✅ Repair pairs from token decoding: ${count[0].cnt.toLocaleString()}`);

  return count[0].cnt;
}

async function step6_UnionRepairPairs() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 6: UNION REPAIR PAIRS (KEEP ONLY VWC TXS)');
  console.log('═══════════════════════════════════════════════════════════');

  // Create VWC tx reference
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS _vwc_tx' });
  console.log('\n📊 Creating _vwc_tx reference...');
  await clickhouse.command({
    query: `
      CREATE TABLE _vwc_tx ENGINE = Memory AS
      SELECT DISTINCT transaction_hash AS tx_hash
      FROM vw_trades_canonical
    `
  });

  const vwcTxCount = await runQuery('SELECT count() AS cnt FROM _vwc_tx', 'Counting VWC transactions');
  console.log(`  ✅ VWC distinct txs: ${vwcTxCount[0].cnt.toLocaleString()}`);

  // Union all repair pairs
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS _repair_pairs' });
  console.log('\n📊 Creating _repair_pairs (union of all sources)...');
  await clickhouse.command({
    query: `
      CREATE TABLE _repair_pairs ENGINE = Memory AS
      SELECT DISTINCT tx_hash, cid FROM _tx_cid_from_erc1155
      UNION ALL
      SELECT DISTINCT tx_hash, cid FROM _tx_cid_from_tokens
    `
  });

  const repairCount = await runQuery('SELECT count() AS cnt FROM _repair_pairs', 'Counting union repair pairs');
  console.log(`  Total repair pairs: ${repairCount[0].cnt.toLocaleString()}`);

  // Filter to only VWC txs
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS _repair_pairs_vwc' });
  console.log('\n📊 Creating _repair_pairs_vwc (filtered to VWC txs)...');
  await clickhouse.command({
    query: `
      CREATE TABLE _repair_pairs_vwc ENGINE = Memory AS
      SELECT DISTINCT r.tx_hash, r.cid
      FROM _repair_pairs r
      WHERE r.tx_hash IN (SELECT tx_hash FROM _vwc_tx)
    `
  });

  const vwcRepairCount = await runQuery('SELECT count() AS cnt FROM _repair_pairs_vwc', 'Counting VWC-filtered repair pairs');
  console.log(`  ✅ Repair pairs in VWC: ${vwcRepairCount[0].cnt.toLocaleString()}`);

  return vwcRepairCount[0].cnt;
}

async function step7_BuildFactTradesClean() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 7: BUILD fact_trades_clean WITH PATCHED CIDS');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS fact_trades_clean' });

  // Base table from VWC with existing CIDs
  console.log('\n📊 Creating fact_trades_clean (base from vwc)...');
  await clickhouse.command({
    query: `
      CREATE TABLE fact_trades_clean
      ENGINE = ReplacingMergeTree
      ORDER BY (cid, tx_hash, wallet_address) AS
      SELECT
        v.transaction_hash AS tx_hash,
        v.timestamp AS block_time,
        lower(concat('0x', lpad(replaceOne(lower(v.condition_id_norm), '0x', ''), 64, '0'))) AS cid,
        v.outcome_index,
        v.wallet_address_norm AS wallet_address,
        v.trade_direction AS direction,
        v.shares,
        v.entry_price AS price,
        v.usd_value AS usdc_amount
      FROM vw_trades_canonical v
      WHERE v.condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0', 64)))
    `
  });

  const baseCount = await runQuery('SELECT count() AS cnt FROM fact_trades_clean', 'Counting base rows');
  console.log(`  Base rows: ${baseCount[0].cnt.toLocaleString()}`);

  // Patch with repair pairs
  console.log('\n📊 Inserting patched CIDs from repair pairs...');
  await clickhouse.command({
    query: `
      INSERT INTO fact_trades_clean
      SELECT
        v.transaction_hash,
        v.timestamp,
        r.cid,
        v.outcome_index,
        v.wallet_address_norm,
        v.trade_direction,
        v.shares,
        v.entry_price,
        v.usd_value
      FROM vw_trades_canonical v
      JOIN _repair_pairs_vwc r ON r.tx_hash = v.transaction_hash
      LEFT JOIN fact_trades_clean f ON f.tx_hash = v.transaction_hash AND f.cid = r.cid
      WHERE f.tx_hash IS NULL
    `
  });

  const totalCount = await runQuery('SELECT count() AS cnt FROM fact_trades_clean', 'Counting total rows after patch');
  const addedRows = totalCount[0].cnt - baseCount[0].cnt;
  console.log(`  Patched rows added: ${addedRows.toLocaleString()}`);
  console.log(`  ✅ Total rows: ${totalCount[0].cnt.toLocaleString()}`);

  // Check distinct CIDs added
  const cidStats = await runQuery(`
    SELECT
      (SELECT count() FROM (SELECT DISTINCT cid FROM fact_trades_clean)) AS total_cids,
      (SELECT count() FROM (SELECT DISTINCT cid FROM fact_trades_clean WHERE cid IN (SELECT cid FROM _residual_cids))) AS recovered_cids
  `, 'Counting CID recovery');

  const cs = cidStats[0];
  console.log(`\n  Total distinct CIDs:  ${cs.total_cids.toLocaleString()}`);
  console.log(`  Recovered CIDs:       ${cs.recovered_cids.toLocaleString()}`);

  return { addedRows, recoveredCids: cs.recovered_cids };
}

async function step8_RecomputeGates() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 8: RECOMPUTE GATES');
  console.log('═══════════════════════════════════════════════════════════');

  // Gate A
  console.log('\n🔍 Gate A: Missing tx coverage...');
  const gateAQuery = `
    WITH missing AS (
      SELECT DISTINCT transaction_hash AS tx
      FROM trades_raw
      WHERE (condition_id = '' OR condition_id = concat('0x', repeat('0', 64)))
        AND transaction_hash != ''
    ),
    covered AS (
      SELECT DISTINCT tx_hash AS tx FROM fact_trades_clean
    )
    SELECT
      count() AS missing_cnt,
      countIf(tx IN (SELECT tx FROM covered)) AS covered_cnt,
      round(100.0 * covered_cnt / nullIf(missing_cnt, 0), 2) AS pct_in_union_for_missing
    FROM missing
  `;

  const gateA = await runQuery(gateAQuery, 'Calculating Gate A');
  const a = gateA[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE A RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Missing txs:          ${a.missing_cnt.toLocaleString()}`);
  console.log(`  Covered:              ${a.covered_cnt.toLocaleString()}`);
  console.log(`  Coverage:             ${a.pct_in_union_for_missing}%`);
  console.log(`  Threshold:            >= 85%`);
  console.log(`  Status:               ${a.pct_in_union_for_missing >= 85 ? '✅ PASS' : '❌ FAIL'}`);

  // Gate B
  console.log('\n🔍 Gate B: Resolution CID coverage...');
  const gateBQuery = `
    WITH res AS (
      SELECT DISTINCT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm), '0x', ''), 64, '0'))) AS cid
      FROM market_resolutions_final
      WHERE condition_id_norm != ''
    ),
    fact AS (
      SELECT DISTINCT cid FROM fact_trades_clean
    )
    SELECT
      (SELECT count() FROM res) AS res_cids,
      (SELECT count() FROM fact) AS fact_cids,
      (SELECT count() FROM res WHERE cid IN (SELECT cid FROM fact)) AS overlap_cids,
      round(100.0 * overlap_cids / nullIf(res_cids, 0), 2) AS pct_res_covered_by_fact,
      round(100.0 * overlap_cids / nullIf(fact_cids, 0), 2) AS pct_fact_in_res
  `;

  const gateB = await runQuery(gateBQuery, 'Calculating Gate B');
  const b = gateB[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE B RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Resolutions CIDs:     ${b.res_cids.toLocaleString()}`);
  console.log(`  Fact CIDs:            ${b.fact_cids.toLocaleString()}`);
  console.log(`  Overlap:              ${b.overlap_cids.toLocaleString()}`);
  console.log(`  Res covered by fact:  ${b.pct_res_covered_by_fact}%`);
  console.log(`  Fact in res:          ${b.pct_fact_in_res}%`);
  console.log(`  Threshold:            >= 85%`);
  console.log(`  Status:               ${b.pct_res_covered_by_fact >= 85 ? '✅ PASS' : '❌ FAIL'}`);

  return { gateA: a, gateB: b };
}

async function step9_SampleRecoveredCIDs() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('SAMPLE: CIDS MOVED FROM RESIDUAL TO COVERED');
  console.log('═══════════════════════════════════════════════════════════');

  const sampleQuery = `
    SELECT DISTINCT cid
    FROM fact_trades_clean
    WHERE cid IN (SELECT cid FROM _residual_cids)
    LIMIT 25
  `;

  const samples = await runQuery(sampleQuery, 'Sampling recovered CIDs');

  console.log('\n25 CIDs that moved from residual to covered:');
  for (const row of samples) {
    console.log(`  ${row.cid}`);
  }
}

async function printFinalReport(
  residualCids: number,
  erc1155Pairs: number,
  tokenPairs: number,
  vwcRepairPairs: number,
  repairStats: any,
  gates: any
) {
  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 TARGETED CID REPAIR - FINAL REPORT');
  console.log('═══════════════════════════════════════════════════════════');

  console.log('\n🔢 REPAIR METRICS:');
  console.log(`  Initial residual CIDs:        ${residualCids.toLocaleString()}`);
  console.log(`  Repair pairs from ERC1155:    ${erc1155Pairs.toLocaleString()}`);
  console.log(`  Repair pairs from tokens:     ${tokenPairs.toLocaleString()}`);
  console.log(`  Total repair pairs (VWC):     ${vwcRepairPairs.toLocaleString()}`);
  console.log(`  Rows added to fact table:     ${repairStats.addedRows.toLocaleString()}`);
  console.log(`  Distinct CIDs recovered:      ${repairStats.recoveredCids.toLocaleString()}`);

  console.log('\n🎯 GATE RESULTS:');
  console.log(`  Gate A (tx coverage):         ${gates.gateA.pct_in_union_for_missing}%`);
  console.log(`  Gate B (CID coverage):        ${gates.gateB.pct_res_covered_by_fact}%`);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DECISION');
  console.log('═══════════════════════════════════════════════════════════');

  if (gates.gateB.pct_res_covered_by_fact >= 85) {
    console.log('\n✅ SUCCESS - GATE B >= 85%');
    console.log('\n➡️  READY TO PROMOTE fact_trades_clean AS SOURCE FOR PNL');
    console.log('\nNext steps:');
    console.log('  1. Use fact_trades_clean for P&L calculations');
    console.log('  2. No blockchain backfill needed');
    console.log('  3. Ship Phase 1');
  } else {
    const stillMissing = gates.gateB.res_cids - gates.gateB.overlap_cids;
    const missingPct = ((stillMissing / gates.gateB.res_cids) * 100).toFixed(2);

    console.log('\n⚠️  GATE B < 85% - TARGETED BACKFILL NEEDED');
    console.log(`\nStill missing: ${stillMissing.toLocaleString()} CIDs (${missingPct}% of resolutions)`);
    console.log('\nNext steps:');
    console.log('  1. Create _still_missing_cids table');
    console.log('  2. Run targeted eth_getLogs for CTF Exchange');
    console.log('  3. Filter to missing CIDs only');
    console.log('  4. Decode token_ids and patch fact_trades_clean');
    console.log('\n  Estimated timeline: 2-4 hours (targeted only)');
    console.log('  Estimated cost: $10-50');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔧 TARGETED CID REPAIR - EXISTING ON-CHAIN DATA ONLY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Goal: Lift Gate B from 39.21% → 85%+ using existing tables');
  console.log('No blockchain backfill yet - exhaust what we have first');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    await step1_CanonicalizeCIDs();
    const residualCids = await step2_FindResidualCIDs();
    await step3_BuildTokenCIDMap();
    const erc1155Pairs = await step4_MapViaERC1155();
    const tokenPairs = await step5_MapViaTokenDecoding();
    const vwcRepairPairs = await step6_UnionRepairPairs();
    const repairStats = await step7_BuildFactTradesClean();
    const gates = await step8_RecomputeGates();
    await step9_SampleRecoveredCIDs();

    await printFinalReport(
      residualCids,
      erc1155Pairs,
      tokenPairs,
      vwcRepairPairs,
      repairStats,
      gates
    );

    await clickhouse.close();
    process.exit(gates.gateB.pct_res_covered_by_fact >= 85 ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    await clickhouse.close();
    process.exit(2);
  }
}

main();
