#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function syncResolved() {
  console.log('🔄 Syncing Resolved Positions to Unified Table\n');
  
  // Step 1: Check what we need to sync
  const checkQuery = `
    SELECT 
      count() as positions_in_v3_last_48h,
      toString(min(resolved_at)) as earliest,
      toString(max(resolved_at)) as latest
    FROM pm_trade_fifo_roi_v3
    WHERE resolved_at >= now() - INTERVAL 48 HOUR
      AND resolved_at IS NOT NULL
  `;
  
  const checkResult = await clickhouse.query({
    query: checkQuery,
    format: 'JSONEachRow'
  });
  const check = (await checkResult.json())[0];
  
  console.log('📊 Found in pm_trade_fifo_roi_v3 (last 48h):');
  console.log(`   Count: ${parseInt(check.positions_in_v3_last_48h).toLocaleString()}`);
  console.log(`   Range: ${check.earliest} to ${check.latest}\n`);
  
  // Step 2: Delete old rows from unified that will be replaced
  console.log('1️⃣ Deleting old rows from unified table...');
  await clickhouse.command({
    query: `
      ALTER TABLE pm_trade_fifo_roi_v3_mat_unified
      DELETE WHERE (tx_hash, wallet, condition_id, outcome_index) IN (
        SELECT tx_hash, wallet, condition_id, outcome_index
        FROM pm_trade_fifo_roi_v3
        WHERE resolved_at >= now() - INTERVAL 48 HOUR
          AND resolved_at IS NOT NULL
      )
    `,
    clickhouse_settings: { max_execution_time: 300 }
  });
  
  // Wait for mutation
  let done = false;
  let attempts = 0;
  while (!done && attempts < 60) {
    const mutResult = await clickhouse.query({
      query: `
        SELECT count() as pending
        FROM system.mutations
        WHERE table = 'pm_trade_fifo_roi_v3_mat_unified'
          AND database = 'default'
          AND is_done = 0
      `,
      format: 'JSONEachRow'
    });
    const mut = (await mutResult.json())[0];
    
    if (parseInt(mut.pending) === 0) {
      done = true;
    } else {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
    }
  }
  console.log('   ✅ Deleted\n');
  
  // Step 3: Insert new resolved rows
  console.log('2️⃣ Inserting resolved positions from v3...');
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
      WHERE resolved_at >= now() - INTERVAL 48 HOUR
        AND resolved_at IS NOT NULL
    `,
    clickhouse_settings: { max_execution_time: 300 }
  });
  console.log('   ✅ Inserted\n');
  
  // Step 4: Check result
  const finalResult = await clickhouse.query({
    query: `
      SELECT 
        toString(max(resolved_at)) as latest_resolution,
        dateDiff('minute', max(resolved_at), now()) as minutes_behind
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json())[0];
  
  console.log('✅ SYNC COMPLETE!\n');
  console.log(`📅 Latest resolution in unified: ${final.latest_resolution}`);
  console.log(`⏱️  Minutes behind: ${final.minutes_behind}\n`);
}

syncResolved().catch(console.error);
