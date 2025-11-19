#!/usr/bin/env npx tsx
/**
 * FINAL CORRECTED GATES MEASUREMENT
 *
 * Fixes:
 * 1. Normalize token_ from BOTH vw_trades_canonical AND trades_raw_enriched_final
 * 2. Use uniqExact() to deduplicate across UNION ALL
 *
 * This is the TRUE measurement after fixing all format issues.
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
console.log('FINAL CORRECTED GATES MEASUREMENT');
console.log('═'.repeat(80));
console.log();

console.log('Fixes Applied:');
console.log('  1. Normalize token_ from vw_trades_canonical');
console.log('  2. Normalize token_ from trades_raw_enriched_final (was missing!)');
console.log('  3. Use uniqExact() to deduplicate across UNION ALL');
console.log();

try {
  const finalGates = await client.query({
    query: `
      WITH
      RES AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
        FROM default.market_resolutions_final
        WHERE replaceOne(lower(condition_id_norm),'0x','') NOT IN ('', repeat('0',64))
      ),
      FACT AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      ),
      TRADED_ANY_NORMALIZED AS (
        -- Normalize ALL condition IDs from vw_trades_canonical (including token_)
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

        -- Normalize ALL condition IDs from trades_raw_enriched_final (including token_!)
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
      TRADED_DISTINCT AS (
        SELECT DISTINCT cid
        FROM TRADED_ANY_NORMALIZED
        WHERE cid IS NOT NULL
      )
      SELECT
        (SELECT count() FROM RES)                                                          AS res_cids,
        (SELECT count() FROM FACT)                                                         AS fact_cids,
        (SELECT count() FROM RES  WHERE cid IN (SELECT cid FROM FACT))                     AS overlap_cids,
        round(100.0 * overlap_cids / nullIf((SELECT count() FROM RES),0), 2)               AS G_abs,
        (SELECT count() FROM TRADED_DISTINCT)                                              AS traded_cids_normalized,
        (SELECT count() FROM TRADED_DISTINCT WHERE cid IN (SELECT cid FROM FACT))          AS traded_overlap,
        round(100.0 * traded_overlap / nullIf((SELECT count() FROM TRADED_DISTINCT),0), 2) AS G_traded_corrected
    `,
    format: 'JSONEachRow',
  });

  const gates = await finalGates.json<Array<{
    res_cids: number;
    fact_cids: number;
    overlap_cids: number;
    G_abs: number;
    traded_cids_normalized: number;
    traded_overlap: number;
    G_traded_corrected: number;
  }>>();

  const gateData = gates[0];

  console.log('Results:');
  console.log(`  RES (resolutions):                      ${gateData.res_cids.toLocaleString()} condition IDs`);
  console.log(`  FACT (fact_trades_clean):               ${gateData.fact_cids.toLocaleString()} condition IDs`);
  console.log(`  Overlap (RES ∩ FACT):                   ${gateData.overlap_cids.toLocaleString()} condition IDs`);
  console.log(`  G_abs (% resolutions in FACT):          ${gateData.G_abs}%`);
  console.log();
  console.log(`  TRADED_ANY (normalized & deduped):      ${gateData.traded_cids_normalized.toLocaleString()} condition IDs`);
  console.log(`  Traded overlap (TRADED ∩ FACT):         ${gateData.traded_overlap.toLocaleString()} condition IDs`);
  console.log(`  G_traded_CORRECTED (final):             ${gateData.G_traded_corrected}%`);
  console.log();

  console.log('═'.repeat(80));
  console.log('COMPARISON');
  console.log('═'.repeat(80));
  console.log();
  console.log(`  OLD measurement (with duplicates):      94.17%`);
  console.log(`  OLD denominator (duplicated):           411,673 CIDs`);
  console.log();
  console.log(`  NEW measurement (normalized):           ${gateData.G_traded_corrected}%`);
  console.log(`  NEW denominator (deduplicated):         ${gateData.traded_cids_normalized.toLocaleString()} CIDs`);
  console.log(`  Reduction from normalization:           ${(411673 - gateData.traded_cids_normalized).toLocaleString()} CIDs (${((411673 - gateData.traded_cids_normalized) / 411673 * 100).toFixed(1)}%)`);
  console.log();

  console.log('═'.repeat(80));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(80));
  console.log();

  const G_traded = gateData.G_traded_corrected;

  if (G_traded >= 99) {
    console.log(`✅ EXCELLENT: ${G_traded}% ≥ 99%`);
    console.log();
    console.log('SHIP PNL FEATURE WITH HIGH CONFIDENCE');
    console.log();
    console.log('Coverage quality:');
    console.log('  • 99%+ of traded markets (normalized) in fact_trades_clean');
    console.log('  • Missing <1% unlikely to affect any major wallets');
    console.log();
    console.log('The previous 94.17% was a MEASUREMENT ERROR from:');
    console.log('  • Format duplicates (token_ vs hex)');
    console.log('  • UNION ALL not deduplicating');
    console.log('  • Missing normalization of trades_raw_enriched_final token_ rows');
    console.log();
    console.log('Next steps:');
    console.log('  1. Build wallet PnL views using fact_trades_clean');
    console.log('  2. Join with market_resolutions_final for outcomes');
    console.log('  3. Deploy to production TODAY');
    console.log();
  } else if (G_traded >= 95) {
    console.log(`✅ GOOD: ${G_traded}% ≥ 95%`);
    console.log();
    console.log('SHIP PNL FEATURE');
    console.log();
    console.log('Coverage quality:');
    console.log('  • 95%+ of traded markets (normalized) in fact_trades_clean');
    console.log('  • Can calculate accurate wallet metrics');
    console.log('  • Missing <5% acceptable for production');
    console.log();
    console.log('The previous 94.17% was inflated by format duplicates.');
    console.log('After normalization, coverage is sufficient to ship.');
    console.log();
  } else {
    console.log(`⚠️  BELOW THRESHOLD: ${G_traded}% < 95%`);
    console.log();
    console.log(`Still ${(95 - G_traded).toFixed(2)}% short of 95% threshold`);
    console.log();
    console.log('After fixing all format issues, there IS a real data gap.');
    console.log();
    console.log('Missing markets represent:');
    const missing_count = gateData.traded_cids_normalized - gateData.traded_overlap;
    console.log(`  • ${missing_count.toLocaleString()} condition IDs (${(100 - G_traded).toFixed(2)}% of traded markets)`);
    console.log();
    console.log('Options:');
    console.log('  A. Ship as beta with coverage disclaimer');
    console.log('  B. Investigate what specific markets are missing');
    console.log('  C. Perform targeted backfill for high-volume missing markets');
    console.log();
  }

} catch (error: any) {
  console.error('❌ Final gates failed:', error?.message || error);
  console.error('Stack:', error?.stack);
}

console.log('═'.repeat(80));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
