/**
 * FIFO Recovery - Phase 2: Process Chunks from Optimized Table
 *
 * Processes 10,108 conditions in 11 chunks of ~1000 conditions each.
 * Reads from tmp_fills_2026_01_by_condition (created in Phase 1).
 *
 * Features:
 * - Sequential chunk processing (no parallelism)
 * - Checkpoint/resume support
 * - Progress tracking with ETA
 * - Cleanup after each chunk
 *
 * Expected runtime: 45-55 minutes (4-5 min per chunk)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const CHUNK_SIZE = 1000;

interface Checkpoint {
  phase: number;
  phase1_completed?: boolean;
  started_at: string;
  completed_chunks: number[];
  failed_chunks: number[];
  last_chunk: number;
  total_chunks: number;
  rows_inserted: number;
  updated_at: string;
}

function loadCheckpoint(): Checkpoint | null {
  try {
    const data = fs.readFileSync('/tmp/fifo-recovery-checkpoint.json', 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function saveCheckpoint(checkpoint: Checkpoint) {
  checkpoint.updated_at = new Date().toISOString();
  fs.writeFileSync(
    '/tmp/fifo-recovery-checkpoint.json',
    JSON.stringify(checkpoint, null, 2)
  );
}

async function processChunk(
  conditionChunk: string[],
  chunkNum: number,
  totalChunks: number
): Promise<{ success: boolean; longsInserted: number; shortsInserted: number }> {
  const chunkStart = Date.now();
  console.log(`\n[Chunk ${chunkNum}/${totalChunks}] Processing ${conditionChunk.length} conditions`);

  const conditionsTable = `tmp_chunk_${chunkNum}_conditions`;
  const stagingTable = `tmp_chunk_${chunkNum}_staging`;

  try {
    // Step 1: Create conditions table
    process.stdout.write('  Creating conditions table...');
    await clickhouse.command({
      query: `DROP TABLE IF EXISTS ${conditionsTable}`
    });
    await clickhouse.command({
      query: `CREATE TABLE ${conditionsTable} (condition_id String) ENGINE = Memory`
    });

    // Insert conditions in sub-batches
    for (let i = 0; i < conditionChunk.length; i += 500) {
      const batch = conditionChunk.slice(i, i + 500);
      const values = batch.map(id => `('${id}')`).join(',');
      await clickhouse.command({
        query: `INSERT INTO ${conditionsTable} VALUES ${values}`
      });
    }
    console.log(' ✓');

    // Step 2: Create staging table
    process.stdout.write('  Creating staging table...');
    await clickhouse.command({
      query: `DROP TABLE IF EXISTS ${stagingTable}`
    });
    await clickhouse.command({
      query: `
        CREATE TABLE ${stagingTable} (
          fill_id String, tx_hash String, wallet String, condition_id String,
          outcome_index UInt8, tokens_delta Float64, usdc_delta Float64,
          event_time DateTime, is_maker UInt8, is_self_fill UInt8,
          payout_numerators String, resolved_at DateTime
        )
        ENGINE = MergeTree
        ORDER BY (wallet, condition_id, outcome_index, event_time, fill_id)
      `
    });
    console.log(' ✓');

    // Step 3: Populate staging from optimized table (FAST)
    process.stdout.write('  Populating staging from optimized table...');
    await clickhouse.command({
      query: `
        INSERT INTO ${stagingTable}
        SELECT f.*
        FROM tmp_fills_2026_01_by_condition f
        INNER JOIN ${conditionsTable} c ON f.condition_id = c.condition_id
      `,
      clickhouse_settings: {
        max_execution_time: 300,
        max_threads: 6,
        max_memory_usage: 8000000000,
      }
    });
    console.log(' ✓');

    // Step 4: Process LONGS
    process.stdout.write('  Processing LONGS...');
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
              FROM ${stagingTable}
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
              FROM ${stagingTable}
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

    const longsInserted = 0; // ClickHouse doesn't return row count easily
    console.log(' ✓');

    // Step 5: Process SHORTS
    process.stdout.write('  Processing SHORTS...');
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
            FROM ${stagingTable}
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

    const shortsInserted = 0; // ClickHouse doesn't return row count easily
    console.log(' ✓');

    // Step 6: Cleanup chunk tables
    process.stdout.write('  Cleaning up chunk tables...');
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${conditionsTable}` });
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${stagingTable}` });
    console.log(' ✓');

    const chunkDuration = ((Date.now() - chunkStart) / 1000 / 60).toFixed(1);
    console.log(`  Chunk completed in ${chunkDuration} minutes`);

    return { success: true, longsInserted, shortsInserted };
  } catch (err: any) {
    console.log(`  ✗ ERROR: ${err.message}`);

    // Cleanup on error
    try {
      await clickhouse.command({ query: `DROP TABLE IF EXISTS ${conditionsTable}` });
      await clickhouse.command({ query: `DROP TABLE IF EXISTS ${stagingTable}` });
    } catch {}

    return { success: false, longsInserted: 0, shortsInserted: 0 };
  }
}

async function main() {
  const startTime = Date.now();

  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   FIFO RECOVERY - PHASE 2: PROCESS CHUNKS    ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Load checkpoint
  const existingCheckpoint = loadCheckpoint();
  if (!existingCheckpoint || !existingCheckpoint.phase1_completed) {
    console.error('❌ ERROR: Phase 1 not completed.');
    console.error('Run build-jan-fills-optimized.ts first.\n');
    process.exit(1);
  }

  // Load missing conditions
  const conditionIds = JSON.parse(
    fs.readFileSync('/tmp/missing-conditions-jan2026.json', 'utf-8')
  );
  const totalChunks = Math.ceil(conditionIds.length / CHUNK_SIZE);

  console.log(`Total conditions: ${conditionIds.length.toLocaleString()}`);
  console.log(`Chunk size: ${CHUNK_SIZE}`);
  console.log(`Total chunks: ${totalChunks}\n`);

  // Initialize or load checkpoint
  const checkpoint: Checkpoint = {
    phase: 2,
    phase1_completed: true,
    started_at: existingCheckpoint.started_at || new Date().toISOString(),
    completed_chunks: existingCheckpoint.completed_chunks || [],
    failed_chunks: existingCheckpoint.failed_chunks || [],
    last_chunk: existingCheckpoint.last_chunk || 0,
    total_chunks: totalChunks,
    rows_inserted: existingCheckpoint.rows_inserted || 0,
    updated_at: new Date().toISOString(),
  };

  // Process chunks sequentially
  for (let i = 0; i < conditionIds.length; i += CHUNK_SIZE) {
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;

    // Skip completed chunks
    if (checkpoint.completed_chunks.includes(chunkNum)) {
      console.log(`[Chunk ${chunkNum}/${totalChunks}] Already completed, skipping...`);
      continue;
    }

    const chunk = conditionIds.slice(i, i + CHUNK_SIZE);
    const result = await processChunk(chunk, chunkNum, totalChunks);

    if (result.success) {
      checkpoint.completed_chunks.push(chunkNum);
      checkpoint.rows_inserted += result.longsInserted + result.shortsInserted;
    } else {
      checkpoint.failed_chunks.push(chunkNum);
    }

    checkpoint.last_chunk = chunkNum;
    saveCheckpoint(checkpoint);

    // Progress report
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const progress = ((checkpoint.completed_chunks.length / totalChunks) * 100).toFixed(0);
    const rate = checkpoint.completed_chunks.length / ((Date.now() - startTime) / 1000 / 60);
    const remaining = Math.ceil((totalChunks - checkpoint.completed_chunks.length) / rate);

    console.log(`Overall: ${checkpoint.completed_chunks.length}/${totalChunks} chunks (${progress}%) | Elapsed: ${elapsed}m | ETA: ${remaining}m\n`);
  }

  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║           PHASE 2 COMPLETE                    ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Duration: ${totalDuration} minutes`);
  console.log(`Completed: ${checkpoint.completed_chunks.length}/${totalChunks} chunks`);
  console.log(`Failed: ${checkpoint.failed_chunks.length} chunks\n`);

  if (checkpoint.failed_chunks.length > 0) {
    console.log('⚠ Failed chunks:', checkpoint.failed_chunks.join(', '));
    console.log('Re-run this script to retry failed chunks.\n');
  }

  console.log('✓ Ready for Phase 3: validate-fifo-recovery.ts\n');
}

main().catch(err => {
  console.error('\n❌ FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
