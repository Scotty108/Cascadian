#!/usr/bin/env npx tsx
/**
 * Quick Refresh - Using existing backup from 20260129
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function quickRefresh() {
  console.log('🔄 Quick Refresh (Backup already exists: backup_20260129)\n');
  
  // Step 1: Delete stale unresolved positions
  console.log('1️⃣  Deleting stale unresolved positions...');
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE resolved_at IS NULL
    `
  });
  
  console.log('   Waiting for DELETE to complete...');
  let mutationsDone = false;
  let attempts = 0;
  while (!mutationsDone && attempts < 60) {
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
      console.log(`   Mutation in progress... (${mutations.pending} pending)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }
  }
  
  if (!mutationsDone) {
    throw new Error('Mutation timeout after 5 minutes');
  }
  
  console.log('   ✅ Stale positions deleted\n');
  
  // Step 2: Check current state
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
  
  console.log('2️⃣  Current state after DELETE:');
  console.log(`   Total: ${parseInt(current.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(current.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(current.unresolved).toLocaleString()}\n`);
  
  // Step 3: Rebuild fresh unresolved positions
  console.log('3️⃣  Rebuilding fresh unresolved positions...');
  
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
  
  // Process in batches
  const BATCH_SIZE = 500;
  const batches = Math.ceil(wallets.length / BATCH_SIZE);
  
  console.log(`   Processing ${batches} batches...\n`);
  
  for (let i = 0; i < batches; i++) {
    const batchWallets = wallets.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const walletList = batchWallets.map(w => `'${w.wallet}'`).join(',');
    
    // Insert LONG positions for unresolved conditions
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
          AND condition_id NOT IN (
            SELECT condition_id FROM pm_condition_resolutions
          )
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        HAVING tokens_held > 0.01
      `,
      clickhouse_settings: {
        max_execution_time: 300,
      }
    });
    
    if ((i + 1) % 10 === 0 || i === batches - 1) {
      console.log(`   Batch ${i + 1}/${batches} complete`);
    }
  }
  
  console.log('\n   ✅ Unresolved positions rebuilt\n');
  
  // Step 4: Final verification
  console.log('4️⃣  Final verification...');
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        uniq(wallet) as wallets,
        max(resolved_at) as newest_resolved,
        date_diff('minute', max(resolved_at), now()) as resolved_stale_min
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
  
  console.log(`\n✅ REFRESH COMPLETE!`);
  console.log(`   Backup available: pm_trade_fifo_roi_v3_mat_unified_backup_20260129`);
}

quickRefresh().catch(console.error);
