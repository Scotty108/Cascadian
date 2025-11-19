#!/usr/bin/env npx tsx
/**
 * Debug P&L View Join Bug
 *
 * If 100% of markets are resolved but only 11.92% of positions are,
 * there's a fundamental bug in the view join logic.
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
  console.log('\n🐛 DEBUGGING P&L VIEW JOIN BUG\n');
  console.log('═'.repeat(80));

  // Test: Sample 10 markets and check if they resolve in the view
  console.log('\n1️⃣ Testing sample markets:\n');

  const sampleMarkets = await ch.query({
    query: `
      SELECT DISTINCT
        cid as condition_id_raw,
        lower(replaceAll(cid, '0x', '')) as condition_id_norm
      FROM default.fact_trades_clean
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleMarkets.json<any>();

  for (const sample of samples) {
    console.log(`\n  Testing: ${sample.condition_id_norm.substring(0, 32)}...`);

    // Check if it exists in all_resolutions CTE
    const resCheck = await ch.query({
      query: `
        WITH all_resolutions AS (
          SELECT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
        SELECT COUNT(*) as count
        FROM all_resolutions
        WHERE cid_norm = '${sample.condition_id_norm}'
      `,
      format: 'JSONEachRow'
    });

    const resData = await resCheck.json<any>();
    console.log(`    In all_resolutions CTE: ${resData[0].count > 0 ? 'YES ✓' : 'NO ✗'}`);

    // Check if positions from this market have resolutions in the view
    const viewCheck = await ch.query({
      query: `
        SELECT
          condition_id,
          COUNT(*) as positions,
          COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved
        FROM default.vw_wallet_pnl_calculated
        WHERE lower(replaceAll(condition_id, '0x', '')) = '${sample.condition_id_norm}'
        GROUP BY condition_id
      `,
      format: 'JSONEachRow'
    });

    const viewData = await viewCheck.json<any>();

    if (viewData.length > 0) {
      const v = viewData[0];
      console.log(`    In vw_wallet_pnl_calculated: ${v.positions} positions, ${v.resolved} resolved`);
      if (parseInt(v.resolved) === 0 && resData[0].count > 0) {
        console.log(`    ⚠️  BUG: Resolution exists but view shows 0 resolved!`);
      }
    } else {
      console.log(`    In vw_wallet_pnl_calculated: NO positions found`);
    }
  }

  // Check the actual view definition
  console.log('\n2️⃣ Checking view join logic:\n');

  const viewDef = await ch.query({
    query: `SHOW CREATE TABLE default.vw_wallet_pnl_calculated`,
    format: 'JSONEachRow'
  });

  const viewDefData = await viewDef.json<any>();
  const createStmt = viewDefData[0].statement;

  // Extract the JOIN clause
  const joinMatch = createStmt.match(/LEFT JOIN.*?ON.*?(?=WHERE|GROUP|SELECT|$)/s);
  if (joinMatch) {
    console.log(`  JOIN clause:`);
    console.log(`  ${joinMatch[0].substring(0, 200)}...\n`);
  }

  // Check if condition_id normalization is correct
  if (createStmt.includes('lower(replaceAll(t.cid, \'0x\', \'\'))')) {
    console.log(`  ✅ Trade condition_id normalization looks correct\n`);
  } else {
    console.log(`  ⚠️  Trade condition_id normalization may be wrong\n`);
  }

  if (createStmt.includes('lower(replaceAll(condition_id_norm, \'0x\', \'\'))') ||
      createStmt.includes('lower(replaceAll(condition_id, \'0x\', \'\'))')) {
    console.log(`  ✅ Resolution condition_id normalization looks correct\n`);
  } else {
    console.log(`  ⚠️  Resolution condition_id normalization may be wrong\n`);
  }

  // Test the exact JOIN that the view uses
  console.log('3️⃣ Testing the view\'s JOIN logic directly:\n');

  const directTest = await ch.query({
    query: `
      WITH
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
        ),
        trade_positions AS (
          SELECT
            wallet_address as wallet,
            lower(replaceAll(cid, '0x', '')) as condition_id_norm,
            cid as condition_id_raw,
            outcome_index,
            COUNT(*) as num_trades
          FROM default.fact_trades_clean
          GROUP BY wallet_address, cid, outcome_index
          LIMIT 1000
        )
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN r.payout_denominator > 0 THEN 1 END) as resolved_positions,
        ROUND(resolved_positions / total_positions * 100, 2) as coverage_pct
      FROM trade_positions t
      LEFT JOIN all_resolutions r
        ON t.condition_id_norm = r.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const directData = await directTest.json<any>();
  console.log(`  Sample of 1,000 positions:`);
  console.log(`    Total: ${directData[0].total_positions}`);
  console.log(`    Resolved: ${directData[0].resolved_positions}`);
  console.log(`    Coverage: ${directData[0].coverage_pct}%\n`);

  console.log('═'.repeat(80));
  console.log('📊 DIAGNOSIS\n');

  const sampleCoverage = parseFloat(directData[0].coverage_pct);

  if (sampleCoverage >= 95) {
    console.log('✅ Join logic works correctly on sample');
    console.log('   Bug must be in the view definition itself\n');
    console.log('💡 Likely issues:');
    console.log('   1. View is cached with old data');
    console.log('   2. View definition has subtle normalization bug');
    console.log('   3. Array indexing bug (outcome_index + 1)\n');
  } else if (sampleCoverage > 50) {
    console.log('⚠️  Partial join success on sample');
    console.log('   Some condition_ids match, others don\'t\n');
  } else {
    console.log('❌ Join fails even on sample');
    console.log('   Major normalization or schema issue\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
