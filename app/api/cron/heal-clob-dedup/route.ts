/**
 * Cron: Heal CLOB Dedup Table
 *
 * Heals gaps in the dedup table by reprocessing the last 24 hours.
 * This catches any rows that were missed by the incremental sync.
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Every 6 hours
 * Window: 24 hours lookback
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

// Healing lookback window
const LOOKBACK_HOURS = 24;

interface MissingBucket {
  bucket: string;
  rawCount: number;
  dedupCount: number;
  gap: number;
}

interface HealResult {
  success: boolean;
  mode: 'healer';
  lookbackHours: number;
  rawLatest: string;
  fromTime: string;
  toTime: string;
  rowsInserted: number;
  missingBucketsBefore?: MissingBucket[];
  missingBucketsAfter?: MissingBucket[];
  freshnessGapSeconds: number;
  durationMs: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  // In dev mode only, allow requests without secret
  if (!cronSecret && !isProduction) {
    console.warn('[heal-clob-dedup] CRON_SECRET not set (dev mode) - allowing request');
    return true;
  }

  // In production, CRON_SECRET is required
  if (!cronSecret && isProduction) {
    console.error('[heal-clob-dedup] CRON_SECRET not set in production - rejecting');
    return false;
  }

  // Option 1: Bearer token in Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  // Option 2: Token query parameter
  const url = new URL(request.url);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam === cronSecret) {
    return true;
  }

  return false;
}

async function detectGaps(): Promise<MissingBucket[]> {
  // Gap detector - compare raw vs dedup by 5-minute bucket over last 24h
  // Use now('UTC') for time-consistent queries
  const gapDetectorResult = await clickhouse.query({
    query: `
      WITH
        raw_buckets AS (
          SELECT
            toStartOfFiveMinutes(trade_time) as bucket,
            count() as cnt
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
            AND trade_time > now('UTC') - INTERVAL 24 HOUR
          GROUP BY bucket
        ),
        dedup_buckets AS (
          SELECT
            toStartOfFiveMinutes(trade_time) as bucket,
            count() as cnt
          FROM pm_trader_events_dedup_v2_tbl
          WHERE trade_time > now('UTC') - INTERVAL 24 HOUR
          GROUP BY bucket
        )
      SELECT
        r.bucket,
        r.cnt as raw_count,
        coalesce(d.cnt, 0) as dedup_count,
        r.cnt - coalesce(d.cnt, 0) as gap
      FROM raw_buckets r
      LEFT JOIN dedup_buckets d ON r.bucket = d.bucket
      WHERE r.cnt > coalesce(d.cnt, 0)
      ORDER BY gap DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const gapBuckets = (await gapDetectorResult.json()) as any[];
  return gapBuckets.map((b) => ({
    bucket: b.bucket,
    rawCount: Number(b.raw_count),
    dedupCount: Number(b.dedup_count),
    gap: Number(b.gap),
  }));
}

export async function GET(request: Request) {
  const startTime = Date.now();

  // Auth guard
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log(`[heal-clob-dedup] Starting ${LOOKBACK_HOURS}h healing window`);

    // Step 1: Detect gaps before healing
    const missingBucketsBefore = await detectGaps();
    console.log(`[heal-clob-dedup] Gaps before: ${missingBucketsBefore.length} buckets`);

    // Step 2: Get raw latest timestamp
    const rawLatestResult = await clickhouse.query({
      query: `SELECT max(trade_time) as latest FROM pm_trader_events_v2`,
      format: 'JSONEachRow',
    });
    const rawLatest = ((await rawLatestResult.json()) as any[])[0]?.latest as string;

    console.log(`[heal-clob-dedup] Raw latest: ${rawLatest}`);

    // Step 3: Insert the full 24h healing window
    // Use >= to not lose boundary row
    const insertQuery = `
      INSERT INTO pm_trader_events_dedup_v2_tbl
        (event_id, trader_wallet, role, side, token_id, usdc_amount, token_amount, fee_amount, trade_time, transaction_hash, block_number)
      SELECT
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
        block_number
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= toDateTime('${rawLatest}', 'UTC') - INTERVAL ${LOOKBACK_HOURS} HOUR
        AND trade_time <= toDateTime('${rawLatest}', 'UTC')
    `;

    await clickhouse.command({ query: insertQuery });

    // Step 4: Count rows in healing window
    const countResult = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= toDateTime('${rawLatest}', 'UTC') - INTERVAL ${LOOKBACK_HOURS} HOUR
          AND trade_time <= toDateTime('${rawLatest}', 'UTC')
      `,
      format: 'JSONEachRow',
    });
    const rowsInserted = Number(((await countResult.json()) as any[])[0]?.cnt || 0);

    // Step 5: Detect gaps after healing
    const missingBucketsAfter = await detectGaps();
    console.log(`[heal-clob-dedup] Gaps after: ${missingBucketsAfter.length} buckets`);

    // Step 6: Compute freshness gap
    const dedupLatestResult = await clickhouse.query({
      query: `SELECT max(trade_time) as latest FROM pm_trader_events_dedup_v2_tbl`,
      format: 'JSONEachRow',
    });
    const dedupLatest = ((await dedupLatestResult.json()) as any[])[0]?.latest as string;

    const rawLatestMs = new Date(rawLatest + 'Z').getTime();
    const dedupLatestMs = new Date(dedupLatest + 'Z').getTime();
    const freshnessGapSeconds = (rawLatestMs - dedupLatestMs) / 1000;

    const durationMs = Date.now() - startTime;

    const result: HealResult = {
      success: true,
      mode: 'healer',
      lookbackHours: LOOKBACK_HOURS,
      rawLatest,
      fromTime: `${rawLatest} - ${LOOKBACK_HOURS}h`,
      toTime: rawLatest,
      rowsInserted,
      missingBucketsBefore: missingBucketsBefore.length > 0 ? missingBucketsBefore : undefined,
      missingBucketsAfter: missingBucketsAfter.length > 0 ? missingBucketsAfter : undefined,
      freshnessGapSeconds,
      durationMs,
    };

    console.log(`[heal-clob-dedup] Complete:`, result);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[heal-clob-dedup] Error:', error);

    const result: HealResult = {
      success: false,
      mode: 'healer',
      lookbackHours: LOOKBACK_HOURS,
      rawLatest: '',
      fromTime: '',
      toTime: '',
      rowsInserted: 0,
      freshnessGapSeconds: -1,
      durationMs: Date.now() - startTime,
      error: error.message,
    };

    return NextResponse.json(result, { status: 500 });
  }
}
