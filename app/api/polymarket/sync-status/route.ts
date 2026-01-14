/**
 * DEPRECATED: Polymarket Sync Status API
 *
 * Supabase sync is no longer needed - all data comes from ClickHouse.
 * Returns a deprecation notice.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request) {
  return NextResponse.json({
    success: true,
    deprecated: true,
    last_sync_timestamp: Date.now(),
    is_stale: false,
    sync_in_progress: false,
    last_synced: new Date().toISOString(),
    message: 'Sync status is deprecated. Data is now sourced directly from ClickHouse and auto-refreshes via cron.',
  });
}
