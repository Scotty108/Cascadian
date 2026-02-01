#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function insertMissingUnresolved() {
  console.log('🔄 Inserting Missing Unresolved Positions (Direct Approach)\n');

  console.log('1️⃣ Executing direct INSERT of missing positions...');
  console.log('   (This will INSERT only positions that don\'t exist in unified)\n');

  const startTime = Date.now();

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
        AND condition_id NOT IN (
          SELECT condition_id
          FROM pm_condition_resolutions
          WHERE is_deleted = 0
        )
      GROUP BY tx_hash, wallet, condition_id, outcome_index
      HAVING sum(tokens_delta) > 0.01
        AND NOT EXISTS (
          SELECT 1
          FROM pm_trade_fifo_roi_v3_mat_unified u
          WHERE u.tx_hash = pm_canonical_fills_v4.tx_hash
            AND u.wallet = pm_canonical_fills_v4.wallet
            AND u.condition_id = pm_canonical_fills_v4.condition_id
            AND u.outcome_index = pm_canonical_fills_v4.outcome_index
            AND u.resolved_at IS NULL
        )
    `,
    clickhouse_settings: {
      max_execution_time: 1800,  // 30 minutes
      send_timeout: 1800,
      receive_timeout: 1800
    }
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   ✅ Insert completed in ${duration}s\n`);

  // Verify final state
  console.log('2️⃣ Verifying final state...\n');

  const finalResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_unresolved,
        uniq(wallet, condition_id, outcome_index) as unique_positions,
        toString(max(entry_time)) as latest_entry,
        dateDiff('minute', max(entry_time), now()) as minutes_behind
      FROM pm_trade_fifo_roi_v3_mat_unified
      WHERE resolved_at IS NULL
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalResult.json())[0];

  console.log('✅ COMPLETE!\n');
  console.log('📊 Final Unresolved State:');
  console.log(`   Total rows: ${parseInt(final.total_unresolved).toLocaleString()}`);
  console.log(`   Unique positions: ${parseInt(final.unique_positions).toLocaleString()}`);
  console.log(`   Latest entry: ${final.latest_entry}`);
  console.log(`   Minutes behind: ${final.minutes_behind}\n`);

  // Compare with canonical
  const canonicalResult = await clickhouse.query({
    query: `
      SELECT uniq(wallet, condition_id, outcome_index) as unique_positions
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND tokens_delta > 0
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0
        )
    `,
    format: 'JSONEachRow'
  });
  const canonical = (await canonicalResult.json())[0];

  const gap = parseInt(canonical.unique_positions) - parseInt(final.unique_positions);
  const coverage = (parseInt(final.unique_positions) / parseInt(canonical.unique_positions) * 100).toFixed(2);

  console.log('📊 Coverage:');
  console.log(`   Canonical unique positions: ${parseInt(canonical.unique_positions).toLocaleString()}`);
  console.log(`   Coverage: ${coverage}%`);
  console.log(`   Remaining gap: ${gap.toLocaleString()}\n`);

  console.log('🎉 Done!\n');
}

insertMissingUnresolved().catch(console.error);
