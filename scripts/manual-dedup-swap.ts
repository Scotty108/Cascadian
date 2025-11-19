#!/usr/bin/env tsx
/**
 * Manual P0 Dedup Swap
 * Complete the atomic swap that was skipped in Steps 3-4
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
  request_timeout: 120000,
});

async function manualSwap() {
  console.log('🔄 Manual P0 Dedup Swap\n');

  // STEP 3: Validation checks
  console.log('Step 3: Running validation checks...\n');

  console.log('Check 1: Verifying row count...');
  const [dedupCount, uniqueCheck] = await Promise.all([
    clickhouse.query({
      query: `SELECT count() AS total FROM pm_trades_canonical_v3_deduped`,
      format: 'JSONEachRow'
    }).then(r => r.json<any>()).then(d => d[0].total),
    clickhouse.query({
      query: `SELECT count(DISTINCT trade_id) AS unique_ids FROM pm_trades_canonical_v3_deduped`,
      format: 'JSONEachRow'
    }).then(r => r.json<any>()).then(d => d[0].unique_ids)
  ]);

  if (dedupCount === uniqueCheck) {
    console.log(`✅ Row count matches unique trade_ids: ${dedupCount}`);
  } else {
    throw new Error(`❌ VALIDATION FAILED: Row count (${dedupCount}) != Unique IDs (${uniqueCheck})`);
  }

  console.log('Check 2: Verifying no duplicates...');
  const dupCheckResult = await clickhouse.query({
    query: `
      SELECT count() AS remaining_dups
      FROM (
        SELECT trade_id
        FROM pm_trades_canonical_v3_deduped
        GROUP BY trade_id
        HAVING count() > 1
      )
    `,
    format: 'JSONEachRow'
  });
  const remainingDups = (await dupCheckResult.json<any>())[0].remaining_dups;

  if (remainingDups === 0) {
    console.log('✅ No duplicates found in deduped table');
  } else {
    throw new Error(`❌ VALIDATION FAILED: ${remainingDups} duplicates still exist`);
  }

  console.log('Check 3: Verifying volume preserved...');
  const [origVolume, dedupVolume] = await Promise.all([
    clickhouse.query({
      query: `
        SELECT sum(usd_value) AS total_volume
        FROM (
          SELECT trade_id, any(usd_value) AS usd_value
          FROM pm_trades_canonical_v3
          GROUP BY trade_id
        )
      `,
      format: 'JSONEachRow'
    }).then(r => r.json<any>()).then(d => d[0].total_volume),
    clickhouse.query({
      query: `SELECT sum(usd_value) AS total_volume FROM pm_trades_canonical_v3_deduped`,
      format: 'JSONEachRow'
    }).then(r => r.json<any>()).then(d => d[0].total_volume)
  ]);

  const volumeDiff = Math.abs(origVolume - dedupVolume);
  const volumeDiffPct = (volumeDiff / origVolume) * 100;

  if (volumeDiffPct < 0.01) {
    console.log(`✅ Volume preserved: $${Math.round(dedupVolume / 1e9)}B`);
    console.log(`   Difference: $${Math.round(volumeDiff)} (${volumeDiffPct.toFixed(4)}%)`);
  } else {
    throw new Error(`❌ VALIDATION FAILED: Volume difference ${volumeDiffPct.toFixed(2)}% exceeds 0.01% threshold`);
  }

  console.log('\n✅ All validation checks passed!\n');

  // STEP 4: Create backup and atomic swap
  console.log('Step 4: Creating backup and executing atomic swap...\n');

  // Atomic swap: backup old, replace with new
  console.log('Executing atomic RENAME (swapping tables)...');
  await clickhouse.query({
    query: `
      RENAME TABLE
        pm_trades_canonical_v3 TO pm_trades_canonical_v3_backup_20251116,
        pm_trades_canonical_v3_deduped TO pm_trades_canonical_v3
    `,
    format: 'JSONEachRow'
  });
  console.log('✅ Tables swapped! Backup saved as pm_trades_canonical_v3_backup_20251116\n');

  // STEP 5: Final verification
  console.log('Step 5: Final verification...\n');

  const finalCount = await clickhouse.query({
    query: `SELECT count() AS total FROM pm_trades_canonical_v3`,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].total);

  console.log(`Final pm_trades_canonical_v3 row count: ${finalCount}`);

  const dupCheck = await clickhouse.query({
    query: `
      SELECT count() AS remaining_dups
      FROM (
        SELECT trade_id
        FROM pm_trades_canonical_v3
        GROUP BY trade_id
        HAVING count() > 1
      )
    `,
    format: 'JSONEachRow'
  }).then(r => r.json<any>()).then(d => d[0].remaining_dups);

  console.log(`Remaining duplicates: ${dupCheck}`);

  console.log('\n================================================================================');
  console.log('🎉 P0 DEDUPLICATION COMPLETE 🎉');
  console.log('================================================================================\n');
  console.log('RESULTS:');
  console.log(`  Before: 139,624,782 trades`);
  console.log(`  After:  ${finalCount} trades`);
  console.log(`  Removed: ${139624782 - finalCount} duplicates`);
  console.log(`  Remaining duplicates: ${dupCheck}`);
  console.log('\nBACKUP LOCATION:');
  console.log('  pm_trades_canonical_v3_backup_20251116');
  console.log('\n================================================================================\n');

  await clickhouse.close();
}

manualSwap().catch((error) => {
  console.error('\n❌ SWAP FAILED:\n', error);
  process.exit(1);
});
