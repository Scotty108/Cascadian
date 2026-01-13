/**
 * WIO Position Backfill Script
 *
 * Backfills wio_positions_v1 from pm_canonical_fills_v4
 * Run in batches by wallet prefix to avoid timeouts
 *
 * Usage: npx tsx scripts/wio-backfill-positions.ts [--batch=0-f] [--dry-run]
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

// Load .env.local explicitly
config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!, // Already includes https:// and port
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 1800000, // 30 minutes
  clickhouse_settings: {
    max_execution_time: 1800, // 30 minutes
    max_bytes_before_external_group_by: 5000000000, // 5GB - spill to disk before OOM
    max_bytes_before_external_sort: 5000000000,
  },
});

// Use 2-character batches (256 batches of ~300K each instead of 16 batches of ~5M)
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
        -- Dedupe by fill_id using argMax (streaming, no FINAL memory spike)
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

// Generate all 256 two-character hex prefixes (00-ff)
const HEX_CHARS = '0123456789abcdef'.split('');
const BATCH_PREFIXES: string[] = [];
for (const c1 of HEX_CHARS) {
  for (const c2 of HEX_CHARS) {
    BATCH_PREFIXES.push(c1 + c2);
  }
}

async function getPositionCount(): Promise<number> {
  const result = await clickhouse.query({
    query: 'SELECT count() as cnt FROM wio_positions_v1',
    format: 'JSONEachRow',
  });
  const rows = await result.json() as any[];
  return Number(rows[0]?.cnt || 0);
}

async function runBatch(batchChar: string, dryRun: boolean): Promise<number> {
  const query = POSITION_INSERT_QUERY.replace('{BATCH_PREFIX}', batchChar);

  if (dryRun) {
    // Just count what would be inserted
    const countQuery = query
      .replace('INSERT INTO wio_positions_v1', 'SELECT count() as cnt FROM')
      .replace(/SELECT[\s\S]*?FROM \(/, 'SELECT count() as cnt FROM (');

    console.log(`[DRY RUN] Would run batch ${batchChar}`);
    return 0;
  }

  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting batch ${batchChar}...`);

  try {
    await clickhouse.command({ query });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${new Date().toISOString()}] Batch ${batchChar} completed in ${elapsed}s`);
    return 1;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Batch ${batchChar} failed:`, error);
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const batchArg = args.find(a => a.startsWith('--batch='));

  let batches = BATCH_PREFIXES;
  if (batchArg) {
    const batchValue = batchArg.split('=')[1];
    if (batchValue.includes('-')) {
      const [start, end] = batchValue.split('-');
      const startIdx = BATCH_PREFIXES.indexOf(start);
      const endIdx = BATCH_PREFIXES.indexOf(end);
      batches = BATCH_PREFIXES.slice(startIdx, endIdx + 1);
    } else {
      batches = [batchValue];
    }
  }

  console.log('='.repeat(60));
  console.log('WIO Position Backfill');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Batches: ${batches.join(', ')}`);
  console.log('='.repeat(60));

  const startCount = await getPositionCount();
  console.log(`Current position count: ${startCount.toLocaleString()}`);

  let successCount = 0;
  for (const batchChar of batches) {
    successCount += await runBatch(batchChar, dryRun);
  }

  const endCount = await getPositionCount();
  console.log('='.repeat(60));
  console.log(`Batches completed: ${successCount}/${batches.length}`);
  console.log(`Positions added: ${(endCount - startCount).toLocaleString()}`);
  console.log(`Total positions: ${endCount.toLocaleString()}`);
  console.log('='.repeat(60));

  await clickhouse.close();
}

main().catch(console.error);
