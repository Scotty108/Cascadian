#!/usr/bin/env npx tsx
/**
 * DIAGNOSE FACT_TRADES SOURCE
 *
 * Determine which table fact_trades_clean was built from:
 * - trades_raw?
 * - trades_raw_enriched_final?
 * - vw_trades_canonical?
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
console.log('DIAGNOSE FACT_TRADES SOURCE');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q1: Transaction overlap with each source
// ============================================================================

console.log('Q1: Which source table has the most overlap with fact_trades_clean?');
console.log('─'.repeat(80));

try {
  const overlap = await client.query({
    query: `
      WITH
      FACT_TXS AS (
        SELECT DISTINCT tx_hash AS tx
        FROM cascadian_clean.fact_trades_clean
      ),
      RAW_TXS AS (
        SELECT DISTINCT transaction_hash AS tx
        FROM default.trades_raw
        WHERE transaction_hash != ''
      ),
      ENRICHED_TXS AS (
        SELECT DISTINCT transaction_hash AS tx
        FROM default.trades_raw_enriched_final
        WHERE transaction_hash != ''
      ),
      VWC_TXS AS (
        SELECT DISTINCT transaction_hash AS tx
        FROM default.vw_trades_canonical
        WHERE transaction_hash != ''
      )
      SELECT
        'fact_trades_clean' AS source,
        toString((SELECT count() FROM FACT_TXS)) AS tx_count,
        '' AS overlap_pct
      UNION ALL
      SELECT 'trades_raw',
        toString((SELECT count() FROM RAW_TXS)),
        toString(round(100.0 * (SELECT countIf(tx IN (SELECT tx FROM FACT_TXS)) FROM RAW_TXS) / (SELECT count() FROM FACT_TXS), 2)) || '%'
      UNION ALL
      SELECT 'trades_raw_enriched_final',
        toString((SELECT count() FROM ENRICHED_TXS)),
        toString(round(100.0 * (SELECT countIf(tx IN (SELECT tx FROM FACT_TXS)) FROM ENRICHED_TXS) / (SELECT count() FROM FACT_TXS), 2)) || '%'
      UNION ALL
      SELECT 'vw_trades_canonical',
        toString((SELECT count() FROM VWC_TXS)),
        toString(round(100.0 * (SELECT countIf(tx IN (SELECT tx FROM FACT_TXS)) FROM VWC_TXS) / (SELECT count() FROM FACT_TXS), 2)) || '%'
    `,
    format: 'JSONEachRow',
  });

  const overlapData = await overlap.json<Array<{
    source: string;
    tx_count: string;
    overlap_pct: string;
  }>>();

  console.log();
  console.log('Source table overlap with fact_trades_clean:');
  console.log();
  overlapData.forEach(row => {
    const pct = row.overlap_pct ? `(${row.overlap_pct} overlap)` : '';
    console.log(`  ${row.source.padEnd(30)} ${row.tx_count.padStart(15)} txs  ${pct}`);
  });
  console.log();

} catch (error: any) {
  console.error('❌ Q1 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q2: CID overlap with each source
// ============================================================================

console.log('Q2: Which source has the most CID overlap with fact_trades_clean?');
console.log('─'.repeat(80));

try {
  const cidOverlap = await client.query({
    query: `
      WITH
      FACT_CIDS AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      ),
      RAW_CIDS AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid
        FROM default.trades_raw
        WHERE condition_id LIKE '0x%'
          AND condition_id != concat('0x', repeat('0',64))
      ),
      ENRICHED_CIDS AS (
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
      ),
      VWC_CIDS AS (
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
      )
      SELECT
        'fact_trades_clean' AS source,
        toString((SELECT count() FROM FACT_CIDS)) AS cid_count,
        '' AS coverage_pct
      UNION ALL
      SELECT 'trades_raw',
        toString((SELECT count() FROM RAW_CIDS)),
        toString(round(100.0 * (SELECT countIf(cid IN (SELECT cid FROM FACT_CIDS)) FROM RAW_CIDS) / (SELECT count() FROM RAW_CIDS), 2)) || '%'
      UNION ALL
      SELECT 'trades_raw_enriched_final',
        toString((SELECT count() FROM ENRICHED_CIDS WHERE cid IS NOT NULL)),
        toString(round(100.0 * (SELECT countIf(cid IN (SELECT cid FROM FACT_CIDS)) FROM ENRICHED_CIDS WHERE cid IS NOT NULL) / (SELECT count() FROM ENRICHED_CIDS WHERE cid IS NOT NULL), 2)) || '%'
      UNION ALL
      SELECT 'vw_trades_canonical',
        toString((SELECT count() FROM VWC_CIDS)),
        toString(round(100.0 * (SELECT countIf(cid IN (SELECT cid FROM FACT_CIDS)) FROM VWC_CIDS) / (SELECT count() FROM VWC_CIDS), 2)) || '%'
    `,
    format: 'JSONEachRow',
  });

  const cidData = await cidOverlap.json<Array<{
    source: string;
    cid_count: string;
    coverage_pct: string;
  }>>();

  console.log();
  console.log('CID overlap (what % of source CIDs are in fact_trades_clean):');
  console.log();
  cidData.forEach(row => {
    const pct = row.coverage_pct ? `(${row.coverage_pct} in FACT)` : '';
    console.log(`  ${row.source.padEnd(30)} ${row.cid_count.padStart(10)} CIDs  ${pct}`);
  });
  console.log();

} catch (error: any) {
  console.error('❌ Q2 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// Q3: Reverse coverage - what % of FACT is in each source?
// ============================================================================

console.log('Q3: Reverse coverage - what % of fact_trades CIDs come from each source?');
console.log('─'.repeat(80));

try {
  const reverseCoverage = await client.query({
    query: `
      WITH
      FACT_CIDS AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      ),
      RAW_CIDS AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid
        FROM default.trades_raw
        WHERE condition_id LIKE '0x%'
          AND condition_id != concat('0x', repeat('0',64))
      ),
      ENRICHED_CIDS AS (
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
      ),
      VWC_CIDS AS (
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
      )
      SELECT
        'trades_raw' AS source,
        toString(round(100.0 * (SELECT countIf(cid IN (SELECT cid FROM RAW_CIDS)) FROM FACT_CIDS) / (SELECT count() FROM FACT_CIDS), 2)) || '%' AS pct_of_fact
      UNION ALL
      SELECT 'trades_raw_enriched_final',
        toString(round(100.0 * (SELECT countIf(cid IN (SELECT cid FROM ENRICHED_CIDS)) FROM FACT_CIDS) / (SELECT count() FROM FACT_CIDS), 2)) || '%'
      UNION ALL
      SELECT 'vw_trades_canonical',
        toString(round(100.0 * (SELECT countIf(cid IN (SELECT cid FROM VWC_CIDS)) FROM FACT_CIDS) / (SELECT count() FROM FACT_CIDS), 2)) || '%'
    `,
    format: 'JSONEachRow',
  });

  const reverseData = await reverseCoverage.json<Array<{
    source: string;
    pct_of_fact: string;
  }>>();

  console.log();
  console.log('What % of fact_trades_clean CIDs are also in each source:');
  console.log();
  reverseData.forEach(row => {
    console.log(`  ${row.source.padEnd(30)} ${row.pct_of_fact.padStart(10)}`);
  });
  console.log();

  console.log('Interpretation:');
  console.log('  • 100% = fact_trades was built from this source');
  console.log('  • <100% = fact_trades has CIDs not in this source');
  console.log('  • >100% not possible (FACT is subset)');
  console.log();

} catch (error: any) {
  console.error('❌ Q3 failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

console.log('CONCLUSION');
console.log('═'.repeat(80));
console.log();
console.log('Based on overlap percentages:');
console.log('  • If trades_raw covers 100% of FACT → built from trades_raw');
console.log('  • If trades_raw_enriched_final covers 100% → built from enriched');
console.log('  • If vw_trades_canonical covers 100% → built from canonical view');
console.log();
console.log('The missing 16.8% gap suggests fact_trades should be rebuilt from a richer source.');
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
