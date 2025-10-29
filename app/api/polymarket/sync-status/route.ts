/**
 * GET /api/polymarket/sync-status
 *
 * Lightweight endpoint to check if data has changed
 * Clients poll this instead of fetching full data
 */

import { NextResponse } from 'next/server';
import { getLastSyncTimestamp, isClientDataStale } from '@/lib/cache/cache-invalidation';
import { getSyncStatus } from '@/lib/polymarket/sync';

export const dynamic = 'force-dynamic';

/**
 * GET handler
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientTimestamp = parseInt(searchParams.get('client_ts') || '0', 10);

    const lastSync = getLastSyncTimestamp();
    const isStale = isClientDataStale(clientTimestamp);
    const syncStatus = await getSyncStatus();

    return NextResponse.json({
      success: true,
      last_sync_timestamp: lastSync,
      is_stale: isStale,
      sync_in_progress: syncStatus.sync_in_progress,
      last_synced: syncStatus.last_synced?.toISOString(),
    });
  } catch (error) {
    console.error('[API] Sync status error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get sync status',
      },
      { status: 500 }
    );
  }
}
