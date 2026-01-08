/**
 * Managed Dedup Rebuild - V3
 *
 * NON-DESTRUCTIVE: Creates new table, never touches pm_trader_events_v2
 * LIVE SYNC: Materialized View captures new data automatically
 * MANAGED: Progress tracking, resume capability, parallel batching
 */
import 'dotenv/config';
import { clickhouse } from '../lib/clickhouse/client';

const NEW_TABLE = 'pm_trader_events_v3';
const STAGING_TABLE = 'pm_trader_events_v3_staging';
const PROGRESS_TABLE = 'pm_trader_events_v3_progress';
const MV_NAME = 'pm_trader_events_v3_mv';

// Config
const PARALLEL_BATCHES = 4;  // Process 4 months concurrently
const MAX_RETRIES = 3;

interface MonthStatus {
  month: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  rows: number;
  error?: string;
}

async function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function setupTables() {
  log('Setting up tables...');

  // Progress tracking table
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${PROGRESS_TABLE} (
        month String,
        status String,
        rows UInt64,
        error String,
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY month
    `
  });

  // Main deduped table with ReplacingMergeTree
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${NEW_TABLE} (
        event_id String,
        trader_wallet LowCardinality(String),
        role LowCardinality(String),
        side LowCardinality(String),
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
      ORDER BY (trader_wallet, trade_time, event_id)
      PARTITION BY toYYYYMM(trade_time)
      SETTINGS index_granularity = 8192
    `
  });

  log('Tables ready.');
}

async function setupLiveSync() {
  log('Setting up live sync (Materialized View)...');

  // Drop existing MV if exists
  try {
    await clickhouse.command({ query: `DROP VIEW IF EXISTS ${MV_NAME}` });
  } catch (e) {}

  // Create MV that captures new inserts and dedupes
  await clickhouse.command({
    query: `
      CREATE MATERIALIZED VIEW ${MV_NAME} TO ${NEW_TABLE}
      AS SELECT
        event_id,
        trader_wallet,
        role,
        side,
        token_id,
        usdc_amount,
        token_amount,
        fee_amount,
        trade_time,
        transaction_hash,
        block_number,
        1 as _version
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
    `
  });

  log('Live sync MV created - new inserts will auto-dedupe.');
}

async function getMonthsToProcess(): Promise<string[]> {
  // Get date range
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

  // Get already processed months
  const doneQ = await clickhouse.query({
    query: `SELECT month FROM ${PROGRESS_TABLE} WHERE status = 'done'`,
    format: 'JSONEachRow'
  });
  const doneMonths = new Set((await doneQ.json() as any[]).map(r => r.month));

  // Generate all months
  const months: string[] = [];
  let current = new Date(range.min_month);
  const end = new Date(range.max_month);

  while (current <= end) {
    const monthStr = current.toISOString().slice(0, 7);
    if (!doneMonths.has(monthStr)) {
      months.push(monthStr);
    }
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

async function processMonth(month: string, retryCount = 0): Promise<MonthStatus> {
  const year = parseInt(month.slice(0, 4));
  const mon = parseInt(month.slice(5, 7));
  const startDate = `${year}-${String(mon).padStart(2, '0')}-01`;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const nextYear = mon === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMon).padStart(2, '0')}-01`;

  try {
    // Mark as processing
    await clickhouse.command({
      query: `INSERT INTO ${PROGRESS_TABLE} (month, status, rows) VALUES ('${month}', 'processing', 0)`
    });

    // Insert with GROUP BY to dedupe (use underscore prefix to avoid alias conflict)
    await clickhouse.command({
      query: `
        INSERT INTO ${NEW_TABLE}
        SELECT
          event_id,
          _trader_wallet as trader_wallet,
          _role as role,
          _side as side,
          _token_id as token_id,
          _usdc_amount as usdc_amount,
          _token_amount as token_amount,
          _fee_amount as fee_amount,
          _trade_time as trade_time,
          _transaction_hash as transaction_hash,
          _block_number as block_number,
          1 as _version
        FROM (
          SELECT
            event_id,
            any(trader_wallet) as _trader_wallet,
            any(role) as _role,
            any(side) as _side,
            any(token_id) as _token_id,
            any(usdc_amount) as _usdc_amount,
            any(token_amount) as _token_amount,
            any(fee_amount) as _fee_amount,
            any(trade_time) as _trade_time,
            any(transaction_hash) as _transaction_hash,
            any(block_number) as _block_number
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
            AND trade_time >= '${startDate}'
            AND trade_time < '${endDate}'
          GROUP BY event_id
        )
      `,
      clickhouse_settings: {
        max_execution_time: 900,  // 15 min per month
        max_memory_usage: 8_000_000_000  // 8GB
      }
    });

    // Get count
    const countQ = await clickhouse.query({
      query: `
        SELECT count() as cnt FROM ${NEW_TABLE}
        WHERE trade_time >= '${startDate}' AND trade_time < '${endDate}'
      `,
      format: 'JSONEachRow'
    });
    const rows = (await countQ.json() as any[])[0]?.cnt || 0;

    // Mark as done
    await clickhouse.command({
      query: `INSERT INTO ${PROGRESS_TABLE} (month, status, rows) VALUES ('${month}', 'done', ${rows})`
    });

    return { month, status: 'done', rows };

  } catch (err: any) {
    if (retryCount < MAX_RETRIES) {
      log(`  ${month} failed, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(r => setTimeout(r, 5000));  // Wait 5s
      return processMonth(month, retryCount + 1);
    }

    const errorMsg = err.message?.slice(0, 200) || 'Unknown error';
    await clickhouse.command({
      query: `INSERT INTO ${PROGRESS_TABLE} (month, status, rows, error) VALUES ('${month}', 'error', 0, '${errorMsg.replace(/'/g, "''")}')`
    });

    return { month, status: 'error', rows: 0, error: errorMsg };
  }
}

