/**
 * DEPRECATED: Polymarket Events API (External Gamma API)
 *
 * This API has been replaced by /api/events (ClickHouse-backed)
 * Redirects to the new faster ClickHouse endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Build new URL preserving query params
  const newUrl = new URL('/api/events', request.url);

  // Map old params to new params
  const limit = searchParams.get('limit') || '100';
  const offset = searchParams.get('offset') || '0';
  const closed = searchParams.get('closed');

  newUrl.searchParams.set('limit', limit);
  newUrl.searchParams.set('offset', offset);
  if (closed === 'true') {
    newUrl.searchParams.set('active', 'false');
  }

  return NextResponse.redirect(newUrl.toString(), { status: 307 });
}
