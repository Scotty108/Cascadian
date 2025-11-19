#!/usr/bin/env tsx
/**
 * Source Coverage Matrix for 14 Missing Markets
 *
 * Creates a machine-readable table showing which sources contain each of the
 * 14 condition_ids that Dome has but we don't.
 *
 * This reveals WHERE in the pipeline (CLOB → Goldsky → ClickHouse) the data disappears.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

// 14 condition_ids from Dome that we're missing
const MISSING_CONDITION_IDS = [
  '0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678', // Satoshi Bitcoin
  '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1', // Xi Jinping 2025
  '0xef00c9e8b1eb7eb322ccc13b67cfa35d4291017a0aa46d09f3e2f3e3b255e3d0', // Eggs $3.00-3.25 Sept
  '0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608', // Trump Gold Cards
  '0xa491ceedf3da3e6e6b4913c8eff3362caf6dbfda9bbf299e5a628b223803c2e6', // Xi out before Oct
  '0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be', // Elon budget cut
  '0x93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620', // Inflation 2.7% Aug
  '0x03bf5c66a49c7f44661d99dc3784f3cb4484c0aa8459723bd770680512e72f82', // Eggs $3.25-3.50 Aug
  '0xfae907b4c7d9b39fcd27683e3f9e4bdbbafc24f36765b6240a93b8c94ed206fa', // Lisa Cook Fed
  '0x340c700abfd4870e95683f1d45cf7cb28e77c284f41e69d385ed2cc52227b307', // Eggs $4.25-4.50 Aug
  '0x601141063589291af41d6811b9f20d544e1c24b3641f6996c21e8957dd43bcec', // Eggs $3.00-3.25 Aug
  '0x7bdc006d11b7dff2eb7ccbba5432c22b702c92aa570840f3555b5e4da86fed02', // Eggs $3.75-4.00 Aug
  '0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44', // US ally nuke 2025
  '0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7'  // China Bitcoin unban
];

async function main() {
  console.log('🔍 Source Coverage Matrix: 14 Missing Markets');
  console.log('='.repeat(80));
  console.log('');

  const matrix: any[] = [];

  for (const rawConditionId of MISSING_CONDITION_IDS) {
    // Normalize: lowercase, strip 0x
    const conditionId = rawConditionId.toLowerCase().replace(/^0x/, '');
    const conditionId0x = '0x' + conditionId;

    console.log(`\nChecking: ${conditionId.substring(0, 16)}...`);

    const row: any = {
      condition_id_short: conditionId.substring(0, 16) + '...',
      condition_id_full: conditionId,
      in_clob_fills: 0,
      in_pm_trades: 0,
      in_pm_markets: 'NOT_FOUND',
      in_pm_asset_token_map: 0,
      in_gamma_markets: 0,
      total_sources_with_data: 0
    };

    // Check clob_fills
    try {
      const clobQuery = await clickhouse.query({
        query: `
          SELECT COUNT(*) as count
          FROM clob_fills
          WHERE lower(replaceAll(condition_id, '0x', '')) = '${conditionId}'
        `,
        format: 'JSONEachRow'
      });
      const clobResult = await clobQuery.json();
      row.in_clob_fills = parseInt(clobResult[0]?.count || '0');
      if (row.in_clob_fills > 0) row.total_sources_with_data++;
    } catch (e) {
      row.in_clob_fills = 'ERROR';
    }

    // Check pm_trades
    try {
      const tradesQuery = await clickhouse.query({
        query: `
          SELECT COUNT(*) as count
          FROM pm_trades
          WHERE lower(replaceAll(condition_id, '0x', '')) = '${conditionId}'
        `,
        format: 'JSONEachRow'
      });
      const tradesResult = await tradesQuery.json();
      row.in_pm_trades = parseInt(tradesResult[0]?.count || '0');
      if (row.in_pm_trades > 0) row.total_sources_with_data++;
    } catch (e) {
      row.in_pm_trades = 'ERROR';
    }

    // Check pm_markets
    try {
      const marketsQuery = await clickhouse.query({
        query: `
          SELECT status, market_type, winning_outcome_index
          FROM pm_markets
          WHERE lower(replaceAll(condition_id, '0x', '')) = '${conditionId}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });
      const marketsResult = await marketsQuery.json();
      if (marketsResult.length > 0) {
        row.in_pm_markets = marketsResult[0].status;
        row.market_type = marketsResult[0].market_type;
        row.winning_outcome = marketsResult[0].winning_outcome_index;
        row.total_sources_with_data++;
      }
    } catch (e) {
      row.in_pm_markets = 'ERROR';
    }

    // Check pm_asset_token_map
    try {
      const tokenMapQuery = await clickhouse.query({
        query: `
          SELECT COUNT(*) as count
          FROM pm_asset_token_map
          WHERE lower(replaceAll(condition_id, '0x', '')) = '${conditionId}'
        `,
        format: 'JSONEachRow'
      });
      const tokenMapResult = await tokenMapQuery.json();
      row.in_pm_asset_token_map = parseInt(tokenMapResult[0]?.count || '0');
      if (row.in_pm_asset_token_map > 0) row.total_sources_with_data++;
    } catch (e) {
      row.in_pm_asset_token_map = 'ERROR';
    }

    // Check gamma_markets
    try {
      const gammaQuery = await clickhouse.query({
        query: `
          SELECT COUNT(*) as count
          FROM gamma_markets
          WHERE lower(replaceAll(condition_id, '0x', '')) = '${conditionId}'
        `,
        format: 'JSONEachRow'
      });
      const gammaResult = await gammaQuery.json();
      row.in_gamma_markets = parseInt(gammaResult[0]?.count || '0');
      if (row.in_gamma_markets > 0) row.total_sources_with_data++;
    } catch (e) {
      row.in_gamma_markets = 'ERROR';
    }

    matrix.push(row);

    console.log(`   clob_fills: ${row.in_clob_fills}`);
    console.log(`   pm_trades: ${row.in_pm_trades}`);
    console.log(`   pm_markets: ${row.in_pm_markets}`);
    console.log(`   pm_asset_token_map: ${row.in_pm_asset_token_map}`);
    console.log(`   gamma_markets: ${row.in_gamma_markets}`);
    console.log(`   Sources with data: ${row.total_sources_with_data}/5`);
  }

  // Print summary table
  console.log('\n' + '='.repeat(80));
  console.log('📊 COVERAGE MATRIX SUMMARY');
  console.log('='.repeat(80));
  console.log('');

  console.table(matrix.map(r => ({
    'Condition ID': r.condition_id_short,
    'clob_fills': r.in_clob_fills,
    'pm_trades': r.in_pm_trades,
    'pm_markets': r.in_pm_markets,
    'token_map': r.in_pm_asset_token_map,
    'gamma': r.in_gamma_markets,
    'Sources': r.total_sources_with_data
  })));

  // Aggregate statistics
  const stats = {
    total_markets: matrix.length,
    found_in_clob_fills: matrix.filter(r => r.in_clob_fills > 0).length,
    found_in_pm_trades: matrix.filter(r => r.in_pm_trades > 0).length,
    found_in_pm_markets: matrix.filter(r => r.in_pm_markets !== 'NOT_FOUND').length,
    found_in_token_map: matrix.filter(r => r.in_pm_asset_token_map > 0).length,
    found_in_gamma: matrix.filter(r => r.in_gamma_markets > 0).length,
    found_in_no_sources: matrix.filter(r => r.total_sources_with_data === 0).length,
    found_in_all_sources: matrix.filter(r => r.total_sources_with_data === 5).length
  };

  console.log('');
  console.log('Aggregate Statistics:');
  console.log(`  Total markets checked: ${stats.total_markets}`);
  console.log(`  Found in clob_fills: ${stats.found_in_clob_fills} (${(stats.found_in_clob_fills / stats.total_markets * 100).toFixed(1)}%)`);
  console.log(`  Found in pm_trades: ${stats.found_in_pm_trades} (${(stats.found_in_pm_trades / stats.total_markets * 100).toFixed(1)}%)`);
  console.log(`  Found in pm_markets: ${stats.found_in_pm_markets} (${(stats.found_in_pm_markets / stats.total_markets * 100).toFixed(1)}%)`);
  console.log(`  Found in token_map: ${stats.found_in_token_map} (${(stats.found_in_token_map / stats.total_markets * 100).toFixed(1)}%)`);
  console.log(`  Found in gamma_markets: ${stats.found_in_gamma} (${(stats.found_in_gamma / stats.total_markets * 100).toFixed(1)}%)`);
  console.log(`  Found in ZERO sources: ${stats.found_in_no_sources}`);
  console.log(`  Found in ALL sources: ${stats.found_in_all_sources}`);
  console.log('');

  // Write to CSV
  const csv: string[] = [];
  csv.push('condition_id,clob_fills,pm_trades,pm_markets,pm_asset_token_map,gamma_markets,total_sources');
  matrix.forEach(r => {
    csv.push(`${r.condition_id_full},${r.in_clob_fills},${r.in_pm_trades},${r.in_pm_markets},${r.in_pm_asset_token_map},${r.in_gamma_markets},${r.total_sources_with_data}`);
  });

  const csvPath = resolve(process.cwd(), 'source_coverage_matrix_14_markets.csv');
  writeFileSync(csvPath, csv.join('\n'));

  console.log(`📄 CSV written to: source_coverage_matrix_14_markets.csv`);
  console.log('');

  // Conclusion
  console.log('='.repeat(80));
  console.log('🔍 CONCLUSION');
  console.log('='.repeat(80));
  console.log('');

  if (stats.found_in_no_sources === stats.total_markets) {
    console.log('❌ CRITICAL: ALL 14 markets are missing from ALL sources');
    console.log('   This means:');
    console.log('   1. These markets were NEVER ingested into ClickHouse');
    console.log('   2. The gap is at the EARLIEST stage (Polymarket → Goldsky or Goldsky → ClickHouse)');
    console.log('   3. Next step: Query Polymarket CLOB API directly to see if data exists there');
  } else if (stats.found_in_clob_fills > 0 && stats.found_in_pm_trades === 0) {
    console.log('⚠️  Markets found in clob_fills but NOT in pm_trades');
    console.log('   This means:');
    console.log('   1. Data was ingested from Goldsky');
    console.log('   2. But failed to transform into pm_trades (likely asset_id join failure)');
    console.log('   3. Next step: Fix pm_asset_token_map for these condition_ids');
  } else if (stats.found_in_pm_trades > 0 && stats.found_in_pm_markets === 0) {
    console.log('⚠️  Markets found in pm_trades but NOT in pm_markets');
    console.log('   This means:');
    console.log('   1. Trades exist but market metadata is missing');
    console.log('   2. Next step: Backfill pm_markets from Polymarket API');
  } else {
    console.log('Mixed results. Review the matrix above to identify the failure point for each market.');
  }

  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
