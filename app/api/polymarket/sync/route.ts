/**
 * POST /api/polymarket/sync
 *
 * Manual sync trigger endpoint
 * Protected by cron secret
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncPolymarketData, getSyncStatus } from '@/lib/polymarket/sync';
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

export const dynamic = 'force-dynamic';

/**
 * POST handler - Trigger sync
 */
export async function POST(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'polymarket-sync');
  if (!authResult.authorized) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.reason,
      },
      { status: 401 }
    );
  }

  try {

    console.log('[Sync API] Manual sync triggered');

    // Run sync
    const result = await syncPolymarketData();

    // Return result
    return NextResponse.json({
      success: result.success,
      markets_synced: result.markets_synced,
      errors: result.errors.length,
      error_details: result.errors.map(e => ({
        error: e.error,
        market_id: e.market_id,
        timestamp: e.timestamp.toISOString(),
      })),
      duration_ms: result.duration_ms,
      timestamp: result.timestamp.toISOString(),
    });

  } catch (error) {
    console.error('[Sync API] Sync failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Sync failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET handler - Get sync status (also used by Vercel cron)
 */
export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'polymarket-sync');
  if (!authResult.authorized) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.reason,
      },
      { status: 401 }
    );
  }

  try {
    const status = await getSyncStatus();

    return NextResponse.json({
      success: true,
      last_synced: status.last_synced?.toISOString() || null,
      is_stale: status.is_stale,
      sync_in_progress: status.sync_in_progress,
    });

  } catch (error) {
    console.error('[Sync API] Failed to get status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get sync status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
