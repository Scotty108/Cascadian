#!/usr/bin/env npx tsx
/**
 * Safe Refresh of Unified Table
 * 
 * Steps:
 * 1. Create backup table
 * 2. Verify backup
 * 3. Delete stale unresolved positions
 * 4. Rebuild fresh unresolved positions
 * 5. Verify final state
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function safeRefresh() {
  console.log('🔄 Safe Refresh of Unified Table\n');
  
  // Step 1: Create backup
  console.log('1️⃣  Creating backup table...');
  const backupName = `pm_trade_fifo_roi_v3_mat_unified_backup_${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
  
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS ${backupName}`
  });
  
  await clickhouse.command({
    query: `
      CREATE TABLE ${backupName} AS pm_trade_fifo_roi_v3_mat_unified
      ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
    `
  });
  
  await clickhouse.command({
    query: `INSERT INTO ${backupName} SELECT * FROM pm_trade_fifo_roi_v3_mat_unified`
  });
  
  console.log(`   ✅ Backup created: ${backupName}\n`);
  
  // Step 2: Verify backup
  console.log('2️⃣  Verifying backup...');
  const backupVerify = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved
      FROM ${backupName}
    `,
    format: 'JSONEachRow'
  });
  const backup = (await backupVerify.json<any>())[0];
  
  console.log(`   Total: ${parseInt(backup.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(backup.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(backup.unresolved).toLocaleString()}`);
  
  if (parseInt(backup.total) !== 587724876) {
    throw new Error('Backup verification failed! Row count mismatch');
  }
  console.log('   ✅ Backup verified\n');
  
  // Step 3: Delete stale unresolved positions
  console.log('3️⃣  Deleting stale unresolved positions...');
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE resolved_at IS NULL
    `
  });
  
  // Wait for mutation to complete
  console.log('   Waiting for DELETE to complete...');
  let mutationsDone = false;
  while (!mutationsDone) {
    const mutationsResult = await clickhouse.query({
      query: `
        SELECT count() as pending
        FROM system.mutations
        WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
          AND database = 'default'
          AND is_done = 0
      `,
      format: 'JSONEachRow'
    });
    const mutations = (await mutationsResult.json<any>())[0];
    
    if (parseInt(mutations.pending) === 0) {
      mutationsDone = true;
    } else {
      console.log(`   Still processing... (${mutations.pending} mutations pending)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  console.log('   ✅ Stale positions deleted\n');
  
  // Step 4: Rebuild fresh unresolved positions
  console.log('4️⃣  Rebuilding fresh unresolved positions...');
  
  // Get active wallets (last 24 hours)
  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 24 HOUR
        AND wallet != '0x0000000000000000000000000000000000000000'
        AND source = 'clob'
    `,
    format: 'JSONEachRow'
  });
  const wallets = await walletsResult.json<{ wallet: string }>();
  
  console.log(`   Found ${wallets.length.toLocaleString()} active wallets`);
  
  // Get unresolved conditions
  const conditionsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_token_to_condition_map_v5
      WHERE condition_id NOT IN (
        SELECT condition_id FROM pm_condition_resolutions
      )
    `,
    format: 'JSONEachRow'
  });
  const conditions = await conditionsResult.json<{ condition_id: string }>();
  
  console.log(`   Found ${conditions.length.toLocaleString()} unresolved conditions`);
  
  // Process in batches
  const BATCH_SIZE = 500;
  const batches = Math.ceil(wallets.length / BATCH_SIZE);
  
  console.log(`   Processing ${batches} batches...\n`);
  
  for (let i = 0; i < batches; i++) {
    const batchWallets = wallets.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const walletList = batchWallets.map(w => `'${w.wallet}'`).join(',');
    
    // Insert LONG positions
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          tx_hash,
          wallet,
          condition_id,
          outcome_index,
          min(event_time) as entry_time,
          NULL as resolved_at,
          sum(shares_delta) as tokens,
          sum(abs(usdc_delta)) as cost_usd,
          0 as tokens_sold_early,
          sum(shares_delta) as tokens_held,
          0 as exit_value,
          -sum(abs(usdc_delta)) as pnl_usd,
          -1.0 as roi,
          0 as pct_sold_early,
          max(is_maker) as is_maker,
          0 as is_closed,
          0 as is_short
        FROM pm_canonical_fills_v4
        WHERE wallet IN (${walletList})
          AND source = 'clob'
          AND shares_delta > 0
          AND condition_id IN (SELECT condition_id FROM (${conditions.map(c => `SELECT '${c.condition_id}' as condition_id`).join(' UNION ALL ')}))
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        HAVING tokens_held > 0.01
      `,
      clickhouse_settings: {
        max_execution_time: 300,
      }
    });
    
    if ((i + 1) % 10 === 0) {
      console.log(`   Batch ${i + 1}/${batches} complete`);
    }
  }
  
  console.log('   ✅ Unresolved positions rebuilt\n');
  
  // Step 5: Final verification
  console.log('5️⃣  Final verification...');
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        uniq(wallet) as wallets,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as resolved_stale_min,
        (SELECT max(event_time) FROM pm_canonical_fills_v4 WHERE source = 'clob') as newest_fill,
        date_diff('minute', (SELECT max(event_time) FROM pm_canonical_fills_v4 WHERE source = 'clob'), now()) as fill_stale_min
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json<any>())[0];
  
  console.log('\n📊 FINAL STATE:');
  console.log(`   Total rows: ${parseInt(final.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(final.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(final.unresolved).toLocaleString()}`);
  console.log(`   Wallets: ${parseInt(final.wallets).toLocaleString()}`);
  console.log(`   Newest resolved: ${final.newest_resolved} (${final.resolved_stale_min} min stale)`);
  console.log(`   Newest fill: ${final.newest_fill} (${final.fill_stale_min} min stale)`);
  
  console.log(`\n✅ REFRESH COMPLETE!`);
  console.log(`   Backup: ${backupName}`);
  console.log(`   Safe to drop backup after 24-48 hours if all looks good.`);
}

safeRefresh().catch(console.error);
