#!/usr/bin/env npx tsx
/**
 * UNION MAP RECOVERY - EXHAUST EXISTING DATA BEFORE BACKFILL
 *
 * GPT's strategy: Gate A showed 100% tx coverage. Problem is CID mapping, not missing txs.
 * Build a union CID map from existing data sources:
 * 1. Via VWC market_id_norm → consensus map
 * 2. Via token_... decoding in trades_raw_enriched_final
 * 3. Via existing ERC1155 tables
 *
 * Then re-run gates with union map to see if we can ship Phase 1 without blockchain backfill.
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

async function step1_NormalizeKeys() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 1: NORMALIZE KEYS ONCE');
  console.log('═══════════════════════════════════════════════════════════');

  console.log('\n🧹 Dropping existing views...');
  const viewsToDrop = ['_tx_vwc', '_cid_res', '_mkey_vwc'];
  for (const view of viewsToDrop) {
    await clickhouse.command({ query: `DROP VIEW IF EXISTS ${view}` });
  }

  // 1. VWC transactions (0x...66 lowercase)
  console.log('\n📊 Creating _tx_vwc (distinct tx from vw_trades_canonical)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _tx_vwc AS
      SELECT DISTINCT lower(replaceRegexpAll(transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx66
      FROM vw_trades_canonical
      WHERE transaction_hash != ''
    `
  });
  console.log('  ✅ _tx_vwc created');

  // 2. Resolutions CIDs (64-hex lowercase without 0x)
  console.log('\n📊 Creating _cid_res (distinct cid64 from market_resolutions_final)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _cid_res AS
      SELECT DISTINCT lpad(lower(replaceAll(condition_id_norm, '0x', '')), 64, '0') AS cid64
      FROM market_resolutions_final
      WHERE condition_id_norm != '' AND condition_id_norm IS NOT NULL
    `
  });
  console.log('  ✅ _cid_res created');

  // 3. VWC market IDs (exclude bad hex)
  console.log('\n📊 Creating _mkey_vwc (distinct market keys from vw_trades_canonical)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _mkey_vwc AS
      SELECT DISTINCT lower(market_id_norm) AS mkey
      FROM vw_trades_canonical
      WHERE market_id_norm IS NOT NULL
        AND market_id_norm != ''
        AND market_id_norm NOT LIKE '0x%'
    `
  });
  console.log('  ✅ _mkey_vwc created');

  console.log('\n✅ Step 1 complete: Normalized key views created');
}

async function step2_BuildConsensusMap() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 2: BUILD CONSENSUS MARKET_ID → CID MAP');
  console.log('═══════════════════════════════════════════════════════════');

  console.log('\n🧹 Dropping existing mapping views...');
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _mkey_to_cid_candidates' });
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _mkey_to_cid' });

  // Collect candidates from all mapping tables (only those with both market_id and condition_id)
  console.log('\n📊 Creating _mkey_to_cid_candidates (collect from all mapping tables)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _mkey_to_cid_candidates AS
      SELECT lower(market_id) AS mkey,
             lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS cid64
      FROM market_id_mapping
      WHERE condition_id IS NOT NULL AND condition_id != ''
      UNION ALL
      SELECT lower(market_id) AS mkey,
             lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS cid64
      FROM market_key_map
      WHERE condition_id IS NOT NULL AND condition_id != ''
    `
  });
  console.log('  ✅ _mkey_to_cid_candidates created');

  // Consensus: choose single CID per market by voting, prefer resolvable CIDs
  console.log('\n📊 Creating _mkey_to_cid (consensus map via voting)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _mkey_to_cid AS
      WITH votes AS (
        SELECT
          mkey,
          cid64,
          count() AS cnt,
          if(cid64 IN (SELECT cid64 FROM _cid_res), 1, 0) AS in_res
        FROM _mkey_to_cid_candidates
        GROUP BY mkey, cid64
      ),
      ranked AS (
        SELECT
          mkey,
          cid64,
          cnt,
          in_res,
          row_number() OVER (PARTITION BY mkey ORDER BY in_res DESC, cnt DESC, cid64) AS rnk
        FROM votes
      )
      SELECT mkey, cid64
      FROM ranked
      WHERE rnk = 1
    `
  });
  console.log('  ✅ _mkey_to_cid created');

  // Get stats
  const statsQuery = `
    SELECT
      (SELECT count() FROM _mkey_to_cid) AS total_mappings,
      (SELECT count() FROM _mkey_to_cid m JOIN _cid_res r USING(cid64)) AS resolvable_mappings,
      round(100.0 * resolvable_mappings / nullIf(total_mappings, 0), 2) AS pct_resolvable
  `;
  const stats = await runQuery(statsQuery, 'Getting consensus map stats');
  const s = stats[0];

  console.log('\n📊 Consensus Map Stats:');
  console.log(`  Total market_id mappings:     ${s.total_mappings.toLocaleString()}`);
  console.log(`  Resolvable CIDs:              ${s.resolvable_mappings.toLocaleString()}`);
  console.log(`  Resolvable %:                 ${s.pct_resolvable}%`);

  console.log('\n✅ Step 2 complete: Consensus market_id → CID map built');
}

async function step3_BuildUnionMap() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 3: BUILD UNION TX → CID MAP FROM 3 SOURCES');
  console.log('═══════════════════════════════════════════════════════════');

  console.log('\n🧹 Dropping existing union views...');
  const viewsToDrop = [
    '_tx_cid_via_market',
    '_tx_cid_via_token',
    '_token_to_cid',
    '_tx_cid_via_erc1155',
    '_tx_cid_union'
  ];
  for (const view of viewsToDrop) {
    await clickhouse.command({ query: `DROP VIEW IF EXISTS ${view}` });
  }

  // Source 1: tx → CID via VWC market_id consensus map
  console.log('\n📊 Creating _tx_cid_via_market (tx → CID via market_id)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _tx_cid_via_market AS
      SELECT DISTINCT
        lower(replaceRegexpAll(v.transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx66,
        c.cid64
      FROM vw_trades_canonical v
      JOIN _mkey_to_cid c ON lower(v.market_id_norm) = c.mkey
    `
  });
  console.log('  ✅ _tx_cid_via_market created');

  // Source 2: tx → CID via token_... decoding
  console.log('\n📊 Creating _tx_cid_via_token (tx → CID via token decoding)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _tx_cid_via_token AS
      SELECT DISTINCT
        lower(replaceRegexpAll(transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx66,
        lpad(lower(hex(intDiv(toUInt256(replaceAll(condition_id, 'token_', '')), 256))), 64, '0') AS cid64
      FROM trades_raw_enriched_final
      WHERE condition_id LIKE 'token_%'
    `
  });
  console.log('  ✅ _tx_cid_via_token created');

  // Source 3a: token → CID map
  console.log('\n📊 Creating _token_to_cid (token → CID from existing maps)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _token_to_cid AS
      SELECT DISTINCT
        toString(token_id) AS token_str,
        lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS cid64
      FROM erc1155_condition_map
      WHERE condition_id IS NOT NULL AND condition_id != ''
      UNION ALL
      SELECT DISTINCT
        toString(token_id) AS token_str,
        lpad(lower(replaceAll(condition_id_norm, '0x', '')), 64, '0') AS cid64
      FROM ctf_token_map
      WHERE condition_id_norm IS NOT NULL AND condition_id_norm != ''
    `
  });
  console.log('  ✅ _token_to_cid created');

  // Source 3b: tx → token → CID via ERC1155 transfers
  console.log('\n📊 Creating _tx_cid_via_erc1155 (tx → token → CID via ERC1155)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _tx_cid_via_erc1155 AS
      SELECT DISTINCT
        lower(tx_hash) AS tx66,
        t.cid64
      FROM erc1155_transfers e
      JOIN _token_to_cid t ON toString(e.token_id) = t.token_str
    `
  });
  console.log('  ✅ _tx_cid_via_erc1155 created');

  // Final union
  console.log('\n📊 Creating _tx_cid_union (union of all 3 sources)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _tx_cid_union AS
      SELECT tx66, cid64 FROM _tx_cid_via_market
      UNION ALL
      SELECT tx66, cid64 FROM _tx_cid_via_token
      UNION ALL
      SELECT tx66, cid64 FROM _tx_cid_via_erc1155
    `
  });
  console.log('  ✅ _tx_cid_union created');

  // Get stats for each source
  console.log('\n📊 Union Map Source Stats:');

  const marketStats = await runQuery('SELECT count() AS cnt FROM (SELECT DISTINCT tx66, cid64 FROM _tx_cid_via_market)', 'Counting market mappings');
  console.log(`  Via market_id:                ${marketStats[0].cnt.toLocaleString()}`);

  const tokenStats = await runQuery('SELECT count() AS cnt FROM (SELECT DISTINCT tx66, cid64 FROM _tx_cid_via_token)', 'Counting token mappings');
  console.log(`  Via token decoding:           ${tokenStats[0].cnt.toLocaleString()}`);

  const erc1155Stats = await runQuery('SELECT count() AS cnt FROM (SELECT DISTINCT tx66, cid64 FROM _tx_cid_via_erc1155)', 'Counting ERC1155 mappings');
  console.log(`  Via ERC1155 transfers:        ${erc1155Stats[0].cnt.toLocaleString()}`);

  const unionStats = await runQuery('SELECT count() AS cnt FROM (SELECT DISTINCT tx66, cid64 FROM _tx_cid_union)', 'Counting union total');
  console.log(`  Total union (distinct):       ${unionStats[0].cnt.toLocaleString()}`);

  console.log('\n✅ Step 3 complete: Union tx → CID map built from 3 sources');
}

async function step4_RecomputeGates() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('STEP 4: RECOMPUTE GATES WITH UNION MAP');
  console.log('═══════════════════════════════════════════════════════════');

  // Gate A: Do missing txs appear in union map?
  console.log('\n🔍 Gate A: Missing tx coverage in union map...');
  const gateAQuery = `
    WITH
      missing_txs AS (
        SELECT DISTINCT lower(replaceRegexpAll(transaction_hash, '^txn-(0x[0-9a-f]+)-.*', '\\1')) AS tx66
        FROM trades_raw
        WHERE condition_id = '' OR condition_id = concat('0x', repeat('0', 64))
      ),
      union_txs AS (
        SELECT DISTINCT tx66 FROM _tx_cid_union
      )
    SELECT
      (SELECT count() FROM missing_txs) AS missing_cnt,
      (SELECT count() FROM union_txs) AS mapped_cnt,
      (SELECT count() FROM missing_txs m INNER JOIN union_txs u USING(tx66)) AS overlap_cnt,
      round(100.0 * overlap_cnt / nullIf(missing_cnt, 0), 2) AS pct_in_union_for_missing
  `;

  const gateA = await runQuery(gateAQuery, 'Calculating Gate A with union map');
  const a = gateA[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE A RESULTS (WITH UNION MAP)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Missing txs:                  ${a.missing_cnt.toLocaleString()}`);
  console.log(`  Mapped txs (union):           ${a.mapped_cnt.toLocaleString()}`);
  console.log(`  Overlap:                      ${a.overlap_cnt.toLocaleString()}`);
  console.log(`  Coverage:                     ${a.pct_in_union_for_missing}%`);
  console.log(`  Threshold:                    >= 85%`);

  if (a.pct_in_union_for_missing >= 85) {
    console.log(`\n  ✅ PASS: ${a.pct_in_union_for_missing}% >= 85%`);
  } else {
    console.log(`\n  ❌ FAIL: ${a.pct_in_union_for_missing}% < 85%`);
  }

  // Gate B: Can mapped CIDs join to resolutions?
  console.log('\n🔍 Gate B: Mapped CIDs joinable to resolutions...');
  const gateBQuery = `
    WITH
      mapped_cids AS (
        SELECT DISTINCT cid64 FROM _tx_cid_union
      ),
      res_cids AS (
        SELECT DISTINCT cid64 FROM _cid_res
      )
    SELECT
      (SELECT count() FROM mapped_cids) AS mapped_cids,
      (SELECT count() FROM res_cids) AS res_cids,
      (SELECT count() FROM mapped_cids m INNER JOIN res_cids r USING(cid64)) AS overlap,
      round(100.0 * overlap / nullIf(res_cids, 0), 2) AS pct_res_covered_by_union,
      round(100.0 * overlap / nullIf(mapped_cids, 0), 2) AS pct_union_cids_in_res
  `;

  const gateB = await runQuery(gateBQuery, 'Calculating Gate B with union map');
  const b = gateB[0];

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE B RESULTS (WITH UNION MAP)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Distinct union CIDs:          ${b.mapped_cids.toLocaleString()}`);
  console.log(`  Distinct res CIDs:            ${b.res_cids.toLocaleString()}`);
  console.log(`  Overlap:                      ${b.overlap.toLocaleString()}`);
  console.log(`  Res covered by union:         ${b.pct_res_covered_by_union}%`);
  console.log(`  Union CIDs in res:            ${b.pct_union_cids_in_res}%`);
  console.log(`  Threshold:                    >= 90%`);

  if (b.pct_res_covered_by_union >= 90) {
    console.log(`\n  ✅ PASS: ${b.pct_res_covered_by_union}% >= 90%`);
  } else {
    console.log(`\n  ❌ FAIL: ${b.pct_res_covered_by_union}% < 90%`);
  }

  console.log('\n✅ Step 4 complete: Gates recomputed with union map');

  return { gateA: a, gateB: b };
}

async function printFinalDecision(gateA: any, gateB: any) {
  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🎯 FINAL DECISION');
  console.log('═══════════════════════════════════════════════════════════');

  console.log('\n📊 THE TWO KEY PERCENTAGES:');
  console.log(`  1. pct_in_union_for_missing:      ${gateA.pct_in_union_for_missing}%`);
  console.log(`  2. pct_res_covered_by_union:      ${gateB.pct_res_covered_by_union}%`);

  const gateAPassed = gateA.pct_in_union_for_missing >= 85;
  const gateBPassed = gateB.pct_res_covered_by_union >= 90;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GATE STATUS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Gate A (tx coverage):         ${gateAPassed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Gate B (CID coverage):        ${gateBPassed ? '✅ PASS' : '❌ FAIL'}`);

  console.log('\n═══════════════════════════════════════════════════════════');

  if (gateAPassed && gateBPassed) {
    console.log('✅ PROCEED WITH PHASE 1: BUILD fact_trades_v1 FROM UNION MAP');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nStrategy: Use _tx_cid_union to map all transactions to condition_ids');
    console.log('\nNext steps:');
    console.log('  1. Build fact_trades_v1 from vw_trades_canonical + _tx_cid_union');
    console.log('  2. Enrich from trades_raw_enriched_final');
    console.log('  3. Fill gaps from trade_direction_assignments');
    console.log('  4. Run coverage gates (min_top100_pct >= 90, p50_pct >= 95)');
    console.log('\n  Timeline: 4-6 hours');
    console.log('  Cost: $0');
    console.log('  Expected coverage: 85-95%');
    console.log('\n  ✅ NO BLOCKCHAIN BACKFILL NEEDED!');
  } else if (gateAPassed && !gateBPassed) {
    console.log('⚠️  PARTIAL SUCCESS: TARGETED BACKFILL NEEDED');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nWe have the transactions, but need more CID mappings.');
    console.log('\nNext steps:');
    console.log('  1. Identify residual CIDs: NOT IN (_tx_cid_union ∩ _cid_res)');
    console.log('  2. Run TARGETED blockchain backfill for residual CIDs only');
    console.log('  3. Much faster than blanket backfill (only missing CIDs)');
    console.log('\n  Estimated residual CIDs to backfill:');
    const residual = gateB.res_cids - gateB.overlap;
    console.log(`  ${residual.toLocaleString()} out of ${gateB.res_cids.toLocaleString()} total (${((residual/gateB.res_cids)*100).toFixed(2)}%)`);
    console.log('\n  Timeline: 2-4 hours (targeted only)');
    console.log('  Cost: $10-50');
  } else {
    console.log('❌ FALLBACK TO FULL BLOCKCHAIN BACKFILL');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nBoth gates failed. Union map insufficient.');
    console.log('\n  Timeline: 12-16 hours');
    console.log('  Cost: $50-200');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');

  return gateAPassed && gateBPassed;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔬 UNION MAP RECOVERY - EXHAUST EXISTING DATA');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('GPT\'s strategy: Gate A = 100% tx coverage. Fix CID mapping.');
  console.log('Build union map from 3 sources before blockchain backfill.');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // Step 1: Normalize keys
    await step1_NormalizeKeys();

    // Step 2: Build consensus market_id → CID map
    await step2_BuildConsensusMap();

    // Step 3: Build union tx → CID map from 3 sources
    await step3_BuildUnionMap();

    // Step 4: Recompute gates with union map
    const { gateA, gateB } = await step4_RecomputeGates();

    // Print final decision
    const shouldProceedPhase1 = await printFinalDecision(gateA, gateB);

    // Close connection
    await clickhouse.close();

    // Exit with appropriate code
    process.exit(shouldProceedPhase1 ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    await clickhouse.close();
    process.exit(2);
  }
}

main();
