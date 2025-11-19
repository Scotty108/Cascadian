#!/usr/bin/env npx tsx
/**
 * CORRECTED GATES MEASUREMENT
 *
 * Fix: Normalize ALL condition IDs (decode token_ to hex) BEFORE counting
 *
 * This corrects the measurement error where token_ and 0x formats
 * for the SAME market were counted as separate condition IDs
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
console.log('CORRECTED GATES MEASUREMENT (With Token Normalization)');
console.log('═'.repeat(80));
console.log();

console.log('Fix: Normalize token_ to hex BEFORE counting unique CIDs');
console.log();

try {
  const correctedGates = await client.query({
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
        -- Normalize ALL condition IDs from vw_trades_canonical
        SELECT DISTINCT
          CASE
            WHEN condition_id_norm LIKE 'token_%' THEN
              -- Decode token_ format to hex
              concat('0x', leftPad(
                lower(hex(intDiv(toUInt256(replaceAll(condition_id_norm,'token_','')), 256)))
              , 64, '0'))
            ELSE
              -- Already hex format, just normalize
              lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))
          END AS cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))

        UNION ALL

        -- Add from trades_raw_enriched_final (already hex format)
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid
        FROM default.trades_raw_enriched_final
        WHERE condition_id LIKE '0x%'
          AND condition_id != concat('0x', repeat('0',64))
      )
      SELECT
        (SELECT count() FROM RES)                                                          AS res_cids,
        (SELECT count() FROM FACT)                                                         AS fact_cids,
        (SELECT count() FROM RES  WHERE cid IN (SELECT cid FROM FACT))                     AS overlap_cids,
        round(100.0 * overlap_cids / nullIf((SELECT count() FROM RES),0), 2)               AS G_abs,
        (SELECT count() FROM TRADED_ANY_NORMALIZED)                                        AS traded_cids_normalized,
        (SELECT count() FROM TRADED_ANY_NORMALIZED WHERE cid IN (SELECT cid FROM FACT))    AS traded_overlap,
        round(100.0 * traded_overlap / nullIf((SELECT count() FROM TRADED_ANY_NORMALIZED),0), 2) AS G_traded_corrected
    `,
    format: 'JSONEachRow',
  });

  const gates = await correctedGates.json<Array<{
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
  console.log(`  TRADED_ANY (normalized):                ${gateData.traded_cids_normalized.toLocaleString()} condition IDs`);
  console.log(`  Traded overlap (TRADED ∩ FACT):         ${gateData.traded_overlap.toLocaleString()} condition IDs`);
  console.log(`  G_traded_CORRECTED (normalized):        ${gateData.G_traded_corrected}%`);
  console.log();

  console.log('═'.repeat(80));
  console.log('COMPARISON');
  console.log('═'.repeat(80));
  console.log();
  console.log(`  OLD G_traded (with format duplicates):  94.17%`);
  console.log(`  NEW G_traded (normalized):              ${gateData.G_traded_corrected}%`);
  console.log(`  Improvement:                            +${(gateData.G_traded_corrected - 94.17).toFixed(2)}%`);
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
    console.log('  • The "missing 5.83%" was a measurement error from format duplicates');
    console.log('  • Actual data gap is minimal (<1%)');
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
  } else {
    console.log(`⚠️  BELOW THRESHOLD: ${G_traded}% < 95%`);
    console.log();
    console.log(`Still ${(95 - G_traded).toFixed(2)}% short of 95% threshold`);
    console.log();
    console.log('This means there IS a real data gap after normalization.');
    console.log('Further investigation needed.');
    console.log();
  }

} catch (error: any) {
  console.error('❌ Corrected gates failed:', error?.message || error);
}

console.log('═'.repeat(80));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
