/**
 * Cron: Sync WIO Positions (Incremental)
 *
 * Incrementally syncs new positions from pm_canonical_fills_v4 to wio_positions_v1.
 * Uses watermark-based processing to avoid reprocessing historical data.
 *
 * Also emits "dots" for smart money wallets when they open new positions.
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Hourly (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

const SLICE_HOURS = 1; // Reduced from 6->2->1 to avoid memory limits on high-activity periods
const SYNC_STATE_KEY = 'wio_positions_v1';

interface SyncResult {
  success: boolean;
  skipped: boolean;
  watermarkBefore: string;
  watermarkAfter: string;
  sourceLatest: string;
  positionsInserted: number;
  dotsEmitted: number;
  durationMs: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!cronSecret && !isProduction) {
    return true;
  }
  if (!cronSecret && isProduction) {
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get('token') === cronSecret) return true;

  return false;
}

export async function GET(request: Request) {
  const startTime = Date.now();

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Step 1: Get current watermark
    const watermarkResult = await clickhouse.query({
      query: `
        SELECT watermark_time
        FROM pm_sync_state_v1
        WHERE table_name = '${SYNC_STATE_KEY}'
        ORDER BY last_sync_at DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const watermarkRow = ((await watermarkResult.json()) as any[])[0];
    const watermarkBefore = watermarkRow?.watermark_time || '2024-01-01 00:00:00';

    console.log(`[sync-wio-positions] Watermark: ${watermarkBefore}`);

    // Step 2: Get latest time in source table
    const sourceLatestResult = await clickhouse.query({
      query: `SELECT max(event_time) as latest FROM pm_canonical_fills_v4`,
      format: 'JSONEachRow',
    });
    const sourceLatest = ((await sourceLatestResult.json()) as any[])[0]?.latest as string;

    console.log(`[sync-wio-positions] Source latest: ${sourceLatest}`);

    // Step 3: Check if sync is needed
    const watermarkMs = new Date(watermarkBefore + 'Z').getTime();
    const sourceLatestMs = new Date(sourceLatest + 'Z').getTime();
    const gapMs = sourceLatestMs - watermarkMs;

    if (gapMs < 60000) {
      console.log(`[sync-wio-positions] Gap is ${gapMs}ms, skipping`);
      return NextResponse.json({
        success: true,
        skipped: true,
        watermarkBefore,
        watermarkAfter: watermarkBefore,
        sourceLatest,
        positionsInserted: 0,
        dotsEmitted: 0,
        durationMs: Date.now() - startTime,
      } as SyncResult);
    }

    // Step 4: Calculate slice window
    const sliceEndMs = Math.min(watermarkMs + SLICE_HOURS * 3600 * 1000, sourceLatestMs);
    const sliceEnd = new Date(sliceEndMs).toISOString().replace('T', ' ').slice(0, 19);

    console.log(`[sync-wio-positions] Processing: ${watermarkBefore} -> ${sliceEnd}`);

    // Step 5: Insert new positions in batches by condition_id
    // First, get distinct condition_ids with activity in this slice
    const conditionsResult = await clickhouse.query({
      query: `
        SELECT DISTINCT condition_id
        FROM pm_canonical_fills_v4
        WHERE event_time > toDateTime('${watermarkBefore}', 'UTC')
          AND event_time <= toDateTime('${sliceEnd}', 'UTC')
          AND source IN ('clob', 'ctf_token')
      `,
      format: 'JSONEachRow',
    });
    const conditionRows = (await conditionsResult.json()) as Array<{ condition_id: string }>;
    const conditionIds = conditionRows.map(r => r.condition_id);

    console.log(`[sync-wio-positions] Found ${conditionIds.length} conditions with activity`);

    // Process in batches of 50 conditions to stay within memory limits
    const BATCH_SIZE = 50;
    let totalInserted = 0;

    for (let batchStart = 0; batchStart < conditionIds.length; batchStart += BATCH_SIZE) {
      const batch = conditionIds.slice(batchStart, batchStart + BATCH_SIZE);
      const conditionList = batch.map(id => `'${id}'`).join(',');

      const insertQuery = `
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
        WITH
          -- Aggregate fills for these conditions (no unbounded scan)
          positions AS (
            SELECT
              wallet,
              cond_id as condition_id,
              outcome_index,
              min(event_time) as ts_open,
              max(event_time) as ts_last_fill,
              sumIf(tokens_delta, tokens_delta > 0) as tokens_bought,
              sumIf(abs(tokens_delta), tokens_delta < 0) as tokens_sold,
              sumIf(abs(usdc_delta), usdc_delta < 0) as cost_usd,
              sumIf(usdc_delta, usdc_delta > 0) as proceeds_usd,
              count() as fills_count,
              min(fill_id) as first_fill_id,
              max(fill_id) as last_fill_id
            FROM (
              SELECT
                fill_id,
                argMax(wallet, _version) as wallet,
                argMax(condition_id, _version) as cond_id,
                argMax(outcome_index, _version) as outcome_index,
                argMax(event_time, _version) as event_time,
                argMax(tokens_delta, _version) as tokens_delta,
                argMax(usdc_delta, _version) as usdc_delta
              FROM pm_canonical_fills_v4
              WHERE condition_id IN (${conditionList})
                AND source IN ('clob', 'ctf_token')
              GROUP BY fill_id
            )
            GROUP BY wallet, cond_id, outcome_index
            HAVING tokens_bought > 0
          )
        SELECT
          cityHash64(concat(p.wallet, p.condition_id, toString(p.outcome_index), toString(p.ts_open))),
          p.wallet,
          p.condition_id,
          if(p.outcome_index = 0, 'YES', 'NO'),

          coalesce(m.category, ''),
          '',

          p.ts_open,
          if(p.tokens_bought = p.tokens_sold, p.ts_last_fill, NULL),
          if(r.resolved_at > '1970-01-02', r.resolved_at, NULL),
          coalesce(
            if(p.tokens_bought = p.tokens_sold, p.ts_last_fill, NULL),
            if(r.resolved_at > '1970-01-02', r.resolved_at, NULL),
            now()
          ),

          p.tokens_bought,
          p.tokens_sold,
          p.tokens_bought - p.tokens_sold,

          p.cost_usd,
          p.proceeds_usd,
          if(p.tokens_bought > 0, p.cost_usd / p.tokens_bought, 0),

          if(r.resolved_at > '1970-01-02', 1, 0),
          toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)),

          (p.proceeds_usd - p.cost_usd) +
          if(toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1,
             p.tokens_bought - p.tokens_sold, 0),

          if(p.cost_usd > 0,
            ((p.proceeds_usd - p.cost_usd) +
             if(toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1,
                p.tokens_bought - p.tokens_sold, 0)) / p.cost_usd,
            0),

          dateDiff('minute', p.ts_open, coalesce(
            if(p.tokens_bought = p.tokens_sold, p.ts_last_fill, NULL),
            if(r.resolved_at > '1970-01-02', r.resolved_at, NULL),
            now()
          )),

          if(r.resolved_at > '1970-01-02' AND p.tokens_bought > 0,
            pow(p.cost_usd / p.tokens_bought - coalesce(toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)), 0), 2),
            NULL),

          p.fills_count,
          p.first_fill_id,
          p.last_fill_id

        FROM positions p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
        LEFT JOIN pm_market_metadata m ON p.condition_id = m.condition_id
      `;

      await clickhouse.command({
        query: insertQuery,
        clickhouse_settings: {
          max_memory_usage: '8000000000',
          max_execution_time: 300,
          join_use_nulls: 1 as any,
        },
      });

      totalInserted += batch.length;
      console.log(`[sync-wio-positions] Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(conditionIds.length / BATCH_SIZE)} complete (${batch.length} conditions)`);
    }

    // Step 6: Count what we inserted
    const countResult = await clickhouse.query({
      query: `
        SELECT count(DISTINCT (wallet, condition_id, outcome_index)) as cnt
        FROM pm_canonical_fills_v4
        WHERE event_time > toDateTime('${watermarkBefore}', 'UTC')
          AND event_time <= toDateTime('${sliceEnd}', 'UTC')
          AND source IN ('clob', 'ctf_token')
      `,
      format: 'JSONEachRow',
    });
    const positionsInserted = Number(((await countResult.json()) as any[])[0]?.cnt || 0);

    // Step 7: Emit dots for smart money wallets
    // Use credibility_score from wio_wallet_scores_v1 (no tier/rank/roi_percentile columns exist).
    // Derive tier from credibility_score and use row_number() for rank within this batch.
    const dotsQuery = `
      INSERT INTO wio_dots_v1 (
        dot_id, dot_type, wallet_id, market_id, side,
        position_size_usd, entry_price,
        wallet_tier, wallet_rank, wallet_roi,
        market_question, category, bundle_id,
        ts, position_id
      )
      SELECT
        cityHash64(concat(wallet_id, market_id, side, toString(ts_open))),
        'smart_money_entry',
        wallet_id,
        market_id,
        side,
        cost_usd,
        p_entry_side,
        wallet_tier,
        wallet_rank,
        wallet_score,
        market_question,
        category,
        bundle_id,
        ts_open,
        position_id
      FROM (
        SELECT
          p.wallet_id,
          p.market_id,
          p.side,
          p.cost_usd,
          p.p_entry_side,
          p.ts_open,
          p.position_id,
          p.category,
          if(s.credibility_score >= 0.8, 'elite',
            if(s.credibility_score >= 0.6, 'high',
              if(s.credibility_score >= 0.4, 'mid', 'low'))) as wallet_tier,
          row_number() OVER (ORDER BY s.credibility_score DESC) as wallet_rank,
          s.credibility_score as wallet_score,
          coalesce(m.question, '') as market_question,
          coalesce(b.primary_bundle_id, '') as bundle_id
        FROM wio_positions_v1 p
        INNER JOIN wio_wallet_scores_v1 s
          ON p.wallet_id = s.wallet_id AND s.window_id = 'ALL'
        LEFT JOIN pm_market_metadata m ON p.market_id = m.condition_id
        LEFT JOIN wio_market_bundle_map b ON p.market_id = b.condition_id
        WHERE p.ts_open > toDateTime('${watermarkBefore}', 'UTC')
          AND p.ts_open <= toDateTime('${sliceEnd}', 'UTC')
          AND p.cost_usd >= 50  -- Minimum position size
      )
      WHERE wallet_rank <= 100  -- Top 100 wallets by credibility
    `;

    let dotsEmitted = 0;
    try {
      await clickhouse.command({
        query: dotsQuery,
        clickhouse_settings: { join_use_nulls: 1 as any },
      });
      const dotsCount = await clickhouse.query({
        query: `
          SELECT count() as cnt FROM wio_dots_v1
          WHERE ts > toDateTime('${watermarkBefore}', 'UTC')
            AND ts <= toDateTime('${sliceEnd}', 'UTC')
        `,
        format: 'JSONEachRow',
      });
      dotsEmitted = Number(((await dotsCount.json()) as any[])[0]?.cnt || 0);
    } catch (e: any) {
      console.log('[sync-wio-positions] Dots emission skipped (scores may not exist yet)');
    }

    // Step 8: Advance watermark
    await clickhouse.command({
      query: `
        INSERT INTO pm_sync_state_v1 (table_name, watermark_time, rows_processed, notes)
        VALUES ('${SYNC_STATE_KEY}', '${sliceEnd}', ${positionsInserted}, 'WIO positions sync')
      `,
    });

    const durationMs = Date.now() - startTime;
    const result: SyncResult = {
      success: true,
      skipped: false,
      watermarkBefore,
      watermarkAfter: sliceEnd,
      sourceLatest,
      positionsInserted,
      dotsEmitted,
      durationMs,
    };

    await logCronExecution({
      cron_name: 'sync-wio-positions',
      status: 'success',
      duration_ms: durationMs,
      details: { positionsInserted, dotsEmitted }
    });

    console.log(`[sync-wio-positions] Complete:`, result);
    return NextResponse.json(result);

  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[sync-wio-positions] Error:', error);

    await logCronExecution({
      cron_name: 'sync-wio-positions',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message
    });

    return NextResponse.json({
      success: false,
      skipped: false,
      watermarkBefore: '',
      watermarkAfter: '',
      sourceLatest: '',
      positionsInserted: 0,
      dotsEmitted: 0,
      durationMs,
      error: error.message,
    } as SyncResult, { status: 500 });
  }
}
