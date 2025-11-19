#!/usr/bin/env tsx
/**
 * Global Resolution Sync: gamma_resolved → pm_markets
 *
 * Generalizes script 111 to work for ALL markets, not just 8 specific ones.
 *
 * This script:
 * 1. Finds ALL markets where gamma_resolved and pm_markets disagree on status/resolution
 * 2. Runs in dry-run mode by default to show what would change
 * 3. Can execute actual sync when --execute flag is provided
 * 4. Uses atomic CREATE + RENAME approach for safety
 *
 * Decision rules:
 * - Market is "resolved" if gamma_resolved.closed = 1 OR winning_outcome is not null/empty
 * - pm_markets.status should = 'resolved' if gamma says resolved
 * - pm_markets.market_type should = 'binary' (inferred from gamma data)
 * - pm_markets.resolved_at should = gamma_resolved.fetched_at
 *
 * SAFE: Read-only in dry-run mode, atomic rebuild with backups when executing
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const DRY_RUN = !process.argv.includes('--execute');

async function main() {
  console.log('🔄 Global Resolution Sync: gamma_resolved → pm_markets');
  console.log('='.repeat(80));
  console.log('');

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made');
    console.log('   Run with --execute flag to apply changes');
  } else {
    console.log('🚨 EXECUTE MODE - Changes will be applied');
  }
  console.log('');

  // Step 1: Get total counts
  console.log('Step 1: Inventory baseline...');
  console.log('');

  const totalsQuery = await clickhouse.query({
    query: `
      SELECT
        (SELECT COUNT(*) FROM pm_markets) as total_pm_markets,
        (SELECT COUNT(*) FROM gamma_resolved) as total_gamma_resolved,
        (SELECT COUNT(*) FROM pm_markets WHERE status = 'resolved') as pm_markets_resolved,
        (SELECT COUNT(*) FROM pm_markets WHERE market_type IS NULL OR market_type = '') as pm_markets_null_type
    `,
    format: 'JSONEachRow'
  });
  const totals = (await totalsQuery.json())[0];

  console.log('Current state:');
  console.log(`  pm_markets total: ${totals.total_pm_markets}`);
  console.log(`  pm_markets resolved: ${totals.pm_markets_resolved} (${(100 * totals.pm_markets_resolved / totals.total_pm_markets).toFixed(1)}%)`);
  console.log(`  pm_markets with null/empty type: ${totals.pm_markets_null_type}`);
  console.log(`  gamma_resolved total: ${totals.total_gamma_resolved}`);
  console.log('');

  // Step 2: Find markets that need sync
  console.log('Step 2: Find markets where gamma and pm_markets disagree...');
  console.log('');

  const inconsistenciesQuery = await clickhouse.query({
    query: `
      WITH gamma_clean AS (
        SELECT
          lower(replaceAll(cid, '0x', '')) as condition_id_norm,
          winning_outcome,
          closed,
          fetched_at
        FROM gamma_resolved
        WHERE closed = 1 OR (winning_outcome IS NOT NULL AND winning_outcome != '')
      ),
      pm_clean AS (
        SELECT
          lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
          status,
          market_type,
          resolved_at
        FROM pm_markets
      )
      SELECT
        pm.condition_id_norm,
        pm.status as pm_status,
        pm.market_type as pm_market_type,
        pm.resolved_at as pm_resolved_at,
        gr.closed as gamma_closed,
        gr.winning_outcome as gamma_winning_outcome,
        gr.fetched_at as gamma_fetched_at,
        CASE
          WHEN pm.status != 'resolved' AND gr.condition_id_norm IS NOT NULL THEN 'status_mismatch'
          WHEN (pm.market_type IS NULL OR pm.market_type = '') AND gr.condition_id_norm IS NOT NULL THEN 'missing_market_type'
          WHEN pm.resolved_at IS NULL AND gr.condition_id_norm IS NOT NULL THEN 'missing_resolved_at'
          ELSE 'ok'
        END as inconsistency_type
      FROM pm_clean pm
      INNER JOIN gamma_clean gr ON pm.condition_id_norm = gr.condition_id_norm
      WHERE pm.status != 'resolved'
         OR (pm.market_type IS NULL OR pm.market_type = '')
         OR pm.resolved_at IS NULL
    `,
    format: 'JSONEachRow'
  });
  const inconsistencies = await inconsistenciesQuery.json();

  console.log(`Markets with inconsistencies: ${inconsistencies.length}`);
  console.log('');

  // Breakdown by type
  const statusMismatch = inconsistencies.filter(m => m.pm_status !== 'resolved').length;
  const missingType = inconsistencies.filter(m => !m.pm_market_type || m.pm_market_type === '').length;
  const missingResolvedAt = inconsistencies.filter(m => !m.pm_resolved_at).length;

  console.log('Breakdown:');
  console.log(`  Status mismatch (pm_markets not 'resolved'): ${statusMismatch}`);
  console.log(`  Missing market_type: ${missingType}`);
  console.log(`  Missing resolved_at timestamp: ${missingResolvedAt}`);
  console.log('');

  if (inconsistencies.length === 0) {
    console.log('✅ All markets are in sync! No action needed.');
    process.exit(0);
  }

  // Show sample of what would change
  console.log('Sample of changes (first 10):');
  console.table(inconsistencies.slice(0, 10).map(m => ({
    'Condition ID (short)': (m.condition_id_norm || '').substring(0, 16) + '...',
    'Current Status': m.pm_status,
    'Current Type': m.pm_market_type || 'NULL',
    'Gamma Closed': m.gamma_closed,
    'Will Update': m.pm_status !== 'resolved' ? 'status→resolved' : (m.pm_market_type ? 'type' : 'resolved_at')
  })));
  console.log('');

  if (DRY_RUN) {
    console.log('='.repeat(80));
    console.log('DRY RUN SUMMARY');
    console.log('='.repeat(80));
    console.log('');
    console.log('If you run with --execute, the following would happen:');
    console.log('');
    console.log(`1. ${statusMismatch} markets would have status updated to 'resolved'`);
    console.log(`2. ${missingType} markets would have market_type set to 'binary'`);
    console.log(`3. ${missingResolvedAt} markets would have resolved_at timestamp set`);
    console.log('');
    console.log('Total markets affected: ' + inconsistencies.length);
    console.log('');
    console.log('To execute these changes, run:');
    console.log('  npx tsx scripts/123-sync-resolution-status-global.ts --execute');
    console.log('');
    process.exit(0);
  }

  // EXECUTE MODE from here on
  console.log('='.repeat(80));
  console.log('EXECUTING CHANGES');
  console.log('='.repeat(80));
  console.log('');

  // Step 3: Create updated pm_markets table
  console.log('Step 3: Create pm_markets_new with synced resolution data...');
  console.log('');

  await clickhouse.command({
    query: `
      CREATE TABLE pm_markets_new
      ENGINE = ReplacingMergeTree()
      ORDER BY (condition_id, outcome_index)
      AS
      WITH gamma_clean AS (
        SELECT
          lower(replaceAll(cid, '0x', '')) as condition_id_norm,
          winning_outcome,
          closed,
          fetched_at
        FROM gamma_resolved
        WHERE closed = 1 OR (winning_outcome IS NOT NULL AND winning_outcome != '')
      )
      SELECT
        pm.condition_id,
        pm.outcome_index,
        pm.market_slug,
        pm.question,
        pm.outcome_label,
        pm.outcomes_json,
        pm.total_outcomes,
        -- Update market_type if missing
        if(
          (pm.market_type IS NULL OR pm.market_type = '') AND gr.condition_id_norm IS NOT NULL,
          'binary',
          pm.market_type
        ) as market_type,
        -- Update status to 'resolved' if in gamma_resolved
        if(gr.condition_id_norm IS NOT NULL, 'resolved', pm.status) as status,
        -- Update resolved_at with fetched_at from gamma_resolved
        if(gr.condition_id_norm IS NOT NULL, toDateTime(gr.fetched_at), pm.resolved_at) as resolved_at,
        pm.winning_outcome_index,
        pm.is_winning_outcome,
        pm.description,
        pm.category,
        pm.end_date,
        pm.data_source
      FROM pm_markets pm
      LEFT JOIN gamma_clean gr
        ON lower(replaceAll(pm.condition_id, '0x', '')) = gr.condition_id_norm
    `
  });

  console.log('✅ Created pm_markets_new');
  console.log('');

  // Step 4: Verify the new table
  console.log('Step 4: Verify updates in pm_markets_new...');
  console.log('');

  const verifyQuery = await clickhouse.query({
    query: `
      SELECT
        (SELECT COUNT(*) FROM pm_markets_new) as total,
        (SELECT COUNT(*) FROM pm_markets_new WHERE status = 'resolved') as resolved,
        (SELECT COUNT(*) FROM pm_markets_new WHERE market_type IS NULL OR market_type = '') as null_type
    `,
    format: 'JSONEachRow'
  });
  const verify = (await verifyQuery.json())[0];

  console.log('New table stats:');
  console.log(`  Total: ${verify.total}`);
  console.log(`  Resolved: ${verify.resolved} (${(100 * verify.resolved / verify.total).toFixed(1)}%)`);
  console.log(`  Null/empty market_type: ${verify.null_type}`);
  console.log('');

  const resolvedIncrease = verify.resolved - totals.pm_markets_resolved;
  const typeFixed = totals.pm_markets_null_type - verify.null_type;

  console.log('Changes applied:');
  console.log(`  Markets newly marked 'resolved': +${resolvedIncrease}`);
  console.log(`  Markets with market_type fixed: +${typeFixed}`);
  console.log('');

  // Sanity checks
  if (verify.total !== totals.total_pm_markets) {
    console.log(`❌ ERROR: Row count mismatch!`);
    console.log(`   Original: ${totals.total_pm_markets}, New: ${verify.total}`);
    console.log('   Dropping pm_markets_new (safety measure)');
    await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_markets_new' });
    process.exit(1);
  }

  if (resolvedIncrease < 0) {
    console.log(`❌ ERROR: Resolved count decreased! This should never happen.`);
    console.log('   Dropping pm_markets_new (safety measure)');
    await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_markets_new' });
    process.exit(1);
  }

  // Step 5: Swap tables
  console.log('Step 5: Swap tables...');
  console.log('');

  console.log('Renaming old pm_markets to pm_markets_backup...');
  await clickhouse.command({
    query: 'RENAME TABLE pm_markets TO pm_markets_backup'
  });

  console.log('Renaming pm_markets_new to pm_markets...');
  await clickhouse.command({
    query: 'RENAME TABLE pm_markets_new TO pm_markets'
  });

  console.log('✅ Tables swapped successfully');
  console.log('   pm_markets (old) → pm_markets_backup');
  console.log('   pm_markets_new → pm_markets (active)');
  console.log('');

  // Step 6: Final verification
  console.log('Step 6: Final verification...');
  console.log('');

  const finalQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
        COUNT(CASE WHEN market_type IS NULL OR market_type = '' THEN 1 END) as null_type
      FROM pm_markets
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalQuery.json())[0];

  console.log('Final pm_markets state:');
  console.log(`  Total: ${final.total}`);
  console.log(`  Resolved: ${final.resolved} (${(100 * final.resolved / final.total).toFixed(1)}%)`);
  console.log(`  Null/empty market_type: ${final.null_type}`);
  console.log('');

  // Summary
  console.log('='.repeat(80));
  console.log('✅ GLOBAL RESOLUTION SYNC COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log('Summary of changes:');
  console.log(`  Markets synced from gamma_resolved: ${inconsistencies.length}`);
  console.log(`  Status updated to 'resolved': ${resolvedIncrease}`);
  console.log(`  market_type set to 'binary': ${typeFixed}`);
  console.log('');
  console.log('Coverage improvement:');
  console.log(`  Before: ${totals.pm_markets_resolved}/${totals.total_pm_markets} (${(100 * totals.pm_markets_resolved / totals.total_pm_markets).toFixed(1)}%) resolved`);
  console.log(`  After:  ${final.resolved}/${final.total} (${(100 * final.resolved / final.total).toFixed(1)}%) resolved`);
  console.log('');
  console.log('Safety:');
  console.log('  - Original table backed up as pm_markets_backup');
  console.log('  - To rollback: RENAME TABLE pm_markets TO pm_markets_new, pm_markets_backup TO pm_markets');
  console.log('');
  console.log('Next steps:');
  console.log('  1. P&L views (pm_wallet_market_pnl_resolved) will automatically pick up newly resolved markets');
  console.log('  2. Run coverage validation to ensure consistency');
  console.log('  3. Document results in RESOLUTION_GLOBAL_COVERAGE_SUMMARY.md');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
