/**
 * FIFO Fix - ISOLATED VERSION
 *
 * Fix: Add batch number to temp table names to avoid parallel worker conflicts
 * Each worker gets unique tables: tmp_batch_1_conditions, tmp_batch_1_fills, etc.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

const BATCH_SIZE = 200; // Process 200 conditions at a time
const PARALLEL_WORKERS = 5;

async function processBatch(conditions: string[], batchNum: number, totalBatches: number): Promise<boolean> {
  // Create unique table names for this batch
  const conditionsTable = `tmp_batch_${batchNum}_conditions`;
  const fillsTable = `tmp_batch_${batchNum}_fills`;

  try {
    process.stdout.write(`[${batchNum}/${totalBatches}] `);

    // Create batch-specific staging table
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${fillsTable}` });
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${conditionsTable}` });

    await clickhouse.command({
      query: `CREATE TABLE ${conditionsTable} (condition_id String) ENGINE = Memory`
    });

    // Load conditions for this batch
    const values = conditions.map(id => `('${id}')`).join(',');
    await clickhouse.command({
      query: `INSERT INTO ${conditionsTable} VALUES ${values}`
    });

    // Create staging table for this batch ONLY
    await clickhouse.command({
      query: `
        CREATE TABLE ${fillsTable}
        (
          fill_id String, tx_hash String, wallet String, condition_id String,
          outcome_index UInt8, tokens_delta Float64, usdc_delta Float64,
          event_time DateTime, is_maker UInt8, is_self_fill UInt8,
          payout_numerators String, resolved_at DateTime
        )
        ENGINE = MergeTree
        ORDER BY (wallet, condition_id, outcome_index, event_time)
      `
    });

    // Populate with fills for THIS batch only
    await clickhouse.command({
      query: `
        INSERT INTO ${fillsTable}
        SELECT f.fill_id, f.tx_hash, lower(f.wallet), f.condition_id, f.outcome_index,
          f.tokens_delta, f.usdc_delta, f.event_time, f.is_maker, f.is_self_fill,
          r.payout_numerators, r.resolved_at
        FROM pm_canonical_fills_v4 f
        INNER JOIN ${conditionsTable} m ON f.condition_id = m.condition_id
        INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
        WHERE f.source = 'clob' AND r.is_deleted = 0 AND r.payout_numerators != ''
      `,
      clickhouse_settings: { max_execution_time: 300, max_threads: 4, max_memory_usage: 6000000000 }
    });

    // Process LONGS - NO WHERE IN NEEDED
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3
        SELECT tx_hash, wallet, condition_id, outcome_index, entry_time, tokens, cost_usd,
          tokens_sold_early, tokens_held, exit_value,
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
            SELECT tx_hash, wallet, condition_id, outcome_index,
              min(event_time) as entry_time, sum(tokens_delta) as tokens, sum(abs(usdc_delta)) as cost_usd,
              max(is_maker) as is_maker_flag, any(payout_numerators) as payout_numerators, any(resolved_at) as resolved_at
            FROM (
              SELECT fill_id, any(tx_hash) as tx_hash, any(event_time) as event_time, any(wallet) as wallet,
                any(condition_id) as condition_id, any(outcome_index) as outcome_index,
                any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
                any(is_maker) as is_maker, any(is_self_fill) as is_self_fill,
                any(payout_numerators) as payout_numerators, any(resolved_at) as resolved_at
              FROM ${fillsTable}
              GROUP BY fill_id
            )
            WHERE tokens_delta > 0 AND wallet != '0x0000000000000000000000000000000000000000'
              AND NOT (is_self_fill = 1 AND is_maker = 1)
            GROUP BY tx_hash, wallet, condition_id, outcome_index
            HAVING cost_usd >= 0.01
          ) AS buy
          LEFT JOIN (
            SELECT wallet, condition_id, outcome_index,
              sum(abs(tokens_delta)) as total_tokens_sold, sum(abs(usdc_delta)) as total_sell_proceeds
            FROM (
              SELECT fill_id, any(event_time) as event_time, any(wallet) as wallet,
                any(condition_id) as condition_id, any(outcome_index) as outcome_index,
                any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
                any(resolved_at) as resolved_at
              FROM ${fillsTable}
              GROUP BY fill_id
            )
            WHERE tokens_delta < 0 AND wallet != '0x0000000000000000000000000000000000000000'
              AND event_time < resolved_at
            GROUP BY wallet, condition_id, outcome_index
          ) AS sells ON buy.wallet = sells.wallet AND buy.condition_id = sells.condition_id AND buy.outcome_index = sells.outcome_index
        )
      `,
      clickhouse_settings: {
        max_execution_time: 600,
        max_threads: 6,
        max_memory_usage: 5000000000,
        optimize_read_in_window_order: 1,
        query_plan_enable_optimizations: 1,
      }
    });

    // Process SHORTS - NO WHERE IN NEEDED
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
            SELECT fill_id, any(event_time) as event_time, any(wallet) as wallet,
              any(condition_id) as condition_id, any(outcome_index) as outcome_index,
              any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
              any(is_self_fill) as is_self_fill, any(is_maker) as is_maker,
              any(payout_numerators) as payout_numerators, any(resolved_at) as resolved_at
            FROM ${fillsTable}
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
        max_threads: 6,
        max_memory_usage: 5000000000,
      }
    });

    // Cleanup
    await clickhouse.command({ query: `DROP TABLE ${conditionsTable}` });
    await clickhouse.command({ query: `DROP TABLE ${fillsTable}` });

    process.stdout.write(`✓\n`);
    return true;
  } catch (err: any) {
    process.stdout.write(`✗ ${err.message.substring(0, 50)}\n`);

    // Cleanup on error
    try {
      await clickhouse.command({ query: `DROP TABLE IF EXISTS ${conditionsTable}` });
      await clickhouse.command({ query: `DROP TABLE IF EXISTS ${fillsTable}` });
    } catch {}

    return false;
  }
}

async function main() {
  const startTime = Date.now();
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║         FIFO FIX - ISOLATED VERSION           ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const conditionIds = JSON.parse(fs.readFileSync('/tmp/missing-conditions-jan2026.json', 'utf-8'));
  const totalBatches = Math.ceil(conditionIds.length / BATCH_SIZE);

  console.log(`Total conditions: ${conditionIds.length}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Parallel workers: ${PARALLEL_WORKERS}`);
  console.log(`Total batches: ${totalBatches}\n`);

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
        processBatch(batch, batchNum, totalBatches).then(success => {
          if (success) completed++;
          else failed++;
          return success;
        })
      );
    }

    await Promise.all(workerPromises);

    const progress = ((completed / totalBatches) * 100).toFixed(1);
    console.log(`Progress: ${completed}/${totalBatches} batches (${progress}%)`);
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║           RECOVERY COMPLETE                   ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Completed: ${completed} batches`);
  console.log(`Failed: ${failed} batches`);
  console.log(`Duration: ${(duration / 60).toFixed(1)} minutes\n`);
}

main();
