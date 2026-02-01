#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function buildUnresolvedStreaming() {
  console.log('🔄 Building Missing Unresolved Positions (Streaming JOIN Approach)\n');

  // Batch by first character of condition_id (0-9, a-f = 16 batches)
  const prefixes = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
  const totalBatches = prefixes.length;

  console.log(`Processing ${totalBatches} batches (one per hex prefix)...\n`);

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < totalBatches; i++) {
    const prefix = prefixes[i];

    try {
      const batchStart = Date.now();

      await clickhouse.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unified
          SELECT
            c.tx_hash,
            c.wallet,
            c.condition_id,
            c.outcome_index,
            min(c.event_time) as entry_time,
            NULL as resolved_at,
            sum(c.tokens_delta) as tokens,
            sum(abs(c.usdc_delta)) as cost_usd,
            0 as tokens_sold_early,
            sum(c.tokens_delta) as tokens_held,
            0 as exit_value,
            -sum(abs(c.usdc_delta)) as pnl_usd,
            -1.0 as roi,
            0 as pct_sold_early,
            max(c.is_maker) as is_maker,
            0 as is_short,
            0 as is_closed
          FROM pm_canonical_fills_v4 c
          LEFT JOIN pm_trade_fifo_roi_v3_mat_unified u
            ON c.tx_hash = u.tx_hash
            AND c.wallet = u.wallet
            AND c.condition_id = u.condition_id
            AND c.outcome_index = u.outcome_index
            AND u.resolved_at IS NULL
          WHERE c.source = 'clob'
            AND c.tokens_delta > 0
            AND startsWith(lower(c.condition_id), '${prefix}')
            AND c.condition_id NOT IN (
              SELECT condition_id
              FROM pm_condition_resolutions
              WHERE is_deleted = 0
            )
            AND u.tx_hash IS NULL
          GROUP BY c.tx_hash, c.wallet, c.condition_id, c.outcome_index
          HAVING sum(c.tokens_delta) > 0.01
        `,
        clickhouse_settings: {
          max_execution_time: 600,
          send_timeout: 600,
          receive_timeout: 600,
          max_memory_usage: 8000000000  // 8GB limit per query
        }
      });

      const batchDuration = ((Date.now() - batchStart) / 1000).toFixed(1);
      processed++;

      console.log(`   ✅ Batch ${i + 1}/${totalBatches} (prefix: ${prefix}) - ${batchDuration}s`);
    } catch (error: any) {
      console.error(`   ⚠️ Error in batch ${i + 1} (prefix: ${prefix}):`, error.message);
      errors++;
      // Continue with next batch
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('✅ Batched Build Complete\n');
  console.log(`📊 Results:`);
  console.log(`   - Total batches: ${totalBatches}`);
  console.log(`   - Processed: ${processed}`);
  console.log(`   - Errors: ${errors}`);
  console.log(`   - Duration: ${totalDuration}s`);
  console.log('════════════════════════════════════════════════════════════\n');

  // Verify final state
  console.log('Verifying final state...\n');

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

buildUnresolvedStreaming().catch(console.error);
