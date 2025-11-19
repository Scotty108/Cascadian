#!/usr/bin/env npx tsx
/**
 * VERIFY FACT_TRADES_V2 REBUILD
 *
 * Verify the rebuilt table and coverage metrics
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
console.log('VERIFY FACT_TRADES_V2 REBUILD');
console.log('═'.repeat(80));
console.log();

// Check table exists and row counts
try {
  const counts = await client.query({
    query: `
      SELECT
        (SELECT count() FROM cascadian_clean.fact_trades_clean) AS old_rows,
        (SELECT count() FROM cascadian_clean.fact_trades_v2) AS new_rows,
        (SELECT uniqExact(cid_hex) FROM cascadian_clean.fact_trades_clean) AS old_cids,
        (SELECT uniqExact(cid_hex) FROM cascadian_clean.fact_trades_v2) AS new_cids,
        (SELECT uniqExact(tx_hash) FROM cascadian_clean.fact_trades_clean) AS old_txs,
        (SELECT uniqExact(tx_hash) FROM cascadian_clean.fact_trades_v2) AS new_txs
    `,
    format: 'JSONEachRow',
  });

  const data = await counts.json<Array<{
    old_rows: number;
    new_rows: number;
    old_cids: number;
    new_cids: number;
    old_txs: number;
    new_txs: number;
  }>>();

  const d = data[0];

  console.log('Table Comparison:');
  console.log();
  console.log(`                            OLD (clean)      NEW (v2)        Improvement`);
  console.log(`  ${'─'.repeat(76)}`);
  console.log(`  Total rows:               ${d.old_rows.toLocaleString().padStart(15)} ${d.new_rows.toLocaleString().padStart(15)} +${(d.new_rows - d.old_rows).toLocaleString()}`);
  console.log(`  Unique condition IDs:     ${d.old_cids.toLocaleString().padStart(15)} ${d.new_cids.toLocaleString().padStart(15)} +${(d.new_cids - d.old_cids).toLocaleString()}`);
  console.log(`  Unique tx_hashes:         ${d.old_txs.toLocaleString().padStart(15)} ${d.new_txs.toLocaleString().padStart(15)} +${(d.new_txs - d.old_txs).toLocaleString()}`);
  console.log();

} catch (error: any) {
  console.error('❌ Table comparison failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// Source breakdown
try {
  const sources = await client.query({
    query: `
      SELECT
        source,
        count() AS rows,
        uniqExact(cid_hex) AS unique_cids,
        uniqExact(tx_hash) AS unique_txs
      FROM cascadian_clean.fact_trades_v2
      GROUP BY source
    `,
    format: 'JSONEachRow',
  });

  const sourceData = await sources.json<Array<{
    source: string;
    rows: number;
    unique_cids: number;
    unique_txs: number;
  }>>();

  console.log('Source Breakdown:');
  console.log();
  sourceData.forEach(row => {
    console.log(`  ${row.source}:`);
    console.log(`    Rows:         ${row.rows.toLocaleString()}`);
    console.log(`    Unique CIDs:  ${row.unique_cids.toLocaleString()}`);
    console.log(`    Unique txs:   ${row.unique_txs.toLocaleString()}`);
    console.log();
  });

} catch (error: any) {
  console.error('❌ Source breakdown failed:', error?.message || error);
}

console.log('═'.repeat(80));
console.log();

// Final coverage verification
try {
  const coverage = await client.query({
    query: `
      WITH
      res AS (
        SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
        FROM default.market_resolutions_final
        WHERE replaceOne(lower(condition_id_norm),'0x','') NOT IN ('', repeat('0',64))
      ),
      fact_v2 AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.fact_trades_v2
      ),
      traded_any AS (
        SELECT DISTINCT cid_hex AS cid
        FROM cascadian_clean.vw_traded_any_norm
      )
      SELECT
        (SELECT count() FROM res) AS res_cids,
        (SELECT count() FROM traded_any) AS traded_cids,
        (SELECT count() FROM fact_v2) AS fact_v2_cids,
        (SELECT count() FROM res WHERE cid IN (SELECT cid FROM fact_v2)) AS overlap_res_fact,
        (SELECT count() FROM traded_any WHERE cid IN (SELECT cid FROM fact_v2)) AS overlap_traded_fact,
        round(100.0 * overlap_res_fact / nullIf(res_cids, 0), 2) AS G_abs_pct,
        round(100.0 * overlap_traded_fact / nullIf(traded_cids, 0), 2) AS G_traded_pct,
        traded_cids - overlap_traded_fact AS missing_cids
    `,
    format: 'JSONEachRow',
  });

  const coverageData = await coverage.json<Array<{
    res_cids: number;
    traded_cids: number;
    fact_v2_cids: number;
    overlap_res_fact: number;
    overlap_traded_fact: number;
    G_abs_pct: number;
    G_traded_pct: number;
    missing_cids: number;
  }>>();

  const c = coverageData[0];

  console.log('Final Coverage Metrics:');
  console.log();
  console.log(`  Resolved markets (RES):           ${c.res_cids.toLocaleString()} CIDs`);
  console.log(`  Traded markets (TRADED_ANY):      ${c.traded_cids.toLocaleString()} CIDs`);
  console.log(`  fact_trades_v2:                   ${c.fact_v2_cids.toLocaleString()} CIDs`);
  console.log();
  console.log(`  RES ∩ FACT_V2:                    ${c.overlap_res_fact.toLocaleString()} CIDs`);
  console.log(`  TRADED ∩ FACT_V2:                 ${c.overlap_traded_fact.toLocaleString()} CIDs`);
  console.log();
  console.log(`  G_abs (% resolutions in FACT):    ${c.G_abs_pct}%`);
  console.log(`  G_traded (% traded in FACT):      ${c.G_traded_pct}%`);
  console.log();
  console.log(`  Missing from FACT_V2:             ${c.missing_cids.toLocaleString()} CIDs (${(100 - c.G_traded_pct).toFixed(2)}%)`);
  console.log();

  console.log('═'.repeat(80));
  console.log('RECOMMENDATION');
  console.log('═'.repeat(80));
  console.log();

  if (c.G_traded_pct >= 99) {
    console.log(`✅ EXCELLENT: ${c.G_traded_pct}% ≥ 99%`);
    console.log();
    console.log('SHIP PNL FEATURE WITH HIGH CONFIDENCE');
    console.log();
    console.log('Next steps:');
    console.log('  1. RENAME fact_trades_clean → fact_trades_backup');
    console.log('  2. RENAME fact_trades_v2 → fact_trades_clean');
    console.log('  3. Build resolved-market PnL views');
    console.log('  4. Deploy to production');
    console.log();
  } else if (c.G_traded_pct >= 95) {
    console.log(`✅ GOOD: ${c.G_traded_pct}% ≥ 95%`);
    console.log();
    console.log('SHIP PNL FEATURE');
    console.log();
    console.log('Next steps:');
    console.log('  1. RENAME fact_trades_clean → fact_trades_backup');
    console.log('  2. RENAME fact_trades_v2 → fact_trades_clean');
    console.log('  3. Build resolved-market PnL views');
    console.log('  4. Deploy');
    console.log();
  } else {
    console.log(`⚠️  BELOW THRESHOLD: ${c.G_traded_pct}% < 95%`);
    console.log();
    console.log('Further investigation needed');
    console.log();
  }

} catch (error: any) {
  console.error('❌ Coverage verification failed:', error?.message || error);
}

console.log('═'.repeat(80));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
