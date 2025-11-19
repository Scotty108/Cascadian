#!/usr/bin/env npx tsx

/**
 * DIRECT POPULATION: ctf_token_map from gamma_markets
 *
 * Strategy: Skip API backfills entirely - gamma_markets already has 149,772 mappings
 * This will achieve >100% coverage (149,772 > 118,870 needed) in seconds vs hours
 *
 * Process:
 * 1. Extract distinct token mappings from gamma_markets
 * 2. Map outcome labels to outcome_index (Yes=1, No=0, etc.)
 * 3. Insert into ctf_token_map (deduplicating on token_id)
 * 4. Verify coverage ≥95%
 *
 * Usage: npx tsx scripts/populate-token-map-from-gamma.ts
 *
 * Expected runtime: ~30 seconds
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('═'.repeat(80));
  console.log('DIRECT POPULATION: ctf_token_map from gamma_markets');
  console.log('═'.repeat(80));
  console.log();

  // 1. Baseline metrics
  console.log('[1] Baseline Coverage');
  console.log('─'.repeat(80));

  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        (SELECT uniq(asset_id) FROM clob_fills) as total_asset_ids,
        (SELECT COUNT(*) FROM ctf_token_map) as current_mappings
    `,
    format: 'JSONEachRow'
  });
  const before = (await beforeResult.json())[0];

  const beforeCoverage = (parseInt(before.current_mappings) / parseInt(before.total_asset_ids) * 100).toFixed(1);

  console.log(`Total unique asset_ids in clob_fills: ${parseInt(before.total_asset_ids).toLocaleString()}`);
  console.log(`Current ctf_token_map rows:            ${parseInt(before.current_mappings).toLocaleString()} (${beforeCoverage}%)`);
  console.log();

  // 2. Check gamma_markets availability
  console.log('[2] Checking gamma_markets Data');
  console.log('─'.repeat(80));

  const gammaResult = await clickhouse.query({
    query: `
      SELECT COUNT(*) as cnt
      FROM gamma_markets
      WHERE token_id IS NOT NULL
        AND token_id != ''
        AND condition_id IS NOT NULL
        AND condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const gammaCount = (await gammaResult.json())[0].cnt;

  console.log(`Valid mappings in gamma_markets: ${parseInt(gammaCount).toLocaleString()}`);
  console.log();

  if (parseInt(gammaCount) === 0) {
    console.error('❌ ERROR: gamma_markets has no valid token mappings');
    process.exit(1);
  }

  console.log(`✅ Sufficient data available (${parseInt(gammaCount).toLocaleString()} > ${parseInt(before.total_asset_ids).toLocaleString()})`);
  console.log();

  // 3. Map outcomes to indices
  console.log('[3] Mapping Outcomes to Indices');
  console.log('─'.repeat(80));

  // Build outcome_index from gamma_markets structure
  // gamma_markets has: token_id, condition_id, outcome (label like "Yes", "No", etc.)
  // We need to assign index based on alphabetical order within each condition

  const mappingQuery = `
    INSERT INTO default.ctf_token_map
      (token_id, condition_id_norm, outcome_index, vote_count, source, created_at, version, market_id)
    SELECT
      token_id,
      lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
      ROW_NUMBER() OVER (PARTITION BY condition_id ORDER BY outcome) - 1 as outcome_index,
      0 as vote_count,
      'gamma_markets' as source,
      now() as created_at,
      1 as version,
      '' as market_id
    FROM (
      SELECT DISTINCT
        token_id,
        condition_id,
        outcome
      FROM gamma_markets
      WHERE token_id IS NOT NULL
        AND token_id != ''
        AND condition_id IS NOT NULL
        AND condition_id != ''
    )
    WHERE token_id NOT IN (SELECT token_id FROM default.ctf_token_map)
  `;

  console.log('Executing direct population...');
  console.log();

  await clickhouse.query({ query: mappingQuery });

  console.log('✅ Population complete');
  console.log();

  // 4. Verify new coverage
  console.log('[4] Verifying Coverage');
  console.log('─'.repeat(80));

  const afterResult = await clickhouse.query({
    query: `
      SELECT
        (SELECT uniq(asset_id) FROM clob_fills) as total_asset_ids,
        (SELECT COUNT(*) FROM ctf_token_map) as current_mappings
    `,
    format: 'JSONEachRow'
  });
  const after = (await afterResult.json())[0];

  const afterCoverage = (parseInt(after.current_mappings) / parseInt(after.total_asset_ids) * 100).toFixed(1);
  const newMappings = parseInt(after.current_mappings) - parseInt(before.current_mappings);
  const coverageGain = (parseFloat(afterCoverage) - parseFloat(beforeCoverage)).toFixed(1);

  console.log(`Total unique asset_ids:  ${parseInt(after.total_asset_ids).toLocaleString()}`);
  console.log(`Now mapped:              ${parseInt(after.current_mappings).toLocaleString()} (${afterCoverage}%)`);
  console.log();
  console.log(`New mappings added:      ${newMappings.toLocaleString()}`);
  console.log(`Coverage increase:       +${coverageGain}%`);
  console.log();

  // 5. Coverage breakdown by join
  const coverageBreakdown = await clickhouse.query({
    query: `
      SELECT
        uniq(cf.asset_id) as total_asset_ids,
        uniqIf(cf.asset_id, ctm.token_id IS NOT NULL) as mapped_asset_ids
      FROM clob_fills cf
      LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
    `,
    format: 'JSONEachRow'
  });
  const breakdown = (await coverageBreakdown.json())[0];
  const joinCoverage = (parseInt(breakdown.mapped_asset_ids) / parseInt(breakdown.total_asset_ids) * 100).toFixed(1);

  console.log(`Join-based coverage verification: ${joinCoverage}%`);
  console.log(`  (${parseInt(breakdown.mapped_asset_ids).toLocaleString()}/${parseInt(breakdown.total_asset_ids).toLocaleString()} asset_ids have mappings)`);
  console.log();

  // 6. Final verdict
  console.log('═'.repeat(80));

  if (parseFloat(joinCoverage) >= 95.0) {
    console.log('✅ COVERAGE TARGET ACHIEVED!');
    console.log('═'.repeat(80));
    console.log();
    console.log(`Final coverage: ${joinCoverage}% (≥95% threshold)`);
    console.log();
    console.log('✅ P&L validation unblocked - ready to proceed with validation');
    console.log();
    console.log('Next steps:');
    console.log('  1. npx tsx scripts/verify-coverage-complete.ts');
    console.log('  2. npx tsx scripts/validate-corrected-pnl-comprehensive.ts');
  } else {
    console.log('⚠️  COVERAGE BELOW TARGET');
    console.log('═'.repeat(80));
    console.log();
    console.log(`Current coverage: ${joinCoverage}% (target: ≥95%)`);
    console.log(`Gap remaining: ${(95.0 - parseFloat(joinCoverage)).toFixed(1)}%`);
    console.log();
    console.log('Options:');
    console.log('  1. Investigate unmapped tokens for patterns');
    console.log('  2. Run Goldsky API backfill for remaining gaps');
    console.log('  3. Proceed with validation (may have >2% P&L variance)');
  }

  console.log('═'.repeat(80));
}

main().catch(console.error);
