/**
 * DEPRECATED: Polymarket Sync API
 *
 * Supabase sync is no longer needed - all data comes from ClickHouse.
 * Returns a deprecation notice with guidance.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest) {
  return NextResponse.json({
    success: true,
    deprecated: true,
    message: 'Sync is no longer needed. Data is now sourced directly from ClickHouse.',
    migration: {
      old: '/api/polymarket/sync',
      new: 'Data auto-refreshes via cron jobs',
    },
  });
}

export async function GET(_request: NextRequest) {
  return NextResponse.json({
    success: true,
    deprecated: true,
    last_synced: null,
    is_stale: false,
    sync_in_progress: false,
    message: 'Sync status is deprecated. Data is now sourced directly from ClickHouse.',
  });
}
