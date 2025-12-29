/**
 * ============================================================================
 * MATERIALIZE PM_UNIFIED_LEDGER_V8 INTO A TABLE (RESILIENT VERSION)
 * ============================================================================
 *
 * The V8 VIEW is too slow for wallet-level queries because it computes the
 * join on every access. This script materializes it into a TABLE with an
 * ORDER BY optimized for wallet lookups.
 *
 * FEATURES:
 * - Small 3-day chunks (fallback to 1-day if needed)
 * - Retry with exponential backoff per chunk (3 attempts)
 * - Resume support via progress file (tmp/materialize-v8-progress.json)
 * - Fast-path if table exists with data (only backfill recent 14 days)
 * - Fallback to 90-day recent-only backfill if historical fails
 *
 * Run: npx tsx scripts/pnl/materialize-v8-ledger.ts
 *
 * Terminal: Claude 1
 * Date: 2025-12-05
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const TABLE_NAME = 'pm_unified_ledger_v8_tbl';
const VIEW_NAME = 'pm_unified_ledger_v8';
const PROGRESS_FILE = path.join(process.cwd(), 'tmp', 'materialize-v8-progress.json');

// Chunk settings
const DEFAULT_CHUNK_DAYS = 3;
const FALLBACK_CHUNK_DAYS = 1;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [3000, 10000, 30000]; // 3s, 10s, 30s

// Fast-path settings
const RECENT_BACKFILL_DAYS = 14;
const FALLBACK_RECENT_ONLY_DAYS = 90;

// ============================================================================
// Progress Tracking
// ============================================================================

interface Progress {
  lastCompletedDate: string | null;
  chunkDays: number;
  totalRowsInserted: number;
  startedAt: string;
  lastUpdatedAt: string;
  mode: 'full' | 'recent-only';
}

function loadProgress(): Progress | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch {}
  return null;
}

function saveProgress(progress: Progress): void {
  try {
    const dir = path.dirname(PROGRESS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch (err: any) {
    console.log(`  Warning: Could not save progress: ${err.message}`);
  }
}

function clearProgress(): void {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
    }
  } catch {}
}

// ============================================================================
// SQL Statements
// ============================================================================

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE_NAME}
(
    source_type String,
    wallet_address String,
    condition_id String,
    outcome_index Int64,
    event_time DateTime,
    event_id String,
    usdc_delta Float64,
    token_delta Float64,
    payout_numerators Nullable(String),
    payout_norm Nullable(Float64)
)
ENGINE = MergeTree()
ORDER BY (wallet_address, event_time, event_id)
SETTINGS index_granularity = 8192
`;

const DROP_TABLE_SQL = `DROP TABLE IF EXISTS ${TABLE_NAME}`;

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function getTableRowCount(): Promise<number> {
  try {
    const result = await clickhouse.query({
      query: `SELECT count() as cnt FROM ${TABLE_NAME}`,
      format: 'JSONEachRow',
    });
    const rows = (await result.json()) as any[];
    return Number(rows[0]?.cnt || 0);
  } catch {
    return 0;
  }
}

async function tableExists(): Promise<boolean> {
  try {
    await clickhouse.query({
      query: `SELECT 1 FROM ${TABLE_NAME} LIMIT 1`,
      format: 'JSONEachRow',
    });
    return true;
  } catch {
    return false;
  }
}

async function getDateRange(): Promise<{ minDate: Date; maxDate: Date }> {
  const query = `
    SELECT
      min(trade_time) as min_date,
      max(trade_time) as max_date
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return {
    minDate: new Date(rows[0].min_date),
    maxDate: new Date(rows[0].max_date),
  };
}

/**
 * Insert CLOB trades directly from pm_trader_events_v2 (bypasses VIEW)
 * Uses two-phase approach: first create temp table for date range, then join & insert.
 */
