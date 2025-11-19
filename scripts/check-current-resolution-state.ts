#!/usr/bin/env npx tsx
/**
 * Check Current Resolution State
 *
 * Understand what resolution data we actually have
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
  console.log('\n📊 CURRENT RESOLUTION STATE CHECK\n');
  console.log('═'.repeat(80));

  // Step 1: Count traded markets
  console.log('\n1️⃣ Traded Markets:\n');

  const tradedQuery = await ch.query({
    query: `
      SELECT COUNT(DISTINCT lower(replaceAll(cid, '0x', ''))) as count
      FROM default.fact_trades_clean
    `
  });

  const tradedData = await tradedQuery.json<any>();
  const totalTraded = parseInt(tradedData[0].count);
  console.log(`  Total unique condition IDs traded: ${totalTraded.toLocaleString()}\n`);

  // Step 2: Check resolution sources
  console.log('2️⃣ Resolution Sources:\n');

  // market_resolutions_final
  try {
    const mrf = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT condition_id_norm) as unique_conditions,
          COUNT(CASE WHEN payout_numerators IS NOT NULL AND length(payout_numerators) > 0 THEN 1 END) as with_payouts
        FROM default.market_resolutions_final
      `
    });

    const mrfData = await mrf.json<any>();
    console.log('  market_resolutions_final:');
    console.log(`    Total rows: ${parseInt(mrfData[0].total_rows).toLocaleString()}`);
    console.log(`    Unique conditions: ${parseInt(mrfData[0].unique_conditions).toLocaleString()}`);
    console.log(`    With payouts: ${parseInt(mrfData[0].with_payouts).toLocaleString()}\n`);
  } catch (e: any) {
    console.log(`  market_resolutions_final: ⚠️  ${e.message}\n`);
  }

  // resolutions_external_ingest
  try {
    const rei = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as unique_conditions,
          COUNT(CASE WHEN payout_numerators IS NOT NULL AND length(payout_numerators) > 0 THEN 1 END) as with_payouts
        FROM default.resolutions_external_ingest
      `
    });

    const reiData = await rei.json<any>();
    console.log('  resolutions_external_ingest:');
    console.log(`    Total rows: ${parseInt(reiData[0].total_rows).toLocaleString()}`);
    console.log(`    Unique conditions: ${parseInt(reiData[0].unique_conditions).toLocaleString()}`);
    console.log(`    With payouts: ${parseInt(reiData[0].with_payouts).toLocaleString()}\n`);
  } catch (e: any) {
    console.log(`  resolutions_external_ingest: ⚠️  ${e.message}\n`);
  }

  // api_markets_staging
  try {
    const ams = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as unique_conditions,
          COUNT(CASE WHEN payout_numerators IS NOT NULL AND length(payout_numerators) > 0 THEN 1 END) as with_payouts
        FROM default.api_markets_staging
      `
    });

    const amsData = await ams.json<any>();
    console.log('  api_markets_staging:');
    console.log(`    Total rows: ${parseInt(amsData[0].total_rows).toLocaleString()}`);
    console.log(`    Unique conditions: ${parseInt(amsData[0].unique_conditions).toLocaleString()}`);
    console.log(`    With payouts: ${parseInt(amsData[0].with_payouts).toLocaleString()}\n`);
  } catch (e: any) {
    console.log(`  api_markets_staging: ⚠️  ${e.message}\n`);
  }

  // Step 3: Calculate coverage
  console.log('3️⃣ Coverage Analysis:\n');

  const coverageQuery = await ch.query({
    query: `
      WITH
        traded_ids AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
        ),
        all_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      SELECT
        COUNT(DISTINCT t.cid_norm) as total_traded,
        COUNT(DISTINCT CASE WHEN r.cid_norm IS NOT NULL THEN t.cid_norm END) as with_resolution,
        COUNT(DISTINCT CASE WHEN r.cid_norm IS NULL THEN t.cid_norm END) as missing_resolution
      FROM traded_ids t
      LEFT JOIN all_resolutions r ON t.cid_norm = r.cid_norm
    `
  });

  const covData = await coverageQuery.json<any>();
  const withRes = parseInt(covData[0].with_resolution);
  const missing = parseInt(covData[0].missing_resolution);
  const total = parseInt(covData[0].total_traded);
  const pct = ((withRes / total) * 100).toFixed(2);

  console.log(`  Market Resolution Coverage:`);
  console.log(`    Total traded: ${total.toLocaleString()}`);
  console.log(`    With resolutions: ${withRes.toLocaleString()} (${pct}%)`);
  console.log(`    Missing: ${missing.toLocaleString()} (${(100 - parseFloat(pct)).toFixed(2)}%)\n`);

  // Step 4: Sample missing markets
  if (missing > 0) {
    console.log('4️⃣ Sample Missing Markets:\n');

    const sampleMissing = await ch.query({
      query: `
        WITH
          traded_ids AS (
            SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
            FROM default.fact_trades_clean
          ),
          all_resolutions AS (
            SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
            FROM default.market_resolutions_final
            WHERE payout_denominator > 0
            UNION ALL
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
            FROM default.resolutions_external_ingest
            WHERE payout_denominator > 0
          )
        SELECT t.cid_norm as condition_id
        FROM traded_ids t
        LEFT JOIN all_resolutions r ON t.cid_norm = r.cid_norm
        WHERE r.cid_norm IS NULL
        LIMIT 10
      `
    });

    const samples = await sampleMissing.json<any>();
    console.log(`  First 10 missing condition IDs:`);
    for (const row of samples) {
      console.log(`    ${row.condition_id}`);
    }
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log('📋 SUMMARY\n');

  if (missing === 0) {
    console.log('✅ ALL TRADED MARKETS HAVE RESOLUTIONS!');
    console.log('   → The 11.88% P&L coverage is correct');
    console.log('   → Most markets simply have not resolved yet\n');
  } else {
    console.log(`⚠️  ${missing.toLocaleString()} markets are missing resolutions`);
    console.log('   → These need to be fetched from blockchain or API\n');
    console.log('📝 Recommended Action:');
    console.log('   1. Check if these markets have actually resolved on-chain');
    console.log('   2. If yes, fetch ConditionResolution events');
    console.log('   3. If no, accept current coverage and show unrealized P&L\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
