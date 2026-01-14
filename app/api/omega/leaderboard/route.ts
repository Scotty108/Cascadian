/**
 * DEPRECATED: Omega Leaderboard API (v2)
 *
 * This API has been replaced by /api/wio/leaderboard
 * Redirects to the new WIO-powered unified leaderboard.
 *
 * Query params preserved:
 *   - limit: number (default: 100)
 *   - window: 30d | 90d | lifetime → maps to WIO window
 *   - category: string → maps to WIO category filter
 */

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') || '100';
  const window = searchParams.get('window') || 'lifetime';
  const category = searchParams.get('category');
  const sortBy = searchParams.get('sort_by') || 'omega_ratio';

  // Map old sort params to WIO equivalents
  const sortMapping: Record<string, string> = {
    'omega_ratio': 'credibility',
    'omega_net': 'credibility',
    'pnl': 'pnl',
    'win_rate': 'roi',
    'sharpe': 'credibility',
  };

  // Redirect to WIO leaderboard
  const wioUrl = new URL('/api/wio/leaderboard', request.url);
  wioUrl.searchParams.set('limit', limit);
  wioUrl.searchParams.set('sortBy', sortMapping[sortBy] || 'credibility');
  wioUrl.searchParams.set('sortDir', 'desc');

  // Map window parameter
  if (window === '30d') {
    wioUrl.searchParams.set('window', '30d');
  } else if (window === '90d') {
    wioUrl.searchParams.set('window', '90d');
  }
  // Default is ALL for WIO

  // Pass through category filter if specified
  if (category && category !== 'all') {
    wioUrl.searchParams.set('category', category);
  }

  return NextResponse.redirect(wioUrl.toString(), { status: 307 });
}
