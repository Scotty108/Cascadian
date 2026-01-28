#!/usr/bin/env npx tsx
/**
 * Build FIFO V5 - BATCH Processing
 *
 * Process ALL active wallets in large batches (not one at a time).
 * Window functions partition by wallet, so this works fine.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const DAYS = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '2');
const BATCH_SIZE = 100; // Process 100 wallets at a time (avoids max_query_size)

async function getActiveWallets(): Promise<string[]> {
  console.log(`Finding wallets active in last ${DAYS} days...\n`);

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL ${DAYS} DAY
        AND source = 'clob'
      ORDER BY wallet
    `,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 300,
      max_memory_usage: 4000000000,
      max_threads: 8,
    },
  });

  const rows = await result.json() as { wallet: string }[];
  return rows.map(r => r.wallet);
}

async function processBatch(wallets: string[], batchNum: number, totalBatches: number): Promise<number> {
  console.log(`\n[Batch ${batchNum}/${totalBatches}] Processing ${wallets.length} wallets...`);

  const walletList = wallets.map(w => `'${w}'`).join(',');

  const startTime = Date.now();

  // Process FULL HISTORY for these wallets (all time, not just last 4 days)
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
}

async function main() {
  console.log('🔨 Building FIFO V5 (BATCH Processing)\n');
  console.log(`Strategy: Process wallets active in last ${DAYS} days`);
  console.log('(Full history per wallet, not just recent trades)');
  console.log(`Batch size: ${BATCH_SIZE.toLocaleString()} wallets\n`);

  const startTime = Date.now();

  // Step 1: Get active wallets
  const wallets = await getActiveWallets();
  console.log(`Found ${wallets.length.toLocaleString()} active wallets\n`);

  if (wallets.length === 0) {
    console.log('No active wallets found. Exiting.\n');
    return;
  }

  // Step 2: Process in batches
  let totalRows = 0;
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      const rows = await processBatch(batch, batchNum, totalBatches);
      totalRows += rows;

      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const rate = (i + batch.length) / (Date.now() - startTime) * 1000 * 60;
      const remaining = wallets.length - (i + batch.length);
      const eta = (remaining / rate).toFixed(0);

      console.log(`\n📊 Progress: ${i + batch.length}/${wallets.length} wallets`);
      console.log(`   Total FIFO rows: ${totalRows.toLocaleString()}`);
      console.log(`   Rate: ${rate.toFixed(0)} wallets/min`);
      console.log(`   Elapsed: ${elapsed} min | ETA: ${eta} min\n`);
    } catch (error: any) {
      console.log(`  ✗ Batch ${batchNum} error: ${error.message}\n`);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n════════════════════════════════════════════════════');
  console.log('✅ FIFO V5 Active Wallets Complete!');
  console.log('════════════════════════════════════════════════════');
  console.log(`Wallets processed: ${wallets.length.toLocaleString()}`);
  console.log(`Total FIFO rows: ${totalRows.toLocaleString()}`);
  console.log(`Duration: ${totalDuration} minutes`);
  console.log('\n🎯 Your leaderboards are now ready!');
  console.log('   Just query: pm_trade_fifo_roi_v3_deduped\n');
}

main().catch(console.error);
