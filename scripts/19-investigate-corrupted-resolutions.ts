import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigateCorruptedResolutions() {
  console.log('=== Investigating Corrupted Resolutions ===\n');

  // Step 1: Find all corrupted resolution records
  const corruptedQuery = `
    SELECT
      condition_id_norm,
      payout_numerators,
      payout_denominator,
      outcome_count,
      winning_outcome,
      winning_index,
      source,
      version,
      resolved_at,
      updated_at
    FROM market_resolutions_final
    WHERE payout_denominator = 0
       OR updated_at = '1970-01-01 00:00:00'
    LIMIT 100
  `;

  const result = await clickhouse.query({ query: corruptedQuery, format: 'JSONEachRow' });
  const corrupted = await result.json<any[]>();

  console.log(`Found ${corrupted.length} corrupted resolution records\n`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('CORRUPTED RECORDS ANALYSIS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Analyze patterns
  const sources = new Map<string, number>();
  const versions = new Map<number, number>();
  let epochTimestamps = 0;
  let zeroDenom = 0;

  corrupted.forEach(rec => {
    sources.set(rec.source, (sources.get(rec.source) || 0) + 1);
    versions.set(rec.version, (versions.get(rec.version) || 0) + 1);

    if (rec.updated_at === '1970-01-01 00:00:00') epochTimestamps++;
    if (rec.payout_denominator === 0) zeroDenom++;
  });

  console.log(`Records with payout_denominator = 0: ${zeroDenom}`);
  console.log(`Records with epoch timestamp: ${epochTimestamps}`);
  console.log('\nSources:');
  sources.forEach((count, source) => {
    console.log(`  ${source}: ${count} records`);
  });

  console.log('\nVersions:');
  versions.forEach((count, version) => {
    console.log(`  v${version}: ${count} records`);
  });

  // Sample corrupted records
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SAMPLE CORRUPTED RECORDS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  corrupted.slice(0, 5).forEach((rec, i) => {
    console.log(`[${i + 1}] Condition ID: ${rec.condition_id_norm}`);
    console.log(`    Source: ${rec.source}, Version: ${rec.version}`);
    console.log(`    Payout: ${JSON.stringify(rec.payout_numerators)}/${rec.payout_denominator}`);
    console.log(`    Winning: ${rec.winning_outcome} (index=${rec.winning_index})`);
    console.log(`    Updated: ${rec.updated_at}`);
    console.log('');
  });

  // Step 2: Check for alternative resolution sources
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('CHECKING ALTERNATIVE RESOLUTION SOURCES:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Check gamma_resolved
  const gammaQuery = `
    SELECT count() AS total
    FROM gamma_resolved
    WHERE cid IN (
      SELECT condition_id_norm
      FROM market_resolutions_final
      WHERE payout_denominator = 0
      LIMIT 10
    )
  `;

  try {
    const gammaResult = await clickhouse.query({ query: gammaQuery, format: 'JSONEachRow' });
    const gammaData = await gammaResult.json<any[]>();
    console.log(`gamma_resolved: ${gammaData[0].total} matches found for corrupted conditions`);
  } catch (error) {
    console.log(`gamma_resolved: Error - ${error instanceof Error ? error.message : 'unknown'}`);
  }

  // Look for resolution tables
  const tablesQuery = `
    SELECT name, total_rows
    FROM system.tables
    WHERE database = currentDatabase()
      AND (
        name LIKE '%resolution%'
        OR name LIKE '%resolved%'
        OR name LIKE '%payout%'
      )
      AND total_rows > 0
    ORDER BY total_rows DESC
  `;

  const tablesResult = await clickhouse.query({ query: tablesQuery, format: 'JSONEachRow' });
  const tables = await tablesResult.json<any[]>();

  console.log('\nAvailable resolution-related tables:');
  tables.forEach(table => {
    console.log(`  ${table.name}: ${Number(table.total_rows).toLocaleString()} rows`);
  });

  // Step 3: Check if xcnstrategy's positions are affected
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('XCNSTRATEGY IMPACT ANALYSIS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const impactQuery = `
    WITH wallet_positions AS (
      SELECT DISTINCT condition_id_norm_v3 AS condition_id
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
    )
    SELECT
      count() AS total_positions,
      countIf(r.payout_denominator = 0) AS corrupted_count,
      countIf(r.payout_denominator > 0) AS valid_count,
      countIf(r.condition_id_norm IS NULL) AS missing_count
    FROM wallet_positions wp
    LEFT JOIN market_resolutions_final r
      ON wp.condition_id = r.condition_id_norm
  `;

  const impactResult = await clickhouse.query({ query: impactQuery, format: 'JSONEachRow' });
  const impact = await impactResult.json<any[]>();

  console.log(`Total xcnstrategy positions: ${impact[0].total_positions}`);
  console.log(`  Valid resolutions: ${impact[0].valid_count} (${((impact[0].valid_count / impact[0].total_positions) * 100).toFixed(1)}%)`);
  console.log(`  Corrupted resolutions: ${impact[0].corrupted_count} (${((impact[0].corrupted_count / impact[0].total_positions) * 100).toFixed(1)}%)`);
  console.log(`  Missing resolutions: ${impact[0].missing_count} (${((impact[0].missing_count / impact[0].total_positions) * 100).toFixed(1)}%)`);

  // Get sample condition IDs for manual investigation
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SAMPLE CORRUPTED CONDITION IDS (for manual lookup):');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const sampleQuery = `
    WITH wallet_positions AS (
      SELECT DISTINCT condition_id_norm_v3 AS condition_id
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 IS NOT NULL
    )
    SELECT wp.condition_id
    FROM wallet_positions wp
    INNER JOIN market_resolutions_final r
      ON wp.condition_id = r.condition_id_norm
    WHERE r.payout_denominator = 0
    LIMIT 10
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json<any[]>();

  samples.forEach((s, i) => {
    console.log(`${i + 1}. ${s.condition_id}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('NEXT STEPS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log('1. Identify authoritative source for resolution data');
  console.log('   Options: gamma_resolved, external API, Polymarket API');
  console.log('');
  console.log('2. For sample condition IDs above, manually verify correct resolutions');
  console.log('   - Check Polymarket API or gamma_resolved');
  console.log('   - Determine correct payout_numerators/payout_denominator');
  console.log('');
  console.log('3. Create repair script to update market_resolutions_final');
  console.log('   - Use UPDATE or CREATE+RENAME for atomic fix');
  console.log('   - Re-validate xcnstrategy PnL after fix');
  console.log('');
}

investigateCorruptedResolutions().catch(console.error);
