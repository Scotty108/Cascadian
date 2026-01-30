#!/usr/bin/env npx tsx
/**
 * Simple Unified Table Refresh
 *
 * Run this manually or via cron every 2-6 hours to keep the table fresh.
 *
 * What it does:
 * 1. Delete stale unresolved positions
 * 2. Build fresh unresolved positions from last 24 hours
 *
 * Runtime: ~10-12 minutes
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function refreshUnified() {
  const startTime = Date.now();
  console.log('🔄 Refreshing Unified Table\n');

  // Step 1: Delete old unresolved positions
  console.log('1️⃣ Deleting stale unresolved positions...');
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE resolved_at IS NULL
    `
  });

  // Wait for DELETE mutation to complete
  console.log('   Waiting for DELETE to complete...');
  let done = false;
  let attempts = 0;
  while (!done && attempts < 60) {
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
      if (attempts % 6 === 0) {
        console.log(`   Mutation in progress... (${pending} pending)`);
      }
      await new Promise(r => setTimeout(r, 5000));
      attempts++;
    }
  }

  if (!done) {
    throw new Error('Mutation timeout after 5 minutes');
  }
  console.log('   ✅ Old unresolved deleted\n');

  // Step 2: Find active wallets (last 24 hours)
  console.log('2️⃣ Finding active wallets...');
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
  console.log(`   ✅ Found ${wallets.length.toLocaleString()} active wallets\n`);

  // Step 3: Build fresh unresolved positions
  console.log('3️⃣ Building fresh unresolved positions...');
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

    if ((i + 1) % 20 === 0 || i === totalBatches - 1) {
      console.log(`   Batch ${i + 1}/${totalBatches}...`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ REFRESH COMPLETE! (${elapsed} minutes)\n`);

  // Final stats
  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        uniq(wallet) as wallets
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json<any>())[0];

  console.log('📊 TABLE STATE:');
  console.log(`   Total: ${parseInt(final.total).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(final.resolved).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(final.unresolved).toLocaleString()}`);
  console.log(`   Wallets: ${parseInt(final.wallets).toLocaleString()}\n`);
}

refreshUnified().catch(console.error);
