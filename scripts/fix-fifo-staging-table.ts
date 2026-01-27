/**
 * FIFO Fix - Staging Table Approach (OPTIMAL)
 *
 * Strategy from research:
 * 1. Load missing conditions into ClickHouse table (avoid giant IN lists)
 * 2. Create staging table with fills ordered for window functions
 * 3. Process with optimized settings + parallelism
 *
 * ETA: 15-30 minutes
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

const BATCH_SIZE = 50; // Optimal per research (20-50)
const PARALLEL_WORKERS = 15; // Increased from 10

async function step1_createStagingTables() {
  console.log('\n=== STEP 1: Create Staging Tables ===\n');

  // Drop existing if they exist
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS tmp_missing_conditions'
  });

  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS tmp_fills_jan_missing'
  });

  // Create missing conditions table
  console.log('Creating tmp_missing_conditions...');
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_missing_conditions
      (
        condition_id String
      )
      ENGINE = Memory
    `
  });

  // Load missing conditions from file
  console.log('Loading 10,108 missing conditions...');
  const conditionIds = JSON.parse(fs.readFileSync('/tmp/missing-conditions-jan2026.json', 'utf-8'));

  // Insert in chunks to avoid query size limits
  for (let i = 0; i < conditionIds.length; i += 1000) {
    const chunk = conditionIds.slice(i, i + 1000);
    const values = chunk.map(id => `('${id}')`).join(',');
    await clickhouse.command({
      query: `INSERT INTO tmp_missing_conditions VALUES ${values}`
    });
    process.stdout.write(`  ${i + chunk.length}/${conditionIds.length}\r`);
  }
  console.log(`\n✓ Loaded ${conditionIds.length} conditions\n`);

  // Create fills staging table ordered for window functions
  console.log('Creating tmp_fills_jan_missing (ordered for FIFO windows)...');
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_fills_jan_missing
      (
        fill_id String,
        tx_hash String,
        wallet String,
        condition_id String,
        outcome_index UInt8,
        tokens_delta Float64,
        usdc_delta Float64,
        event_time DateTime,
        is_maker UInt8,
        is_self_fill UInt8,
        payout_numerators String,
        resolved_at DateTime
      )
      ENGINE = MergeTree
      ORDER BY (wallet, condition_id, outcome_index, event_time, fill_id)
    `
  });

  // Populate staging table with ONLY the fills we need
  console.log('Populating tmp_fills_jan_missing (this may take 2-3 min)...');
  const startPop = Date.now();
  await clickhouse.command({
    query: `
      INSERT INTO tmp_fills_jan_missing
      SELECT
        f.fill_id,
        f.tx_hash,
        lower(f.wallet) AS wallet,
        f.condition_id,
        f.outcome_index,
        f.tokens_delta,
        f.usdc_delta,
        f.event_time,
        f.is_maker,
        f.is_self_fill,
        r.payout_numerators,
        r.resolved_at
      FROM pm_canonical_fills_v4 f
      INNER JOIN tmp_missing_conditions m ON f.condition_id = m.condition_id
      INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      WHERE f.source = 'clob'
        AND r.is_deleted = 0
        AND r.payout_numerators != ''
        AND f.event_time >= toDateTime('2026-01-01 00:00:00')
        AND f.event_time < toDateTime('2026-01-28 00:00:00')
    `,
    clickhouse_settings: {
      max_execution_time: 600,
      max_threads: 8,
    }
  });
  const popTime = ((Date.now() - startPop) / 1000).toFixed(1);
  console.log(`✓ Populated in ${popTime}s\n`);
}

async function step2_processBatch(conditions: string[], batchNum: number, totalBatches: number): Promise<boolean> {
  if (conditions.length === 0) return true;

  const conditionList = conditions.map(id => `'${id}'`).join(',');

  try {
    // LONGS - using staging table
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3
        SELECT
          tx_hash, wallet, condition_id, outcome_index, entry_time,
          tokens, cost_usd, tokens_sold_early, tokens_held, exit_value,
          exit_value - cost_usd as pnl_usd,
          CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
          CASE WHEN (total_tokens_sold + tokens_held) > 0 THEN tokens_sold_early / (total_tokens_sold + tokens_held) * 100 ELSE 0 END as pct_sold_early,
          is_maker_flag as is_maker, resolved_at, 0 as is_short
        FROM (
          SELECT buy.*,
            coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
            coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
            least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
              PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0))) as tokens_sold_early,
            buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
              PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0))) as tokens_held,
            (CASE WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
              (least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
                PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ), 0))) / coalesce(sells.total_tokens_sold, 0)) * coalesce(sells.total_sell_proceeds, 0)
            ELSE 0 END) +
            ((buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
              PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index ORDER BY buy.entry_time
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0)))) * CASE
              WHEN buy.payout_numerators = '[1,1]' THEN 0.5
              WHEN buy.payout_numerators = '[0,1]' AND buy.outcome_index = 1 THEN 1.0
              WHEN buy.payout_numerators = '[1,0]' AND buy.outcome_index = 0 THEN 1.0
              ELSE 0.0
            END) as exit_value
          FROM (
            SELECT _tx_hash as tx_hash, _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
              min(_event_time) as entry_time, sum(_tokens_delta) as tokens, sum(abs(_usdc_delta)) as cost_usd,
              max(_is_maker) as is_maker_flag, any(_payout_numerators) as payout_numerators, any(_resolved_at) as resolved_at
            FROM (
              SELECT fill_id, any(tx_hash) as _tx_hash, any(event_time) as _event_time, any(wallet) as _wallet,
                any(condition_id) as _condition_id, any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta,
                any(usdc_delta) as _usdc_delta, any(is_maker) as _is_maker, any(is_self_fill) as _is_self_fill,
                any(payout_numerators) as _payout_numerators, any(resolved_at) as _resolved_at
              FROM tmp_fills_jan_missing
              WHERE condition_id IN (${conditionList})
              GROUP BY fill_id
            )
            WHERE _tokens_delta > 0 AND _wallet != '0x0000000000000000000000000000000000000000'
              AND NOT (_is_self_fill = 1 AND _is_maker = 1)
            GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
            HAVING cost_usd >= 0.01
          ) AS buy
          LEFT JOIN (
            SELECT _wallet as wallet, _condition_id as condition_id, _outcome_index as outcome_index,
              sum(abs(_tokens_delta)) as total_tokens_sold, sum(abs(_usdc_delta)) as total_sell_proceeds
            FROM (
              SELECT fill_id, any(event_time) as _event_time, any(wallet) as _wallet, any(condition_id) as _condition_id,
                any(outcome_index) as _outcome_index, any(tokens_delta) as _tokens_delta, any(usdc_delta) as _usdc_delta,
                any(resolved_at) as _resolved_at
              FROM tmp_fills_jan_missing
              WHERE condition_id IN (${conditionList})
              GROUP BY fill_id
            )
            WHERE _tokens_delta < 0 AND _wallet != '0x0000000000000000000000000000000000000000'
              AND _event_time < _resolved_at
            GROUP BY _wallet, _condition_id, _outcome_index
          ) AS sells ON buy.wallet = sells.wallet AND buy.condition_id = sells.condition_id AND buy.outcome_index = sells.outcome_index
        )
      `,
      clickhouse_settings: {
        max_execution_time: 600,
        max_threads: 8,
        max_memory_usage: 5000000000, // 5GB per query
        max_bytes_before_external_sort: 2000000000, // 2GB spill threshold
        max_bytes_before_external_group_by: 2000000000,
        optimize_read_in_window_order: 1, // KEY OPTIMIZATION
        query_plan_enable_optimizations: 1,
      }
    });

    // SHORTS
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3
        SELECT
          concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
          wallet, condition_id, outcome_index, entry_time,
          abs(net_tokens) as tokens, -cash_flow as cost_usd, 0 as tokens_sold_early, abs(net_tokens) as tokens_held,
          CASE
            WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
            WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
            WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
            ELSE 0.0
          END as exit_value,
          cash_flow + CASE
            WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
            WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
            WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
            ELSE 0.0
          END as pnl_usd,
          CASE WHEN cash_flow > 0 THEN
            (cash_flow + CASE
              WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
              WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
              WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
              ELSE 0.0
            END) / cash_flow
          ELSE 0 END as roi,
          0 as pct_sold_early, 0 as is_maker, resolved_at, 1 as is_short
        FROM (
          SELECT wallet, condition_id, outcome_index, min(event_time) as entry_time,
            sum(tokens_delta) as net_tokens, sum(usdc_delta) as cash_flow,
            any(payout_numerators) as payout_numerators, any(resolved_at) as resolved_at
          FROM (
            SELECT fill_id, any(event_time) as event_time, any(wallet) as wallet, any(condition_id) as condition_id,
              any(outcome_index) as outcome_index, any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
              any(is_self_fill) as is_self_fill, any(is_maker) as is_maker,
              any(payout_numerators) as payout_numerators, any(resolved_at) as resolved_at
            FROM tmp_fills_jan_missing
            WHERE condition_id IN (${conditionList})
            GROUP BY fill_id
          )
          WHERE wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY wallet, condition_id, outcome_index
          HAVING net_tokens < -0.01 AND cash_flow > 0.01
        )
      `,
      clickhouse_settings: {
        max_execution_time: 600,
        max_threads: 8,
        max_memory_usage: 5000000000,
      }
    });

    return true;
  } catch (err: any) {
    console.error(`\n✗ Batch ${batchNum} error: ${err.message}`);
    return false;
  }
}

async function step3_processInParallel() {
  console.log('=== STEP 2: Process Batches in Parallel ===\n');
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Parallel workers: ${PARALLEL_WORKERS}\n`);

  const conditionIds = JSON.parse(fs.readFileSync('/tmp/missing-conditions-jan2026.json', 'utf-8'));
  const totalBatches = Math.ceil(conditionIds.length / BATCH_SIZE);

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < conditionIds.length; i += BATCH_SIZE * PARALLEL_WORKERS) {
    const workerPromises = [];

    for (let w = 0; w < PARALLEL_WORKERS; w++) {
      const startIdx = i + (w * BATCH_SIZE);
      if (startIdx >= conditionIds.length) break;

      const batch = conditionIds.slice(startIdx, startIdx + BATCH_SIZE);
      const batchNum = Math.floor(startIdx / BATCH_SIZE) + 1;

      workerPromises.push(
        step2_processBatch(batch, batchNum, totalBatches).then(success => {
          if (success) {
            process.stdout.write(`✓`);
            completed++;
          } else {
            process.stdout.write(`✗`);
            failed++;
          }
          return success;
        })
      );
    }

    await Promise.all(workerPromises);

    const progress = ((completed / totalBatches) * 100).toFixed(1);
    console.log(` [${progress}%] ${completed}/${totalBatches} batches`);
  }

  console.log(`\n✓ Complete: ${completed} batches, ${failed} failed`);
}

async function step4_cleanup() {
  console.log('\n=== STEP 3: Cleanup ===\n');

  console.log('Dropping staging tables...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS tmp_missing_conditions' });
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS tmp_fills_jan_missing' });
  console.log('✓ Cleanup complete\n');
}

async function main() {
  const startTime = Date.now();
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  FIFO FIX - STAGING TABLE APPROACH (OPTIMAL)  ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  try {
    await step1_createStagingTables();
    await step3_processInParallel();
    await step4_cleanup();

    const duration = (Date.now() - startTime) / 1000;
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║              RECOVERY COMPLETE                 ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log(`Duration: ${(duration / 60).toFixed(1)} minutes\n`);

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
