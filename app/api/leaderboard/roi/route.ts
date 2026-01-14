/**
 * DEPRECATED: ROI Leaderboard API
 *
 * This API has been replaced by /api/wio/leaderboard
 * Redirects to the new WIO-powered unified leaderboard with ROI sorting.
 */

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') || '50';

  // Redirect to WIO leaderboard with ROI sorting
  const wioUrl = new URL('/api/wio/leaderboard', request.url);
  wioUrl.searchParams.set('limit', limit);
  wioUrl.searchParams.set('sortBy', 'roi');
  wioUrl.searchParams.set('sortDir', 'desc');

  return NextResponse.redirect(wioUrl.toString(), { status: 307 });
}
