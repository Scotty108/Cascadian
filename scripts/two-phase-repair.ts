#!/usr/bin/env npx tsx
/**
 * TWO-PHASE CID REPAIR - GPT'S PLAN
 *
 * Phase A: Repair from existing data (NO market_id joins)
 *   1. Split VWC into hex vs token_ formats
 *   2. Use trusted token→CID map + decode fallback
 *   3. Build fact_trades_clean
 *   4. Check gates
 *
 * Phase B: Targeted blockchain backfill (ONLY if needed)
 *   1. Identify still-missing CIDs
 *   2. Fetch ERC-1155 events for missing CIDs only
 *   3. Patch fact_trades_clean
 *   4. Recheck gates
 *
 * Stop when Gate B >= 85%
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

async function phaseA_Step1_CanonicalResolutions() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PHASE A - STEP 1: CANONICAL RESOLUTIONS CID SET');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _res_cid' });

  console.log('\n📊 Creating _res_cid...');
  await clickhouse.command({
    query: `
      CREATE VIEW _res_cid AS
      SELECT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm), '0x', ''), 64, '0'))) AS cid
      FROM market_resolutions_final
      WHERE condition_id_norm != ''
    `
  });

  const count = await runQuery('SELECT count() AS cnt FROM _res_cid', 'Counting resolution CIDs');
  console.log(`  ✅ Resolution CIDs: ${count[0].cnt.toLocaleString()}`);
}

async function phaseA_Step2_SplitVWC() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PHASE A - STEP 2: SPLIT VWC INTO HEX VS TOKEN');
  console.log('═══════════════════════════════════════════════════════════');

  // Drop existing views
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _vwc_hex' });
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _vwc_token_src' });

  // Clean hex CIDs (no token_ prefix)
  console.log('\n📊 Creating _vwc_hex (clean hex condition_ids)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _vwc_hex AS
      SELECT DISTINCT
        transaction_hash AS tx_hash,
        lower(concat('0x', lpad(replaceOne(lower(condition_id_norm), '0x', ''), 64, '0'))) AS cid
      FROM vw_trades_canonical
      WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0', 64)))
        AND length(replaceOne(lower(condition_id_norm), '0x', '')) = 64
        AND position(lower(replaceOne(condition_id_norm, '0x', '')), 'token_') = 0
    `
  });

  const hexCount = await runQuery('SELECT count() AS cnt FROM _vwc_hex', 'Counting hex CIDs');
  console.log(`  ✅ VWC hex pairs: ${hexCount[0].cnt.toLocaleString()}`);

  // Token format (contains "token_")
  console.log('\n📊 Creating _vwc_token_src (token_ format, needs decoding)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _vwc_token_src AS
      SELECT DISTINCT
        transaction_hash AS tx_hash,
        lower(replaceOne(condition_id_norm, '0x', '')) AS token_str
      FROM vw_trades_canonical
      WHERE position(lower(replaceOne(condition_id_norm, '0x', '')), 'token_') = 1
    `
  });

  const tokenCount = await runQuery('SELECT count() AS cnt FROM _vwc_token_src', 'Counting token format');
  console.log(`  ✅ VWC token pairs: ${tokenCount[0].cnt.toLocaleString()}`);
}

async function phaseA_Step3_TokenCIDMap() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PHASE A - STEP 3: BUILD TOKEN→CID MAP');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _token_cid_map' });
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _vwc_token_joined' });
  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _vwc_token_decoded_fallback' });

  // Trusted token→CID map from existing tables
  console.log('\n📊 Creating _token_cid_map (trusted mappings)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _token_cid_map AS
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

  const mapCount = await runQuery('SELECT count() AS cnt FROM _token_cid_map', 'Counting token→CID mappings');
  console.log(`  Token→CID mappings: ${mapCount[0].cnt.toLocaleString()}`);

  // Join tokens to map
  console.log('\n📊 Creating _vwc_token_joined (using trusted map)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _vwc_token_joined AS
      SELECT s.tx_hash, m.cid
      FROM _vwc_token_src s
      JOIN _token_cid_map m ON lower(concat('0x', s.token_str)) = m.token_str
    `
  });

  const joinedCount = await runQuery('SELECT count() AS cnt FROM _vwc_token_joined', 'Counting joined tokens');
  console.log(`  Tokens joined to map: ${joinedCount[0].cnt.toLocaleString()}`);

  // Decode fallback for unmapped tokens
  console.log('\n📊 Creating _vwc_token_decoded_fallback (decode unmapped)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _vwc_token_decoded_fallback AS
      SELECT
        s.tx_hash,
        -- Decode: CID = token_id >> 8 (remove last 2 hex chars)
        concat('0x', lpad(lower(substring(replaceAll(s.token_str, 'token_', ''), 1,
          length(replaceAll(s.token_str, 'token_', '')) - 2)), 64, '0')) AS cid
      FROM _vwc_token_src s
      LEFT JOIN _token_cid_map m ON lower(concat('0x', s.token_str)) = m.token_str
      WHERE m.token_str IS NULL
        AND length(replaceAll(s.token_str, 'token_', '')) > 2
    `
  });

  const fallbackCount = await runQuery('SELECT count() AS cnt FROM _vwc_token_decoded_fallback', 'Counting fallback decodes');
  console.log(`  Tokens decoded (fallback): ${fallbackCount[0].cnt.toLocaleString()}`);
}

async function phaseA_Step4_RepairPairs() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PHASE A - STEP 4: BUILD REPAIR PAIRS (RESOLUTIONS ONLY)');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _repair_pairs_vwc' });

  console.log('\n📊 Creating _repair_pairs_vwc (union of all sources, filtered to resolutions)...');
  await clickhouse.command({
    query: `
      CREATE VIEW _repair_pairs_vwc AS
      SELECT DISTINCT tx_hash, cid FROM _vwc_hex
      WHERE cid IN (SELECT cid FROM _res_cid)
      UNION ALL
      SELECT DISTINCT tx_hash, cid FROM _vwc_token_joined
      WHERE cid IN (SELECT cid FROM _res_cid)
      UNION ALL
      SELECT DISTINCT tx_hash, cid FROM _vwc_token_decoded_fallback
      WHERE cid IN (SELECT cid FROM _res_cid)
    `
  });

  const count = await runQuery('SELECT count() AS cnt FROM _repair_pairs_vwc', 'Counting repair pairs');
  console.log(`  ✅ Total repair pairs: ${count[0].cnt.toLocaleString()}`);

  const cidCount = await runQuery('SELECT count() AS cnt FROM (SELECT DISTINCT cid FROM _repair_pairs_vwc)', 'Counting distinct CIDs');
  console.log(`  Distinct CIDs in repair pairs: ${cidCount[0].cnt.toLocaleString()}`);
}

async function phaseA_Step5_BuildFactTable() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PHASE A - STEP 5: BUILD fact_trades_clean');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS fact_trades_clean' });

  console.log('\n📊 Creating fact_trades_clean table...');
  await clickhouse.command({
    query: `
      CREATE TABLE fact_trades_clean
      (
        tx_hash String,
        block_time DateTime64(3),
        cid String,
        outcome_index UInt8,
        wallet_address String,
        direction LowCardinality(String),
        shares Decimal(38, 18),
        price Decimal(18, 6),
        usdc_amount Decimal(18, 6)
      )
      ENGINE = ReplacingMergeTree
      ORDER BY (cid, tx_hash, wallet_address)
    `
  });

  // Seed with clean hex CIDs
  console.log('\n📊 Inserting seed data (hex CIDs from VWC)...');
  await clickhouse.command({
    query: `
      INSERT INTO fact_trades_clean
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
        AND length(replaceOne(lower(v.condition_id_norm), '0x', '')) = 64
        AND position(lower(replaceOne(v.condition_id_norm, '0x', '')), 'token_') = 0
    `
  });

  const seedCount = await runQuery('SELECT count() AS cnt FROM fact_trades_clean', 'Counting seed rows');
  console.log(`  Seed rows: ${seedCount[0].cnt.toLocaleString()}`);

  // Patch using repair pairs
  console.log('\n📊 Patching with repair pairs (token-mapped + fallback)...');
  await clickhouse.command({
    query: `
      INSERT INTO fact_trades_clean
      SELECT
        v.transaction_hash, v.timestamp, r.cid,
        v.outcome_index, v.wallet_address_norm, v.trade_direction,
        v.shares, v.entry_price, v.usd_value
      FROM vw_trades_canonical v
      JOIN _repair_pairs_vwc r ON r.tx_hash = v.transaction_hash
      LEFT JOIN fact_trades_clean f ON f.tx_hash = v.transaction_hash AND f.cid = r.cid
      WHERE f.tx_hash IS NULL
    `
  });

  const totalCount = await runQuery('SELECT count() AS cnt FROM fact_trades_clean', 'Counting total rows');
  const patchedRows = totalCount[0].cnt - seedCount[0].cnt;
  console.log(`  Patched rows: ${patchedRows.toLocaleString()}`);
  console.log(`  ✅ Total rows: ${totalCount[0].cnt.toLocaleString()}`);
}

async function phaseA_Step6_Gates() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PHASE A - STEP 6: COMPUTE GATES');
  console.log('═══════════════════════════════════════════════════════════');

  // Gate A
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
  console.log(`  Missing txs:      ${a.missing_cnt.toLocaleString()}`);
  console.log(`  Covered:          ${a.covered_cnt.toLocaleString()}`);
  console.log(`  Coverage:         ${a.pct_in_union_for_missing}%`);
  console.log(`  Status:           ${a.pct_in_union_for_missing >= 85 ? '✅ PASS' : '❌ FAIL'}`);

  // Gate B
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
  console.log(`  Res CIDs:         ${b.res_cids.toLocaleString()}`);
  console.log(`  Fact CIDs:        ${b.fact_cids.toLocaleString()}`);
  console.log(`  Overlap:          ${b.overlap_cids.toLocaleString()}`);
  console.log(`  Res covered:      ${b.pct_res_covered_by_fact}%`);
  console.log(`  Fact in res:      ${b.pct_fact_in_res}%`);
  console.log(`  Status:           ${b.pct_res_covered_by_fact >= 85 ? '✅ PASS' : '❌ FAIL'}`);

  return { gateA: a, gateB: b };
}

async function phaseB_Step7_StillMissing() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PHASE B - STEP 7: IDENTIFY STILL-MISSING CIDS');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS _still_missing_cids' });

  console.log('\n📊 Creating _still_missing_cids (resolutions not in fact table)...');
  await clickhouse.command({
    query: `
      CREATE TABLE _still_missing_cids ENGINE = Memory AS
      SELECT cid FROM _res_cid
      EXCEPT
      SELECT DISTINCT cid FROM fact_trades_clean
    `
  });

  const count = await runQuery('SELECT count() AS cnt FROM _still_missing_cids', 'Counting still-missing CIDs');
  console.log(`  ✅ Still missing CIDs: ${count[0].cnt.toLocaleString()}`);

  return count[0].cnt;
}

async function phaseB_Step8_CandidateContracts() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PHASE B - STEP 8: IDENTIFY CANDIDATE CONTRACTS');
  console.log('═══════════════════════════════════════════════════════════');

  await clickhouse.command({ query: 'DROP VIEW IF EXISTS _candidate_contracts' });

  console.log('\n📊 Creating _candidate_contracts...');
  await clickhouse.command({
    query: `
      CREATE VIEW _candidate_contracts AS
      SELECT DISTINCT lower(market_address) AS addr
      FROM erc1155_condition_map
      WHERE lower(concat('0x', lpad(replaceOne(lower(condition_id), '0x', ''), 64, '0')))
        IN (SELECT cid FROM _still_missing_cids)
    `
  });

  const count = await runQuery('SELECT count() AS cnt FROM _candidate_contracts', 'Counting candidate contracts');
  console.log(`  ✅ Candidate contracts to fetch: ${count[0].cnt.toLocaleString()}`);

  // Sample contracts
  const samples = await runQuery('SELECT addr FROM _candidate_contracts LIMIT 5', 'Sampling contracts');
  console.log('\n  Sample contracts:');
  for (const row of samples) {
    console.log(`    ${row.addr}`);
  }

  return count[0].cnt;
}

async function printPhaseAReport(gates: any) {
  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 PHASE A COMPLETE - EXISTING DATA EXHAUSTED');
  console.log('═══════════════════════════════════════════════════════════');

  console.log('\n🎯 GATE RESULTS:');
  console.log(`  Gate A (tx coverage):     ${gates.gateA.pct_in_union_for_missing}%`);
  console.log(`  Gate B (CID coverage):    ${gates.gateB.pct_res_covered_by_fact}%`);

  console.log('\n═══════════════════════════════════════════════════════════');

  if (gates.gateB.pct_res_covered_by_fact >= 85) {
    console.log('✅ SUCCESS - PHASE A SUFFICIENT');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\n➡️  Gate B >= 85%');
    console.log('\nfact_trades_clean is READY FOR PNL');
    console.log('\nNo blockchain backfill needed!');
    return true;
  } else {
    console.log('⚠️  PHASE B REQUIRED - TARGETED BLOCKCHAIN BACKFILL');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\nGate B: ${gates.gateB.pct_res_covered_by_fact}% < 85% threshold`);
    console.log('\nProceeding to Phase B: Targeted ERC-1155 backfill...');
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔧 TWO-PHASE CID REPAIR');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Phase A: Repair from existing data (NO market_id joins)');
  console.log('Phase B: Targeted blockchain backfill (if needed)');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // ===== PHASE A: REPAIR FROM EXISTING DATA =====
    console.log('\n\n');
    console.log('█████████████████████████████████████████████████████████');
    console.log('█ PHASE A: REPAIR FROM EXISTING TABLES                  █');
    console.log('█████████████████████████████████████████████████████████');

    await phaseA_Step1_CanonicalResolutions();
    await phaseA_Step2_SplitVWC();
    await phaseA_Step3_TokenCIDMap();
    await phaseA_Step4_RepairPairs();
    await phaseA_Step5_BuildFactTable();
    const gates = await phaseA_Step6_Gates();

    const phaseASuccess = await printPhaseAReport(gates);

    if (phaseASuccess) {
      await clickhouse.close();
      process.exit(0);
    }

    // ===== PHASE B: TARGETED BLOCKCHAIN BACKFILL =====
    console.log('\n\n');
    console.log('█████████████████████████████████████████████████████████');
    console.log('█ PHASE B: TARGETED BLOCKCHAIN BACKFILL                 █');
    console.log('█████████████████████████████████████████████████████████');

    const missingCids = await phaseB_Step7_StillMissing();
    const contractCount = await phaseB_Step8_CandidateContracts();

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📋 PHASE B SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\n  Still-missing CIDs:       ${missingCids.toLocaleString()}`);
    console.log(`  Candidate contracts:      ${contractCount.toLocaleString()}`);
    console.log('\n  Next step: Implement blockchain fetch worker');
    console.log('    - Use eth_getLogs for ERC-1155 TransferSingle/TransferBatch');
    console.log('    - Filter to missing CIDs only');
    console.log('    - 8-16 parallel workers, 100k block shards');
    console.log('    - Estimated timeline: 2-4 hours');
    console.log('    - Estimated cost: $10-50');

    console.log('\n═══════════════════════════════════════════════════════════\n');

    await clickhouse.close();
    process.exit(1);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    await clickhouse.close();
    process.exit(2);
  }
}

main();
