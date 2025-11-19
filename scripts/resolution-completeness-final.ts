#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('='.repeat(80));
  console.log('RESOLUTION DATA COMPLETENESS ASSESSMENT');
  console.log('Date:', new Date().toISOString());
  console.log('='.repeat(80));
  console.log();

  // 1. Check resolution tables
  console.log('1. RESOLUTION TABLE INVENTORY\n');

  // market_resolutions_final
  const mrf = await client.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT condition_id_norm) as unique_cids,
        countIf(winning_index >= 0) as has_winner,
        countIf(length(payout_numerators) > 0) as has_payout
      FROM default.market_resolutions_final
    `,
    format: 'JSONEachRow'
  });
  const mrfData = await mrf.json();
  console.log('market_resolutions_final:');
  console.log(`  Total rows: ${mrfData[0].total_rows.toLocaleString()}`);
  console.log(`  Unique condition_ids: ${mrfData[0].unique_cids.toLocaleString()}`);
  console.log(`  Has winning_index: ${mrfData[0].has_winner.toLocaleString()} (${(mrfData[0].has_winner/mrfData[0].total_rows*100).toFixed(1)}%)`);
  console.log(`  Has payout_vector: ${mrfData[0].has_payout.toLocaleString()} (${(mrfData[0].has_payout/mrfData[0].total_rows*100).toFixed(1)}%)`);
  console.log();

  // resolutions_external_ingest
  const rei = await client.query({
    query: `
      SELECT
        count() as total_rows,
        count(DISTINCT condition_id) as unique_cids,
        countIf(winning_index >= 0) as has_winner
      FROM default.resolutions_external_ingest
    `,
    format: 'JSONEachRow'
  });
  const reiData = await rei.json();
  console.log('resolutions_external_ingest:');
  console.log(`  Total rows: ${reiData[0].total_rows.toLocaleString()}`);
  console.log(`  Unique condition_ids: ${reiData[0].unique_cids.toLocaleString()}`);
  console.log(`  Has winning_index: ${reiData[0].has_winner.toLocaleString()}`);
  console.log();

  // 2. Check traded markets
  console.log('\n2. TRADED MARKETS BASELINE\n');

  const traded = await client.query({
    query: `
      SELECT
        count(DISTINCT condition_id_norm) as unique_markets,
        count() as total_trades
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '' AND condition_id_norm IS NOT NULL
    `,
    format: 'JSONEachRow'
  });
  const tradedData = await traded.json();
  console.log(`Unique traded markets: ${tradedData[0].unique_markets.toLocaleString()}`);
  console.log(`Total trades: ${tradedData[0].total_trades.toLocaleString()}`);

  // 3. Check coverage from market_resolutions_final
  console.log('\n\n3. COVERAGE ANALYSIS\n');

  const coverage = await client.query({
    query: `
      WITH
        traded AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != '' AND condition_id_norm IS NOT NULL
        ),
        resolved AS (
          SELECT DISTINCT lower(condition_id_norm) as cid_norm
          FROM default.market_resolutions_final
          WHERE winning_index >= 0
        )
      SELECT
        (SELECT count() FROM traded) as total_traded,
        (SELECT count() FROM resolved) as total_resolved,
        (SELECT count() FROM traded INNER JOIN resolved USING(cid_norm)) as matched,
        round((SELECT count() FROM traded INNER JOIN resolved USING(cid_norm)) * 100.0 / (SELECT count() FROM traded), 2) as coverage_pct
    `,
    format: 'JSONEachRow'
  });
  const coverageData = await coverage.json();
  console.log(`Total traded markets: ${coverageData[0].total_traded.toLocaleString()}`);
  console.log(`Total resolutions: ${coverageData[0].total_resolved.toLocaleString()}`);
  console.log(`Matched (have resolutions): ${coverageData[0].matched.toLocaleString()}`);
  console.log(`Coverage: ${coverageData[0].coverage_pct}%`);
  console.log();

  const missing = coverageData[0].total_traded - coverageData[0].matched;
  console.log(`Missing resolutions: ${missing.toLocaleString()} markets (${(100 - coverageData[0].coverage_pct).toFixed(2)}%)`);

  // 4. Data quality sample
  console.log('\n\n4. DATA QUALITY SAMPLE (10 markets)\n');

  const sample = await client.query({
    query: `
      SELECT
        substring(condition_id_norm, 1, 16) as cid_short,
        winning_index,
        winning_outcome,
        payout_numerators,
        payout_denominator,
        source,
        resolved_at
      FROM default.market_resolutions_final
      WHERE winning_index >= 0
      ORDER BY rand()
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sample.json();
  sampleData.forEach((row, i) => {
    console.log(`${i+1}. ${row.cid_short}...`);
    console.log(`   Winner: ${row.winning_outcome} (index ${row.winning_index})`);
    console.log(`   Payout: [${row.payout_numerators}] / ${row.payout_denominator}`);
    console.log(`   Source: ${row.source}`);
    console.log(`   Resolved: ${row.resolved_at || 'N/A'}`);
  });

  // 5. Resolution sources breakdown
  console.log('\n\n5. RESOLUTION SOURCES\n');

  const sources = await client.query({
    query: `
      SELECT
        source,
        count() as count,
        count(DISTINCT condition_id_norm) as unique_markets
      FROM default.market_resolutions_final
      GROUP BY source
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });
  const sourcesData = await sources.json();
  console.log('Resolutions by source:');
  sourcesData.forEach(row => {
    console.log(`  ${row.source}: ${row.count.toLocaleString()} rows, ${row.unique_markets.toLocaleString()} unique markets`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log(`Resolution Coverage: ${coverageData[0].coverage_pct}%`);
  console.log(`Covered Markets: ${coverageData[0].matched.toLocaleString()} / ${coverageData[0].total_traded.toLocaleString()}`);
  console.log(`Missing Markets: ${missing.toLocaleString()}`);
  console.log();

  if (coverageData[0].coverage_pct >= 95) {
    console.log('✅ EXCELLENT - Resolution data is comprehensive (≥95% coverage)');
    console.log('   Ready for P&L calculations.');
  } else if (coverageData[0].coverage_pct >= 75) {
    console.log('⚠️  GOOD - Majority of markets have resolutions (75-95% coverage)');
    console.log('   P&L calculations possible with some gaps.');
  } else if (coverageData[0].coverage_pct >= 50) {
    console.log('⚠️  MODERATE - Half of markets have resolutions (50-75% coverage)');
    console.log('   Consider backfilling missing resolutions.');
  } else if (coverageData[0].coverage_pct >= 25) {
    console.log('❌ LOW - Only quarter of markets have resolutions (25-50% coverage)');
    console.log('   Significant backfill needed for comprehensive P&L.');
  } else {
    console.log('❌ CRITICAL - Very few markets have resolutions (<25% coverage)');
    console.log('   Backfill required before P&L calculations.');
  }

  console.log();

  await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
