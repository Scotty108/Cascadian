/**
 * API Route: Refresh Category Analytics
 * POST /api/austin/refresh
 *
 * Body:
 * - window: '24h' | '7d' | '30d' | 'lifetime' (default: '30d')
 * - createMV: boolean (default: false) - whether to create materialized view
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  refreshCategoryAnalytics,
  createCategoryAnalyticsMV,
} from '@/lib/metrics/austin-methodology'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const window = (body.window || '30d') as '24h' | '7d' | '30d' | 'lifetime'
    const createMV = body.createMV === true

    console.log(`[API] POST /api/austin/refresh (window: ${window}, createMV: ${createMV})`)

    // Validate window
    if (!['24h', '7d', '30d', 'lifetime'].includes(window)) {
      return NextResponse.json(
        { error: 'Invalid window parameter. Must be: 24h, 7d, 30d, or lifetime' },
        { status: 400 }
      )
    }

    const startTime = Date.now()

    // Refresh analytics
    await refreshCategoryAnalytics(window)

    // Optionally create materialized view
    if (createMV) {
      await createCategoryAnalyticsMV()
    }

    const duration = Date.now() - startTime

    return NextResponse.json({
      success: true,
      window,
      mvCreated: createMV,
      duration,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[API] Failed to refresh analytics:', error)
    return NextResponse.json(
      {
        error: 'Failed to refresh analytics',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
