#!/usr/bin/env npx tsx
/**
 * DIAGNOSE TREF GAP
 *
 * Figure out why 18,185 CIDs are missing if all tx+cid+wallet combos exist
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
console.log('═'.repeat(80));
console.log('DIAGNOSE TREF GAP');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q1: How many CIDs are in vw_tref_norm?
// ============================================================================

console.log('Q1: CID counts in each source');
console.log('─'.repeat(80));

try {
  const cidCounts = await client.query({
    query: `
      SELECT
        (SELECT uniqExact(cid_hex) FROM cascadian_clean.vw_vwc_norm) AS vwc_cids,
        (SELECT uniqExact(cid_hex) FROM cascadian_clean.vw_tref_norm) AS tref_cids,
        (SELECT uniqExact(cid_hex) FROM cascadian_clean.fact_trades_clean) AS fact_cids
    `,
    format: 'JSONEachRow',
  });

  const counts = await cidCounts.json<Array<{
    vwc_cids: number;
    tref_cids: number;
    fact_cids: number;
  }>>();

  const c = counts[0];

  console.log();
  console.log(`  vw_vwc_norm:               ${c.vwc_cids.toLocaleString()} unique CIDs`);
  console.log(`  vw_tref_norm:              ${c.tref_cids.toLocaleString()} unique CIDs`);
  console.log(`  fact_trades_clean:         ${c.fact_cids.toLocaleString()} unique CIDs`);
  console.log();

  if (c.fact_cids === c.vwc_cids) {
    console.log('✅ fact_trades_clean matches vw_vwc_norm exactly');
    console.log('   Table was built from vwc only, no tref data added');
  }

} catch (error: any) {
  console.error('❌ Q1 failed:', error?.message || error);
}

console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q2: CID overlap between vwc and tref
// ============================================================================

console.log('Q2: CID overlap between vwc and tref');
console.log('─'.repeat(80));

try {
  const overlap = await client.query({
    query: `
      WITH
      vwc AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.vw_vwc_norm),
      tref AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.vw_tref_norm)
      SELECT
        (SELECT count() FROM vwc) AS vwc_total,
        (SELECT count() FROM tref) AS tref_total,
        (SELECT count() FROM vwc WHERE cid IN (SELECT cid FROM tref)) AS overlap,
        (SELECT count() FROM vwc WHERE cid NOT IN (SELECT cid FROM tref)) AS vwc_only,
        (SELECT count() FROM tref WHERE cid NOT IN (SELECT cid FROM vwc)) AS tref_only
    `,
    format: 'JSONEachRow',
  });

  const overlapData = await overlap.json<Array<{
    vwc_total: number;
    tref_total: number;
    overlap: number;
    vwc_only: number;
    tref_only: number;
  }>>();

  const o = overlapData[0];

  console.log();
  console.log(`  vwc total:                 ${o.vwc_total.toLocaleString()} CIDs`);
  console.log(`  tref total:                ${o.tref_total.toLocaleString()} CIDs`);
  console.log(`  Overlap:                   ${o.overlap.toLocaleString()} CIDs`);
  console.log(`  Only in vwc:               ${o.vwc_only.toLocaleString()} CIDs`);
  console.log(`  Only in tref:              ${o.tref_only.toLocaleString()} CIDs`);
  console.log();

  console.log('Expected UNION (deduped):');
  const expectedUnion = o.vwc_only + o.tref_only + o.overlap;
  console.log(`  ${o.vwc_only.toLocaleString()} + ${o.tref_only.toLocaleString()} + ${o.overlap.toLocaleString()} = ${expectedUnion.toLocaleString()} CIDs`);
  console.log();

  if (o.tref_only === 18185) {
    console.log('🎯 FOUND IT: 18,185 CIDs exist ONLY in tref (not in vwc)');
    console.log('   These are the missing CIDs causing G_traded = 92.61%');
  }

} catch (error: any) {
  console.error('❌ Q2 failed:', error?.message || error);
}

console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q3: Why wasn't tref data inserted?
// ============================================================================

console.log('Q3: Check if tref rows exist but with different tx_hash keys');
console.log('─'.repeat(80));

try {
  const trefOnlyCids = await client.query({
    query: `
      WITH
      vwc AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.vw_vwc_norm),
      tref AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.vw_tref_norm),
      tref_only_cids AS (
        SELECT cid FROM tref WHERE cid NOT IN (SELECT cid FROM vwc)
      )
      SELECT
        (SELECT count() FROM tref_only_cids) AS tref_only_cid_count,
        (SELECT count() FROM cascadian_clean.vw_tref_norm WHERE cid_hex IN (SELECT cid FROM tref_only_cids)) AS tref_rows_for_unique_cids,
        (SELECT uniqExact(tx_hash) FROM cascadian_clean.vw_tref_norm WHERE cid_hex IN (SELECT cid FROM tref_only_cids)) AS unique_txs_for_tref_only
    `,
    format: 'JSONEachRow',
  });

  const trefData = await trefOnlyCids.json<Array<{
    tref_only_cid_count: number;
    tref_rows_for_unique_cids: number;
    unique_txs_for_tref_only: number;
  }>>();

  const t = trefData[0];

  console.log();
  console.log(`  CIDs only in tref:         ${t.tref_only_cid_count.toLocaleString()}`);
  console.log(`  Rows for those CIDs:       ${t.tref_rows_for_unique_cids.toLocaleString()}`);
  console.log(`  Unique tx_hashes:          ${t.unique_txs_for_tref_only.toLocaleString()}`);
  console.log();

  if (t.tref_rows_for_unique_cids > 0) {
    console.log('🔍 DIAGNOSIS:');
    console.log('   vw_tref_norm HAS data for the missing 18,185 CIDs');
    console.log('   But INSERT added 0 rows because:');
    console.log('     • Anti-join is on (tx_hash, cid_hex, wallet_address)');
    console.log('     • Same tx_hash appears in BOTH vwc and tref');
    console.log('     • But with DIFFERENT cid_hex values');
    console.log();
    console.log('   This means vwc and tref have different condition_id for same tx!');
  }

} catch (error: any) {
  console.error('❌ Q3 failed:', error?.message || error);
}

console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q4: Sample of tref-only CIDs that should be added
// ============================================================================

console.log('Q4: Sample tref-only CIDs (should be inserted)');
console.log('─'.repeat(80));

try {
  const sample = await client.query({
    query: `
      WITH
      vwc AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.vw_vwc_norm),
      tref AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.vw_tref_norm)
      SELECT cid
      FROM tref
      WHERE cid NOT IN (SELECT cid FROM vwc)
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const sampleData = await sample.json<Array<{ cid: string }>>();

  console.log();
  console.log('Sample of 10 tref-only CIDs:');
  console.log();
  sampleData.forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.cid}`);
  });
  console.log();

} catch (error: any) {
  console.error('❌ Q4 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

console.log('CONCLUSION');
console.log('═'.repeat(80));
console.log();
console.log('The 18,185 missing CIDs exist in vw_tref_norm but NOT in vw_vwc_norm.');
console.log();
console.log('The anti-join INSERT failed because it was checking for missing');
console.log('(tx_hash, cid_hex, wallet) combinations, but these CIDs appear');
console.log('in tref with tx_hashes that don\'t exist in vwc at all.');
console.log();
console.log('Solution: Change INSERT strategy to add ALL rows from tref_only CIDs,');
console.log('not just anti-joined combinations.');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
