/**
 * Cron: Nightly Duplicate Cleanup
 *
 * Runs OPTIMIZE FINAL on current month partition to force deduplication.
 * Runs at 3 AM daily when traffic is low.
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Daily at 3 AM (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

interface CleanupResult {
  success: boolean;
  partition: string;
  beforeCount: number;
  afterCount: number;
  duplicatesRemoved: number;
  durationMs: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!cronSecret && !isProduction) return true;
  if (!cronSecret && isProduction) return false;

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
    const currentPartition = new Date().toISOString().slice(0, 7).replace('-', ''); // YYYYMM

    // Count before
    const beforeResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          uniq(fill_id) as unique_fills
        FROM pm_canonical_fills_v4
        WHERE toYYYYMM(event_time) = ${currentPartition}
      `,
      format: 'JSONEachRow',
    });
    const beforeRows = (await beforeResult.json()) as any[];
    const beforeCount = Number(beforeRows[0]?.total_rows || 0);
    const uniqueFills = Number(beforeRows[0]?.unique_fills || 0);

    console.log(`[cleanup-duplicates] Partition ${currentPartition}: ${beforeCount.toLocaleString()} rows, ${uniqueFills.toLocaleString()} unique`);

    // Run OPTIMIZE FINAL
    await clickhouse.command({
      query: `OPTIMIZE TABLE pm_canonical_fills_v4 PARTITION ${currentPartition} FINAL`,
    });

    // Count after
    const afterResult = await clickhouse.query({
      query: `
        SELECT count() as total_rows
        FROM pm_canonical_fills_v4
        WHERE toYYYYMM(event_time) = ${currentPartition}
      `,
      format: 'JSONEachRow',
    });
    const afterRows = (await afterResult.json()) as any[];
    const afterCount = Number(afterRows[0]?.total_rows || 0);

    const duplicatesRemoved = beforeCount - afterCount;
    const durationMs = Date.now() - startTime;

    const result: CleanupResult = {
      success: true,
      partition: currentPartition,
      beforeCount,
      afterCount,
      duplicatesRemoved,
      durationMs,
    };

    console.log(`[cleanup-duplicates] Removed ${duplicatesRemoved.toLocaleString()} duplicates in ${durationMs}ms`);

    await logCronExecution({
      cron_name: 'cleanup-duplicates',
      status: 'success',
      duration_ms: durationMs,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[cleanup-duplicates] Error:', error);

    await logCronExecution({
      cron_name: 'cleanup-duplicates',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message,
    });

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        durationMs,
      } as CleanupResult,
      { status: 500 }
    );
  }
}
