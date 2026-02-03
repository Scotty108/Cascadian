/**
 * Rebuild Unified Table Clean (V5 Logic)
 *
 * Full atomic rebuild of pm_trade_fifo_roi_v3_mat_unified with:
 * 1. Validated resolved positions from pm_trade_fifo_roi_v3
 * 2. Scalper exits with realized PnL from partial/full sales on unresolved markets
 *
 * V5 FIFO Logic:
 * - For resolved: exit_value = (sold_early * sell_proceeds/total_sold) + (held * payout)
 * - For scalpers: exit_value = sell_proceeds, pnl = proceeds - (sold/bought * cost)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

async function rebuildUnifiedTable() {
  const client = getClickHouseClient();
  const startTime = Date.now();

  console.log('=== Rebuild Unified Table Clean (V5 Logic) ===\n');

  // Step 1: Check current corrupted table
  console.log('Step 1: Analyzing current table state...');
  const currentState = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(cost_usd = 0) as zero_cost,
        countIf(cost_usd < 0) as negative_cost,
        countIf(resolved_at = '1970-01-01') as epoch_dates,
        countIf(resolved_at IS NOT NULL) as resolved_count,
        countIf(resolved_at IS NULL) as unresolved_count
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const current = (await currentState.json() as any[])[0];
  console.log(`  Total rows: ${current.total.toLocaleString()}`);
  console.log(`  Zero cost: ${current.zero_cost.toLocaleString()} (${((current.zero_cost / current.total) * 100).toFixed(1)}%)`);
  console.log(`  Negative cost: ${current.negative_cost.toLocaleString()}`);
  console.log(`  Epoch dates: ${current.epoch_dates.toLocaleString()}`);
  console.log(`  Resolved: ${current.resolved_count.toLocaleString()}`);
  console.log(`  Unresolved: ${current.unresolved_count.toLocaleString()}`);

  // Step 2: Create new table
  console.log('\nStep 2: Creating new unified table...');
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
  console.log('  Created empty table structure');

  // Step 3: Copy resolved positions from v3 with validation
  console.log('\nStep 3: Copying validated resolved positions from v3...');
  console.log('  (This may take a few minutes for 285M rows...)');

  await client.command({
    query: `
      INSERT INTO pm_trade_fifo_roi_v3_mat_unified_new
      SELECT
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        resolved_at,
        tokens,
        cost_usd,
        tokens_sold_early,
        tokens_held,
        exit_value,
        pnl_usd,
        roi,
        pct_sold_early,
        is_maker,
        CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END as is_closed,
        is_short
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at IS NOT NULL
        AND resolved_at != '1970-01-01'
        AND cost_usd > 0
        AND tokens > 0
        AND condition_id != ''
        AND condition_id IN (
          SELECT condition_id FROM pm_condition_resolutions
          WHERE is_deleted = 0
        )
    `,
    clickhouse_settings: { max_execution_time: 600, max_memory_usage: 8000000000 },
  });

  // Check progress
  const resolvedCount = await client.query({
    query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3_mat_unified_new`,
    format: 'JSONEachRow',
  });
  const resolved = (await resolvedCount.json() as any[])[0];
  console.log(`  Inserted ${resolved.cnt.toLocaleString()} validated resolved positions`);

  // Step 4: Calculate and insert unresolved positions with partial/full sales
  console.log('\nStep 4: Calculating unresolved positions with sales (scalpers + partial)...');
  console.log('  This captures trading profits before resolution...');

  // Get unresolved conditions in batches to avoid memory issues
  const unresolvedConditionsResult = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND condition_id NOT IN (
          SELECT condition_id FROM pm_condition_resolutions
          WHERE is_deleted = 0 AND payout_numerators != ''
        )
        AND condition_id != ''
        AND wallet != '0x0000000000000000000000000000000000000000'
      LIMIT 100000
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 },
  });
  const unresolvedConditions = (await unresolvedConditionsResult.json() as { condition_id: string }[]).map(r => r.condition_id);
  console.log(`  Found ${unresolvedConditions.length.toLocaleString()} unresolved conditions to process`);

  // Process in batches
  const BATCH_SIZE = 1000;
  let totalScalperPositions = 0;

  for (let i = 0; i < unresolvedConditions.length; i += BATCH_SIZE) {
    const batch = unresolvedConditions.slice(i, i + BATCH_SIZE);
    const conditionList = batch.map(id => `'${id}'`).join(',');

    // Insert scalper/partial sale positions for this batch
    await client.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified_new
        SELECT
          tx_hash,
          wallet,
          condition_id,
          outcome_index,
          entry_time,
          NULL as resolved_at,
          tokens,
          cost_usd,
          tokens_sold_early,
          tokens_held,
          exit_value,
          pnl_usd,
          roi,
          pct_sold_early,
          is_maker,
          is_closed,
          0 as is_short
        FROM (
          SELECT
            any(tx_hash) as tx_hash,
            wallet,
            condition_id,
            outcome_index,
            min(event_time) as entry_time,
            -- Token tracking
            sum(if(tokens_delta > 0, tokens_delta, 0)) as total_tokens_bought,
            sum(if(tokens_delta < 0, abs(tokens_delta), 0)) as total_tokens_sold,
            sum(tokens_delta) as net_tokens,
            -- Cash tracking
            sum(if(tokens_delta > 0, abs(usdc_delta), 0)) as total_cost,
            sum(if(tokens_delta < 0, abs(usdc_delta), 0)) as total_proceeds,
            max(is_maker) as is_maker,
            -- Derived fields
            sum(if(tokens_delta > 0, tokens_delta, 0)) as tokens,
            sum(if(tokens_delta > 0, abs(usdc_delta), 0)) as cost_usd,
            -- FIFO: tokens sold early = min(sold, bought)
            least(
              sum(if(tokens_delta < 0, abs(tokens_delta), 0)),
              sum(if(tokens_delta > 0, tokens_delta, 0))
            ) as tokens_sold_early,
            greatest(0, sum(tokens_delta)) as tokens_held,
            -- Exit value = proceeds from sold portion only
            sum(if(tokens_delta < 0, abs(usdc_delta), 0)) as exit_value,
            -- Realized PnL: (proceeds) - (cost of sold portion)
            -- Cost of sold = (tokens_sold / tokens_bought) * total_cost
            if(
              sum(if(tokens_delta > 0, tokens_delta, 0)) > 0.01 AND sum(if(tokens_delta < 0, abs(tokens_delta), 0)) > 0.01,
              sum(if(tokens_delta < 0, abs(usdc_delta), 0)) -
                (least(sum(if(tokens_delta < 0, abs(tokens_delta), 0)), sum(if(tokens_delta > 0, tokens_delta, 0))) /
                 sum(if(tokens_delta > 0, tokens_delta, 0)) *
                 sum(if(tokens_delta > 0, abs(usdc_delta), 0))),
              0
            ) as pnl_usd,
            -- ROI on realized portion only
            if(
              sum(if(tokens_delta > 0, tokens_delta, 0)) > 0.01 AND
              sum(if(tokens_delta < 0, abs(tokens_delta), 0)) > 0.01 AND
              sum(if(tokens_delta > 0, abs(usdc_delta), 0)) > 0.01,
              (sum(if(tokens_delta < 0, abs(usdc_delta), 0)) -
                (least(sum(if(tokens_delta < 0, abs(tokens_delta), 0)), sum(if(tokens_delta > 0, tokens_delta, 0))) /
                 sum(if(tokens_delta > 0, tokens_delta, 0)) *
                 sum(if(tokens_delta > 0, abs(usdc_delta), 0)))) /
              (least(sum(if(tokens_delta < 0, abs(tokens_delta), 0)), sum(if(tokens_delta > 0, tokens_delta, 0))) /
               sum(if(tokens_delta > 0, tokens_delta, 0)) *
               sum(if(tokens_delta > 0, abs(usdc_delta), 0))),
              0
            ) as roi,
            -- Percent sold early
            if(
              sum(if(tokens_delta > 0, tokens_delta, 0)) > 0,
              least(sum(if(tokens_delta < 0, abs(tokens_delta), 0)), sum(if(tokens_delta > 0, tokens_delta, 0))) /
              sum(if(tokens_delta > 0, tokens_delta, 0)) * 100,
              0
            ) as pct_sold_early,
            -- is_closed = fully exited before resolution
            if(sum(tokens_delta) <= 0.01, 1, 0) as is_closed
          FROM (
            SELECT
              fill_id,
              any(tx_hash) as tx_hash,
              any(event_time) as event_time,
              any(wallet) as wallet,
              any(condition_id) as condition_id,
              any(outcome_index) as outcome_index,
              any(tokens_delta) as tokens_delta,
              any(usdc_delta) as usdc_delta,
              any(is_maker) as is_maker,
              any(is_self_fill) as is_self_fill
            FROM pm_canonical_fills_v4
            WHERE condition_id IN (${conditionList})
              AND source = 'clob'
            GROUP BY fill_id
          )
          WHERE wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY wallet, condition_id, outcome_index
          HAVING total_cost > 0.01 AND total_tokens_sold > 0.01
        )
      `,
      clickhouse_settings: { max_execution_time: 300, max_memory_usage: 8000000000 },
    });

    totalScalperPositions += batch.length;
    if ((i + BATCH_SIZE) % 10000 === 0 || i + BATCH_SIZE >= unresolvedConditions.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, unresolvedConditions.length).toLocaleString()}/${unresolvedConditions.length.toLocaleString()} conditions`);
    }
  }

  // Step 5: Check final counts
  console.log('\nStep 5: Verifying new table...');
  const newState = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(cost_usd = 0) as zero_cost,
        countIf(cost_usd < 0) as negative_cost,
        countIf(tokens < 0) as negative_tokens,
        countIf(resolved_at = '1970-01-01') as epoch_dates,
        countIf(resolved_at IS NOT NULL) as resolved_count,
        countIf(resolved_at IS NULL) as unresolved_count,
        countIf(resolved_at IS NULL AND pct_sold_early > 0) as partial_sales,
        countIf(is_closed = 1 AND resolved_at IS NULL) as full_scalper_exits,
        uniq(wallet) as unique_wallets,
        uniq(condition_id) as unique_conditions
      FROM pm_trade_fifo_roi_v3_mat_unified_new
    `,
    format: 'JSONEachRow',
  });
  const newStats = (await newState.json() as any[])[0];

  console.log(`  Total rows: ${newStats.total.toLocaleString()}`);
  console.log(`  Zero cost: ${newStats.zero_cost.toLocaleString()} (should be 0)`);
  console.log(`  Negative cost: ${newStats.negative_cost.toLocaleString()} (should be 0)`);
  console.log(`  Epoch dates: ${newStats.epoch_dates.toLocaleString()} (should be 0)`);
  console.log(`  Resolved positions: ${newStats.resolved_count.toLocaleString()}`);
  console.log(`  Unresolved positions: ${newStats.unresolved_count.toLocaleString()}`);
  console.log(`  - Partial sales: ${newStats.partial_sales.toLocaleString()}`);
  console.log(`  - Full scalper exits: ${newStats.full_scalper_exits.toLocaleString()}`);
  console.log(`  Unique wallets: ${newStats.unique_wallets.toLocaleString()}`);
  console.log(`  Unique conditions: ${newStats.unique_conditions.toLocaleString()}`);

  // Validate before swap
  const hasErrors = newStats.zero_cost > 0 || newStats.negative_cost > 0 || newStats.epoch_dates > 0;

  if (hasErrors) {
    console.log('\n⚠️ WARNING: New table has data quality issues!');
    console.log('  Aborting swap. Please investigate.');
    return;
  }

  // Step 6: Atomic swap
  console.log('\nStep 6: Performing atomic swap...');

  // Backup corrupted table
  await client.command({ query: `DROP TABLE IF EXISTS pm_trade_fifo_roi_v3_mat_unified_corrupted` });
  await client.command({
    query: `RENAME TABLE pm_trade_fifo_roi_v3_mat_unified TO pm_trade_fifo_roi_v3_mat_unified_corrupted`
  });
  console.log('  Backed up corrupted table');

  // Activate new table
  await client.command({
    query: `RENAME TABLE pm_trade_fifo_roi_v3_mat_unified_new TO pm_trade_fifo_roi_v3_mat_unified`
  });
  console.log('  Activated new table');

  // Optimize to dedupe
  console.log('\nStep 7: Running OPTIMIZE to deduplicate...');
  await client.command({
    query: `OPTIMIZE TABLE pm_trade_fifo_roi_v3_mat_unified FINAL`,
    clickhouse_settings: { max_execution_time: 600 },
  });

  // Final verification
  const finalState = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(cost_usd = 0) as zero_cost,
        countIf(resolved_at IS NOT NULL) as resolved,
        countIf(resolved_at IS NULL AND pct_sold_early > 0) as scalpers
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow',
  });
  const final = (await finalState.json() as any[])[0];

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log('REBUILD COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Before: ${current.total.toLocaleString()} rows (${current.zero_cost.toLocaleString()} corrupted)`);
  console.log(`  After: ${final.total.toLocaleString()} rows (${final.zero_cost.toLocaleString()} zero-cost)`);
  console.log(`  Resolved: ${final.resolved.toLocaleString()}`);
  console.log(`  Scalper/Partial: ${final.scalpers.toLocaleString()}`);
  console.log(`  Duration: ${duration} minutes`);

  if (final.zero_cost === 0) {
    console.log('\n✅ SUCCESS: Unified table rebuilt with clean data!');
  }

  console.log('\nBackup available: pm_trade_fifo_roi_v3_mat_unified_corrupted');
}

rebuildUnifiedTable().catch(console.error);
