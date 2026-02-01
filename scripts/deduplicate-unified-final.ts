#!/usr/bin/env npx tsx
/**
 * Deduplicate Unified Table - Final Clean Version
 *
 * Steps:
 * 1. Delete ALL unresolved positions
 * 2. Rebuild clean unresolved positions from source
 * 3. Verify zero duplicates
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function deduplicateUnified() {
  const startTime = Date.now();
  console.log('🔄 Deduplicating Unified Table\n');

  // Step 1: Delete all unresolved positions
  console.log('1️⃣ Deleting all unresolved positions...');
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE resolved_at IS NULL
    `
  });

  // Wait for DELETE mutation to complete
  console.log('   Waiting for DELETE mutation...');
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
  console.log('   ✅ Unresolved positions deleted\n');

  // Step 2: Rebuild clean unresolved positions
  console.log('2️⃣ Rebuilding clean unresolved positions...');

  // Find all wallets with unresolved positions
  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND tokens_delta > 0
        AND condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0)
    `,
    format: 'JSONEachRow'
  });
  const wallets = await walletsResult.json<{ wallet: string }>();
  console.log(`   Found ${wallets.length.toLocaleString()} wallets with unresolved positions\n`);

  // Process in batches
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);
  console.log(`   Processing ${totalBatches} batches...\n`);

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
          AND condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0)
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        HAVING sum(tokens_delta) > 0.01
      `,
      clickhouse_settings: { max_execution_time: 300 }
    });

    if ((i + 1) % 100 === 0 || i === totalBatches - 1) {
      const pct = ((i + 1) / totalBatches * 100).toFixed(1);
      console.log(`   Batch ${i + 1}/${totalBatches} (${pct}%)`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ REBUILD COMPLETE in ${elapsed} minutes\n`);

  // Step 3: Verify results
  console.log('3️⃣ Verification:\n');

  const finalResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableQuantity(count()) as total_rows,
        formatReadableQuantity(countIf(resolved_at IS NOT NULL)) as resolved,
        formatReadableQuantity(countIf(resolved_at IS NULL)) as unresolved,
        formatReadableQuantity(uniq(wallet)) as unique_wallets
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json<any>())[0];

  console.log('   📊 Table Stats:');
  console.log(`     Total: ${final.total_rows}`);
  console.log(`     Resolved: ${final.resolved}`);
  console.log(`     Unresolved: ${final.unresolved}`);
  console.log(`     Wallets: ${final.unique_wallets}\n`);

  // Check for duplicates in sample
  const dupResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        uniqExact(tx_hash, wallet, condition_id, outcome_index) as unique_keys,
        count() - uniqExact(tx_hash, wallet, condition_id, outcome_index) as duplicates
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NULL
    `,
    format: 'JSONEachRow'
  });
  const dup = (await dupResult.json<any>())[0];

  console.log('   🔍 Duplicate Check (Unresolved):');
  console.log(`     Total Rows: ${parseInt(dup.total).toLocaleString()}`);
  console.log(`     Unique Keys: ${parseInt(dup.unique_keys).toLocaleString()}`);
  console.log(`     Duplicates: ${parseInt(dup.duplicates).toLocaleString()}`);

  if (parseInt(dup.duplicates) === 0) {
    console.log(`     ✅ ZERO DUPLICATES!\n`);
  } else {
    console.log(`     ⚠️  ${dup.duplicates} duplicates found\n`);
  }

  console.log(`✅ DEDUPLICATION COMPLETE!\n`);
  console.log(`Backup table: pm_trade_fifo_roi_v3_mat_unified_backup_full_20260130\n`);
}

deduplicateUnified().catch(console.error);
