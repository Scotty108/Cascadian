#!/usr/bin/env npx tsx
/**
 * Create Backup and Deduplicate Unresolved Positions
 *
 * Steps:
 * 1. Drop old backup table
 * 2. Create new backup table
 * 3. Insert data from main table
 * 4. Verify backup
 * 5. Delete duplicate unresolved from main table
 * 6. Rebuild clean unresolved
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function createBackupAndDedupe() {
  const startTime = Date.now();
  console.log('🔄 Create Backup & Deduplicate\n');

  // Step 1: Drop old backup if exists
  console.log('1️⃣ Preparing backup table...');
  try {
    await clickhouse.command({
      query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified_backup_20260130_0400`
    });
  } catch (e) {
    console.log('   (table did not exist)');
  }

  // Step 2: Create backup table
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unified_backup_20260130_0400 AS pm_trade_fifo_roi_v3_mat_unified
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
      SETTINGS index_granularity = 8192
    `
  });
  console.log('   ✅ Backup table created\n');

  // Step 3: Copy data to backup
  console.log('2️⃣ Copying data to backup (this may take 2-3 minutes)...');
  await clickhouse.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_backup_20260130_0400
      SELECT * FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    clickhouse_settings: {
      max_execution_time: 600
    }
  });
  console.log('   ✅ Backup complete\n');

  // Step 4: Verify backup
  const backupResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        uniq(wallet) as wallets,
        countIf(resolved_at IS NULL) as unresolved
      FROM pm_trade_fifo_roi_v3_mat_unified_backup_20260130_0400
    `,
    format: 'JSONEachRow'
  });
  const backup = (await backupResult.json<any>())[0];
  console.log('3️⃣ Backup Verification:');
  console.log(`   Total: ${parseInt(backup.total).toLocaleString()}`);
  console.log(`   Wallets: ${parseInt(backup.wallets).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(backup.unresolved).toLocaleString()}\n`);

  // Step 5: Delete ALL unresolved from main table
  console.log('4️⃣ Deleting duplicate unresolved positions...');
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE resolved_at IS NULL
    `
  });

  // Wait for DELETE mutation
  console.log('   Waiting for DELETE to complete...');
  let done = false;
  let attempts = 0;
  while (!done && attempts < 120) {
    const mutResult = await clickhouse.query({
      query: `
        SELECT count() as pending
        FROM system.mutations
        WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
          AND is_done = 0
      `,
      format: 'JSONEachRow'
    });
    const mut = (await mutResult.json<any>())[0];
    const pending = parseInt(mut.pending);

    if (pending === 0) {
      done = true;
    } else {
      if (attempts % 12 === 0) {
        console.log(`   Mutation in progress... (${pending} pending)`);
      }
      await new Promise(r => setTimeout(r, 5000));
      attempts++;
    }
  }

  if (!done) {
    throw new Error('DELETE timeout after 10 minutes');
  }
  console.log('   ✅ Duplicates deleted\n');

  // Step 6: Rebuild clean unresolved
  console.log('5️⃣ Rebuilding clean unresolved positions...');

  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND tokens_delta > 0
        AND condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions)
    `,
    format: 'JSONEachRow'
  });
  const wallets = await walletsResult.json<{ wallet: string }>();
  console.log(`   Found ${wallets.length.toLocaleString()} wallets with unresolved positions`);

  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);

  for (let i = 0; i < totalBatches; i++) {
    const batch = wallets.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const walletList = batch.map(w => `'${w.wallet}'`).join(',');

    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          tx_hash, wallet, condition_id, outcome_index,
          min(event_time) as entry_time,
          NULL as resolved_at,
          sum(tokens_delta) as tokens,
          sum(abs(usdc_delta)) as cost_usd,
          0, sum(tokens_delta), 0, -sum(abs(usdc_delta)), -1.0, 0,
          max(is_maker), 0, 0
        FROM pm_canonical_fills_v4
        WHERE wallet IN (${walletList})
          AND source = 'clob'
          AND tokens_delta > 0
          AND condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions)
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        HAVING sum(tokens_delta) > 0.01
      `,
      clickhouse_settings: { max_execution_time: 300 }
    });

    if ((i + 1) % 100 === 0 || i === totalBatches - 1) {
      const pct = ((i + 1) / totalBatches * 100).toFixed(1);
      console.log(`   Batch ${i + 1}/${totalBatches} (${pct}%)...`);
    }
  }

  console.log('   ✅ Clean unresolved rebuilt\n');

  // Final stats
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        uniq(wallet) as wallets,
        uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique_keys
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json<any>())[0];

  const duplicates = parseInt(final.total) - parseInt(final.unique_keys);
  const dupPct = (duplicates * 100.0 / parseInt(final.total)).toFixed(2);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('📊 FINAL STATE:');
  console.log(`   Total: ${parseInt(final.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(final.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(final.unresolved).toLocaleString()}`);
  console.log(`   Wallets: ${parseInt(final.wallets).toLocaleString()}`);
  console.log(`   Unique Keys: ${parseInt(final.unique_keys).toLocaleString()}`);
  console.log(`   Duplicates: ${duplicates.toLocaleString()} (${dupPct}%)`);
  console.log(`\n✅ COMPLETE in ${elapsed} minutes`);
  console.log(`\nBackup saved: pm_trade_fifo_roi_v3_mat_unified_backup_20260130_0400\n`);
}

createBackupAndDedupe().catch(console.error);
