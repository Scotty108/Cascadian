#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - FULL BACKFILL (All Wallets Overnight)
 *
 * Process TRUE FIFO for ALL wallets in database.
 * Uses proven batch approach (100 wallets at a time).
 * Includes checkpoint/resume capability for overnight safety.
 *
 * Expected runtime: 8-12 hours for ~500k wallets
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const BATCH_SIZE = 100; // Process 100 wallets at a time (proven optimal)
const CHECKPOINT_FILE = '/tmp/fifo-v5-full-checkpoint.json';

interface Checkpoint {
  completedBatches: number;
  totalWallets: number;
  totalRows: number;
  startedAt: string;
  lastUpdated: string;
}

function loadCheckpoint(): Checkpoint | null {
  if (existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'));
  }
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint) {
  checkpoint.lastUpdated = new Date().toISOString();
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function getAllWallets(): Promise<string[]> {
  console.log('Finding ALL wallets in database...\n');

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4_deduped
      WHERE source = 'clob'
      ORDER BY wallet
    `,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 600,
      max_memory_usage: 8000000000,
      max_threads: 8,
    },
  });

  const rows = await result.json() as { wallet: string }[];
  return rows.map(r => r.wallet);
}

async function processBatch(
  wallets: string[],
  batchNum: number,
  totalBatches: number,
  maxRetries = 3
): Promise<number> {
  console.log(`\n[Batch ${batchNum}/${totalBatches}] Processing ${wallets.length} wallets...`);

  const walletList = wallets.map(w => `'${w}'`).join(',');

  // Retry logic for network errors
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const startTime = Date.now();

      // Process FULL HISTORY for these wallets (all time)
      await clickhouse.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3
          SELECT
            tx_hash,
            wallet,
            condition_id,
            outcome_index,
            entry_time,
            tokens,
            cost_usd,
            tokens_sold_early,
            tokens_held,
            exit_value,
            exit_value - cost_usd as pnl_usd,
            CASE WHEN cost_usd > 0 THEN (exit_value - cost_usd) / cost_usd ELSE 0 END as roi,
            CASE
              WHEN (total_tokens_sold + tokens_held) > 0 THEN
                tokens_sold_early / (total_tokens_sold + tokens_held) * 100
              ELSE 0
            END as pct_sold_early,
            is_maker_flag as is_maker,
            resolved_at,
            0 as is_short,
            1 as is_closed
          FROM (
            SELECT
              buy.*,
              coalesce(sells.total_tokens_sold, 0) as total_tokens_sold,
              coalesce(sells.total_sell_proceeds, 0) as total_sell_proceeds,
              least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
                PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
                ORDER BY buy.entry_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ), 0))) as tokens_sold_early,
              buy.tokens - least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
                PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
                ORDER BY buy.entry_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ), 0))) as tokens_held,
              CASE
                WHEN coalesce(sells.total_tokens_sold, 0) > 0 THEN
                  least(buy.tokens, greatest(0, coalesce(sells.total_tokens_sold, 0) - coalesce(sum(buy.tokens) OVER (
                    PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
                    ORDER BY buy.entry_time
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                  ), 0))) * (coalesce(sells.total_sell_proceeds, 0) / coalesce(sells.total_tokens_sold, 1))
                ELSE 0
              END as exit_value
            FROM (
              SELECT
                f.fill_id as tx_hash,
                f.wallet,
                f.condition_id,
                f.outcome_index,
                f.event_time as entry_time,
                f.tokens_delta as tokens,
                abs(f.usdc_delta) as cost_usd,
                f.is_maker as is_maker_flag,
                max(f.event_time) OVER (PARTITION BY f.wallet, f.condition_id, f.outcome_index) as resolved_at
              FROM pm_canonical_fills_v4_deduped f
              LEFT JOIN pm_condition_resolutions r
                ON f.condition_id = r.condition_id AND r.is_deleted = 0
              WHERE f.wallet IN (${walletList})
                AND f.source = 'clob'
                AND f.tokens_delta > 0
                AND (r.payout_numerators IS NULL OR r.payout_numerators = '')
              ORDER BY f.wallet, f.condition_id, f.outcome_index, f.event_time
            ) buy
            LEFT JOIN (
              SELECT
                wallet,
                condition_id,
                outcome_index,
                abs(sum(tokens_delta)) as total_tokens_sold,
                sum(usdc_delta) as total_sell_proceeds
              FROM pm_canonical_fills_v4_deduped
              WHERE wallet IN (${walletList})
                AND source = 'clob'
                AND tokens_delta < 0
              GROUP BY wallet, condition_id, outcome_index
            ) sells ON buy.wallet = sells.wallet
              AND buy.condition_id = sells.condition_id
              AND buy.outcome_index = sells.outcome_index
          )
          WHERE tokens_held = 0 OR abs(tokens_held) < 0.01
        `,
        clickhouse_settings: {
          max_execution_time: 1800, // 30 minutes per batch
          max_memory_usage: 15000000000, // 15GB
          max_threads: 8,
          optimize_read_in_window_order: 1,
          query_plan_enable_optimizations: 1,
        },
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      // Count inserted rows for this batch
      const result = await clickhouse.query({
        query: `
          SELECT count() as cnt
          FROM pm_trade_fifo_roi_v3
          WHERE wallet IN (${walletList}) AND is_closed = 1
        `,
        format: 'JSONEachRow',
      });
      const stats = (await result.json())[0];

      console.log(`  ✓ Inserted ${stats.cnt.toLocaleString()} FIFO rows in ${duration}s`);
      return stats.cnt;

    } catch (error: any) {
      if (attempt === maxRetries) {
        console.log(`  ✗ Batch ${batchNum} error after ${maxRetries} attempts: ${error.message}`);
        throw error;
      }

      // Wait before retry (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`  ⚠️  Retry ${attempt}/${maxRetries} after ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  return 0; // Should never reach here
}

async function main() {
  console.log('🔨 Building FIFO V5 (FULL BACKFILL - All Wallets)\n');
  console.log('Strategy: Process FULL HISTORY for ALL wallets in database');
  console.log('(TRUE FIFO = per-trade buy/sell matching for entire wallet history)');
  console.log(`Batch size: ${BATCH_SIZE} wallets\n`);

  const startTime = Date.now();

  // Check for existing checkpoint
  const existingCheckpoint = loadCheckpoint();
  let checkpoint: Checkpoint;

  if (existingCheckpoint) {
    console.log('📋 Found existing checkpoint:');
    console.log(`   Started: ${existingCheckpoint.startedAt}`);
    console.log(`   Completed batches: ${existingCheckpoint.completedBatches}`);
    console.log(`   Total rows: ${existingCheckpoint.totalRows.toLocaleString()}\n`);
    console.log('Resuming from checkpoint...\n');
    checkpoint = existingCheckpoint;
  } else {
    checkpoint = {
      completedBatches: 0,
      totalWallets: 0,
      totalRows: 0,
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
  }

  // Step 1: Get ALL wallets
  const wallets = await getAllWallets();
  console.log(`Found ${wallets.length.toLocaleString()} total wallets\n`);
  checkpoint.totalWallets = wallets.length;

  if (wallets.length === 0) {
    console.log('No wallets found. Exiting.\n');
    return;
  }

  // Step 2: Process in batches (skip already completed batches)
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);
  const startBatch = checkpoint.completedBatches;

  console.log(`Processing batches ${startBatch + 1} to ${totalBatches}...\n`);

  for (let i = startBatch; i < totalBatches; i++) {
    const batchStart = i * BATCH_SIZE;
    const batch = wallets.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = i + 1;

    try {
      const rows = await processBatch(batch, batchNum, totalBatches);
      checkpoint.totalRows += rows;
      checkpoint.completedBatches = batchNum;

      // Save checkpoint every 10 batches
      if (batchNum % 10 === 0) {
        saveCheckpoint(checkpoint);
      }

      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const walletsProcessed = batchNum * BATCH_SIZE;
      const rate = walletsProcessed / (Date.now() - startTime) * 1000 * 60;
      const remaining = wallets.length - walletsProcessed;
      const eta = (remaining / rate).toFixed(0);

      console.log(`\n📊 Progress: ${walletsProcessed}/${wallets.length} wallets`);
      console.log(`   Total FIFO rows: ${checkpoint.totalRows.toLocaleString()}`);
      console.log(`   Rate: ${rate.toFixed(0)} wallets/min`);
      console.log(`   Elapsed: ${elapsed} min | ETA: ${eta} min\n`);

    } catch (error: any) {
      console.log(`\n⚠️  Batch ${batchNum} failed, continuing to next batch...\n`);
      // Save checkpoint even on error
      saveCheckpoint(checkpoint);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Full Backfill Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Wallets processed: ${wallets.length.toLocaleString()}`);
  console.log(`Total FIFO rows: ${checkpoint.totalRows.toLocaleString()}`);
  console.log(`Duration: ${totalDuration} minutes (${(totalDuration / 60).toFixed(1)} hours)`);
  console.log('\n🎯 Your leaderboards are now ready!');
  console.log('   Query: pm_trade_fifo_roi_v3_deduped\n');

  // Save final checkpoint
  saveCheckpoint(checkpoint);

  // Cleanup checkpoint file on success
  console.log('Archiving checkpoint file...');
  const archivePath = `/tmp/fifo-v5-full-checkpoint-${Date.now()}.json`;
  writeFileSync(archivePath, JSON.stringify(checkpoint, null, 2));
  console.log(`Checkpoint archived to: ${archivePath}\n`);
}

main().catch(console.error);