async function insertCLOBChunk(startDate: string, endDate: string): Promise<number> {
  // Use a subquery with unique aliases to avoid column name conflicts
  const insertQuery = `
    INSERT INTO ${TABLE_NAME}
    SELECT
      'CLOB' AS source_type,
      agg.wallet_addr AS wallet_address,
      map.condition_id AS condition_id,
      map.outcome_index AS outcome_index,
      agg.ev_time AS event_time,
      agg.ev_id AS event_id,
      if(agg.trade_side = 'buy', -agg.usdc_amt, agg.usdc_amt) AS usdc_delta,
      if(agg.trade_side = 'buy', agg.token_amt, -agg.token_amt) AS token_delta,
      res.payout_numerators AS payout_numerators,
      if(
        res.payout_numerators IS NOT NULL,
        if(
          JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000,
          1,
          JSONExtractInt(res.payout_numerators, map.outcome_index + 1)
        ),
        NULL
      ) AS payout_norm
    FROM (
      -- Use the normalized view which:
      -- 1. Includes BOTH maker AND taker events (no role filter)
      -- 2. Deduplicates by (event_id, trader_wallet) to handle backfill duplicates
      -- See: scripts/pnl/create-normalized-trader-events-view.ts
      SELECT
        event_id AS ev_id,
        trader_wallet AS wallet_addr,
        side AS trade_side,
        usdc_amount / 1000000.0 AS usdc_amt,
        token_amount / 1000000.0 AS token_amt,
        trade_time AS ev_time,
        token_id AS tok_id
      FROM vw_pm_trader_events_wallet_dedup_v1
      WHERE trade_time >= '${startDate}'
        AND trade_time < '${endDate}'
    ) AS agg
    LEFT JOIN pm_token_to_condition_map_v5 AS map ON agg.tok_id = map.token_id_dec
    LEFT JOIN pm_condition_resolutions AS res ON map.condition_id = res.condition_id
    WHERE map.condition_id IS NOT NULL AND map.condition_id != ''
  `;

  await clickhouse.command({
    query: insertQuery,
    clickhouse_settings: {
      max_execution_time: 600,
      max_threads: 4,
    },
  });

  // Get count for this chunk
  const countQuery = `
    SELECT count() as cnt
    FROM ${TABLE_NAME}
    WHERE source_type = 'CLOB'
      AND event_time >= '${startDate}'
      AND event_time < '${endDate}'
  `;
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countRows = (await countResult.json()) as any[];
  return Number(countRows[0]?.cnt || 0);
}

/**
 * Insert CTF events directly from pm_ctf_events (bypasses VIEW)
 */
async function insertCTFChunk(startDate: string, endDate: string): Promise<number> {
  // Insert PositionSplit events
  const splitQuery = `
    INSERT INTO ${TABLE_NAME}
    SELECT
      'PositionSplit' AS source_type,
      c.user_address AS wallet_address,
      c.condition_id AS condition_id,
      0 AS outcome_index,
      c.event_timestamp AS event_time,
      c.id AS event_id,
      -toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_delta,
      toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS token_delta,
      r.payout_numerators AS payout_numerators,
      NULL AS payout_norm
    FROM pm_ctf_events AS c
    LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
    WHERE c.is_deleted = 0
      AND c.event_type = 'PositionSplit'
      AND c.event_timestamp >= '${startDate}'
      AND c.event_timestamp < '${endDate}'
      AND c.condition_id IS NOT NULL
      AND c.condition_id != ''
  `;

  await clickhouse.command({
    query: splitQuery,
    clickhouse_settings: { max_execution_time: 300, max_threads: 4 },
  });

  // Insert PositionsMerge events
  const mergeQuery = `
    INSERT INTO ${TABLE_NAME}
    SELECT
      'PositionsMerge' AS source_type,
      c.user_address AS wallet_address,
      c.condition_id AS condition_id,
      0 AS outcome_index,
      c.event_timestamp AS event_time,
      c.id AS event_id,
      toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_delta,
      -toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS token_delta,
      r.payout_numerators AS payout_numerators,
      NULL AS payout_norm
    FROM pm_ctf_events AS c
    LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
    WHERE c.is_deleted = 0
      AND c.event_type = 'PositionsMerge'
      AND c.event_timestamp >= '${startDate}'
      AND c.event_timestamp < '${endDate}'
      AND c.condition_id IS NOT NULL
      AND c.condition_id != ''
  `;

  await clickhouse.command({
    query: mergeQuery,
    clickhouse_settings: { max_execution_time: 300, max_threads: 4 },
  });

  // Insert PayoutRedemption events
  const redemptionQuery = `
    INSERT INTO ${TABLE_NAME}
    SELECT
      'PayoutRedemption' AS source_type,
      c.user_address AS wallet_address,
      c.condition_id AS condition_id,
      0 AS outcome_index,
      c.event_timestamp AS event_time,
      c.id AS event_id,
      toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_delta,
      -toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS token_delta,
      r.payout_numerators AS payout_numerators,
      1 AS payout_norm
    FROM pm_ctf_events AS c
    LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
    WHERE c.is_deleted = 0
      AND c.event_type = 'PayoutRedemption'
      AND c.event_timestamp >= '${startDate}'
      AND c.event_timestamp < '${endDate}'
      AND c.condition_id IS NOT NULL
      AND c.condition_id != ''
  `;

  await clickhouse.command({
    query: redemptionQuery,
    clickhouse_settings: { max_execution_time: 300, max_threads: 4 },
  });

  // Get count for CTF events in this chunk
  const countQuery = `
    SELECT count() as cnt
    FROM ${TABLE_NAME}
    WHERE source_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
      AND event_time >= '${startDate}'
      AND event_time < '${endDate}'
  `;
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countRows = (await countResult.json()) as any[];
  return Number(countRows[0]?.cnt || 0);
}

