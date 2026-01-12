/**
 * Cron: Sync CLOB Dedup Table (Incremental)
 *
 * Cheap incremental sync from pm_trader_events_v2 (raw Goldsky stream)
 * to pm_trader_events_dedup_v2_tbl (deduplicated table for queries).
 *
 * This is the fast, low-cost sync that runs every 30 minutes.
 * For gap healing, use /api/cron/heal-clob-dedup (runs every 6h).
 *
 * Table uses ReplacingMergeTree with:
 *   - ORDER BY (event_id, trader_wallet, role) for dedup identity
 *   - trade_time as version column
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Every 30 minutes
 * Buffer: 10 minutes overlap to handle late-arriving rows
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

// Buffer to handle late-arriving rows and merge timing
const BUFFER_MINUTES = 10;
// Minimum gap (seconds) before syncing - avoids unnecessary work
const MIN_GAP_SECONDS = 30;

interface SyncResult {
  success: boolean;
  skipped: boolean;
  mode: 'incremental';
  rawLatest: string;
  dedupLatestBefore: string;
  dedupLatestAfter: string;
  fromTime: string;
  toTime: string;
  rowsInserted: number;
  freshnessGapSeconds: number;
  durationMs: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  // In dev mode only, allow requests without secret
  if (!cronSecret && !isProduction) {
    console.warn('[sync-clob-dedup] CRON_SECRET not set (dev mode) - allowing request');
    return true;
  }

  // In production, CRON_SECRET is required
  if (!cronSecret && isProduction) {
    console.error('[sync-clob-dedup] CRON_SECRET not set in production - rejecting');
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

export async function GET(request: Request) {
  const startTime = Date.now();

  // Auth guard
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Step 1: Get latest timestamps from both tables
    const [rawLatestResult, dedupLatestResult] = await Promise.all([
      clickhouse.query({
        query: `SELECT max(trade_time) as latest FROM pm_trader_events_v2`,
        format: 'JSONEachRow',
      }),
      clickhouse.query({
        query: `SELECT max(trade_time) as latest FROM pm_trader_events_dedup_v2_tbl`,
        format: 'JSONEachRow',
      }),
    ]);

    const rawLatest = ((await rawLatestResult.json()) as any[])[0]?.latest as string;
    const dedupLatestBefore = ((await dedupLatestResult.json()) as any[])[0]?.latest as string;

    console.log(`[sync-clob-dedup] Raw latest: ${rawLatest}`);
    console.log(`[sync-clob-dedup] Dedup latest: ${dedupLatestBefore}`);

    // Step 2: Check if sync is needed
    const rawLatestMs = new Date(rawLatest + 'Z').getTime();
    const dedupLatestMs = new Date(dedupLatestBefore + 'Z').getTime();
    const gapSeconds = (rawLatestMs - dedupLatestMs) / 1000;

    if (gapSeconds <= MIN_GAP_SECONDS) {
      console.log(`[sync-clob-dedup] Gap is ${gapSeconds}s <= ${MIN_GAP_SECONDS}s, skipping`);

      const result: SyncResult = {
        success: true,
        skipped: true,
        mode: 'incremental',
        rawLatest,
        dedupLatestBefore,
        dedupLatestAfter: dedupLatestBefore,
        fromTime: '',
        toTime: '',
        rowsInserted: 0,
        freshnessGapSeconds: gapSeconds,
        durationMs: Date.now() - startTime,
      };

      return NextResponse.json(result);
    }

    // Step 3: Calculate sync window with buffer
    // Cheap incremental: dedupLatest - 10m to rawLatest
    const fromTime = dedupLatestBefore;
    const toTime = rawLatest;

    console.log(`[sync-clob-dedup] Sync window: ${fromTime} -> ${toTime}`);

    // Step 4: Insert delta window with explicit column list
    // ReplacingMergeTree will dedupe on ORDER BY (event_id, trader_wallet, role)
    // Use >= to not lose boundary row
    // Limit to 2 hours max to prevent memory issues
    const maxHours = 2;
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
        AND trade_time >= greatest(
          toDateTime('${fromTime}', 'UTC') - INTERVAL ${BUFFER_MINUTES} MINUTE,
          toDateTime('${toTime}', 'UTC') - INTERVAL ${maxHours} HOUR
        )
        AND trade_time <= toDateTime('${toTime}', 'UTC')
      SETTINGS max_memory_usage = 8000000000
    `;

    await clickhouse.command({ query: insertQuery });

    // Step 5: Count rows in sync window (use same window as insert)
    const countResult = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= greatest(
            toDateTime('${fromTime}', 'UTC') - INTERVAL ${BUFFER_MINUTES} MINUTE,
            toDateTime('${toTime}', 'UTC') - INTERVAL ${maxHours} HOUR
          )
          AND trade_time <= toDateTime('${toTime}', 'UTC')
      `,
      format: 'JSONEachRow',
    });
    const rowsInserted = Number(((await countResult.json()) as any[])[0]?.cnt || 0);

    // Step 6: Verify new latest and compute freshness gap
    const dedupLatestAfterResult = await clickhouse.query({
      query: `SELECT max(trade_time) as latest FROM pm_trader_events_dedup_v2_tbl`,
      format: 'JSONEachRow',
    });
    const dedupLatestAfter = ((await dedupLatestAfterResult.json()) as any[])[0]?.latest as string;

    const dedupAfterMs = new Date(dedupLatestAfter + 'Z').getTime();
    const freshnessGapSeconds = (rawLatestMs - dedupAfterMs) / 1000;

    const durationMs = Date.now() - startTime;

    const result: SyncResult = {
      success: true,
      skipped: false,
      mode: 'incremental',
      rawLatest,
      dedupLatestBefore,
      dedupLatestAfter,
      fromTime,
      toTime,
      rowsInserted,
      freshnessGapSeconds,
      durationMs,
    };

    console.log(`[sync-clob-dedup] Complete:`, result);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[sync-clob-dedup] Error:', error);

    const result: SyncResult = {
      success: false,
      skipped: false,
      mode: 'incremental',
      rawLatest: '',
      dedupLatestBefore: '',
      dedupLatestAfter: '',
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
