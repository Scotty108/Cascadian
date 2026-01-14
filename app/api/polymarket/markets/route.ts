/**
 * DEPRECATED: Polymarket Markets API (Supabase)
 *
 * This API has been replaced by /api/markets (ClickHouse-backed)
 * Redirects to the new faster ClickHouse endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Build new URL preserving query params
  const newUrl = new URL('/api/markets', request.url);

  // Map old params to new params
  const category = searchParams.get('category');
  const limit = searchParams.get('limit') || '100';
  const offset = searchParams.get('offset') || '0';
  const sort = searchParams.get('sort') || 'volume';

  newUrl.searchParams.set('limit', limit);
  newUrl.searchParams.set('offset', offset);
  if (category) newUrl.searchParams.set('category', category);
  newUrl.searchParams.set('sortBy', sort);

  return NextResponse.redirect(newUrl.toString(), { status: 307 });
}
