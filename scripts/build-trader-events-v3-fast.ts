/**
 * FAST Dedup Rebuild - V3
 * Optimized for speed: weekly chunks, no parallelism (more reliable), resume-capable
 */
import 'dotenv/config';
import { clickhouse } from '../lib/clickhouse/client';

const NEW_TABLE = 'pm_trader_events_v3';
const PROGRESS_TABLE = 'pm_trader_events_v3_progress';
const MV_NAME = 'pm_trader_events_v3_mv';

async function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function setupTables() {
  log('Setting up tables...');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${PROGRESS_TABLE} (
        week_start Date,
        status String,
        rows UInt64,
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY week_start
    `
  });

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

async function getWeeksToProcess(): Promise<string[]> {
  // Get all weeks
  const weeksQ = await clickhouse.query({
    query: `
      SELECT DISTINCT toStartOfWeek(trade_time) as week_start
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      ORDER BY week_start
    `,
    format: 'JSONEachRow'
  });
  const allWeeks = (await weeksQ.json() as any[]).map(r => r.week_start.slice(0, 10));

  // Get done weeks
  const doneQ = await clickhouse.query({
    query: `SELECT toString(week_start) as ws FROM ${PROGRESS_TABLE} FINAL WHERE status = 'done'`,
    format: 'JSONEachRow'
  });
  const doneWeeks = new Set((await doneQ.json() as any[]).map(r => r.ws.slice(0, 10)));

  return allWeeks.filter(w => !doneWeeks.has(w));
}

async function processWeek(weekStart: string): Promise<{ rows: number; error?: string }> {
  const startDate = weekStart;
  const endDate = new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
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
        max_execution_time: 600,
        max_memory_usage: 12_000_000_000,  // 12GB
        max_bytes_before_external_group_by: 5_000_000_000  // Spill to disk if needed
      }
    });

    // Get count
    const countQ = await clickhouse.query({
      query: `SELECT count() as cnt FROM ${NEW_TABLE} WHERE trade_time >= '${startDate}' AND trade_time < '${endDate}'`,
      format: 'JSONEachRow'
    });
    const rows = (await countQ.json() as any[])[0]?.cnt || 0;

    // Mark done
    await clickhouse.command({
      query: `INSERT INTO ${PROGRESS_TABLE} (week_start, status, rows) VALUES ('${startDate}', 'done', ${rows})`
    });

    return { rows };

  } catch (err: any) {
    const error = err.message?.slice(0, 150) || 'Unknown error';
    await clickhouse.command({
      query: `INSERT INTO ${PROGRESS_TABLE} (week_start, status, rows) VALUES ('${startDate}', 'error', 0)`
    });
    return { rows: 0, error };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     FAST DEDUP REBUILD - Weekly chunks, sequential         ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await setupTables();

  const weeks = await getWeeksToProcess();
  log(`Found ${weeks.length} weeks to process`);

  if (weeks.length === 0) {
    log('All weeks done!');
    return;
  }

  const startTime = Date.now();
  let totalRows = 0;
  let errors = 0;

  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    const result = await processWeek(week);

    if (result.error) {
      log(`✗ ${week}: ${result.error}`);
      errors++;
    } else {
      totalRows += result.rows;
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = totalRows / elapsed;
      const remaining = weeks.length - i - 1;
      const eta = remaining > 0 ? Math.round((remaining * elapsed) / (i + 1)) : 0;

      log(`✓ ${week}: ${result.rows.toLocaleString()} rows | Total: ${totalRows.toLocaleString()} | ETA: ${Math.round(eta / 60)}m`);
    }

    // Progress every 10 weeks
    if ((i + 1) % 10 === 0) {
      const pct = ((i + 1) / weeks.length * 100).toFixed(1);
      log(`--- Progress: ${i + 1}/${weeks.length} weeks (${pct}%) ---`);
    }
  }

  // Final stats
  log('\n=== COMPLETE ===');
  const finalQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${NEW_TABLE}`,
    format: 'JSONEachRow'
  });
  const finalCount = (await finalQ.json() as any[])[0]?.cnt || 0;

  log(`Total rows: ${finalCount.toLocaleString()}`);
  log(`Errors: ${errors}`);
  log(`Time: ${Math.round((Date.now() - startTime) / 60000)} minutes`);

  // Setup live sync
  log('Setting up live sync MV...');
  try {
    await clickhouse.command({ query: `DROP VIEW IF EXISTS ${MV_NAME}` });
    await clickhouse.command({
      query: `
        CREATE MATERIALIZED VIEW ${MV_NAME} TO ${NEW_TABLE}
        AS SELECT
          event_id, trader_wallet, role, side, token_id,
          usdc_amount, token_amount, fee_amount, trade_time,
          transaction_hash, block_number, 1 as _version
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
      `
    });
    log('Live sync MV created.');
  } catch (e: any) {
    log('MV creation failed: ' + e.message?.slice(0, 100));
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
