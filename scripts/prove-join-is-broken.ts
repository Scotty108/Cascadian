#!/usr/bin/env npx tsx
/**
 * Prove the P&L View Join is Broken
 *
 * If 100% of traded markets exist in resolution tables,
 * but only 11.88% of positions resolve, the join is broken.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n🔬 PROVING THE JOIN IS BROKEN\n');
  console.log('═'.repeat(80));

  // Test 1: Direct join (bypassing view)
  console.log('\n1️⃣ Direct join test (100 positions):\n');

  const directTest = await ch.query({
    query: `
      WITH
        test_positions AS (
          SELECT
            wallet_address,
            cid,
            outcome_index,
            lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
          LIMIT 100
        ),
        all_resolutions AS (
          SELECT
            lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm,
            payout_numerators,
            payout_denominator
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT
            lower(replaceAll(condition_id, '0x', '')) as cid_norm,
            payout_numerators,
            payout_denominator
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN r.payout_denominator > 0 THEN 1 END) as with_resolution,
        ROUND(with_resolution / total_positions * 100, 1) as coverage_pct
      FROM test_positions t
      LEFT JOIN all_resolutions r ON t.cid_norm = r.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const directData = await directTest.json<any>();
  console.log(`  Sample: 100 positions`);
  console.log(`  With resolution: ${directData[0].with_resolution}`);
  console.log(`  Coverage: ${directData[0].coverage_pct}%\n`);

  // Test 2: What the P&L view shows
  console.log('2️⃣ P&L view shows:\n');

  const viewTest = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as with_resolution,
        ROUND(with_resolution / total_positions * 100, 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });

  const viewData = await viewTest.json<any>();
  console.log(`  Total positions: ${parseInt(viewData[0].total_positions).toLocaleString()}`);
  console.log(`  With resolution: ${parseInt(viewData[0].with_resolution).toLocaleString()}`);
  console.log(`  Coverage: ${viewData[0].coverage_pct}%\n`);

  // Test 3: Check the view definition
  console.log('3️⃣ Checking view definition:\n');

  const viewDef = await ch.query({
    query: `SHOW CREATE TABLE default.vw_wallet_pnl_calculated`,
    format: 'JSONEachRow'
  });

  const viewDefData = await viewDef.json<any>();
  const createStmt = viewDefData[0].statement;

  // Check normalization
  const hasTradeNorm = createStmt.includes("lower(replaceAll(t.cid, '0x', ''))");
  const hasResNorm = createStmt.includes("lower(replaceAll(") && createStmt.includes("condition_id");

  console.log(`  Trade ID normalization: ${hasTradeNorm ? '✓' : '✗'}`);
  console.log(`  Resolution ID normalization: ${hasResNorm ? '✓' : '✗'}\n`);

  // Extract JOIN clause
  const joinMatch = createStmt.match(/LEFT JOIN.*?ON.*?(?=WHERE|GROUP|SELECT|ORDER|LIMIT|$)/s);
  if (joinMatch) {
    console.log(`  JOIN clause (first 300 chars):`);
    console.log(`  ${joinMatch[0].substring(0, 300)}...\n`);
  }

  console.log('═'.repeat(80));
  console.log('📊 VERDICT\n');

  const directCoverage = parseFloat(directData[0].coverage_pct);
  const viewCoverage = parseFloat(viewData[0].coverage_pct);

  if (directCoverage > 80 && viewCoverage < 20) {
    console.log('🚨 JOIN IS DEFINITELY BROKEN!');
    console.log(`   Direct join: ${directCoverage}% coverage`);
    console.log(`   View shows: ${viewCoverage}% coverage`);
    console.log(`\n   The view is NOT using the correct join logic!\n`);
  } else if (directCoverage > viewCoverage + 10) {
    console.log('⚠️  View has issues');
    console.log(`   Direct join: ${directCoverage}%`);
    console.log(`   View: ${viewCoverage}%\n`);
  } else {
    console.log('✅ View matches direct join');
    console.log(`   Both show ~${viewCoverage}% coverage\n`);
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
