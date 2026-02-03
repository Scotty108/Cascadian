/**
 * Rebuild Unified Table with Fixed Dates
 *
 * Uses the CORRECTED resolved_at from pm_condition_resolutions (which we just fixed)
 * instead of the stale resolved_at baked into pm_trade_fifo_roi_v3.
 *
 * This ensures epoch timestamps that were fixed in resolutions get propagated.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function rebuildUnified() {
  const client = getClickHouseClient();
  const startTime = Date.now();

  console.log('=== Rebuild Unified Table with Fixed Dates ===\n');

  // Step 1: Create new table
  console.log('Step 1: Creating new unified table...');
  await client.command({ query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified_new` });

  await client.command({
    query: `
      CREATE TABLE pm_trade_fifo_roi_v3_mat_unified_new (
        tx_hash String,
        wallet LowCardinality(String),
        condition_id String,
        outcome_index UInt8,
        entry_time DateTime,
        resolved_at Nullable(DateTime),
        tokens Float64,
        cost_usd Float64,
        tokens_sold_early Float64,
        tokens_held Float64,
        exit_value Float64,
        pnl_usd Float64,
        roi Float64,
        pct_sold_early Float64,
        is_maker UInt8,
        is_closed UInt8,
        is_short UInt8
      ) ENGINE = ReplacingMergeTree()
      ORDER BY (wallet, condition_id, outcome_index, tx_hash)
    `,
  });
  console.log('  ✓ Created table structure');

  // Step 2: Get year-month ranges to process in chunks
  console.log('\nStep 2: Getting date ranges...');
  const dateRanges = await client.query({
    query: `
      SELECT DISTINCT
        toStartOfMonth(entry_time) as month
      FROM pm_trade_fifo_roi_v3
      WHERE cost_usd > 0 AND tokens > 0 AND condition_id != ''
      ORDER BY month
    `,
    format: 'JSONEachRow',
  });
  const months = (await dateRanges.json() as { month: string }[]).map(r => r.month);
  console.log(`  Found ${months.length} months to process`);

  // Step 3: Process each month - JOIN to resolutions to get CORRECTED resolved_at
  console.log('\nStep 3: Inserting with corrected resolved_at from pm_condition_resolutions...');

  let totalInserted = 0;
  for (let i = 0; i < months.length; i++) {
    const monthStart = months[i].substring(0, 10);
    const nextMonth = new Date(months[i]);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const monthEnd = nextMonth.toISOString().substring(0, 10);
    const monthLabel = monthStart.substring(0, 7);

    try {
      // Get count before insert
      const beforeCount = await client.query({
        query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3_mat_unified_new`,
        format: 'JSONEachRow',
      });
      const before = (await beforeCount.json() as any[])[0].cnt;

      // Insert with JOIN to get corrected resolved_at
      await client.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unified_new
          SELECT
            v.tx_hash,
            v.wallet,
            v.condition_id,
            v.outcome_index,
            v.entry_time,
            -- Use CORRECTED resolved_at from resolutions table (not the stale one in v3)
            r.resolved_at as resolved_at,
            v.tokens,
            v.cost_usd,
            v.tokens_sold_early,
            v.tokens_held,
            v.exit_value,
            v.pnl_usd,
            v.roi,
            v.pct_sold_early,
            v.is_maker,
            CASE WHEN v.tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
            v.is_short
          FROM pm_trade_fifo_roi_v3 v
          INNER JOIN pm_condition_resolutions r
            ON v.condition_id = r.condition_id
            AND r.is_deleted = 0
          WHERE v.cost_usd > 0
            AND v.tokens > 0
            AND v.condition_id != ''
            AND v.entry_time >= '${monthStart}'
            AND v.entry_time < '${monthEnd}'
        `,
        clickhouse_settings: { max_execution_time: 300, max_memory_usage: 8000000000 },
      });

      // Get count after insert
      const afterCount = await client.query({
        query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3_mat_unified_new`,
        format: 'JSONEachRow',
      });
      const after = (await afterCount.json() as any[])[0].cnt;
      const inserted = after - before;
      totalInserted += inserted;

      console.log(`  [${i + 1}/${months.length}] ${monthLabel}: +${inserted.toLocaleString()} rows (total: ${after.toLocaleString()})`);
    } catch (error: any) {
      console.log(`  [${i + 1}/${months.length}] ${monthLabel}: ERROR - ${error.message.substring(0, 80)}...`);
    }
  }

  // Step 4: Add scalper positions (unresolved with sales)
  console.log('\nStep 4: Adding scalper/partial sale positions...');

  // Get unresolved condition count
  const unresolvedResult = await client.query({
    query: `
      SELECT count(DISTINCT condition_id) as cnt
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0
        )
        AND condition_id != ''
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 120 },
  });
  const unresolvedCount = (await unresolvedResult.json() as any[])[0].cnt;
  console.log(`  Found ${unresolvedCount.toLocaleString()} unresolved conditions`);

  // Process unresolved in batches of conditions
  const BATCH_SIZE = 2000;
  let offset = 0;
  let scalperTotal = 0;

  while (offset < unresolvedCount) {
    try {
      const beforeCount = await client.query({
        query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3_mat_unified_new`,
        format: 'JSONEachRow',
      });
      const before = (await beforeCount.json() as any[])[0].cnt;

      await client.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_mat_unified_new
          SELECT
            any(tx_hash) as tx_hash,
            wallet,
            condition_id,
            outcome_index,
            min(event_time) as entry_time,
            NULL as resolved_at,
            sum(if(tokens_delta > 0, tokens_delta, 0)) as tokens,
            sum(if(tokens_delta > 0, abs(usdc_delta), 0)) as cost_usd,
            least(sum(if(tokens_delta < 0, abs(tokens_delta), 0)), sum(if(tokens_delta > 0, tokens_delta, 0))) as tokens_sold_early,
            greatest(0, sum(tokens_delta)) as tokens_held,
            sum(if(tokens_delta < 0, abs(usdc_delta), 0)) as exit_value,
            -- Realized PnL from partial sales
            if(sum(if(tokens_delta > 0, tokens_delta, 0)) > 0.01,
              sum(if(tokens_delta < 0, abs(usdc_delta), 0)) -
              (least(sum(if(tokens_delta < 0, abs(tokens_delta), 0)), sum(if(tokens_delta > 0, tokens_delta, 0))) /
               sum(if(tokens_delta > 0, tokens_delta, 0)) * sum(if(tokens_delta > 0, abs(usdc_delta), 0))),
              0) as pnl_usd,
            -- ROI
            if(sum(if(tokens_delta > 0, abs(usdc_delta), 0)) > 0.01 AND sum(if(tokens_delta < 0, abs(tokens_delta), 0)) > 0.01,
              (sum(if(tokens_delta < 0, abs(usdc_delta), 0)) -
               (least(sum(if(tokens_delta < 0, abs(tokens_delta), 0)), sum(if(tokens_delta > 0, tokens_delta, 0))) /
                sum(if(tokens_delta > 0, tokens_delta, 0)) * sum(if(tokens_delta > 0, abs(usdc_delta), 0)))) /
              (least(sum(if(tokens_delta < 0, abs(tokens_delta), 0)), sum(if(tokens_delta > 0, tokens_delta, 0))) /
               sum(if(tokens_delta > 0, tokens_delta, 0)) * sum(if(tokens_delta > 0, abs(usdc_delta), 0))),
              0) as roi,
            if(sum(if(tokens_delta > 0, tokens_delta, 0)) > 0,
              least(sum(if(tokens_delta < 0, abs(tokens_delta), 0)), sum(if(tokens_delta > 0, tokens_delta, 0))) /
              sum(if(tokens_delta > 0, tokens_delta, 0)) * 100, 0) as pct_sold_early,
            max(is_maker) as is_maker,
            if(sum(tokens_delta) <= 0.01, 1, 0) as is_closed,
            0 as is_short
          FROM (
            SELECT fill_id, any(tx_hash) as tx_hash, any(event_time) as event_time,
              any(wallet) as wallet, any(condition_id) as condition_id,
              any(outcome_index) as outcome_index, any(tokens_delta) as tokens_delta,
              any(usdc_delta) as usdc_delta, any(is_maker) as is_maker,
              any(is_self_fill) as is_self_fill
            FROM pm_canonical_fills_v4
            WHERE source = 'clob'
              AND condition_id IN (
                SELECT DISTINCT condition_id
                FROM pm_canonical_fills_v4
                WHERE source = 'clob'
                  AND condition_id NOT IN (
                    SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0
                  )
                  AND condition_id != ''
                LIMIT ${BATCH_SIZE} OFFSET ${offset}
              )
            GROUP BY fill_id
          )
          WHERE wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY wallet, condition_id, outcome_index
          HAVING sum(if(tokens_delta > 0, abs(usdc_delta), 0)) > 0.01
            AND sum(if(tokens_delta < 0, abs(tokens_delta), 0)) > 0.01
        `,
        clickhouse_settings: { max_execution_time: 300, max_memory_usage: 8000000000 },
      });

      const afterCount = await client.query({
        query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3_mat_unified_new`,
        format: 'JSONEachRow',
      });
      const after = (await afterCount.json() as any[])[0].cnt;
      const inserted = after - before;
      scalperTotal += inserted;

      console.log(`  Batch ${Math.floor(offset / BATCH_SIZE) + 1}: +${inserted.toLocaleString()} scalper positions`);
    } catch (error: any) {
      console.log(`  Batch ${Math.floor(offset / BATCH_SIZE) + 1}: ERROR - ${error.message.substring(0, 60)}...`);
    }

    offset += BATCH_SIZE;
  }

  console.log(`  Total scalper positions: ${scalperTotal.toLocaleString()}`);

  // Step 5: Verify
  console.log('\nStep 5: Verification...');
  const finalStats = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(cost_usd = 0) as zero_cost,
        countIf(cost_usd < 0) as negative_cost,
        countIf(resolved_at = '1970-01-01') as epoch_dates,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL) as unresolved,
        countIf(resolved_at IS NULL AND pct_sold_early > 0) as scalpers,
        uniq(wallet) as wallets,
        uniq(condition_id) as conditions
      FROM pm_trade_fifo_roi_v3_mat_unified_new
    `,
    format: 'JSONEachRow',
  });
  const stats = (await finalStats.json() as any[])[0];

  console.log(`  Total rows: ${stats.total.toLocaleString()}`);
  console.log(`  Zero cost: ${stats.zero_cost.toLocaleString()} (should be 0)`);
  console.log(`  Negative cost: ${stats.negative_cost.toLocaleString()} (should be 0)`);
  console.log(`  Epoch dates: ${stats.epoch_dates.toLocaleString()} (residual from unfixed resolutions)`);
  console.log(`  Resolved: ${stats.resolved.toLocaleString()}`);
  console.log(`  Unresolved: ${stats.unresolved.toLocaleString()}`);
  console.log(`  - Scalpers: ${stats.scalpers.toLocaleString()}`);
  console.log(`  Wallets: ${stats.wallets.toLocaleString()}`);
  console.log(`  Conditions: ${stats.conditions.toLocaleString()}`);

  // Check if safe to swap
  if (stats.zero_cost > 0 || stats.negative_cost > 0) {
    console.log('\n⚠️ Data quality issues detected. Review before swapping.');
    return;
  }

  // Step 6: Atomic swap
  console.log('\nStep 6: Atomic swap...');
  await client.command({ query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified_corrupted` });
  await client.command({
    query: `RENAME TABLE pm_trade_fifo_roi_v3_mat_unified TO pm_trade_fifo_roi_v3_mat_unified_corrupted`
  });
  await client.command({
    query: `RENAME TABLE pm_trade_fifo_roi_v3_mat_unified_new TO pm_trade_fifo_roi_v3_mat_unified`
  });
  console.log('  ✓ Swap complete');

  // Optimize
  console.log('\nStep 7: Optimizing...');
  await client.command({
    query: `OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL`,
    clickhouse_settings: { max_execution_time: 600 },
  });

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ COMPLETE in ${duration} minutes`);
  console.log('Backup: pm_trade_fifo_roi_v3_mat_unified_corrupted');
}

rebuildUnified().catch(console.error);
