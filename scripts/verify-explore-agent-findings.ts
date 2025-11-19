#!/usr/bin/env npx tsx
/**
 * Verify Explore Agent's Findings
 * Direct validation of the claims about resolution coverage
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
  console.log('\n🔍 VERIFYING EXPLORE AGENT FINDINGS\n');
  console.log('═'.repeat(80));

  // Claim 1: Current coverage is 11.88%
  console.log('\n1️⃣ Current P&L coverage:\n');

  const currentCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved,
        ROUND(resolved / total_positions * 100, 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });

  const current = await currentCoverage.json<any>();
  console.log(`  Total positions: ${parseInt(current[0].total_positions).toLocaleString()}`);
  console.log(`  Resolved: ${parseInt(current[0].resolved).toLocaleString()}`);
  console.log(`  Coverage: ${current[0].coverage_pct}%`);
  console.log(`  ✓ Agent claimed 11.88%: ${current[0].coverage_pct === '11.88' || current[0].coverage_pct === '11.92' ? 'VERIFIED' : 'MISMATCH'}\n`);

  // Claim 2: resolution_candidates has better coverage than market_resolutions_final
  console.log('2️⃣ Comparing resolution table coverage:\n');

  const tableComparison = await ch.query({
    query: `
      WITH
        traded_ids AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
        )
      SELECT
        (SELECT COUNT(*) FROM traded_ids) as total_traded,
        (SELECT COUNT(DISTINCT t.cid_norm)
         FROM traded_ids t
         INNER JOIN default.market_resolutions_final r
           ON t.cid_norm = lower(replaceAll(r.condition_id_norm, '0x', ''))
         WHERE r.payout_denominator > 0) as in_market_resolutions_final,
        (SELECT COUNT(DISTINCT t.cid_norm)
         FROM traded_ids t
         INNER JOIN default.resolution_candidates r
           ON t.cid_norm = lower(replaceAll(r.condition_id_norm, '0x', ''))
         WHERE r.payout_denominator > 0) as in_resolution_candidates
    `,
    format: 'JSONEachRow'
  });

  const comparison = await tableComparison.json<any>();
  const totalTraded = parseInt(comparison[0].total_traded);
  const inMRF = parseInt(comparison[0].in_market_resolutions_final);
  const inRC = parseInt(comparison[0].in_resolution_candidates);

  console.log(`  Total traded markets: ${totalTraded.toLocaleString()}`);
  console.log(`  In market_resolutions_final: ${inMRF.toLocaleString()} (${(inMRF/totalTraded*100).toFixed(2)}%)`);
  console.log(`  In resolution_candidates: ${inRC.toLocaleString()} (${(inRC/totalTraded*100).toFixed(2)}%)`);
  console.log(`  Improvement potential: +${(inRC - inMRF).toLocaleString()} markets\n`);

  // Claim 3: 70% of traded markets missing from api_markets_staging
  console.log('3️⃣ Markets missing from api_markets_staging:\n');

  const missingMarkets = await ch.query({
    query: `
      WITH
        traded_ids AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
        ),
        staging_ids AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.api_markets_staging
        )
      SELECT
        (SELECT COUNT(*) FROM traded_ids) as total_traded,
        (SELECT COUNT(*) FROM traded_ids t
         INNER JOIN staging_ids s ON t.cid_norm = s.cid_norm) as in_staging,
        (SELECT COUNT(*) FROM traded_ids t
         LEFT JOIN staging_ids s ON t.cid_norm = s.cid_norm
         WHERE s.cid_norm IS NULL) as missing_from_staging
    `,
    format: 'JSONEachRow'
  });

  const missing = await missingMarkets.json<any>();
  const totalTradedMarkets = parseInt(missing[0].total_traded);
  const inStaging = parseInt(missing[0].in_staging);
  const missingFromStaging = parseInt(missing[0].missing_from_staging);

  console.log(`  Total traded markets: ${totalTradedMarkets.toLocaleString()}`);
  console.log(`  In api_markets_staging: ${inStaging.toLocaleString()} (${(inStaging/totalTradedMarkets*100).toFixed(2)}%)`);
  console.log(`  Missing from staging: ${missingFromStaging.toLocaleString()} (${(missingFromStaging/totalTradedMarkets*100).toFixed(2)}%)\n`);

  // Check if resolution_candidates table exists
  console.log('4️⃣ Checking resolution_candidates table:\n');

  try {
    const rcCheck = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT condition_id_norm) as unique_conditions,
          COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as with_payouts
        FROM default.resolution_candidates
      `,
      format: 'JSONEachRow'
    });

    const rcData = await rcCheck.json<any>();
    console.log(`  ✓ Table exists`);
    console.log(`  Total rows: ${parseInt(rcData[0].total_rows).toLocaleString()}`);
    console.log(`  Unique conditions: ${parseInt(rcData[0].unique_conditions).toLocaleString()}`);
    console.log(`  With payouts: ${parseInt(rcData[0].with_payouts).toLocaleString()}\n`);
  } catch (e: any) {
    console.log(`  ✗ Table doesn't exist or error: ${e.message}\n`);
  }

  console.log('═'.repeat(80));
  console.log('📊 VERDICT\n');

  const rcCoverage = (inRC / totalTraded * 100).toFixed(2);
  const mrfCoverage = (inMRF / totalTraded * 100).toFixed(2);

  if (parseFloat(rcCoverage) > parseFloat(mrfCoverage) + 50) {
    console.log('✅ AGENT WAS RIGHT!');
    console.log(`   resolution_candidates has ${rcCoverage}% coverage`);
    console.log(`   market_resolutions_final has only ${mrfCoverage}% coverage`);
    console.log(`   Using resolution_candidates would ADD ${(inRC - inMRF).toLocaleString()} markets!\n`);
    console.log('🎯 ACTION: Update P&L views to use resolution_candidates\n');
  } else if (inRC > inMRF) {
    console.log('⚠️  Agent partially right');
    console.log(`   resolution_candidates: ${rcCoverage}%`);
    console.log(`   market_resolutions_final: ${mrfCoverage}%`);
    console.log(`   Improvement: +${(inRC - inMRF).toLocaleString()} markets\n`);
  } else {
    console.log('❌ Agent was wrong');
    console.log('   resolution_candidates doesn\'t offer better coverage\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
