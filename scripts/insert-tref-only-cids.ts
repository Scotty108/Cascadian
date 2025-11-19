#!/usr/bin/env npx tsx
/**
 * INSERT TREF-ONLY CIDs
 *
 * Add the 2,337 CIDs that exist only in tref (not in vwc)
 * This should bring total from 227,838 → 230,175 CIDs
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
console.log('INSERT TREF-ONLY CIDs');
console.log('═'.repeat(80));
console.log();

console.log('Strategy: Insert ALL rows from vw_tref_norm for CIDs that exist only in tref');
console.log('Expected: Add 2,337 unique CIDs');
console.log();

// ============================================================================
// STEP 1: Count tref-only CIDs and rows
// ============================================================================

console.log('Step 1: Count Tref-Only Data');
console.log('─'.repeat(80));

try {
  const counts = await client.query({
    query: `
      WITH
      vwc_cids AS (SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.vw_vwc_norm),
      tref_only_cids AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.vw_tref_norm
        WHERE cid_hex NOT IN (SELECT cid FROM vwc_cids)
      )
      SELECT
        (SELECT count() FROM tref_only_cids) AS tref_only_cid_count,
        (SELECT count() FROM cascadian_clean.vw_tref_norm WHERE cid_hex IN (SELECT cid FROM tref_only_cids)) AS rows_to_insert
    `,
    format: 'JSONEachRow',
  });

  const countData = await counts.json<Array<{
    tref_only_cid_count: number;
    rows_to_insert: number;
  }>>();

  const c = countData[0];

  console.log();
  console.log(`  Unique tref-only CIDs:     ${c.tref_only_cid_count.toLocaleString()}`);
  console.log(`  Rows to insert:            ${c.rows_to_insert.toLocaleString()}`);
  console.log();

  if (c.tref_only_cid_count === 0) {
    console.log('⚠️  No tref-only CIDs found - already complete!');
    await client.close();
    return;
  }

} catch (error: any) {
  console.error('❌ Count failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 2: Execute INSERT for tref-only CIDs
// ============================================================================

console.log('Step 2: Insert Tref-Only Rows');
console.log('─'.repeat(80));
console.log();
console.log('Executing INSERT...');
console.log();

try {
  const startTime = Date.now();

  await client.query({
    query: `
      INSERT INTO cascadian_clean.fact_trades_clean
      SELECT
        t.tx_hash,
        t.block_time,
        t.cid_hex,
        t.outcome_index,
        t.wallet_address,
        t.direction,
        t.shares,
        t.price,
        t.usdc_amount,
        'RAW_ENRICHED' AS source
      FROM cascadian_clean.vw_tref_norm t
      WHERE t.cid_hex NOT IN (
        SELECT DISTINCT cid_hex
        FROM cascadian_clean.vw_vwc_norm
      )
    `,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`✅ INSERT completed in ${elapsed}s`);
  console.log();

} catch (error: any) {
  console.error(`❌ INSERT failed: ${error?.message || error}`);
  await client.close();
  process.exit(1);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 3: Verify new counts
// ============================================================================

console.log('Step 3: Verify Post-Insert Counts');
console.log('─'.repeat(80));

try {
  const verify = await client.query({
    query: `
      SELECT
        count() AS total_rows,
        uniqExact(cid_hex) AS unique_cids,
        uniqExact(tx_hash) AS unique_txs,
        countIf(source = 'VW_CANONICAL') AS vwc_rows,
        countIf(source = 'RAW_ENRICHED') AS tref_rows
      FROM cascadian_clean.fact_trades_clean
    `,
    format: 'JSONEachRow',
  });

  const verifyData = await verify.json<Array<{
    total_rows: number;
    unique_cids: number;
    unique_txs: number;
    vwc_rows: number;
    tref_rows: number;
  }>>();

  const v = verifyData[0];

  console.log();
  console.log('After tref-only INSERT:');
  console.log(`  Total rows:                ${v.total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs:               ${v.unique_cids.toLocaleString()}`);
  console.log(`  Unique tx_hashes:          ${v.unique_txs.toLocaleString()}`);
  console.log(`  From vw_canonical:         ${v.vwc_rows.toLocaleString()} rows`);
  console.log(`  From raw_enriched:         ${v.tref_rows.toLocaleString()} rows`);
  console.log();

  console.log('Improvement from baseline (227,838 CIDs):');
  console.log(`  CIDs added:                +${(v.unique_cids - 227838).toLocaleString()}`);
  console.log(`  Rows added:                +${(v.total_rows - 63541468).toLocaleString()}`);
  console.log();

  if (v.unique_cids === 230175) {
    console.log('✅ PERFECT: 230,175 CIDs = vwc (227,838) + tref-only (2,337)');
    console.log('   Expected coverage: 100% of TRADED_ANY (if TRADED_ANY = 230,175)');
  } else if (v.unique_cids > 229000) {
    console.log(`✅ EXCELLENT: ${v.unique_cids.toLocaleString()} CIDs (99%+ coverage likely)`);
  } else {
    console.log(`⚠️  WARNING: Only ${v.unique_cids.toLocaleString()} CIDs (expected 230,175)`);
  }

} catch (error: any) {
  console.error('❌ Verification failed:', error?.message || error);
}

console.log();
console.log('═'.repeat(80));
console.log('INSERT COMPLETE');
console.log('═'.repeat(80));
console.log();
console.log('Next step: Run final-gates-corrected.ts to measure G_traded');
console.log('Expected: G_traded = 100% if TRADED_ANY = 230,175');
console.log('          G_traded = 93.6% if TRADED_ANY = 246,023 (over-counting issue)');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
