#!/usr/bin/env npx tsx
/**
 * DIAGNOSE TRADED_ANY SOURCES
 *
 * Understand why TRADED_ANY has 411,673 CIDs when vw_trades_canonical
 * normalizes to only 227,838. What is trades_raw_enriched_final contributing?
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
console.log('DIAGNOSE TRADED_ANY SOURCES');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q1: What does vw_trades_canonical contribute (normalized)?
// ============================================================================

console.log('Q1: vw_trades_canonical normalized CID count');
console.log('─'.repeat(80));

try {
  const vwcNorm = await client.query({
    query: `
      SELECT uniqExact(
        CASE
          WHEN condition_id_norm LIKE 'token_%' THEN
            concat('0x', leftPad(
              lower(hex(intDiv(toUInt256(replaceAll(condition_id_norm,'token_','')), 256)))
            , 64, '0'))
          ELSE
            lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))
        END
      ) AS normalized_cids
      FROM default.vw_trades_canonical
      WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
    `,
    format: 'JSONEachRow',
  });

  const vwcData = await vwcNorm.json<Array<{ normalized_cids: number }>>();
  console.log();
  console.log(`  vw_trades_canonical (normalized): ${vwcData[0].normalized_cids.toLocaleString()} unique CIDs`);
  console.log();

} catch (error: any) {
  console.error('❌ Q1 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q2: What does trades_raw_enriched_final contribute?
// ============================================================================

console.log('Q2: trades_raw_enriched_final normalized CID count');
console.log('─'.repeat(80));

try {
  const trefNorm = await client.query({
    query: `
      SELECT uniqExact(
        lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0'))
      ) AS normalized_cids
      FROM default.trades_raw_enriched_final
      WHERE condition_id LIKE '0x%'
        AND condition_id != concat('0x', repeat('0',64))
    `,
    format: 'JSONEachRow',
  });

  const trefData = await trefNorm.json<Array<{ normalized_cids: number }>>();
  console.log();
  console.log(`  trades_raw_enriched_final (hex only): ${trefData[0].normalized_cids.toLocaleString()} unique CIDs`);
  console.log();

} catch (error: any) {
  console.error('❌ Q2 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q3: What is the UNION of both (should match TRADED_ANY)?
// ============================================================================

console.log('Q3: UNION of both sources (with DISTINCT)');
console.log('─'.repeat(80));

try {
  const unionCount = await client.query({
    query: `
      WITH combined AS (
        SELECT DISTINCT
          CASE
            WHEN condition_id_norm LIKE 'token_%' THEN
              concat('0x', leftPad(
                lower(hex(intDiv(toUInt256(replaceAll(condition_id_norm,'token_','')), 256)))
              , 64, '0'))
            ELSE
              lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))
          END AS cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))

        UNION ALL

        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid
        FROM default.trades_raw_enriched_final
        WHERE condition_id LIKE '0x%'
          AND condition_id != concat('0x', repeat('0',64))
      )
      SELECT uniqExact(cid) AS total_unique
      FROM combined
    `,
    format: 'JSONEachRow',
  });

  const unionData = await unionCount.json<Array<{ total_unique: number }>>();
  console.log();
  console.log(`  UNION of both (DISTINCT applied): ${unionData[0].total_unique.toLocaleString()} unique CIDs`);
  console.log();

  if (unionData[0].total_unique === 411673) {
    console.log('  ✅ Matches TRADED_ANY count from CORRECTED_GATES_MEASUREMENT');
  } else {
    console.log(`  ⚠️  Expected 411,673, got ${unionData[0].total_unique.toLocaleString()}`);
  }
  console.log();

} catch (error: any) {
  console.error('❌ Q3 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q4: Overlap between the two sources
// ============================================================================

console.log('Q4: Overlap between vw_trades_canonical and trades_raw_enriched_final');
console.log('─'.repeat(80));

try {
  const overlap = await client.query({
    query: `
      WITH
      vwc AS (
        SELECT DISTINCT
          CASE
            WHEN condition_id_norm LIKE 'token_%' THEN
              concat('0x', leftPad(
                lower(hex(intDiv(toUInt256(replaceAll(condition_id_norm,'token_','')), 256)))
              , 64, '0'))
            ELSE
              lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))
          END AS cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
      ),
      tref AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid
        FROM default.trades_raw_enriched_final
        WHERE condition_id LIKE '0x%'
          AND condition_id != concat('0x', repeat('0',64))
      )
      SELECT
        (SELECT count() FROM vwc) AS vwc_count,
        (SELECT count() FROM tref) AS tref_count,
        (SELECT count() FROM vwc WHERE cid IN (SELECT cid FROM tref)) AS overlap_count,
        (SELECT count() FROM vwc WHERE cid NOT IN (SELECT cid FROM tref)) AS vwc_only,
        (SELECT count() FROM tref WHERE cid NOT IN (SELECT cid FROM vwc)) AS tref_only
    `,
    format: 'JSONEachRow',
  });

  const overlapData = await overlap.json<Array<{
    vwc_count: number;
    tref_count: number;
    overlap_count: number;
    vwc_only: number;
    tref_only: number;
  }>>();

  const o = overlapData[0];

  console.log();
  console.log(`  vw_trades_canonical:              ${o.vwc_count.toLocaleString()} unique CIDs`);
  console.log(`  trades_raw_enriched_final:        ${o.tref_count.toLocaleString()} unique CIDs`);
  console.log(`  Overlap (in both):                ${o.overlap_count.toLocaleString()} (${(o.overlap_count / o.vwc_count * 100).toFixed(1)}%)`);
  console.log(`  Only in vwc:                      ${o.vwc_only.toLocaleString()}`);
  console.log(`  Only in tref:                     ${o.tref_only.toLocaleString()}`);
  console.log();

  const expectedUnion = o.vwc_only + o.tref_only + o.overlap_count;
  console.log(`  Expected UNION: ${o.vwc_only.toLocaleString()} + ${o.tref_only.toLocaleString()} + ${o.overlap_count.toLocaleString()} = ${expectedUnion.toLocaleString()}`);
  console.log();

} catch (error: any) {
  console.error('❌ Q4 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q5: Does trades_raw_enriched_final ALSO have token_ format?
// ============================================================================

console.log('Q5: Does trades_raw_enriched_final have token_ format CIDs?');
console.log('─'.repeat(80));

try {
  const trefFormats = await client.query({
    query: `
      SELECT
        countIf(condition_id LIKE 'token_%') AS token_count,
        countIf(condition_id LIKE '0x%') AS hex_count,
        countIf(condition_id NOT LIKE 'token_%' AND condition_id NOT LIKE '0x%') AS other_count
      FROM default.trades_raw_enriched_final
    `,
    format: 'JSONEachRow',
  });

  const formatData = await trefFormats.json<Array<{
    token_count: number;
    hex_count: number;
    other_count: number;
  }>>();

  console.log();
  console.log(`  token_ format:  ${formatData[0].token_count.toLocaleString()} rows`);
  console.log(`  hex format:     ${formatData[0].hex_count.toLocaleString()} rows`);
  console.log(`  other format:   ${formatData[0].other_count.toLocaleString()} rows`);
  console.log();

  if (formatData[0].token_count > 0) {
    console.log('  🔍 CRITICAL: trades_raw_enriched_final ALSO has token_ format!');
    console.log('     The CORRECTED_GATES_MEASUREMENT is NOT normalizing these!');
    console.log();
  }

} catch (error: any) {
  console.error('❌ Q5 failed:', error?.message || error);
}

console.log('═'.repeat(80));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
