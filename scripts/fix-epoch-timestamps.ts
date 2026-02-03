/**
 * Fix Epoch Timestamps in pm_condition_resolutions
 *
 * Problem: 7,171 conditions have resolved_at = '1970-01-01' (Unix epoch)
 * Solution: Reconstruct timestamps from pm_canonical_fills_v4 (max event_time per condition)
 *
 * This uses atomic rebuild pattern (CREATE TABLE AS SELECT → RENAME)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function fixEpochTimestamps() {
  const client = getClickHouseClient();
  const startTime = Date.now();

  console.log('=== Fix Epoch Timestamps in pm_condition_resolutions ===\n');

  // Step 1: Check current state
  console.log('Step 1: Checking current state...');
  const currentState = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at = '1970-01-01') as epoch_count,
        countIf(resolved_at != '1970-01-01' AND resolved_at IS NOT NULL) as valid_count
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const state = (await currentState.json() as any[])[0];
  console.log(`  Total conditions: ${state.total}`);
  console.log(`  Epoch timestamps: ${state.epoch_count}`);
  console.log(`  Valid timestamps: ${state.valid_count}`);

  if (state.epoch_count === 0) {
    console.log('\n✅ No epoch timestamps found. Nothing to fix.');
    return;
  }

  // Step 2: Get list of epoch conditions first (small query)
  console.log('\nStep 2: Getting list of epoch condition IDs...');
  const epochConditions = await client.query({
    query: `
      SELECT condition_id
      FROM pm_condition_resolutions
      WHERE resolved_at = '1970-01-01'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const epochList = (await epochConditions.json() as { condition_id: string }[]).map(r => r.condition_id);
  console.log(`  Found ${epochList.length} epoch conditions`);

  // Step 3: Create temp table and populate in batches
  console.log('\nStep 3: Creating temp table with corrected timestamps (batched)...');
  await client.command({ query: `DROP TABLE IF EXISTS _temp_epoch_fixes` });
  await client.command({
    query: `
      CREATE TABLE _temp_epoch_fixes (
        condition_id String,
        corrected_resolved_at DateTime
      ) ENGINE = MergeTree() ORDER BY condition_id
    `,
  });

  // Process in batches of 500 conditions
  const BATCH_SIZE = 500;
  let processed = 0;
  for (let i = 0; i < epochList.length; i += BATCH_SIZE) {
    const batch = epochList.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map(id => `'${id}'`).join(',');

    await client.command({
      query: `
        INSERT INTO _temp_epoch_fixes
        SELECT
          condition_id,
          max(event_time) as corrected_resolved_at
        FROM pm_canonical_fills_v4
        WHERE condition_id IN (${conditionList})
        GROUP BY condition_id
      `,
      clickhouse_settings: { max_execution_time: 120 },
    });

    processed += batch.length;
    if (processed % 2000 === 0 || processed === epochList.length) {
      console.log(`  Processed ${processed}/${epochList.length} conditions`);
    }
  }

  // Verify temp table
  const tempCount = await client.query({
    query: `SELECT count() as cnt FROM _temp_epoch_fixes`,
    format: 'JSONEachRow',
  });
  const tempResult = (await tempCount.json() as any[])[0];
  console.log(`  Corrected timestamps found: ${tempResult.cnt}`);

  // Step 3: Get schema of existing table
  console.log('\nStep 3: Creating fixed resolutions table...');

  // Get the CREATE TABLE statement for the existing table
  const schemaResult = await client.query({
    query: `SHOW CREATE TABLE pm_condition_resolutions`,
    format: 'JSONEachRow',
  });
  const schemaRow = (await schemaResult.json() as any[])[0];
  console.log('  Retrieved existing schema');

  // Step 4: Create the fixed table using atomic rebuild pattern
  await client.command({ query: `DROP TABLE IF EXISTS pm_condition_resolutions_fixed` });

  await client.command({
    query: `
      CREATE TABLE pm_condition_resolutions_fixed
      ENGINE = MergeTree()
      ORDER BY (condition_id)
      AS
      SELECT
        r.condition_id,
        r.payout_numerators,
        r.payout_denominator,
        COALESCE(
          if(fix.corrected_resolved_at IS NOT NULL AND r.resolved_at = '1970-01-01',
             fix.corrected_resolved_at,
             NULL),
          r.resolved_at
        ) as resolved_at,
        r.block_number,
        r.tx_hash,
        r.is_deleted
      FROM pm_condition_resolutions r
      LEFT JOIN _temp_epoch_fixes fix ON r.condition_id = fix.condition_id
    `,
    clickhouse_settings: { max_execution_time: 300 },
  });

  // Verify the fixed table
  const fixedState = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at = '1970-01-01') as epoch_count,
        countIf(resolved_at != '1970-01-01' AND resolved_at IS NOT NULL) as valid_count
      FROM pm_condition_resolutions_fixed
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const fixed = (await fixedState.json() as any[])[0];
  console.log(`\n  Fixed table stats:`);
  console.log(`    Total conditions: ${fixed.total}`);
  console.log(`    Epoch timestamps: ${fixed.epoch_count}`);
  console.log(`    Valid timestamps: ${fixed.valid_count}`);

  // Step 5: Atomic swap
  console.log('\nStep 4: Performing atomic swap...');

  // Backup original
  await client.command({ query: `DROP TABLE IF EXISTS pm_condition_resolutions_backup_epoch` });
  await client.command({
    query: `RENAME TABLE pm_condition_resolutions TO pm_condition_resolutions_backup_epoch`
  });
  console.log('  Backed up original table');

  // Activate fixed table
  await client.command({
    query: `RENAME TABLE pm_condition_resolutions_fixed TO pm_condition_resolutions`
  });
  console.log('  Activated fixed table');

  // Cleanup temp table
  await client.command({ query: `DROP TABLE IF EXISTS _temp_epoch_fixes` });
  console.log('  Cleaned up temp table');

  // Final verification
  console.log('\nStep 5: Final verification...');
  const finalState = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at = '1970-01-01') as epoch_count
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const final = (await finalState.json() as any[])[0];

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log('RESULTS:');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Before: ${state.epoch_count} epoch timestamps`);
  console.log(`  After: ${final.epoch_count} epoch timestamps`);
  console.log(`  Fixed: ${state.epoch_count - final.epoch_count} conditions`);
  console.log(`  Duration: ${duration}s`);

  if (final.epoch_count === 0) {
    console.log('\n✅ SUCCESS: All epoch timestamps have been fixed!');
  } else {
    console.log(`\n⚠️ WARNING: ${final.epoch_count} epoch timestamps remain (no matching fills found)`);
  }

  console.log('\nBackup table available: pm_condition_resolutions_backup_epoch');
  console.log('To rollback: RENAME TABLE pm_condition_resolutions TO pm_condition_resolutions_fixed; RENAME TABLE pm_condition_resolutions_backup_epoch TO pm_condition_resolutions;');
}

fixEpochTimestamps().catch(console.error);
