/**
 * Build Properly Deduped Trader Events Table - V3
 *
 * Strategy: Batch by month to avoid memory limits, use ReplacingMergeTree
 *
 * Unique key: event_id (already unique per fill)
 *
 * Why duplicates exist:
 * - Multiple backfills inserted same events
 * - SharedMergeTree doesn't dedupe automatically
 *
 * Solution:
 * 1. Create new table with ReplacingMergeTree (auto-dedupes on OPTIMIZE)
 * 2. Insert data month-by-month with GROUP BY event_id
 * 3. Run OPTIMIZE FINAL to force deduplication
 * 4. Rename tables atomically
 */
import 'dotenv/config';
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== BUILD DEDUPED TRADER EVENTS V3 ===\n');

  // Step 1: Create new table with ReplacingMergeTree
  console.log('Step 1: Creating new table with ReplacingMergeTree...');

  await clickhouse.command({
    query: `
      DROP TABLE IF EXISTS pm_trader_events_v3_new
    `
  });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_trader_events_v3_new (
        event_id String,
        trader_wallet String,
        role String,
        side String,
        token_id String,
        usdc_amount Float64,
        token_amount Float64,
        fee_amount Float64,
        trade_time DateTime,
        transaction_hash String,
        block_number UInt64,
        trade_date Date MATERIALIZED toDate(trade_time),
        _version UInt64 DEFAULT 1
      )
      ENGINE = ReplacingMergeTree(_version)
      ORDER BY (event_id)
      PARTITION BY toYYYYMM(trade_time)
      SETTINGS index_granularity = 8192
    `
  });

  console.log('Table created.\n');

  // Step 2: Get date range for batching
  console.log('Step 2: Getting date range...');
  const rangeQ = await clickhouse.query({
    query: `
      SELECT
        toStartOfMonth(min(trade_time)) as min_month,
        toStartOfMonth(max(trade_time)) as max_month
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const range = (await rangeQ.json() as any[])[0];
  console.log(`Date range: ${range.min_month} to ${range.max_month}\n`);

  // Generate month list
  const months: string[] = [];
  let current = new Date(range.min_month);
  const end = new Date(range.max_month);

  while (current <= end) {
    months.push(current.toISOString().slice(0, 7)); // YYYY-MM
    current.setMonth(current.getMonth() + 1);
  }

  console.log(`Processing ${months.length} months...\n`);

  // Step 3: Insert data month by month with dedup
  let totalInserted = 0;

  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    const year = parseInt(month.slice(0, 4));
    const mon = parseInt(month.slice(5, 7));

    const startDate = `${year}-${String(mon).padStart(2, '0')}-01`;
    const nextMon = mon === 12 ? 1 : mon + 1;
    const nextYear = mon === 12 ? year + 1 : year;
    const endDate = `${nextYear}-${String(nextMon).padStart(2, '0')}-01`;

    console.log(`[${i + 1}/${months.length}] Processing ${month}...`);

    try {
      // Insert with GROUP BY to dedupe
      await clickhouse.command({
        query: `
          INSERT INTO pm_trader_events_v3_new
          SELECT
            event_id,
            any(trader_wallet) as trader_wallet,
            any(role) as role,
            any(side) as side,
            any(token_id) as token_id,
            any(usdc_amount) as usdc_amount,
            any(token_amount) as token_amount,
            any(fee_amount) as fee_amount,
            any(trade_time) as trade_time,
            any(transaction_hash) as transaction_hash,
            any(block_number) as block_number,
            1 as _version
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
            AND trade_time >= '${startDate}'
            AND trade_time < '${endDate}'
          GROUP BY event_id
        `,
        clickhouse_settings: {
          max_execution_time: 600,  // 10 minutes per month
          max_memory_usage: 10_000_000_000  // 10GB
        }
      });

      // Get count for this month
      const countQ = await clickhouse.query({
        query: `
          SELECT count() as cnt
          FROM pm_trader_events_v3_new
          WHERE trade_time >= '${startDate}' AND trade_time < '${endDate}'
        `,
        format: 'JSONEachRow'
      });
      const count = (await countQ.json() as any[])[0]?.cnt || 0;
      totalInserted += count;

      console.log(`  Inserted ${count.toLocaleString()} events (total: ${totalInserted.toLocaleString()})`);

    } catch (err: any) {
      console.error(`  ERROR: ${err.message?.slice(0, 200)}`);
      // Continue with next month
    }
  }

  console.log(`\nTotal inserted: ${totalInserted.toLocaleString()}\n`);

  // Step 4: Run OPTIMIZE to force deduplication
  console.log('Step 4: Running OPTIMIZE FINAL...');
  try {
    await clickhouse.command({
      query: 'OPTIMIZE TABLE pm_trader_events_v3_new FINAL',
      clickhouse_settings: {
        max_execution_time: 3600  // 1 hour
      }
    });
    console.log('OPTIMIZE complete.\n');
  } catch (err: any) {
    console.log('OPTIMIZE may take time, continuing...', err.message?.slice(0, 100));
  }

  // Step 5: Verify counts
  console.log('Step 5: Verifying...');
  const finalQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_trader_events_v3_new',
    format: 'JSONEachRow'
  });
  const finalCount = (await finalQ.json() as any[])[0]?.cnt || 0;

  const dupCheckQ = await clickhouse.query({
    query: `
      SELECT count() as total, uniqExact(event_id) as unique_ids
      FROM pm_trader_events_v3_new
      LIMIT 1
    `,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });

  try {
    const dupCheck = (await dupCheckQ.json() as any[])[0];
    console.log(`Final count: ${finalCount.toLocaleString()}`);
    console.log(`Unique event_ids: ${dupCheck?.unique_ids?.toLocaleString() || 'N/A'}`);
    console.log(`Dup factor: ${(finalCount / (dupCheck?.unique_ids || 1)).toFixed(2)}x`);
  } catch (e) {
    console.log(`Final count: ${finalCount.toLocaleString()}`);
    console.log('Could not verify unique count (memory limit)');
  }

  console.log('\n=== NEXT STEPS ===');
  console.log('1. Verify the new table has correct data');
  console.log('2. Run: RENAME TABLE pm_trader_events_v2 TO pm_trader_events_v2_backup, pm_trader_events_v3_new TO pm_trader_events_v3');
  console.log('3. Update code to use pm_trader_events_v3');
  console.log('4. After validation, drop backup table');
}

main().catch(console.error);
