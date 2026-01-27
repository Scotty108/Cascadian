#!/usr/bin/env tsx
/**
 * Rebuild FIFO Table - Deduplicated
 *
 * Rebuilds pm_trade_fifo_roi_v3 with deduplication to eliminate 200M+ duplicate rows.
 *
 * Root cause: refresh-fifo-trades cron was checking only 48-hour window, causing
 * conditions to be reprocessed multiple times (48x for some positions).
 *
 * Strategy:
 * 1. Create new table with same schema
 * 2. Populate with deduplicated data (GROUP BY wallet, condition_id, outcome_index)
 * 3. Atomic swap (RENAME)
 *
 * Expected result: 278M rows → ~78M rows (64% reduction)
 * Duration: 15-20 minutes
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('🔨 FIFO Table Rebuild - Deduplication\n');
  console.log('This will take 15-20 minutes...\n');

  const startTime = Date.now();

  try {
    // Step 1: Create new table with same schema
    console.log('Step 1: Creating new table...');
    await clickhouse.command({
      query: `
        CREATE TABLE pm_trade_fifo_roi_v3_new (
          tx_hash String,
          wallet LowCardinality(String),
          condition_id String,
          outcome_index UInt8,
          entry_time DateTime,
          tokens Float64,
          cost_usd Float64,
          tokens_sold_early Float64,
          tokens_held Float64,
          exit_value Float64,
          pnl_usd Float64,
          roi Float64,
          pct_sold_early Float64,
          is_maker UInt8,
          resolved_at DateTime,
          is_short UInt8 DEFAULT 0
        )
        ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
        PARTITION BY toYYYYMM(resolved_at)
        ORDER BY (wallet, condition_id, outcome_index, tx_hash)
        SETTINGS index_granularity = 8192
      `,
      clickhouse_settings: {
        max_execution_time: 60,
      },
    });
    console.log('✓ New table created\n');

    // Step 2: Populate with deduplicated data (month by month to avoid memory limits)
    console.log('Step 2: Populating with deduplicated data...');
    console.log('(Processing month-by-month to avoid memory limits - 20-25 minutes)');

    // Get all partition months
    const partitionsResult = await clickhouse.query({
      query: `SELECT DISTINCT toYYYYMM(resolved_at) as partition FROM pm_trade_fifo_roi_v3 ORDER BY partition`,
      format: 'JSONEachRow',
    });
    const partitions = (await partitionsResult.json()) as { partition: string }[];

    console.log(`Found ${partitions.length} monthly partitions to process\n`);

    // Process each month separately
    let processedMonths = 0;
    for (const { partition } of partitions) {
      const year = Math.floor(parseInt(partition) / 100);
      const month = parseInt(partition) % 100;

      console.log(`Processing ${year}-${month.toString().padStart(2, '0')}...`);

      await clickhouse.command({
        query: `
          INSERT INTO pm_trade_fifo_roi_v3_new
          SELECT
            any(tx_hash) as tx_hash,
            wallet,
            condition_id,
            outcome_index,
            any(entry_time) as entry_time,
            any(tokens) as tokens,
            any(cost_usd) as cost_usd,
            any(tokens_sold_early) as tokens_sold_early,
            any(tokens_held) as tokens_held,
            any(exit_value) as exit_value,
            any(pnl_usd) as pnl_usd,
            any(roi) as roi,
            any(pct_sold_early) as pct_sold_early,
            any(is_maker) as is_maker,
            any(resolved_at) as resolved_at,
            any(is_short) as is_short
          FROM pm_trade_fifo_roi_v3
          WHERE toYYYYMM(resolved_at) = ${partition}
          GROUP BY wallet, condition_id, outcome_index
        `,
        clickhouse_settings: {
          max_execution_time: 600, // 10 minutes per month
          max_memory_usage: 8000000000, // 8GB per month
          max_threads: 6,
        },
      });

      processedMonths++;
      const progress = ((processedMonths / partitions.length) * 100).toFixed(0);
      console.log(`✓ ${year}-${month.toString().padStart(2, '0')} complete (${progress}%)\n`);
    }

    const populateDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`✓ All data populated (${populateDuration} min)\n`);

    // Step 3: Get row counts
    console.log('Step 3: Verifying counts...');

    const oldCountResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM pm_trade_fifo_roi_v3',
      format: 'JSONEachRow',
    });
    const oldCount = (await oldCountResult.json())[0].count;

    const newCountResult = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM pm_trade_fifo_roi_v3_new',
      format: 'JSONEachRow',
    });
    const newCount = (await newCountResult.json())[0].count;

    const reduction = ((1 - newCount / oldCount) * 100).toFixed(1);

    console.log(`Old table: ${oldCount.toLocaleString()} rows`);
    console.log(`New table: ${newCount.toLocaleString()} rows`);
    console.log(`Reduction: ${reduction}% (${(oldCount - newCount).toLocaleString()} duplicates removed)\n`);

    // Step 4: Atomic swap
    console.log('Step 4: Atomic table swap...');

    // Rename old to backup
    await clickhouse.command({
      query: 'RENAME TABLE pm_trade_fifo_roi_v3 TO pm_trade_fifo_roi_v3_backup_20260127',
      clickhouse_settings: { max_execution_time: 60 },
    });

    // Rename new to production
    await clickhouse.command({
      query: 'RENAME TABLE pm_trade_fifo_roi_v3_new TO pm_trade_fifo_roi_v3',
      clickhouse_settings: { max_execution_time: 60 },
    });

    console.log('✓ Tables swapped atomically\n');

    const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log('════════════════════════════════════════════════════');
    console.log('✅ FIFO Table Rebuild Complete!');
    console.log('════════════════════════════════════════════════════');
    console.log(`Duration: ${totalDuration} minutes`);
    console.log(`Rows removed: ${(oldCount - newCount).toLocaleString()} (${reduction}%)`);
    console.log(`New table size: ${newCount.toLocaleString()} rows`);
    console.log('\nBackup table: pm_trade_fifo_roi_v3_backup_20260127');
    console.log('(Can be dropped after verification)');
    console.log('\nNext steps:');
    console.log('1. Verify wallet PnL matches Polymarket');
    console.log('2. Deploy updated refresh-fifo-trades cron (already committed)');
    console.log('3. Drop backup table after 24h if all looks good\n');

  } catch (error: any) {
    console.error('\n❌ Error during rebuild:', error.message);
    console.error('\nAttempting rollback...');

    try {
      // Try to restore from backup if swap happened
      await clickhouse.command({
        query: 'RENAME TABLE pm_trade_fifo_roi_v3 TO pm_trade_fifo_roi_v3_failed',
        clickhouse_settings: { max_execution_time: 60 },
      }).catch(() => {}); // Ignore if doesn't exist

      await clickhouse.command({
        query: 'RENAME TABLE pm_trade_fifo_roi_v3_backup_20260127 TO pm_trade_fifo_roi_v3',
        clickhouse_settings: { max_execution_time: 60 },
      }).catch(() => {}); // Ignore if doesn't exist

      console.log('✓ Rollback successful');
    } catch (rollbackError) {
      console.error('❌ Rollback failed - manual intervention needed!');
    }

    throw error;
  }
}

main().catch(console.error);
