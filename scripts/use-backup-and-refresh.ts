#!/usr/bin/env npx tsx
/**
 * Use Backup Table and Refresh
 * Skip mutation queue entirely by using yesterday's clean backup
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function useBackupAndRefresh() {
  console.log('🔄 Using Backup Table (bypass mutation queue)\n');
  
  // Step 1: Kill pending mutations
  console.log('1️⃣  Killing pending mutations...');
  await clickhouse.command({
    query: `
      KILL MUTATION
      WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
        AND database = 'default'
        AND is_done = 0
      SYNC
    `
  });
  console.log('   ✅ Mutations killed\n');
  
  // Step 2: Rename tables (atomic swap)
  console.log('2️⃣  Swapping to backup table...');
  
  await clickhouse.command({
    query: `RENAME TABLE pm_trade_fifo_roi_v3_mat_unified TO pm_trade_fifo_roi_v3_mat_unified_old_broken`
  });
  
  await clickhouse.command({
    query: `RENAME TABLE pm_trade_fifo_roi_v3_mat_unified_backup_20260129 TO pm_trade_fifo_roi_v3_mat_unified`
  });
  
  console.log('   ✅ Tables swapped\n');
  
  // Step 3: Verify current state
  const currentResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const current = (await currentResult.json<any>())[0];
  
  console.log('3️⃣  Current state (from backup):');
  console.log(`   Total: ${parseInt(current.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(current.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(current.unresolved).toLocaleString()}\n`);
  
  // Step 4: Delete old unresolved positions from backup
  console.log('4️⃣  Deleting old unresolved positions...');
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE resolved_at IS NULL
    `
  });
  
  console.log('   Waiting for DELETE...');
  let done = false;
  let attempts = 0;
  while (!done && attempts < 120) {
    const mutResult = await clickhouse.query({
      query: `SELECT count() as p FROM system.mutations WHERE table = 'pm_trade_fifo_roi_v3_mat_unified' AND is_done = 0`,
      format: 'JSONEachRow'
    });
    const mut = (await mutResult.json<any>())[0];
    if (parseInt(mut.p) === 0) {
      done = true;
    } else {
      await new Promise(r => setTimeout(r, 5000));
      attempts++;
    }
  }
  console.log('   ✅ Old unresolved deleted\n');
  
  // Step 5: Rebuild fresh unresolved
  console.log('5️⃣  Building fresh unresolved positions...');
  
  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 24 HOUR
        AND source = 'clob'
    `,
    format: 'JSONEachRow'
  });
  const wallets = await walletsResult.json<{ wallet: string }>();
  console.log(`   Active wallets: ${wallets.length.toLocaleString()}`);
  
  const BATCH_SIZE = 500;
  for (let i = 0; i < Math.ceil(wallets.length / BATCH_SIZE); i++) {
    const batch = wallets.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const wList = batch.map(w => `'${w.wallet}'`).join(',');
    
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          tx_hash, wallet, condition_id, outcome_index,
          min(event_time) as entry_time,
          NULL as resolved_at,
          sum(shares_delta) as tokens,
          sum(abs(usdc_delta)) as cost_usd,
          0, sum(shares_delta), 0, -sum(abs(usdc_delta)), -1.0, 0,
          max(is_maker), 0, 0
        FROM pm_canonical_fills_v4
        WHERE wallet IN (${wList})
          AND source = 'clob'
          AND shares_delta > 0
          AND condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions)
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        HAVING sum(shares_delta) > 0.01
      `,
      clickhouse_settings: { max_execution_time: 300 }
    });
    
    if ((i + 1) % 10 === 0) console.log(`   Batch ${i + 1} complete`);
  }
  
  console.log('\n   ✅ Fresh unresolved built\n');
  
  // Final stats
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        uniq(wallet) as wallets,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as stale_min
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json<any>())[0];
  
  console.log('📊 FINAL:');
  console.log(`   Total: ${parseInt(final.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(final.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(final.unresolved).toLocaleString()}`);
  console.log(`   Wallets: ${parseInt(final.wallets).toLocaleString()}`);
  console.log(`   Freshness: ${final.stale_min} min stale\n`);
  
  console.log('✅ COMPLETE! Broken table saved as: pm_trade_fifo_roi_v3_mat_unified_old_broken');
}

useBackupAndRefresh().catch(console.error);
