#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

/**
 * SUSTAINABLE UNIFIED TABLE REFRESH
 *
 * Strategy: "Sliding Window" - Keep old data stable, refresh recent data
 *
 * What it does:
 * 1. DELETE + INSERT last 48h of unresolved positions (from canonical fills)
 * 2. DELETE + INSERT last 48h of resolved positions (from v3)
 *
 * Why sustainable:
 * - No full table rebuild
 * - Only touches recent data (48h window)
 * - Old data (48h+) remains stable
 * - Fast runtime (~1-2 minutes)
 * - Can run every 30-60 minutes
 *
 * This keeps the table current without expensive full rebuilds.
 */

const LOOKBACK_HOURS = 48;

async function refreshUnifiedSustainable() {
  console.log('🔄 Sustainable Unified Table Refresh (Sliding Window)\n');
  console.log(`⏱️  Processing last ${LOOKBACK_HOURS} hours of data\n`);

  const startTime = Date.now();

  // ============================================================
  // PART 1: Refresh Unresolved Positions (Last 48h)
  // ============================================================
  console.log('1️⃣ Refreshing unresolved positions...\n');

  // Step 1a: Delete recent unresolved
  console.log('   Deleting recent unresolved (last 48h)...');
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE resolved_at IS NULL
        AND entry_time >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
    `,
    clickhouse_settings: { max_execution_time: 300 }
  });

  await waitForMutations();
  console.log('   ✅ Deleted\n');

  // Step 1b: Insert fresh unresolved (batched by prefix to avoid memory issues)
  console.log('   Inserting fresh unresolved positions...');

  const prefixes = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
  let inserted = 0;

  for (const prefix of prefixes) {
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
          sum(tokens_delta) as tokens,
          sum(abs(usdc_delta)) as cost_usd,
          0 as tokens_sold_early,
          sum(tokens_delta) as tokens_held,
          0 as exit_value,
          -sum(abs(usdc_delta)) as pnl_usd,
          -1.0 as roi,
          0 as pct_sold_early,
          max(is_maker) as is_maker,
          0 as is_short,
          0 as is_closed
        FROM pm_canonical_fills_v4
        WHERE source = 'clob'
          AND tokens_delta > 0
          AND event_time >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
          AND startsWith(lower(condition_id), '${prefix}')
          AND condition_id NOT IN (
            SELECT condition_id
            FROM pm_condition_resolutions
            WHERE is_deleted = 0
          )
        GROUP BY tx_hash, wallet, condition_id, outcome_index
        HAVING sum(tokens_delta) > 0.01
      `,
      clickhouse_settings: {
        max_execution_time: 300,
        send_timeout: 300,
        receive_timeout: 300
      }
    });
    inserted++;
  }

  console.log(`   ✅ Inserted (${inserted} batches)\n`);

  // ============================================================
  // PART 2: Sync Resolved Positions from V3 (Last 48h)
  // ============================================================
  console.log('2️⃣ Syncing resolved positions from v3...\n');

  // Check what needs syncing
  const checkResult = await clickhouse.query({
    query: `
      SELECT
        count() as count,
        toString(min(resolved_at)) as earliest,
        toString(max(resolved_at)) as latest
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow'
  });
  const check = (await checkResult.json())[0];
  const resolvedCount = parseInt(check.count);

  console.log(`   Found ${resolvedCount.toLocaleString()} in v3`);

  if (resolvedCount > 0) {
    console.log(`   Range: ${check.earliest} to ${check.latest}\n`);

    // Delete old resolved that will be replaced
    console.log('   Deleting old resolved positions...');
    await clickhouse.command({
      query: `
        ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
        DELETE WHERE (tx_hash, wallet, condition_id, outcome_index) IN (
          SELECT tx_hash, wallet, condition_id, outcome_index
          FROM pm_trade_fifo_roi_v3
          WHERE resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
            AND resolved_at IS NOT NULL
        )
      `,
      clickhouse_settings: { max_execution_time: 300 }
    });

    await waitForMutations();
    console.log('   ✅ Deleted\n');

    // Insert fresh resolved
    console.log('   Inserting fresh resolved positions...');
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified (
          tx_hash, wallet, condition_id, outcome_index, entry_time, resolved_at,
          tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
          pnl_usd, roi, pct_sold_early, is_maker, is_closed, is_short
        )
        SELECT
          tx_hash, wallet, condition_id, outcome_index, entry_time, resolved_at,
          tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
          pnl_usd, roi, pct_sold_early, is_maker,
          CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
          is_short
        FROM pm_trade_fifo_roi_v3
        WHERE resolved_at >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
          AND resolved_at IS NOT NULL
      `,
      clickhouse_settings: { max_execution_time: 300 }
    });
    console.log('   ✅ Inserted\n');
  } else {
    console.log('   No resolved positions to sync\n');
  }

  // ============================================================
  // PART 3: Verify
  // ============================================================
  console.log('3️⃣ Verifying...\n');

  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(resolved_at IS NULL) as unresolved,
        countIf(resolved_at IS NOT NULL) as resolved
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json())[0];

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('✅ REFRESH COMPLETE!\n');
  console.log('═'.repeat(60));
  console.log(`📊 Unified Table:`);
  console.log(`   Total: ${parseInt(final.total).toLocaleString()}`);
  console.log(`   Unresolved: ${parseInt(final.unresolved).toLocaleString()}`);
  console.log(`   Resolved: ${parseInt(final.resolved).toLocaleString()}`);
  console.log(`⏱️  Duration: ${duration}s`);
  console.log('═'.repeat(60) + '\n');
}

async function waitForMutations(): Promise<void> {
  let done = false;
  let attempts = 0;

  while (!done && attempts < 60) {
    const result = await clickhouse.query({
      query: `
        SELECT count() as pending
        FROM system.mutations
        WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
          AND database = 'default'
          AND is_done = 0
      `,
      format: 'JSONEachRow'
    });
    const mut = (await result.json())[0];

    if (parseInt(mut.pending) === 0) {
      done = true;
    } else {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
    }
  }
}

refreshUnifiedSustainable().catch(console.error);
