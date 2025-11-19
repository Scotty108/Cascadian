#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function deepAnalysis() {
  console.log('=== DEEP COVERAGE ANALYSIS ===\n');

  // The confusion: JOIN returns 100% coverage but old report says 8%?
  // Let's check if it's a CROSS JOIN issue

  console.log('1. BASELINE: Total trades breakdown');
  const baseline = await client.query({
    query: `
      SELECT
        COUNT(*) as all_trades,
        SUM(CASE WHEN condition_id != '' THEN 1 ELSE 0 END) as has_condition_id,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_condition_id
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  });
  const base = await baseline.json<any>();
  console.log(`  All trades: ${parseInt(base[0].all_trades).toLocaleString()}`);
  console.log(`  Has condition_id: ${parseInt(base[0].has_condition_id).toLocaleString()} (${(parseInt(base[0].has_condition_id)/parseInt(base[0].all_trades)*100).toFixed(2)}%)`);
  console.log(`  Empty condition_id: ${parseInt(base[0].empty_condition_id).toLocaleString()} (${(parseInt(base[0].empty_condition_id)/parseInt(base[0].all_trades)*100).toFixed(2)}%)`);
  console.log();

  console.log('2. LEFT JOIN behavior check (should NOT multiply rows)');
  const joinBehavior = await client.query({
    query: `
      SELECT
        COUNT(*) as result_row_count,
        COUNT(DISTINCT t.trade_id) as unique_trades
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const join = await joinBehavior.json<any>();
  console.log(`  Result rows: ${parseInt(join[0].result_row_count).toLocaleString()}`);
  console.log(`  Unique trade_ids: ${parseInt(join[0].unique_trades).toLocaleString()}`);
  console.log(`  ${join[0].result_row_count === join[0].unique_trades ? '✅ No row multiplication (good)' : '❌ CROSS JOIN detected!'}`);
  console.log();

  console.log('3. Checking for duplicate resolutions per condition_id');
  const dupes = await client.query({
    query: `
      SELECT
        condition_id_norm,
        COUNT(*) as resolution_count
      FROM market_resolutions_final
      GROUP BY condition_id_norm
      HAVING COUNT(*) > 1
      ORDER BY resolution_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const dupesData = await dupes.json<any>();
  if (dupesData.length > 0) {
    console.log(`  ⚠️  Found ${dupesData.length} condition_ids with multiple resolutions:`);
    dupesData.forEach((d: any) => {
      console.log(`    ${d.condition_id_norm}: ${d.resolution_count} resolutions`);
    });
  } else {
    console.log('  ✅ No duplicate resolutions found (all condition_ids unique)');
  }
  console.log();

  console.log('4. ACTUAL resolution coverage (trades that CAN calculate P&L)');
  // The key question: Of trades with condition_id, how many have VALID payout data?
  const actual = await client.query({
    query: `
      SELECT
        COUNT(*) as total_trades_with_cid,
        SUM(CASE
          WHEN r.condition_id_norm IS NOT NULL
            AND length(r.payout_numerators) > 0
            AND r.payout_denominator > 0
            AND r.winning_index IS NOT NULL
          THEN 1 ELSE 0
        END) as can_calculate_pnl,
        SUM(CASE
          WHEN r.condition_id_norm IS NOT NULL
            AND (length(r.payout_numerators) = 0 OR r.payout_denominator = 0)
          THEN 1 ELSE 0
        END) as has_resolution_but_invalid_payout,
        SUM(CASE WHEN r.condition_id_norm IS NULL THEN 1 ELSE 0 END) as no_resolution
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const act = await actual.json<any>();
  const total = parseInt(act[0].total_trades_with_cid);
  const canCalc = parseInt(act[0].can_calculate_pnl);
  const invalid = parseInt(act[0].has_resolution_but_invalid_payout);
  const noRes = parseInt(act[0].no_resolution);

  console.log(`  Total trades with condition_id: ${total.toLocaleString()}`);
  console.log();
  console.log(`  ✅ CAN calculate P&L: ${canCalc.toLocaleString()} (${(canCalc/total*100).toFixed(2)}%)`);
  console.log(`     - Has resolution + valid payout data`);
  console.log();
  console.log(`  ⚠️  Has resolution but INVALID payout: ${invalid.toLocaleString()} (${(invalid/total*100).toFixed(2)}%)`);
  console.log(`     - payout_numerators empty OR payout_denominator = 0`);
  console.log();
  console.log(`  ❌ NO resolution at all: ${noRes.toLocaleString()} (${(noRes/total*100).toFixed(2)}%)`);
  console.log();

  console.log('5. Volume breakdown by P&L calculability');
  const volume = await client.query({
    query: `
      SELECT
        SUM(t.usd_value) as total_volume,
        SUM(CASE
          WHEN r.condition_id_norm IS NOT NULL
            AND length(r.payout_numerators) > 0
            AND r.payout_denominator > 0
          THEN t.usd_value ELSE 0
        END) as pnl_calculable_volume,
        SUM(CASE WHEN r.condition_id_norm IS NULL THEN t.usd_value ELSE 0 END) as no_resolution_volume
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const vol = await volume.json<any>();
  const totalVol = parseFloat(vol[0].total_volume);
  const calcVol = parseFloat(vol[0].pnl_calculable_volume);
  const noResVol = parseFloat(vol[0].no_resolution_volume);

  console.log(`  Total volume: $${totalVol.toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`  P&L calculable: $${calcVol.toLocaleString(undefined, {maximumFractionDigits: 2})} (${(calcVol/totalVol*100).toFixed(2)}%)`);
  console.log(`  No resolution: $${noResVol.toLocaleString(undefined, {maximumFractionDigits: 2})} (${(noResVol/totalVol*100).toFixed(2)}%)`);
  console.log();

  console.log('6. Understanding the 100% vs 8% discrepancy');
  console.log('   Theory: Earlier reports may have used INNER JOIN or different table');
  console.log();

  // Check if there's a difference between INNER and LEFT join counts
  const innerJoinTest = await client.query({
    query: `
      SELECT COUNT(*) as inner_join_count
      FROM trades_raw t
      INNER JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const inner = await innerJoinTest.json<any>();
  const innerCount = parseInt(inner[0].inner_join_count);

  console.log(`   LEFT JOIN result: ${total.toLocaleString()} rows`);
  console.log(`   INNER JOIN result: ${innerCount.toLocaleString()} rows`);
  console.log(`   Difference: ${(total - innerCount).toLocaleString()} rows (${((total-innerCount)/total*100).toFixed(2)}%)`);
  console.log();

  if (total - innerCount > 0) {
    console.log('   ❌ FOUND THE BUG: INNER JOIN filters out trades without resolutions!');
    console.log('   ✅ Should use LEFT JOIN to see full picture');
  }

  console.log();
  console.log('=== FINAL VERDICT ===\n');
  console.log('COVERAGE REALITY:');
  console.log(`  • ${(canCalc/total*100).toFixed(2)}% of trades (with condition_id) CAN calculate realized P&L`);
  console.log(`  • ${(noRes/total*100).toFixed(2)}% of trades have NO resolution (need unrealized P&L calculation)`);
  console.log(`  • ${(invalid/total*100).toFixed(2)}% of trades have invalid payout data (manual fix needed)`);
  console.log();
  console.log('RECOMMENDATION:');
  console.log('  1. Use market_resolutions_final as authoritative source ✅');
  console.log('  2. Fix 94 invalid payout denominators (gamma source) ⚠️');
  console.log('  3. Build unrealized P&L calculator for open positions 📊');
  console.log('  4. Recover condition_ids for 78.7M empty trades (ERC1155 backfill) 🔧');

  await client.close();
}

deepAnalysis().catch(console.error);
