#!/usr/bin/env npx tsx
/**
 * FINAL GATES VALIDATION - CORRECTED
 *
 * Fix: Properly deduplicate TRADED_ANY before counting overlap
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
console.log('FINAL GATES VALIDATION (CORRECTED)');
console.log('═'.repeat(80));
console.log();

try {
  const gates = await client.query({
    query: `
      WITH
      res AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
        FROM default.market_resolutions_final
        WHERE replaceOne(lower(condition_id_norm),'0x','') NOT IN ('', repeat('0',64))
      ),
      traded_any_deduped AS (
        SELECT DISTINCT cid FROM (
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
          WHERE condition_id_norm NOT IN ('','0x', concat('0x', repeat('0',64)))

          UNION ALL

          SELECT DISTINCT
            CASE
              WHEN lower(condition_id) LIKE 'token_%' THEN
                concat('0x', leftPad(
                  lower(hex(intDiv(toUInt256(replaceAll(condition_id,'token_','')), 256)))
                , 64, '0'))
              WHEN lower(condition_id) LIKE '0x%' THEN
                lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0'))
              ELSE NULL
            END AS cid
          FROM default.trades_raw_enriched_final
          WHERE condition_id IS NOT NULL
            AND condition_id != ''
            AND condition_id != '0x'
            AND condition_id != concat('0x', repeat('0',64))
        )
        WHERE cid IS NOT NULL
      ),
      fact AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      )
      SELECT
        (SELECT count() FROM res)                                              AS res_cids,
        (SELECT count() FROM traded_any_deduped)                               AS traded_cids_true,
        (SELECT count() FROM fact)                                             AS fact_cids,
        (SELECT count() FROM res WHERE cid IN (SELECT cid FROM fact))          AS overlap_res_fact,
        (SELECT count() FROM traded_any_deduped WHERE cid IN (SELECT cid FROM fact)) AS overlap_traded_fact,
        round(100.0 * overlap_res_fact   / nullIf(res_cids,        0), 2)     AS G_abs_pct,
        round(100.0 * overlap_traded_fact/ nullIf(traded_cids_true, 0), 2)    AS G_traded_pct,
        traded_cids_true - overlap_traded_fact                                 AS missing_cids
    `,
    format: 'JSONEachRow',
  });

  const gateData = await gates.json<Array<{
    res_cids: number;
    traded_cids_true: number;
    fact_cids: number;
    overlap_res_fact: number;
    overlap_traded_fact: number;
    G_abs_pct: number;
    G_traded_pct: number;
    missing_cids: number;
  }>>();

  const g = gateData[0];

  console.log('FINAL COVERAGE METRICS (Production - Corrected):');
  console.log();
  console.log(`  Resolved markets (RES):                 ${g.res_cids.toLocaleString()} CIDs`);
  console.log(`  Traded markets (TRADED_ANY):            ${g.traded_cids_true.toLocaleString()} CIDs`);
  console.log(`  Production FACT:                        ${g.fact_cids.toLocaleString()} CIDs`);
  console.log();
  console.log(`  RES ∩ FACT:                             ${g.overlap_res_fact.toLocaleString()} CIDs`);
  console.log(`  TRADED ∩ FACT:                          ${g.overlap_traded_fact.toLocaleString()} CIDs`);
  console.log();
  console.log(`  G_abs (% resolutions in FACT):          ${g.G_abs_pct}%`);
  console.log(`  G_traded (% traded in FACT):            ${g.G_traded_pct}%`);
  console.log();
  console.log(`  Missing from FACT:                      ${g.missing_cids.toLocaleString()} CIDs (${(100 - g.G_traded_pct).toFixed(2)}%)`);
  console.log();

  console.log('═'.repeat(80));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(80));
  console.log();

  if (g.G_traded_pct >= 99) {
    console.log(`✅ EXCELLENT: ${g.G_traded_pct}% ≥ 99%`);
    console.log();
    console.log('PRODUCTION READY - SHIP PNL FEATURE');
  } else if (g.G_traded_pct >= 95) {
    console.log(`✅ GOOD: ${g.G_traded_pct}% ≥ 95%`);
    console.log();
    console.log('PRODUCTION READY - SHIP PNL FEATURE');
  } else {
    console.log(`⚠️  BELOW THRESHOLD: ${g.G_traded_pct}% < 95%`);
    console.log();
    console.log('Further investigation needed');
  }
  console.log();

  console.log('Comparison vs Pre-Rebuild:');
  console.log(`  Before rebuild:  83.2%  (old fact_trades_clean)`);
  console.log(`  After rebuild:   ${g.G_traded_pct}%  (new fact_trades_clean)`);
  console.log(`  Improvement:     +${(g.G_traded_pct - 83.2).toFixed(2)} percentage points`);
  console.log();

} catch (error: any) {
  console.error('❌ Gates validation failed:', error?.message || error);
}

console.log('═'.repeat(80));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