async function processBatch(months: string[]): Promise<MonthStatus[]> {
  return Promise.all(months.map(m => processMonth(m)));
}

async function showProgress() {
  const progressQ = await clickhouse.query({
    query: `
      SELECT
        status,
        count() as cnt,
        sum(rows) as total_rows
      FROM ${PROGRESS_TABLE} FINAL
      GROUP BY status
    `,
    format: 'JSONEachRow'
  });
  const progress = await progressQ.json() as any[];

  const done = progress.find(p => p.status === 'done');
  const pending = progress.find(p => p.status === 'pending');
  const error = progress.find(p => p.status === 'error');

  log(`Progress: Done=${done?.cnt || 0} (${(done?.total_rows || 0).toLocaleString()} rows), Pending=${pending?.cnt || 0}, Errors=${error?.cnt || 0}`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     MANAGED DEDUP REBUILD - pm_trader_events_v3            ║');
  console.log('║     Non-destructive • Live sync • Resume-capable           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Step 1: Setup
  await setupTables();

  // Step 2: Get months to process
  const months = await getMonthsToProcess();
  log(`Found ${months.length} months to process\n`);

  if (months.length === 0) {
    log('All months already processed!');
    await showProgress();

    // Setup live sync if not exists
    await setupLiveSync();
    return;
  }

  // Step 3: Process in parallel batches
  const startTime = Date.now();
  let processed = 0;

  for (let i = 0; i < months.length; i += PARALLEL_BATCHES) {
    const batch = months.slice(i, i + PARALLEL_BATCHES);
    log(`Processing batch ${Math.floor(i / PARALLEL_BATCHES) + 1}: ${batch.join(', ')}`);

    const results = await processBatch(batch);

    for (const r of results) {
      if (r.status === 'done') {
        log(`  ✓ ${r.month}: ${r.rows.toLocaleString()} rows`);
      } else {
        log(`  ✗ ${r.month}: ${r.error}`);
      }
    }

    processed += batch.length;
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const remaining = (months.length - processed) / rate;

    log(`Progress: ${processed}/${months.length} months (${Math.round(elapsed)}s elapsed, ~${Math.round(remaining)}s remaining)\n`);
  }

  // Step 4: Setup live sync
  await setupLiveSync();

  // Step 5: Final stats
  log('\n=== FINAL STATS ===');
  await showProgress();

  const totalQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${NEW_TABLE}`,
    format: 'JSONEachRow'
  });
  const total = (await totalQ.json() as any[])[0]?.cnt || 0;
  log(`Total rows in ${NEW_TABLE}: ${total.toLocaleString()}`);

  const rawQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0`,
    format: 'JSONEachRow'
  });
  const raw = (await rawQ.json() as any[])[0]?.cnt || 0;

  log(`Dedup ratio: ${raw.toLocaleString()} → ${total.toLocaleString()} (${(raw / total).toFixed(2)}x reduction)`);

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  REBUILD COMPLETE                                          ║');
  console.log('║  • New table: pm_trader_events_v3                          ║');
  console.log('║  • Live sync: Materialized View active                     ║');
  console.log('║  • Original table: UNCHANGED                               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
