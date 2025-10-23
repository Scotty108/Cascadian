/**
 * POST /api/polymarket/sync
 *
 * Manual sync trigger endpoint
 * Protected by admin key for debugging and initial data load
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncPolymarketData, getSyncStatus } from '@/lib/polymarket/sync';

export const dynamic = 'force-dynamic';

/**
 * Simple authentication check
 * In production, should use proper API key or Vercel cron secret
 */
function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const adminKey = process.env.ADMIN_API_KEY || process.env.CRON_SECRET;

  // Allow if no admin key configured (development)
  if (!adminKey) {
    return true;
  }

  // Check bearer token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return token === adminKey;
  }

  return false;
}

/**
 * POST handler - Trigger sync
 */
export async function POST(request: NextRequest) {
  try {
    // Check authorization
    if (!isAuthorized(request)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

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
 * GET handler - Get sync status
 */
export async function GET() {
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
