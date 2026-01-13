/**
 * WIO Position Backfill Runner
 *
 * Runs position backfill with progress tracking and resume capability.
 * Progress is saved to a JSON file so it can resume from interruption.
 *
 * Usage: npx tsx scripts/wio-backfill-runner.ts
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

config({ path: '.env.local' });

const PROGRESS_FILE = '/tmp/wio-backfill-progress.json';
const BATCH_PREFIXES = generateBatchPrefixes();

function generateBatchPrefixes(): string[] {
  const prefixes: string[] = [];
  for (let i = 0; i < 256; i++) {
    prefixes.push(i.toString(16).padStart(2, '0'));
  }
  return prefixes;
}

interface Progress {
  completed: string[];
  failed: string[];
  startedAt: string;
  lastUpdated: string;
  totalPositions: number;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return {
    completed: [],
    failed: [],
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalPositions: 0,
  };
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000, // 10 minutes per batch
  clickhouse_settings: {
    max_execution_time: 600,
    max_bytes_before_external_group_by: 5000000000,
    max_bytes_before_external_sort: 5000000000,
  },
});

const POSITION_INSERT_QUERY = `
INSERT INTO wio_positions_v1 (
    position_id, wallet_id, market_id, side,
    category, event_id,
    ts_open, ts_close, ts_resolve, end_ts,
    qty_shares_opened, qty_shares_closed, qty_shares_remaining,
    cost_usd, proceeds_usd, p_entry_side,
    is_resolved, outcome_side,
    pnl_usd, roi, hold_minutes,
    brier_score, fills_count, first_fill_id, last_fill_id
)
SELECT
    cityHash64(concat(f.wallet, f.condition_id, toString(f.outcome_index), toString(f.ts_open))),
    f.wallet,
    f.condition_id,
    if(f.outcome_index = 0, 'YES', 'NO'),

    coalesce(m.category, ''),
    '',  -- event_id (populated separately)

    f.ts_open,
    if(f.tokens_bought = f.tokens_sold, f.ts_last_fill, NULL),
    if(r.resolved_at > '1970-01-02', r.resolved_at, NULL),
    coalesce(
        if(f.tokens_bought = f.tokens_sold, f.ts_last_fill, NULL),
        if(r.resolved_at > '1970-01-02', r.resolved_at, NULL),
        now()
    ),

    f.tokens_bought,
    f.tokens_sold,
    f.tokens_bought - f.tokens_sold,

    f.cost_usd,
    f.proceeds_usd,
    if(f.tokens_bought > 0, f.cost_usd / f.tokens_bought, 0),

    if(r.resolved_at > '1970-01-02', 1, 0),
    toInt64OrNull(JSONExtractString(r.payout_numerators, f.outcome_index + 1)),

    (f.proceeds_usd - f.cost_usd) +
    if(toInt64OrNull(JSONExtractString(r.payout_numerators, f.outcome_index + 1)) = 1,
       f.tokens_bought - f.tokens_sold, 0),

    if(f.cost_usd > 0,
        ((f.proceeds_usd - f.cost_usd) +
         if(toInt64OrNull(JSONExtractString(r.payout_numerators, f.outcome_index + 1)) = 1,
            f.tokens_bought - f.tokens_sold, 0)) / f.cost_usd,
        0),

    dateDiff('minute', f.ts_open, coalesce(
        if(f.tokens_bought = f.tokens_sold, f.ts_last_fill, NULL),
        if(r.resolved_at > '1970-01-02', r.resolved_at, NULL),
        now()
    )),

    if(r.resolved_at > '1970-01-02' AND f.tokens_bought > 0,
        pow(f.cost_usd / f.tokens_bought - coalesce(toInt64OrNull(JSONExtractString(r.payout_numerators, f.outcome_index + 1)), 0), 2),
        NULL),

    f.fills_count,
    f.first_fill_id,
    f.last_fill_id

FROM (
    SELECT
        deduped.w as wallet,
        deduped.cid as condition_id,
        deduped.oi as outcome_index,
        min(deduped.event_time) as ts_open,
        max(deduped.event_time) as ts_last_fill,
        sumIf(deduped.tokens_delta_dedup, deduped.tokens_delta_dedup > 0) as tokens_bought,
        sumIf(abs(deduped.tokens_delta_dedup), deduped.tokens_delta_dedup < 0) as tokens_sold,
        sumIf(abs(deduped.usdc_delta_dedup), deduped.usdc_delta_dedup < 0) as cost_usd,
        sumIf(deduped.usdc_delta_dedup, deduped.usdc_delta_dedup > 0) as proceeds_usd,
        count() as fills_count,
        min(deduped.fill_id) as first_fill_id,
        max(deduped.fill_id) as last_fill_id
    FROM (
        SELECT
            fill_id,
            argMax(wallet, _version) as w,
            argMax(condition_id, _version) as cid,
            argMax(outcome_index, _version) as oi,
            argMax(event_time, _version) as event_time,
            argMax(tokens_delta, _version) as tokens_delta_dedup,
            argMax(usdc_delta, _version) as usdc_delta_dedup
        FROM pm_canonical_fills_v4
        WHERE substring(wallet, 3, 2) = '{BATCH_PREFIX}'
          AND source IN ('clob', 'ctf_token')
        GROUP BY fill_id
    ) deduped
    GROUP BY deduped.w, deduped.cid, deduped.oi
    HAVING tokens_bought > 0
) f
LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id AND r.is_deleted = 0
LEFT JOIN pm_market_metadata m ON f.condition_id = m.condition_id
`;

async function getPositionCount(): Promise<number> {
  const result = await clickhouse.query({
    query: 'SELECT count() as cnt FROM wio_positions_v1',
    format: 'JSONEachRow',
  });
  const rows = await result.json() as any[];
  return Number(rows[0]?.cnt || 0);
}

async function runBatch(batchPrefix: string): Promise<{ success: boolean; time: number }> {
  const query = POSITION_INSERT_QUERY.replace('{BATCH_PREFIX}', batchPrefix);
  const startTime = Date.now();

  try {
    await clickhouse.command({ query });
    return { success: true, time: (Date.now() - startTime) / 1000 };
  } catch (error: any) {
    console.error(`  ERROR: ${error.message}`);
    return { success: false, time: (Date.now() - startTime) / 1000 };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('WIO Position Backfill Runner');
  console.log('='.repeat(70));

  const progress = loadProgress();
  const remaining = BATCH_PREFIXES.filter(p => !progress.completed.includes(p));

  console.log(`Progress: ${progress.completed.length}/256 batches completed`);
  console.log(`Remaining: ${remaining.length} batches`);
  console.log(`Failed (will retry): ${progress.failed.length}`);
  console.log('='.repeat(70));

  if (remaining.length === 0) {
    console.log('All batches complete!');
    const total = await getPositionCount();
    console.log(`Total positions: ${total.toLocaleString()}`);
    await clickhouse.close();
    return;
  }

  let batchNum = progress.completed.length;
  const startTotal = await getPositionCount();
  const startTime = Date.now();

  for (const batch of remaining) {
    batchNum++;
    const pct = ((batchNum / 256) * 100).toFixed(1);
    process.stdout.write(`[${batchNum}/256 ${pct}%] Batch ${batch}... `);

    const result = await runBatch(batch);

    if (result.success) {
      progress.completed.push(batch);
      progress.failed = progress.failed.filter(f => f !== batch);
      console.log(`OK (${result.time.toFixed(1)}s)`);
    } else {
      if (!progress.failed.includes(batch)) {
        progress.failed.push(batch);
      }
      console.log(`FAILED (${result.time.toFixed(1)}s)`);
    }

    // Save progress after each batch
    progress.totalPositions = await getPositionCount();
    saveProgress(progress);

    // Progress report every 10 batches
    if (batchNum % 10 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (progress.totalPositions - startTotal) / elapsed;
      const eta = (remaining.length - (batchNum - progress.completed.length + remaining.length)) * (elapsed / batchNum);
      console.log(`  >> Positions: ${progress.totalPositions.toLocaleString()} | Rate: ${rate.toFixed(0)}/s | ETA: ${(eta/60).toFixed(0)} min`);
    }
  }

  console.log('='.repeat(70));
  console.log(`Completed: ${progress.completed.length}/256`);
  console.log(`Failed: ${progress.failed.length}`);
  console.log(`Total positions: ${progress.totalPositions.toLocaleString()}`);
  console.log('='.repeat(70));

  await clickhouse.close();
}

main().catch(console.error);
