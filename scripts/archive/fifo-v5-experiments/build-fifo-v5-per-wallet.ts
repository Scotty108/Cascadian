#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - Per Wallet Processing
 *
 * Process one wallet at a time - each wallet is small enough to handle.
 * Will take 24-48 hours but WON'T timeout.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const CHECKPOINT_FILE = '/tmp/fifo-v5-checkpoint.json';
const BATCH_SIZE = 100; // Process 100 wallets at a time

interface Checkpoint {
  processedWallets: string[];
  lastWallet: string;
  totalProcessed: number;
  totalRows: number;
  startedAt: string;
}

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'));
  }
  return {
    processedWallets: [],
    lastWallet: '',
    totalProcessed: 0,
    totalRows: 0,
    startedAt: new Date().toISOString(),
  };
}

function saveCheckpoint(checkpoint: Checkpoint) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function getWalletsToProcess(skip: number): Promise<string[]> {
  // Get wallets with unresolved market activity
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT f.wallet
      FROM pm_canonical_fills_v4_deduped f
      LEFT JOIN pm_condition_resolutions r
        ON f.condition_id = r.condition_id AND r.is_deleted = 0
      WHERE f.source = 'clob'
        AND (r.payout_numerators IS NULL OR r.payout_numerators = '')
      ORDER BY f.wallet
      LIMIT ${BATCH_SIZE} OFFSET ${skip}
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as { wallet: string }[];
  return rows.map(r => r.wallet);
}

async function processWallet(wallet: string): Promise<number> {
  // Run FIFO V5 for this single wallet (fast - only 100-1000 fills)
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
          WHERE f.wallet = '${wallet}'
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
          WHERE wallet = '${wallet}'
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
      max_execution_time: 30,
      max_memory_usage: 1000000000, // 1GB per wallet
      max_threads: 2,
      optimize_read_in_window_order: 1,
    },
  });

  // Count inserted
  const result = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trade_fifo_roi_v3 WHERE wallet = '${wallet}' AND is_closed = 1`,
    format: 'JSONEachRow',
  });
  const rows = await result.json() as any[];
  return rows[0]?.cnt || 0;
}

async function main() {
  console.log('🔨 Building FIFO V5 (Per-Wallet Processing)\n');

  const checkpoint = loadCheckpoint();
  console.log(`Resuming from checkpoint...`);
  console.log(`Already processed: ${checkpoint.totalProcessed} wallets`);
  console.log(`Total rows so far: ${checkpoint.totalRows}\n`);

  const startTime = Date.now();
  let skip = checkpoint.totalProcessed;

  while (true) {
    // Get next batch of wallets
    const wallets = await getWalletsToProcess(skip);

    if (wallets.length === 0) {
      console.log('\n✅ All wallets processed!');
      break;
    }

    console.log(`\nBatch ${Math.floor(skip / BATCH_SIZE) + 1}: Processing ${wallets.length} wallets...`);

    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];

      try {
        const rows = await processWallet(wallet);
        checkpoint.totalProcessed++;
        checkpoint.totalRows += rows;
        checkpoint.lastWallet = wallet;

        if (rows > 0) {
          console.log(`  [${checkpoint.totalProcessed}] ${wallet.slice(0, 10)}... → ${rows} FIFO rows`);
        } else {
          process.stdout.write(`  [${checkpoint.totalProcessed}] ${wallet.slice(0, 10)}... → 0 rows\r`);
        }

        // Save checkpoint every 10 wallets
        if (checkpoint.totalProcessed % 10 === 0) {
          saveCheckpoint(checkpoint);
        }
      } catch (error: any) {
        console.log(`  ✗ ${wallet.slice(0, 10)}... error: ${error.message}`);
      }
    }

    skip += wallets.length;

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = checkpoint.totalProcessed / (Date.now() - startTime) * 1000 * 60; // wallets per minute
    const remaining = 500000 - checkpoint.totalProcessed; // Assume 500k wallets total
    const eta = (remaining / rate).toFixed(0);

    console.log(`\nProgress: ${checkpoint.totalProcessed} wallets, ${checkpoint.totalRows} FIFO rows`);
    console.log(`Rate: ${rate.toFixed(1)} wallets/min`);
    console.log(`ETA: ${eta} minutes (${(eta / 60).toFixed(1)} hours)\n`);

    saveCheckpoint(checkpoint);
  }

  const totalDuration = ((Date.now() - startTime) / 1000 / 60 / 60).toFixed(1);

  console.log('\n════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Build Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Total wallets: ${checkpoint.totalProcessed.toLocaleString()}`);
  console.log(`Total FIFO rows: ${checkpoint.totalRows.toLocaleString()}`);
  console.log(`Duration: ${totalDuration} hours`);
  console.log('\nNext: Verify with test wallets\n');
}

main().catch(console.error);
