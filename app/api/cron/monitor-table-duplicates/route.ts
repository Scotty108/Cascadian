/**
 * Cron: Monitor Table Duplicates
 *
 * Checks duplicate rates in source tables and alerts if thresholds exceeded.
 * Part of systematic deduplication strategy (Layer 4).
 *
 * Schedule: Daily at 9am UTC (0 9 * * *)
 * Timeout: 5 minutes
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse/client';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

interface DuplicateStats {
  table_name: string;
  total_rows: number;
  unique_keys: number;
  duplicates: number;
  duplicate_pct: number;
  time_window: string;
}

const ALERT_THRESHOLD = 5.0; // Alert if >5% duplicates in last 7 days

async function checkCanonicalFills(client: any): Promise<DuplicateStats> {
  const result = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        uniqExact(fill_id) as unique_keys
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  const row = rows[0];

  return {
    table_name: 'pm_canonical_fills_v4',
    total_rows: row.total_rows,
    unique_keys: row.unique_keys,
    duplicates: row.total_rows - row.unique_keys,
    duplicate_pct: parseFloat((((row.total_rows - row.unique_keys) * 100.0) / row.total_rows).toFixed(2)),
    time_window: '7 days',
  };
}

async function checkFifoTrades(client: any): Promise<DuplicateStats> {
  const result = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        uniqExact((wallet, condition_id, outcome_index)) as unique_keys
      FROM pm_trade_fifo_roi_v3_deduped FINAL
      WHERE resolved_at >= now() - INTERVAL 7 DAY
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  const row = rows[0];

  return {
    table_name: 'pm_trade_fifo_roi_v3',
    total_rows: row.total_rows,
    unique_keys: row.unique_keys,
    duplicates: row.total_rows - row.unique_keys,
    duplicate_pct: parseFloat((((row.total_rows - row.unique_keys) * 100.0) / row.total_rows).toFixed(2)),
    time_window: '7 days',
  };
}

async function checkTraderEvents(client: any): Promise<DuplicateStats> {
  const result = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        uniqExact(event_id) as unique_keys
      FROM pm_trader_events_v2
      WHERE trade_time >= now() - INTERVAL 7 DAY
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  const row = rows[0];

  return {
    table_name: 'pm_trader_events_v2',
    total_rows: row.total_rows,
    unique_keys: row.unique_keys,
    duplicates: row.total_rows - row.unique_keys,
    duplicate_pct: parseFloat((((row.total_rows - row.unique_keys) * 100.0) / row.total_rows).toFixed(2)),
    time_window: '7 days',
  };
}

export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'monitor-table-duplicates');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const client = getClickHouseClient();

    // Check all three critical tables
    const [canonicalStats, fifoStats, eventsStats] = await Promise.all([
      checkCanonicalFills(client),
      checkFifoTrades(client),
      checkTraderEvents(client),
    ]);

    const allStats = [canonicalStats, fifoStats, eventsStats];
    const alertTables = allStats.filter((s) => s.duplicate_pct > ALERT_THRESHOLD);

    const duration = (Date.now() - startTime) / 1000;

    // Alert if any table exceeds threshold
    if (alertTables.length > 0) {
      console.error('⚠️  DUPLICATE ALERT:', alertTables);
      // TODO: Send Discord alert
      // await sendDiscordAlert(`Duplicate rate alert: ${alertTables.map(t => t.table_name).join(', ')}`);
    }

    return NextResponse.json({
      success: true,
      stats: allStats,
      alerts: alertTables.length > 0 ? alertTables : null,
      threshold_pct: ALERT_THRESHOLD,
      duration: `${duration.toFixed(1)}s`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Duplicate monitoring failed:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
