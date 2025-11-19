#!/usr/bin/env npx tsx
/**
 * COMPLETE TREF ENRICHMENT
 *
 * Add missing trades from vw_tref_norm that weren't added during initial rebuild
 * Goal: Lift G_traded from 92.61% to ≥95%
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
console.log('COMPLETE TREF ENRICHMENT');
console.log('═'.repeat(80));
console.log();

console.log('Objective: Add missing trades from trades_raw_enriched_final');
console.log('Current:   92.61% coverage (18,185 CIDs missing)');
console.log('Target:    ≥95% coverage');
console.log();

// ============================================================================
// STEP 1: Baseline before enrichment
// ============================================================================

console.log('Step 1: Baseline Counts');
console.log('─'.repeat(80));

try {
  const baseline = await client.query({
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

  const baselineData = await baseline.json<Array<{
    total_rows: number;
    unique_cids: number;
    unique_txs: number;
    vwc_rows: number;
    tref_rows: number;
  }>>();

  const b = baselineData[0];

  console.log();
  console.log('Before tref enrichment:');
  console.log(`  Total rows:                ${b.total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs:               ${b.unique_cids.toLocaleString()}`);
  console.log(`  Unique tx_hashes:          ${b.unique_txs.toLocaleString()}`);
  console.log(`  From vw_canonical:         ${b.vwc_rows.toLocaleString()} rows`);
  console.log(`  From raw_enriched:         ${b.tref_rows.toLocaleString()} rows`);
  console.log();

} catch (error: any) {
  console.error('❌ Baseline failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 2: Count how many rows will be inserted
// ============================================================================

console.log('Step 2: Count Insertable Rows from vw_tref_norm');
console.log('─'.repeat(80));

try {
  const countInsertable = await client.query({
    query: `
      SELECT count() AS insertable_rows
      FROM cascadian_clean.vw_tref_norm t
      LEFT JOIN cascadian_clean.fact_trades_clean f
        ON f.tx_hash = t.tx_hash
       AND f.cid_hex = t.cid_hex
       AND f.wallet_address = t.wallet_address
      WHERE f.tx_hash IS NULL
    `,
    format: 'JSONEachRow',
  });

  const insertData = await countInsertable.json<Array<{ insertable_rows: number }>>();

  console.log();
  console.log(`  Rows to insert from tref:  ${insertData[0].insertable_rows.toLocaleString()}`);
  console.log();

  if (insertData[0].insertable_rows === 0) {
    console.log('⚠️  No rows to insert - tref enrichment already complete!');
    await client.close();
    return;
  }

} catch (error: any) {
  console.error('❌ Count failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 3: Execute INSERT
// ============================================================================

console.log('Step 3: Insert Missing Trades from vw_tref_norm');
console.log('─'.repeat(80));
console.log();
console.log('Executing INSERT...');
console.log('(This may take 2-5 minutes for large datasets)');
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
      LEFT JOIN cascadian_clean.fact_trades_clean f
        ON f.tx_hash = t.tx_hash
       AND f.cid_hex = t.cid_hex
       AND f.wallet_address = t.wallet_address
      WHERE f.tx_hash IS NULL
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
// STEP 4: Verify post-enrichment counts
// ============================================================================

console.log('Step 4: Verify Post-Enrichment Counts');
console.log('─'.repeat(80));

try {
  const afterEnrichment = await client.query({
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

  const afterData = await afterEnrichment.json<Array<{
    total_rows: number;
    unique_cids: number;
    unique_txs: number;
    vwc_rows: number;
    tref_rows: number;
  }>>();

  const a = afterData[0];

  console.log();
  console.log('After tref enrichment:');
  console.log(`  Total rows:                ${a.total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs:               ${a.unique_cids.toLocaleString()}`);
  console.log(`  Unique tx_hashes:          ${a.unique_txs.toLocaleString()}`);
  console.log(`  From vw_canonical:         ${a.vwc_rows.toLocaleString()} rows`);
  console.log(`  From raw_enriched:         ${a.tref_rows.toLocaleString()} rows`);
  console.log();

  console.log('Improvement:');
  console.log(`  Rows added:                +${(a.total_rows - 63541468).toLocaleString()}`);
  console.log(`  CIDs added:                +${(a.unique_cids - 227838).toLocaleString()}`);
  console.log(`  Expected CID improvement:  ~18,185 CIDs`);
  console.log();

  if (a.unique_cids >= 245000) {
    console.log('✅ EXCELLENT: CID count suggests 99%+ coverage likely');
  } else if (a.unique_cids >= 234000) {
    console.log('✅ GOOD: CID count suggests 95%+ coverage likely');
  } else {
    console.log('⚠️  WARNING: CID count lower than expected');
  }

} catch (error: any) {
  console.error('❌ Post-enrichment verification failed:', error?.message || error);
}

console.log();
console.log('═'.repeat(80));
console.log('ENRICHMENT COMPLETE');
console.log('═'.repeat(80));
console.log();
console.log('Next step: Run final-gates-corrected.ts to measure G_traded');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
