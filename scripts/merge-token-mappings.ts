#!/usr/bin/env npx tsx

/**
 * PHASE 3: Merge Staging Tables to Production
 *
 * Merges token mappings from both staging tables (Dome + Goldsky tracks)
 * into the production ctf_token_map table.
 *
 * Strategy:
 * 1. Verify staging table completeness
 * 2. Union both staging tables (deduplicating on token_id)
 * 3. Insert new mappings to ctf_token_map (skip duplicates)
 * 4. Report final coverage statistics
 *
 * Usage: npx tsx scripts/merge-token-mappings.ts
 *
 * Expected runtime: ~5-10 minutes
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  console.log('═'.repeat(80));
  console.log('PHASE 3: MERGE STAGING TABLES TO PRODUCTION');
  console.log('═'.repeat(80));
  console.log();

  // 1. Verify staging table completeness
  console.log('[1] Staging Table Verification');
  console.log('─'.repeat(80));

  const domeResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM staging.clob_asset_map_dome',
    format: 'JSONEachRow'
  });
  const domeCount = (await domeResult.json())[0].cnt;

  const goldskyResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM staging.clob_asset_map_goldsky',
    format: 'JSONEachRow'
  });
  const goldskyCount = (await goldskyResult.json())[0].cnt;

  console.log(`Dome track mappings:     ${parseInt(domeCount).toLocaleString()}`);
  console.log(`Goldsky track mappings:  ${parseInt(goldskyCount).toLocaleString()}`);
  console.log(`Total new mappings:      ${(parseInt(domeCount) + parseInt(goldskyCount)).toLocaleString()}`);
  console.log();

  if (domeCount === '0' && goldskyCount === '0') {
    console.error('❌ ERROR: Both staging tables are empty. Run Phase 1 and Phase 2 first.');
    process.exit(1);
  }

  // 2. Check for overlaps between staging tables
  console.log('[2] Checking for Overlaps');
  console.log('─'.repeat(80));

  const overlapResult = await clickhouse.query({
    query: `
      SELECT COUNT(*) as cnt
      FROM staging.clob_asset_map_dome d
      INNER JOIN staging.clob_asset_map_goldsky g
        ON d.token_id = g.token_id
    `,
    format: 'JSONEachRow'
  });
  const overlapCount = (await overlapResult.json())[0].cnt;

  console.log(`Overlapping tokens: ${parseInt(overlapCount).toLocaleString()}`);
  console.log();

  if (parseInt(overlapCount) > 0) {
    console.log(`ℹ️  Found ${parseInt(overlapCount).toLocaleString()} tokens in both staging tables.`);
    console.log(`   Will deduplicate (Dome track takes precedence).`);
    console.log();
  }

  // 3. Get current production coverage
  console.log('[3] Current Production Coverage');
  console.log('─'.repeat(80));

  const beforeResult = await clickhouse.query({
    query: `
      SELECT
        (SELECT uniq(asset_id) FROM clob_fills) as total_tokens,
        (SELECT COUNT(*) FROM ctf_token_map WHERE condition_id_norm != '') as mapped_tokens
    `,
    format: 'JSONEachRow'
  });
  const before = (await beforeResult.json())[0];

  const beforeCoverage = (parseInt(before.mapped_tokens) / parseInt(before.total_tokens) * 100).toFixed(1);

  console.log(`Total unique asset_ids:  ${parseInt(before.total_tokens).toLocaleString()}`);
  console.log(`Currently mapped:        ${parseInt(before.mapped_tokens).toLocaleString()} (${beforeCoverage}%)`);
  console.log();

  // 4. Merge staging tables to production
  console.log('[4] Merging Staging → Production');
  console.log('─'.repeat(80));

  // Union both staging tables with deduplication (Dome takes precedence)
  await clickhouse.query({
    query: `
      INSERT INTO default.ctf_token_map
        (token_id, condition_id_norm, outcome_index, outcome_label, source, fetched_at)
      SELECT
        token_id,
        condition_id_norm,
        outcome_index,
        outcome_label,
        source,
        fetched_at
      FROM (
        SELECT
          token_id,
          condition_id_norm,
          outcome_index,
          outcome_label,
          source,
          fetched_at,
          ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY source ASC) as rn
        FROM (
          SELECT * FROM staging.clob_asset_map_dome
          UNION ALL
          SELECT * FROM staging.clob_asset_map_goldsky
        )
      )
      WHERE rn = 1
        AND token_id NOT IN (SELECT token_id FROM default.ctf_token_map)
    `
  });

  console.log('✓ Merge complete');
  console.log();

  // 5. Verify new coverage
  console.log('[5] Post-Merge Coverage');
  console.log('─'.repeat(80));

  const afterResult = await clickhouse.query({
    query: `
      SELECT
        (SELECT uniq(asset_id) FROM clob_fills) as total_tokens,
        (SELECT COUNT(*) FROM ctf_token_map WHERE condition_id_norm != '') as mapped_tokens
    `,
    format: 'JSONEachRow'
  });
  const after = (await afterResult.json())[0];

  const afterCoverage = (parseInt(after.mapped_tokens) / parseInt(after.total_tokens) * 100).toFixed(1);
  const newMappings = parseInt(after.mapped_tokens) - parseInt(before.mapped_tokens);
  const coverageGain = (parseFloat(afterCoverage) - parseFloat(beforeCoverage)).toFixed(1);

  console.log(`Total unique asset_ids:  ${parseInt(after.total_tokens).toLocaleString()}`);
  console.log(`Now mapped:              ${parseInt(after.mapped_tokens).toLocaleString()} (${afterCoverage}%)`);
  console.log();
  console.log(`New mappings added:      ${newMappings.toLocaleString()}`);
  console.log(`Coverage increase:       +${coverageGain}%`);
  console.log();

  // 6. Final verdict
  console.log('═'.repeat(80));

  if (parseFloat(afterCoverage) >= 95.0) {
    console.log('✅ PHASE 3 COMPLETE - Coverage Target Achieved!');
    console.log('═'.repeat(80));
    console.log();
    console.log(`Final coverage: ${afterCoverage}% (≥95% threshold)`);
    console.log();
    console.log('Ready to proceed with Phase 4 (Coverage Verification)');
  } else {
    console.log('⚠️  PHASE 3 COMPLETE - Coverage Below Target');
    console.log('═'.repeat(80));
    console.log();
    console.log(`Current coverage: ${afterCoverage}% (target: ≥95%)`);
    console.log(`Gap remaining: ${(95.0 - parseFloat(afterCoverage)).toFixed(1)}%`);
    console.log();
    console.log('Options:');
    console.log('1. Proceed with validation (may have <2% P&L variance)');
    console.log('2. Run additional backfill iterations to improve coverage');
    console.log('3. Investigate unmapped tokens for patterns');
  }

  console.log('═'.repeat(80));
}

main().catch(console.error);
