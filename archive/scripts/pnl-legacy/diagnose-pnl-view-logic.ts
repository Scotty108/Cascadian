#!/usr/bin/env npx tsx
/**
 * Diagnose P&L View Logic
 * Find where the disconnect occurs between working sample joins (101%) and failing P&L queries (7.4%)
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
  console.log('\n🔍 DIAGNOSING P&L VIEW LOGIC\n');
  console.log('═'.repeat(80));

  // 1. Verify which trades table is being used
  console.log('\n1️⃣ Checking which trades table has the data:\n');

  const tradesComparison = await ch.query({
    query: `
      SELECT
        'cascadian_clean.fact_trades_clean' as table_name,
        COUNT(DISTINCT lower(replaceAll(cid_hex, '0x', ''))) as unique_conditions,
        COUNT(*) as total_trades
      FROM cascadian_clean.fact_trades_clean
      UNION ALL
      SELECT
        'default.fact_trades_clean' as table_name,
        COUNT(DISTINCT lower(replaceAll(cid_hex, '0x', ''))) as unique_conditions,
        COUNT(*) as total_trades
      FROM default.fact_trades_clean
    `,
    format: 'JSONEachRow'
  });

  const tradesData = await tradesComparison.json<any>();
  tradesData.forEach((row: any) => {
    console.log(`  ${row.table_name}:`);
    console.log(`    Unique conditions: ${parseInt(row.unique_conditions).toLocaleString()}`);
    console.log(`    Total trades: ${parseInt(row.total_trades).toLocaleString()}\n`);
  });

  // 2. Check if vw_trades_canonical exists and what it points to
  console.log('2️⃣ Checking vw_trades_canonical view:\n');

  try {
    const viewDef = await ch.query({
      query: `SHOW CREATE TABLE default.vw_trades_canonical`,
      format: 'JSONEachRow'
    });
    const viewDefData = await viewDef.json<any>();
    const createStmt = viewDefData[0].statement;

    console.log(`  View definition found:`);
    if (createStmt.includes('cascadian_clean.fact_trades_clean')) {
      console.log(`  ✅ Uses cascadian_clean.fact_trades_clean (CORRECT)\n`);
    } else if (createStmt.includes('default.fact_trades_clean')) {
      console.log(`  ⚠️  Uses default.fact_trades_clean (WRONG - has fewer markets!)\n`);
    } else {
      console.log(`  ⚠️  Uses unknown source\n`);
    }
  } catch (e: any) {
    console.log(`  ❌ View doesn't exist or error: ${e.message}\n`);
  }

  // 3. Test the resolution UNION logic
  console.log('3️⃣ Testing resolution UNION coverage:\n');

  const resolutionUnion = await ch.query({
    query: `
      WITH all_resolutions AS (
        SELECT condition_id_norm as cid, payout_denominator
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
        UNION ALL
        SELECT condition_id as cid, payout_denominator
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )
      SELECT
        COUNT(DISTINCT cid) as unique_resolved_markets,
        COUNT(*) as total_resolution_records
      FROM all_resolutions
    `,
    format: 'JSONEachRow'
  });

  const unionData = await resolutionUnion.json<any>();
  console.log(`  Unique resolved markets: ${parseInt(unionData[0].unique_resolved_markets).toLocaleString()}`);
  console.log(`  Total resolution records: ${parseInt(unionData[0].total_resolution_records).toLocaleString()}\n`);

  // 4. Test join on cascadian_clean table specifically
  console.log('4️⃣ Testing join with cascadian_clean.fact_trades_clean:\n');

  const cascadianJoin = await ch.query({
    query: `
      WITH traded_ids AS (
        SELECT DISTINCT lower(replaceAll(cid_hex, '0x', '')) as cid
        FROM cascadian_clean.fact_trades_clean
        LIMIT 1000
      ),
      all_resolutions AS (
        SELECT condition_id_norm as cid, payout_denominator
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
        UNION ALL
        SELECT condition_id as cid, payout_denominator
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )
      SELECT
        COUNT(*) as total_sampled,
        COUNT(CASE WHEN r.cid IS NOT NULL THEN 1 END) as with_resolution,
        ROUND(with_resolution / total_sampled * 100, 1) as coverage_pct
      FROM traded_ids t
      LEFT JOIN all_resolutions r ON t.cid = lower(r.cid)
    `,
    format: 'JSONEachRow'
  });

  const cascadianData = await cascadianJoin.json<any>();
  console.log(`  Sample: 1,000 traded condition_ids`);
  console.log(`  With resolution: ${cascadianData[0].with_resolution}`);
  console.log(`  Coverage: ${cascadianData[0].coverage_pct}%\n`);

  // 5. Test join on default table
  console.log('5️⃣ Testing join with default.fact_trades_clean:\n');

  const defaultJoin = await ch.query({
    query: `
      WITH traded_ids AS (
        SELECT DISTINCT lower(replaceAll(cid_hex, '0x', '')) as cid
        FROM default.fact_trades_clean
        LIMIT 1000
      ),
      all_resolutions AS (
        SELECT condition_id_norm as cid, payout_denominator
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
        UNION ALL
        SELECT condition_id as cid, payout_denominator
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )
      SELECT
        COUNT(*) as total_sampled,
        COUNT(CASE WHEN r.cid IS NOT NULL THEN 1 END) as with_resolution,
        ROUND(with_resolution / total_sampled * 100, 1) as coverage_pct
      FROM traded_ids t
      LEFT JOIN all_resolutions r ON t.cid = lower(r.cid)
    `,
    format: 'JSONEachRow'
  });

  const defaultData = await defaultJoin.json<any>();
  console.log(`  Sample: 1,000 traded condition_ids`);
  console.log(`  With resolution: ${defaultData[0].with_resolution}`);
  console.log(`  Coverage: ${defaultData[0].coverage_pct}%\n`);

  // 6. Test specific wallet 0x4ce7
  console.log('6️⃣ Testing wallet 0x4ce7 coverage:\n');

  const walletTest = await ch.query({
    query: `
      WITH wallet_trades AS (
        SELECT DISTINCT lower(replaceAll(cid_hex, '0x', '')) as cid
        FROM cascadian_clean.fact_trades_clean
        WHERE lower(wallet_address) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
      ),
      all_resolutions AS (
        SELECT condition_id_norm as cid, payout_denominator
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
        UNION ALL
        SELECT condition_id as cid, payout_denominator
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )
      SELECT
        COUNT(*) as total_markets,
        COUNT(CASE WHEN r.cid IS NOT NULL THEN 1 END) as resolved_markets,
        ROUND(resolved_markets / total_markets * 100, 1) as coverage_pct
      FROM wallet_trades w
      LEFT JOIN all_resolutions r ON w.cid = lower(r.cid)
    `,
    format: 'JSONEachRow'
  });

  const walletData = await walletTest.json<any>();
  console.log(`  Total markets: ${walletData[0].total_markets}`);
  console.log(`  Resolved markets: ${walletData[0].resolved_markets}`);
  console.log(`  Coverage: ${walletData[0].coverage_pct}%\n`);

  // 7. Sample a few condition_ids from wallet 0x4ce7 and check resolution tables
  console.log('7️⃣ Sampling condition_ids from wallet 0x4ce7:\n');

  const walletSample = await ch.query({
    query: `
      SELECT DISTINCT
        lower(replaceAll(cid_hex, '0x', '')) as cid
      FROM cascadian_clean.fact_trades_clean
      WHERE lower(wallet_address) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const sampleIds = await walletSample.json<any>();

  for (const row of sampleIds) {
    const cid = row.cid;
    console.log(`  Condition: ${cid.substring(0, 16)}...`);

    const resCheck = await ch.query({
      query: `
        SELECT 'market_resolutions_final' as source, COUNT(*) as count
        FROM default.market_resolutions_final
        WHERE lower(condition_id_norm) = '${cid}'
        UNION ALL
        SELECT 'resolutions_external_ingest' as source, COUNT(*) as count
        FROM default.resolutions_external_ingest
        WHERE condition_id = '${cid}'
      `,
      format: 'JSONEachRow'
    });

    const resData = await resCheck.json<any>();
    resData.forEach((r: any) => {
      console.log(`    ${r.source}: ${r.count} matches`);
    });
  }

  console.log('\n' + '═'.repeat(80));
  console.log('📊 DIAGNOSIS SUMMARY\n');

  const cascadianCoverage = parseFloat(cascadianData[0].coverage_pct);
  const defaultCoverage = parseFloat(defaultData[0].coverage_pct);
  const walletCoverage = parseFloat(walletData[0].coverage_pct);

  if (cascadianCoverage > 50 && walletCoverage === 0) {
    console.log('🔍 FOUND ISSUE: Table mismatch in P&L views');
    console.log('   - cascadian_clean.fact_trades_clean has good coverage');
    console.log('   - But wallet 0x4ce7 shows 0% coverage');
    console.log('   - Likely cause: P&L views query default.fact_trades_clean instead');
    console.log('   - Or: Wallet address normalization issue in join\n');
  } else if (cascadianCoverage < 10 && defaultCoverage > 50) {
    console.log('🔍 FOUND ISSUE: Wrong table being queried');
    console.log('   - default.fact_trades_clean has better coverage');
    console.log('   - Should use default.fact_trades_clean for P&L views\n');
  } else if (cascadianCoverage > 50 && defaultCoverage > 50) {
    console.log('✅ Both tables have good coverage');
    console.log('   - Issue is likely in the P&L view logic itself');
    console.log('   - Check: join conditions, field normalization, filters\n');
  } else {
    console.log('❌ Coverage low in both tables');
    console.log('   - Data might not have inserted properly');
    console.log('   - Or: Join logic has fundamental issue\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
