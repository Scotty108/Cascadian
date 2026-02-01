#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function buildUnresolvedBatched() {
  console.log('🔄 Building Missing Unresolved Positions (Batched by Time)\n');

  // Step 1: Get time range for unresolved fills
  console.log('1️⃣ Finding time range for unresolved fills...');

  const rangeResult = await clickhouse.query({
    query: `
      SELECT
        min(event_time) as min_time,
        max(event_time) as max_time,
        dateDiff('day', min(event_time), max(event_time)) as days_span
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND tokens_delta > 0
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0
        )
    `,
    format: 'JSONEachRow'
  });
  const range = (await rangeResult.json())[0];

  console.log(`   Min time: ${range.min_time}`);
  console.log(`   Max time: ${range.max_time}`);
  console.log(`   Span: ${range.days_span} days\n`);

  // Step 2: Process in 7-day batches
  const DAYS_PER_BATCH = 7;
  const totalDays = parseInt(range.days_span);
  const totalBatches = Math.ceil(totalDays / DAYS_PER_BATCH);

  console.log(`2️⃣ Processing ${totalBatches} batches (${DAYS_PER_BATCH} days each)...\n`);

  const startDate = new Date(range.min_time);
  let processed = 0;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < totalBatches; i++) {
    const batchStart = new Date(startDate);
    batchStart.setDate(batchStart.getDate() + (i * DAYS_PER_BATCH));

    const batchEnd = new Date(batchStart);
    batchEnd.setDate(batchEnd.getDate() + DAYS_PER_BATCH);

    const batchStartStr = batchStart.toISOString().split('T')[0];
    const batchEndStr = batchEnd.toISOString().split('T')[0];

    try {
      const result = await clickhouse.command({
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
            AND event_time >= '${batchStartStr}'
            AND event_time < '${batchEndStr}'
            AND condition_id NOT IN (
              SELECT condition_id
              FROM pm_condition_resolutions
              WHERE is_deleted = 0
            )
          GROUP BY tx_hash, wallet, condition_id, outcome_index
          HAVING sum(tokens_delta) > 0.01
            AND (tx_hash, wallet, condition_id, outcome_index) NOT IN (
              SELECT tx_hash, wallet, condition_id, outcome_index
              FROM pm_trade_fifo_roi_v3_mat_unified
              WHERE resolved_at IS NULL
            )
        `,
        clickhouse_settings: {
          max_execution_time: 300,
          send_timeout: 300,
          receive_timeout: 300
        }
      });

      processed++;
      inserted++;

      if ((i + 1) % 10 === 0 || i === totalBatches - 1) {
        const pct = ((i + 1) / totalBatches * 100).toFixed(1);
        console.log(`   Batch ${i + 1}/${totalBatches} (${pct}%) - ${batchStartStr} to ${batchEndStr}`);
      }
    } catch (error: any) {
      console.error(`   ⚠️ Error in batch ${i + 1} (${batchStartStr}):`, error.message);
      errors++;
      // Continue with next batch
    }
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('✅ Batched Build Complete\n');
  console.log(`📊 Results:`);
  console.log(`   - Total batches: ${totalBatches}`);
  console.log(`   - Processed: ${processed}`);
  console.log(`   - Errors: ${errors}`);
  console.log('════════════════════════════════════════════════════════════\n');

  // Step 3: Verify final state
  console.log('3️⃣ Verifying final state...\n');

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

  console.log('✅ COMPLETE!\n');
  console.log('📊 Final Unresolved State:');
  console.log(`   Total rows: ${parseInt(final.total_unresolved).toLocaleString()}`);
  console.log(`   Unique positions: ${parseInt(final.unique_positions).toLocaleString()}`);
  console.log(`   Latest entry: ${final.latest_entry}`);
  console.log(`   Minutes behind: ${final.minutes_behind}\n`);

  console.log('📊 Coverage:');
  console.log(`   Canonical unique positions: ${parseInt(canonical.unique_positions).toLocaleString()}`);
  console.log(`   Unified coverage: ${coverage}%`);
  console.log(`   Remaining gap: ${gap.toLocaleString()}\n`);

  console.log('🎉 Done!\n');
}

buildUnresolvedBatched().catch(console.error);
