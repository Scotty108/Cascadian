/**
 * FIFO Fix - CHUNKED V2
 *
 * Strategy:
 * 1. Create staging tables for 1000 conditions at a time (avoids memory limit)
 * 2. Process each staging table in batches of 50 (avoids per-batch INNER JOINs)
 * 3. This does the expensive INNER JOIN only 11 times instead of 203 times
 *
 * Expected: 11 chunks × 5 minutes = 55 minutes total
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

const STAGING_CHUNK_SIZE = 1000;
const BATCH_SIZE = 50;

async function processChunk(conditionChunk: string[], chunkNum: number, totalChunks: number) {
  const startTime = Date.now();
  console.log(`\n[Chunk ${chunkNum}/${totalChunks}] Processing ${conditionChunk.length} conditions`);

  // Create temporary tables
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS tmp_chunk_conditions' });
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS tmp_chunk_fills' });

  await clickhouse.command({
    query: `CREATE TABLE tmp_chunk_conditions (condition_id String) ENGINE = Memory`
  });

  // Load conditions in sub-batches
  for (let i = 0; i < conditionChunk.length; i += 500) {
    const batch = conditionChunk.slice(i, i + 500);
    const values = batch.map(id => `('${id}')`).join(',');
    await clickhouse.command({ query: `INSERT INTO tmp_chunk_conditions VALUES ${values}` });
  }

  // Create staging table
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_chunk_fills
      (
        fill_id String, tx_hash String, wallet String, condition_id String,
        outcome_index UInt8, tokens_delta Float64, usdc_delta Float64,
        event_time DateTime, is_maker UInt8, is_self_fill UInt8,
        payout_numerators String, resolved_at DateTime
      )
      ENGINE = MergeTree
      ORDER BY (wallet, condition_id, outcome_index, event_time, fill_id)
    `
  });

  // Populate staging table - THIS IS THE EXPENSIVE OPERATION (once per chunk)
  process.stdout.write('  Populating staging table...');
  await clickhouse.command({
    query: `
      INSERT INTO tmp_chunk_fills
      SELECT
        f.fill_id, f.tx_hash, lower(f.wallet) AS wallet, f.condition_id, f.outcome_index,
        f.tokens_delta, f.usdc_delta, f.event_time, f.is_maker, f.is_self_fill,
        r.payout_numerators, r.resolved_at
      FROM pm_canonical_fills_v4 f
      INNER JOIN tmp_chunk_conditions m ON f.condition_id = m.condition_id
      INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      WHERE f.source = 'clob' AND r.is_deleted = 0 AND r.payout_numerators != ''
    `,
    clickhouse_settings: {
      max_execution_time: 600,
      max_threads: 6,
      max_memory_usage: 8000000000,
    }
  });
  console.log(' ✓');

  // Now process batches from the staging table (FAST - no INNER JOIN)
  let completed = 0;
  let failed = 0;

  for (let i = 0; i < conditionChunk.length; i += BATCH_SIZE) {
    const batch = conditionChunk.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(conditionChunk.length / BATCH_SIZE);

    process.stdout.write(`  [${batchNum}/${totalBatches}] `);

    const success = await processBatchFromStaging(batch);
    if (success) {
      process.stdout.write(`✓\n`);
      completed++;
    } else {
      process.stdout.write(`✗\n`);
      failed++;
    }
  }

  // Cleanup
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS tmp_chunk_conditions' });
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS tmp_chunk_fills' });

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`  Chunk complete: ${completed}/${completed + failed} batches in ${duration}m`);
}

async function processBatchFromStaging(conditions: string[]): Promise<boolean> {
  const conditionList = conditions.map(id => `'${id}'`).join(',');

  try {
    // LONGS - read directly from staging table filtered by batch conditions
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
            SELECT tx_hash, wallet, condition_id, outcome_index,
              min(event_time) as entry_time, sum(tokens_delta) as tokens, sum(abs(usdc_delta)) as cost_usd,
              max(is_maker) as is_maker_flag, any(payout_numerators) as payout_numerators, any(resolved_at) as resolved_at
            FROM (
              SELECT fill_id, any(tx_hash) as tx_hash, any(event_time) as event_time, any(wallet) as wallet,
                any(condition_id) as condition_id, any(outcome_index) as outcome_index,
                any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
                any(is_maker) as is_maker, any(is_self_fill) as is_self_fill,
                any(payout_numerators) as payout_numerators, any(resolved_at) as resolved_at
              FROM tmp_chunk_fills
              WHERE condition_id IN (${conditionList})
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
              FROM tmp_chunk_fills
              WHERE condition_id IN (${conditionList})
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
        max_memory_usage: 4000000000,
        optimize_read_in_window_order: 1,
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
            SELECT fill_id, any(event_time) as event_time, any(wallet) as wallet,
              any(condition_id) as condition_id, any(outcome_index) as outcome_index,
              any(tokens_delta) as tokens_delta, any(usdc_delta) as usdc_delta,
              any(is_self_fill) as is_self_fill, any(is_maker) as is_maker,
              any(payout_numerators) as payout_numerators, any(resolved_at) as resolved_at
            FROM tmp_chunk_fills
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
        max_threads: 6,
        max_memory_usage: 4000000000,
      }
    });

    return true;
  } catch (err: any) {
    return false;
  }
}

async function main() {
  const startTime = Date.now();
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║         FIFO FIX - CHUNKED V2                 ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const conditionIds = JSON.parse(fs.readFileSync('/tmp/missing-conditions-jan2026.json', 'utf-8'));
  const totalChunks = Math.ceil(conditionIds.length / STAGING_CHUNK_SIZE);

  console.log(`Total conditions: ${conditionIds.length}`);
  console.log(`Chunk size: ${STAGING_CHUNK_SIZE} conditions`);
  console.log(`Batch size: ${BATCH_SIZE} conditions`);
  console.log(`Total chunks: ${totalChunks}`);
  console.log(`Expected duration: 55-70 minutes\n`);

  for (let i = 0; i < conditionIds.length; i += STAGING_CHUNK_SIZE) {
    const chunk = conditionIds.slice(i, i + STAGING_CHUNK_SIZE);
    const chunkNum = Math.floor(i / STAGING_CHUNK_SIZE) + 1;
    await processChunk(chunk, chunkNum, totalChunks);

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const progress = (chunkNum / totalChunks * 100).toFixed(0);
    const rate = chunkNum / ((Date.now() - startTime) / 1000 / 60);
    const remaining = Math.ceil((totalChunks - chunkNum) / rate);

    console.log(`Overall progress: ${chunkNum}/${totalChunks} chunks (${progress}%) | Elapsed: ${elapsed}m | ETA: ${remaining}m\n`);
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║           RECOVERY COMPLETE                   ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Duration: ${(duration / 60).toFixed(1)} minutes\n`);
}

main();
