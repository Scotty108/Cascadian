/**
 * Backfill order_id for existing FIFO tables
 *
 * Uses ReplacingMergeTree deduplication: INSERT new rows with order_id populated,
 * they'll replace old rows with empty order_id during merge (same sort key).
 *
 * Uses adaptive batch sizing based on volume:
 * - Monthly for data before Jul 2024
 * - 2-week for Jul-Sep 2024
 * - Weekly for Oct 2024 - Sep 2025
 * - 4-day for Oct 2025 onward (highest volume)
 *
 * Run: npx tsx scripts/backfill-order-id.ts
 */

import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const host = process.env.CLICKHOUSE_HOST || '';
const url = host.startsWith('http') ? host : `https://${host}:8443`;

const client = createClient({
  url,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 3600000,
  clickhouse_settings: {
    max_execution_time: 7200,
  },
});

// Batch size thresholds (adjusted for actual volumes)
const HIGH_VOLUME_THRESHOLD = new Date('2024-07-01');      // 2-week batches
const VERY_HIGH_VOLUME_THRESHOLD = new Date('2024-10-01'); // Weekly batches
const EXTREME_VOLUME_THRESHOLD = new Date('2025-10-01');   // 4-day batches
const ULTRA_VOLUME_THRESHOLD = new Date('2026-01-01');     // 2-day batches

