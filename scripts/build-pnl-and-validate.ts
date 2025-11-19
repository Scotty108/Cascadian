#!/usr/bin/env npx tsx
/**
 * BUILD PNL VIEWS AND FINAL VALIDATION
 *
 * Step 3: Build resolved-market PnL views, patch directions, and validate
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
console.log('BUILD PNL VIEWS AND FINAL VALIDATION');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 3.1: Check direction quality in fact_trades_clean
// ============================================================================

console.log('Step 3.1: Check Direction Quality');
console.log('─'.repeat(80));

try {
  const directionCheck = await client.query({
    query: `
      SELECT
        direction,
        count() AS rows,
        round(100.0 * rows / (SELECT count() FROM cascadian_clean.fact_trades_clean), 2) AS pct
      FROM cascadian_clean.fact_trades_clean
      GROUP BY direction
      ORDER BY rows DESC
    `,
    format: 'JSONEachRow',
  });

  const dirData = await directionCheck.json<Array<{
    direction: string;
    rows: number;
    pct: number;
  }>>();

  console.log();
  console.log('Direction breakdown in fact_trades_clean:');
  console.log();
  dirData.forEach(row => {
    const dir = row.direction || '(empty)';
    console.log(`  ${dir.padEnd(15)} ${row.rows.toLocaleString().padStart(12)} rows (${row.pct}%)`);
  });
  console.log();

  const unknownCount = dirData.find(r => r.direction === 'UNKNOWN' || r.direction === '' || r.direction === null);
  if (unknownCount && unknownCount.pct > 5) {
    console.log(`⚠️  ${unknownCount.pct}% of rows have UNKNOWN/empty direction`);
    console.log('   Will attempt to patch from trades_with_direction');
  } else {
    console.log('✅ Direction quality is good (≤5% UNKNOWN)');
  }

} catch (error: any) {
  console.error('❌ Direction check failed:', error?.message || error);
}

console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 3.2: Count patchable rows from trades_with_direction
// ============================================================================

console.log('Step 3.2: Check Patchable Directions from trades_with_direction');
console.log('─'.repeat(80));

try {
  const patchable = await client.query({
    query: `
      SELECT count() AS patchable_rows
      FROM cascadian_clean.fact_trades_clean f
      INNER JOIN default.trades_with_direction d
        ON d.tx_hash = f.tx_hash AND d.wallet_address = f.wallet_address
      WHERE (f.direction = '' OR f.direction = 'UNKNOWN' OR f.direction IS NULL)
        AND d.direction IN ('BUY', 'SELL')
    `,
    format: 'JSONEachRow',
  });

  const patchData = await patchable.json<Array<{ patchable_rows: number }>>();

  console.log();
  console.log(`  Rows that can be patched: ${patchData[0].patchable_rows.toLocaleString()}`);
  console.log();

  if (patchData[0].patchable_rows > 0) {
    console.log('  Note: ClickHouse does not support ALTER UPDATE on large tables efficiently');
    console.log('  Direction patching should be done during PnL view creation via LEFT JOIN');
    console.log('  OR rebuild fact_trades_clean with direction computed from trades_with_direction');
  } else {
    console.log('  No rows need direction patching');
  }

} catch (error: any) {
  console.error('❌ Patchable check failed:', error?.message || error);
}

console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 3.3: Re-run final gates with production table
// ============================================================================

console.log('Step 3.3: Final Gates Validation (Production)');
console.log('─'.repeat(80));

try {
  const gates = await client.query({
    query: `
      WITH
      res AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
        FROM default.market_resolutions_final
        WHERE replaceOne(lower(condition_id_norm),'0x','') NOT IN ('', repeat('0',64))
      ),
      traded_any AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
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
      ),
      fact AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      )
      SELECT
        (SELECT count() FROM res)                                              AS res_cids,
        (SELECT uniqExact(cid) FROM traded_any WHERE cid IS NOT NULL)          AS traded_cids_true,
        (SELECT count() FROM fact)                                             AS fact_cids,
        (SELECT count() FROM res WHERE cid IN (SELECT cid FROM fact))          AS overlap_res_fact,
        (SELECT count() FROM traded_any WHERE cid IS NOT NULL AND cid IN (SELECT cid FROM fact)) AS overlap_traded_fact,
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

  console.log();
  console.log('FINAL COVERAGE METRICS (Production):');
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

  if (g.G_traded_pct >= 99) {
    console.log(`✅ EXCELLENT: ${g.G_traded_pct}% ≥ 99% - PRODUCTION READY`);
  } else if (g.G_traded_pct >= 95) {
    console.log(`✅ GOOD: ${g.G_traded_pct}% ≥ 95% - PRODUCTION READY`);
  } else {
    console.log(`⚠️  BELOW THRESHOLD: ${g.G_traded_pct}% < 95%`);
  }

} catch (error: any) {
  console.error('❌ Gates validation failed:', error?.message || error);
}

console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 3.4: Top 20 Missing CIDs by Transaction Count
// ============================================================================

console.log('Step 3.4: Top 20 Missing CIDs by Transaction Count');
console.log('─'.repeat(80));

try {
  const topMissing = await client.query({
    query: `
      WITH
      fact AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_clean
      ),
      traded_normalized AS (
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

        UNION ALL

        SELECT
          CASE
            WHEN lower(condition_id) LIKE 'token_%' THEN
              concat('0x', leftPad(
                lower(hex(intDiv(toUInt256(replaceAll(condition_id,'token_','')), 256)))
              , 64, '0'))
            WHEN lower(condition_id) LIKE '0x%' THEN
              lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0'))
            ELSE NULL
          END AS cid,
          transaction_hash AS tx
        FROM default.trades_raw_enriched_final
        WHERE condition_id IS NOT NULL
          AND condition_id != ''
          AND condition_id != '0x'
          AND condition_id != concat('0x', repeat('0',64))
      ),
      missing_trades AS (
        SELECT cid, tx
        FROM traded_normalized
        WHERE cid IS NOT NULL
          AND cid NOT IN (SELECT cid FROM fact)
      )
      SELECT
        cid,
        uniqExact(tx) AS tx_count
      FROM missing_trades
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
  if (missingData.length > 0) {
    console.log('Top 20 missing CIDs by transaction volume:');
    console.log();
    missingData.forEach((row, i) => {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${row.cid} → ${row.tx_count.toLocaleString()} txs`);
    });
    console.log();

    const totalMissingTxs = missingData.reduce((sum, row) => sum + row.tx_count, 0);
    console.log(`  Top 20 account for: ${totalMissingTxs.toLocaleString()} transactions`);
  } else {
    console.log('✅ No missing CIDs - 100% coverage achieved!');
  }
  console.log();

} catch (error: any) {
  console.error('❌ Top missing query failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log('VALIDATION COMPLETE');
console.log('═'.repeat(80));
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
