#!/usr/bin/env npx tsx
/**
 * ANALYZE REAL MISSING GAP
 *
 * After proper normalization, we have 83.2% coverage (41,343 missing CIDs).
 * This script investigates WHAT these missing markets are.
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
console.log('ANALYZE REAL MISSING GAP (83.2% Coverage)');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q1: Which table is the missing CIDs in? vwc or tref?
// ============================================================================

console.log('Q1: Which source table contains the missing CIDs?');
console.log('─'.repeat(80));

try {
  const sourceAnalysis = await client.query({
    query: `
      WITH
      FACT AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      ),
      VWC_NORM AS (
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
      TREF_NORM AS (
        SELECT DISTINCT
          CASE
            WHEN condition_id LIKE 'token_%' THEN
              concat('0x', leftPad(
                lower(hex(intDiv(toUInt256(replaceAll(condition_id,'token_','')), 256)))
              , 64, '0'))
            WHEN condition_id LIKE '0x%' THEN
              lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0'))
            ELSE
              NULL
          END AS cid
        FROM default.trades_raw_enriched_final
        WHERE condition_id != ''
          AND condition_id != '0x'
          AND condition_id != concat('0x', repeat('0',64))
      )
      SELECT
        'vwc only (not in FACT)' AS source,
        toString(countIf(cid NOT IN (SELECT cid FROM FACT))) AS missing_count
      FROM VWC_NORM
      UNION ALL
      SELECT 'tref only (not in FACT)',
        toString(countIf(cid NOT IN (SELECT cid FROM FACT)))
      FROM TREF_NORM
      WHERE cid IS NOT NULL
      UNION ALL
      SELECT 'vwc total',
        toString(count())
      FROM VWC_NORM
      UNION ALL
      SELECT 'tref total',
        toString(count())
      FROM TREF_NORM
      WHERE cid IS NOT NULL
    `,
    format: 'JSONEachRow',
  });

  const sourceData = await sourceAnalysis.json<Array<{ source: string; missing_count: string }>>();
  console.log();
  sourceData.forEach(row => {
    console.log(`  ${row.source.padEnd(35)} ${row.missing_count.padStart(10)}`);
  });
  console.log();

} catch (error: any) {
  console.error('❌ Q1 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q2: Transaction volume of missing CIDs
// ============================================================================

console.log('Q2: How many transactions are on the missing CIDs?');
console.log('─'.repeat(80));

try {
  const txVolume = await client.query({
    query: `
      WITH
      FACT AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      ),
      TRADED_NORM AS (
        SELECT DISTINCT
          CASE
            WHEN condition_id_norm LIKE 'token_%' THEN
              concat('0x', leftPad(
                lower(hex(intDiv(toUInt256(replaceAll(condition_id_norm,'token_','')), 256)))
              , 64, '0'))
            ELSE
              lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))
          END AS cid,
          transaction_hash AS tx
        FROM default.vw_trades_canonical
        WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
      ),
      MISSING_TRADES AS (
        SELECT tx
        FROM TRADED_NORM
        WHERE cid NOT IN (SELECT cid FROM FACT)
      )
      SELECT
        (SELECT uniqExact(tx) FROM TRADED_NORM) AS total_txs,
        (SELECT uniqExact(tx) FROM MISSING_TRADES) AS missing_txs,
        round(100.0 * missing_txs / total_txs, 2) AS pct_missing_txs
    `,
    format: 'JSONEachRow',
  });

  const volData = await txVolume.json<Array<{
    total_txs: number;
    missing_txs: number;
    pct_missing_txs: number;
  }>>();

  console.log();
  console.log(`  Total transactions:        ${volData[0].total_txs.toLocaleString()}`);
  console.log(`  Missing transactions:      ${volData[0].missing_txs.toLocaleString()}`);
  console.log(`  Percentage missing:        ${volData[0].pct_missing_txs}%`);
  console.log();

} catch (error: any) {
  console.error('❌ Q2 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q3: Sample of missing CIDs
// ============================================================================

console.log('Q3: Sample of top missing CIDs by transaction volume');
console.log('─'.repeat(80));

try {
  const topMissing = await client.query({
    query: `
      WITH
      FACT AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      ),
      MISSING_CIDS AS (
        SELECT
          CASE
            WHEN condition_id_norm LIKE 'token_%' THEN
              concat('0x', leftPad(
                lower(hex(intDiv(toUInt256(replaceAll(condition_id_norm,'token_','')), 256)))
              , 64, '0'))
            ELSE
              lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))
          END AS cid,
          transaction_hash AS tx
        FROM default.vw_trades_canonical
        WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
      )
      SELECT
        cid,
        uniqExact(tx) AS tx_count
      FROM MISSING_CIDS
      WHERE cid NOT IN (SELECT cid FROM FACT)
      GROUP BY cid
      ORDER BY tx_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const missingData = await topMissing.json<Array<{
    cid: string;
    tx_count: number;
  }>>();

  console.log();
  console.log('Top 20 missing CIDs by transaction volume:');
  console.log();
  missingData.forEach((row, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${row.cid} → ${row.tx_count.toLocaleString()} txs`);
  });
  console.log();

  const totalMissingTxs = missingData.reduce((sum, row) => sum + row.tx_count, 0);
  console.log(`  Top 20 account for: ${totalMissingTxs.toLocaleString()} transactions`);
  console.log();

} catch (error: any) {
  console.error('❌ Q3 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q4: Are the missing CIDs in the raw tables but not mapped?
// ============================================================================

console.log('Q4: Are missing CIDs in trades_raw but failed to map to fact_trades?');
console.log('─'.repeat(80));

try {
  const rawPresence = await client.query({
    query: `
      WITH
      FACT AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      ),
      MISSING_FROM_VWC AS (
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
          AND (
            CASE
              WHEN condition_id_norm LIKE 'token_%' THEN
                concat('0x', leftPad(
                  lower(hex(intDiv(toUInt256(replaceAll(condition_id_norm,'token_','')), 256)))
                , 64, '0'))
              ELSE
                lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))
            END
          ) NOT IN (SELECT cid FROM FACT)
      ),
      RAW_CIDS AS (
        SELECT DISTINCT
          lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid
        FROM default.trades_raw
        WHERE condition_id LIKE '0x%'
          AND condition_id != concat('0x', repeat('0',64))
      )
      SELECT
        (SELECT count() FROM MISSING_FROM_VWC) AS missing_count,
        (SELECT count() FROM MISSING_FROM_VWC WHERE cid IN (SELECT cid FROM RAW_CIDS)) AS in_raw,
        (SELECT count() FROM MISSING_FROM_VWC WHERE cid NOT IN (SELECT cid FROM RAW_CIDS)) AS not_in_raw
    `,
    format: 'JSONEachRow',
  });

  const rawData = await rawPresence.json<Array<{
    missing_count: number;
    in_raw: number;
    not_in_raw: number;
  }>>();

  console.log();
  console.log(`  Missing CIDs (from vwc):           ${rawData[0].missing_count.toLocaleString()}`);
  console.log(`  Present in trades_raw:             ${rawData[0].in_raw.toLocaleString()} (${(rawData[0].in_raw / rawData[0].missing_count * 100).toFixed(1)}%)`);
  console.log(`  NOT in trades_raw:                 ${rawData[0].not_in_raw.toLocaleString()} (${(rawData[0].not_in_raw / rawData[0].missing_count * 100).toFixed(1)}%)`);
  console.log();

  if (rawData[0].in_raw / rawData[0].missing_count > 0.9) {
    console.log('  🔍 FINDING: >90% of missing CIDs ARE in trades_raw!');
    console.log('     The gap is a PIPELINE ISSUE - data exists but wasn\'t mapped to fact_trades.');
    console.log();
  } else if (rawData[0].not_in_raw / rawData[0].missing_count > 0.9) {
    console.log('  🔍 FINDING: >90% of missing CIDs are NOT in trades_raw!');
    console.log('     The gap is a DATA SOURCE ISSUE - these markets were never ingested.');
    console.log();
  }

} catch (error: any) {
  console.error('❌ Q4 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

console.log('SUMMARY');
console.log('═'.repeat(80));
console.log();
console.log('After fixing all normalization errors:');
console.log('  • TRUE coverage: 83.2% (not 94.17%)');
console.log('  • Missing: 41,343 condition IDs');
console.log('  • Gap type: [See Q4 above]');
console.log();
console.log('Decision tree:');
console.log('  • If missing CIDs are in trades_raw → Fix pipeline/mapping');
console.log('  • If missing CIDs are NOT in trades_raw → Need additional data source');
console.log('  • If missing txs are <5% of volume → Acceptable to ship with disclaimer');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