async function backfillTable(tableName: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Backfilling order_id for ${tableName}...`);
  console.log('='.repeat(60));

  const startTime = Date.now();

  // Check current stats
  const statsResult = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(order_id != '') as with_order_id,
        countIf(order_id = '' AND is_short = 0) as longs_without_order_id
      FROM ${tableName}
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsResult.json()) as any[];
  console.log(`Current stats:`, stats[0]);

  const longsToUpdate = parseInt(stats[0].longs_without_order_id);
  if (longsToUpdate === 0) {
    console.log('All LONG positions already have order_id. Skipping.');
    return;
  }

  // Determine if table is unified (different column order)
  const isUnified = tableName.includes('unified');

  // Get date range - only for rows still needing order_id
  const dateRangeResult = await client.query({
    query: `
      SELECT
        toDate(min(entry_time)) as min_date,
        toDate(max(entry_time)) as max_date
      FROM ${tableName}
      WHERE order_id = '' AND is_short = 0
    `,
    format: 'JSONEachRow',
  });
  const dateRange = (await dateRangeResult.json()) as any[];
  const minDate = new Date(dateRange[0].min_date);
  const maxDate = new Date(dateRange[0].max_date);

  console.log(`\nProcessing: ${minDate.toISOString().split('T')[0]} to ${maxDate.toISOString().split('T')[0]}`);
  console.log(`Batch sizes: monthly <Jul'24, 2-week <Oct'24, weekly <Oct'25, 4-day <Jan'26, 2-day after`);

  // Build columns for SELECT (order matters - must match table schema)
  const columns = isUnified
    ? `f.tx_hash, COALESCE(l.order_id, '') as order_id, f.wallet, f.condition_id,
       f.outcome_index, f.entry_time, f.resolved_at, f.tokens, f.cost_usd,
       f.tokens_sold_early, f.tokens_held, f.exit_value, f.pnl_usd, f.roi,
       f.pct_sold_early, f.is_maker, f.is_closed, f.is_short`
    : `f.tx_hash, COALESCE(l.order_id, '') as order_id, f.wallet, f.condition_id,
       f.outcome_index, f.entry_time, f.tokens, f.cost_usd, f.tokens_sold_early,
       f.tokens_held, f.exit_value, f.pnl_usd, f.roi, f.pct_sold_early, f.is_maker,
       f.resolved_at, f.is_short, f.is_closed`;

  // Process in batches
  let currentDate = new Date(minDate);
  let batchNum = 0;
  let totalInserted = 0;

  while (currentDate <= maxDate) {
    const startDate = currentDate.toISOString().split('T')[0];

    // Determine batch size based on date
    const nextDate = new Date(currentDate);
    if (currentDate >= ULTRA_VOLUME_THRESHOLD) {
      nextDate.setDate(nextDate.getDate() + 2); // 2 days
    } else if (currentDate >= EXTREME_VOLUME_THRESHOLD) {
      nextDate.setDate(nextDate.getDate() + 4); // 4 days
    } else if (currentDate >= VERY_HIGH_VOLUME_THRESHOLD) {
      nextDate.setDate(nextDate.getDate() + 7); // 1 week
    } else if (currentDate >= HIGH_VOLUME_THRESHOLD) {
      nextDate.setDate(nextDate.getDate() + 14); // 2 weeks
    } else {
      nextDate.setMonth(nextDate.getMonth() + 1); // 1 month
    }
    const endDate = nextDate.toISOString().split('T')[0];

    batchNum++;

    // Count rows in this batch
    const countResult = await client.query({
      query: `
        SELECT count() as cnt
        FROM ${tableName}
        WHERE order_id = ''
          AND is_short = 0
          AND entry_time >= '${startDate}'
          AND entry_time < '${endDate}'
      `,
      format: 'JSONEachRow',
    });
    const batchCount = parseInt(((await countResult.json()) as any)[0]?.cnt || '0');

    if (batchCount === 0) {
      currentDate = nextDate;
      continue;
    }

    console.log(`\nBatch ${batchNum}: ${startDate} to ${endDate} - ${batchCount.toLocaleString()} rows`);

    // Step 1: Create lookup table for this batch
    console.log('  Creating lookup table...');
    await client.command({ query: `DROP TABLE IF EXISTS tmp_order_id_lookup` });

    await client.command({
      query: `
        CREATE TABLE tmp_order_id_lookup
        ENGINE = MergeTree()
        ORDER BY tx_hash
        AS
        SELECT
          tx_hash,
          any(splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1]) as order_id
        FROM pm_canonical_fills_v4
        WHERE source = 'clob'
          AND tx_hash != ''
          AND fill_id != ''
          AND event_time >= '${startDate}'
          AND event_time < '${endDate}'
        GROUP BY tx_hash
      `,
      clickhouse_settings: { max_execution_time: 600 },
    });

    // Step 2: Insert rows with order_id (ReplacingMergeTree will dedupe)
    console.log('  Inserting rows with order_id...');
    await client.command({
      query: `
        INSERT INTO ${tableName}
        SELECT ${columns}
        FROM ${tableName} f
        INNER JOIN tmp_order_id_lookup l ON f.tx_hash = l.tx_hash
        WHERE f.order_id = ''
          AND f.is_short = 0
          AND f.entry_time >= '${startDate}'
          AND f.entry_time < '${endDate}'
          AND l.order_id != ''
      `,
      clickhouse_settings: { max_execution_time: 600 },
    });

    // Cleanup lookup table
    await client.command({ query: `DROP TABLE IF EXISTS tmp_order_id_lookup` });

    totalInserted += batchCount;
    currentDate = nextDate;
    console.log('  Done');
  }

  console.log('\nRunning OPTIMIZE FINAL to deduplicate...');
  await client.command({
    query: `OPTIMIZE TABLE ${tableName} FINAL`,
    clickhouse_settings: { max_execution_time: 3600 },
  });

  const duration = (Date.now() - startTime) / 1000;
  console.log(`\nBackfill complete in ${duration.toFixed(1)}s`);

  // Verify
  const finalResult = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(order_id != '') as with_order_id,
        countIf(order_id = '' AND is_short = 0) as longs_missing
      FROM ${tableName}
    `,
    format: 'JSONEachRow',
  });
  const final = (await finalResult.json()) as any[];
  console.log('Final stats:', final[0]);
}

async function main() {
  console.log('Starting order_id backfill (adjusted thresholds for volumes)...\n');
  const startTime = Date.now();

  try {
    await backfillTable('pm_trade_fifo_roi_v3');
    await backfillTable('pm_trade_fifo_roi_v3_mat_unified');

    // Cleanup
    await client.command({ query: 'DROP TABLE IF EXISTS tmp_order_id_lookup' }).catch(() => {});

    console.log(`\nAll done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  } catch (error) {
    console.error('Failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