/**
 * Insert both CLOB and CTF data for a chunk
 */
async function insertChunk(startDate: string, endDate: string): Promise<number> {
  const clobCount = await insertCLOBChunk(startDate, endDate);
  const ctfCount = await insertCTFChunk(startDate, endDate);
  return clobCount + ctfCount;
}

async function backfillChunkWithRetry(
  startDate: Date,
  endDate: Date,
  chunkNum: number,
  chunkDays: number
): Promise<{ success: boolean; rowCount: number; error?: string }> {
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      process.stdout.write(`  Chunk ${chunkNum} (${startStr} to ${endStr}), attempt ${attempt}/${MAX_RETRIES}...`);
      const rowCount = await insertChunk(startStr, endStr);
      console.log(` ${rowCount.toLocaleString()} rows`);
      return { success: true, rowCount };
    } catch (err: any) {
      const errorMsg = err.message?.slice(0, 100) || 'Unknown error';
      console.log(` FAILED: ${errorMsg}`);

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt - 1];
        console.log(`    Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      } else {
        return { success: false, rowCount: 0, error: errorMsg };
      }
    }
  }

  return { success: false, rowCount: 0 };
}

// ============================================================================
// Main Backfill Logic
// ============================================================================

async function runBackfill(
  startDate: Date,
  endDate: Date,
  chunkDays: number,
  progress: Progress
): Promise<{ completed: boolean; totalRows: number; failedChunks: number }> {
  let currentStart = new Date(startDate);
  let chunkNum = 1;
  let totalRows = progress.totalRowsInserted;
  let failedChunks = 0;
  let consecutiveFailures = 0;

  // Skip already completed chunks
  if (progress.lastCompletedDate) {
    const lastCompleted = new Date(progress.lastCompletedDate);
    if (lastCompleted > currentStart) {
      console.log(`  Resuming from ${formatDate(lastCompleted)}...`);
      currentStart = lastCompleted;
    }
  }

  while (currentStart < endDate) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + chunkDays);

    // Don't go past end date
    if (currentEnd > endDate) {
      currentEnd.setTime(endDate.getTime());
    }

    const result = await backfillChunkWithRetry(currentStart, currentEnd, chunkNum, chunkDays);

    if (result.success) {
      totalRows += result.rowCount;
      consecutiveFailures = 0;

      // Save progress after each successful chunk
      progress.lastCompletedDate = formatDate(currentEnd);
      progress.totalRowsInserted = totalRows;
      progress.lastUpdatedAt = new Date().toISOString();
      saveProgress(progress);
    } else {
      failedChunks++;
      consecutiveFailures++;

      // If too many consecutive failures, abort
      if (consecutiveFailures >= 5) {
        console.log('');
        console.log('  Too many consecutive failures, aborting backfill.');
        return { completed: false, totalRows, failedChunks };
      }
    }

    currentStart = currentEnd;
    chunkNum++;
  }

  return { completed: true, totalRows, failedChunks };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('MATERIALIZE PM_UNIFIED_LEDGER_V8 (RESILIENT VERSION)');
  console.log('='.repeat(80));
  console.log('');

  // Check if table exists with data
  const exists = await tableExists();
  const rowCount = exists ? await getTableRowCount() : 0;

  console.log(`Table exists: ${exists}`);
  console.log(`Current row count: ${rowCount.toLocaleString()}`);
  console.log('');

  // Get date range
  const { minDate, maxDate } = await getDateRange();
  console.log(`Data range: ${formatDate(minDate)} to ${formatDate(maxDate)}`);
  console.log('');

  // Fast-path: if table exists with data, only backfill recent
  if (exists && rowCount > 0) {
    console.log(`Table has data - running RECENT-ONLY backfill (last ${RECENT_BACKFILL_DAYS} days)`);
    console.log('');

    const recentStart = new Date(maxDate);
    recentStart.setDate(recentStart.getDate() - RECENT_BACKFILL_DAYS);

    const progress: Progress = {
      lastCompletedDate: null,
      chunkDays: DEFAULT_CHUNK_DAYS,
      totalRowsInserted: 0,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      mode: 'recent-only',
    };

    const result = await runBackfill(recentStart, maxDate, DEFAULT_CHUNK_DAYS, progress);
    console.log('');
    console.log(`Recent backfill complete: ${result.totalRows.toLocaleString()} new rows`);
    console.log(`Failed chunks: ${result.failedChunks}`);

    // Final verification
    const finalCount = await getTableRowCount();
    console.log(`Final table row count: ${finalCount.toLocaleString()}`);
    return;
  }

  // Full backfill or resume
  let progress = loadProgress();
  const resuming = progress !== null;

  if (resuming) {
    console.log('Found progress file - RESUMING previous backfill');
    console.log(`  Last completed: ${progress!.lastCompletedDate}`);
    console.log(`  Total rows so far: ${progress!.totalRowsInserted.toLocaleString()}`);
    console.log(`  Mode: ${progress!.mode}`);
    console.log('');
  } else {
    // Create table if needed
    if (!exists) {
      console.log('Creating table...');
      await clickhouse.command({ query: CREATE_TABLE_SQL });
      console.log('  Done');
      console.log('');
    }

    progress = {
      lastCompletedDate: null,
      chunkDays: DEFAULT_CHUNK_DAYS,
      totalRowsInserted: 0,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      mode: 'full',
    };
    saveProgress(progress);
  }

  // Try full historical backfill
  console.log(`Starting backfill with ${progress.chunkDays}-day chunks...`);
  console.log('');

  const result = await runBackfill(minDate, maxDate, progress.chunkDays, progress);

  if (!result.completed) {
    // Fallback: try smaller chunks
    if (progress.chunkDays > FALLBACK_CHUNK_DAYS) {
      console.log('');
      console.log(`Trying smaller chunks (${FALLBACK_CHUNK_DAYS}-day)...`);
      progress.chunkDays = FALLBACK_CHUNK_DAYS;
      saveProgress(progress);

      const retryResult = await runBackfill(minDate, maxDate, FALLBACK_CHUNK_DAYS, progress);

      if (!retryResult.completed) {
        // Ultimate fallback: just do recent 90 days
        console.log('');
        console.log('='.repeat(80));
        console.log('FALLING BACK TO RECENT-ONLY MODE (last 90 days)');
        console.log('='.repeat(80));
        console.log('');

        // Drop and recreate
        await clickhouse.command({ query: DROP_TABLE_SQL });
        await clickhouse.command({ query: CREATE_TABLE_SQL });

        const recentStart = new Date(maxDate);
        recentStart.setDate(recentStart.getDate() - FALLBACK_RECENT_ONLY_DAYS);

        progress.lastCompletedDate = null;
        progress.totalRowsInserted = 0;
        progress.mode = 'recent-only';
        saveProgress(progress);

        const fallbackResult = await runBackfill(recentStart, maxDate, DEFAULT_CHUNK_DAYS, progress);
        console.log('');
        console.log(`Recent-only backfill complete: ${fallbackResult.totalRows.toLocaleString()} rows`);
        console.log('NOTE: This is a PARTIAL materialization (last 90 days only)');
      }
    }
  }

  // Final verification
  console.log('');
  console.log('='.repeat(80));
  console.log('VERIFICATION');
  console.log('='.repeat(80));

  const finalCount = await getTableRowCount();
  console.log(`Final table row count: ${finalCount.toLocaleString()}`);

  // Get unique wallets
  try {
    const walletQuery = `SELECT count(DISTINCT wallet_address) as cnt FROM ${TABLE_NAME}`;
    const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' });
    const walletRows = (await walletResult.json()) as any[];
    console.log(`Unique wallets: ${Number(walletRows[0]?.cnt || 0).toLocaleString()}`);
  } catch {}

  // Get date coverage
  try {
    const dateQuery = `
      SELECT
        min(event_time) as min_date,
        max(event_time) as max_date
      FROM ${TABLE_NAME}
    `;
    const dateResult = await clickhouse.query({ query: dateQuery, format: 'JSONEachRow' });
    const dateRows = (await dateResult.json()) as any[];
    console.log(`Date coverage: ${dateRows[0]?.min_date} to ${dateRows[0]?.max_date}`);
  } catch {}

  // Clear progress file on completion
  clearProgress();

  console.log('');
  console.log('='.repeat(80));
  console.log('DONE');
  console.log('='.repeat(80));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
