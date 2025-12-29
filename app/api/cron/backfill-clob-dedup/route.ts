/**
 * Cron: Backfill CLOB Dedup Table
 *
 * Deep backfill for gaps older than the 24h rolling window.
 * Reprocesses a configurable window (default 7 days).
 *
 * Usage:
 *   - /api/cron/backfill-clob-dedup (default 168 hours / 7 days)
 *   - /api/cron/backfill-clob-dedup?hours=336 (14 days)
 *
 * Auth: Requires CRON_SECRET via Bearer token, query param, or Vercel cron header
 * Frequency: Daily or twice daily
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

// Default backfill window
const DEFAULT_HOURS = 168; // 7 days
const MAX_HOURS = 720; // 30 days max to avoid timeout

interface BackfillResult {
  success: boolean;
  hours: number;
  rawLatest: string;
  fromTime: string;
  toTime: string;
  rowsInserted: number;
  durationMs: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  // In dev mode only, allow requests without secret
  if (!cronSecret && !isProduction) {
    console.warn('[backfill-clob-dedup] CRON_SECRET not set (dev mode) - allowing request');
    return true;
  }

  // In production, CRON_SECRET is required
  if (!cronSecret && isProduction) {
    console.error('[backfill-clob-dedup] CRON_SECRET not set in production - rejecting');
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
    // Parse hours from query param
    const url = new URL(request.url);
    const hoursParam = url.searchParams.get('hours');
    let hours = hoursParam ? parseInt(hoursParam, 10) : DEFAULT_HOURS;

    // Clamp to valid range
    if (isNaN(hours) || hours < 1) hours = DEFAULT_HOURS;
    if (hours > MAX_HOURS) hours = MAX_HOURS;

    console.log(`[backfill-clob-dedup] Starting ${hours}h backfill`);

    // Get raw latest timestamp
    const rawLatestResult = await clickhouse.query({
      query: `SELECT max(trade_time) as latest FROM pm_trader_events_v2`,
      format: 'JSONEachRow',
    });
    const rawLatest = ((await rawLatestResult.json()) as any[])[0]?.latest as string;

    console.log(`[backfill-clob-dedup] Raw latest: ${rawLatest}`);

    // Insert the full backfill window
    // Use explicit UTC timezone for consistency
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
        AND trade_time >= toDateTime('${rawLatest}', 'UTC') - INTERVAL ${hours} HOUR
        AND trade_time <= toDateTime('${rawLatest}', 'UTC')
    `;

    await clickhouse.command({ query: insertQuery });

    // Count rows in backfill window
    const countResult = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= toDateTime('${rawLatest}', 'UTC') - INTERVAL ${hours} HOUR
          AND trade_time <= toDateTime('${rawLatest}', 'UTC')
      `,
      format: 'JSONEachRow',
    });
    const rowsInserted = Number(((await countResult.json()) as any[])[0]?.cnt || 0);

    const durationMs = Date.now() - startTime;

    const result: BackfillResult = {
      success: true,
      hours,
      rawLatest,
      fromTime: `${rawLatest} - ${hours}h`,
      toTime: rawLatest,
      rowsInserted,
      durationMs,
    };

    console.log(`[backfill-clob-dedup] Complete:`, result);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[backfill-clob-dedup] Error:', error);

    const result: BackfillResult = {
      success: false,
      hours: DEFAULT_HOURS,
      rawLatest: '',
      fromTime: '',
      toTime: '',
      rowsInserted: 0,
      durationMs: Date.now() - startTime,
      error: error.message,
    };

    return NextResponse.json(result, { status: 500 });
  }
}
