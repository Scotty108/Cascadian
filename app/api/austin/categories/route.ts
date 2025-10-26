/**
 * API Route: Get All Categories
 * GET /api/austin/categories
 *
 * Query params:
 * - window: '24h' | '7d' | '30d' | 'lifetime' (default: '30d')
 * - limit: number (default: 20)
 * - winnableOnly: boolean (default: false)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  analyzeCategories,
  getWinnableCategories,
  exportCategoryAnalysis,
} from '@/lib/metrics/austin-methodology'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const window = (searchParams.get('window') || '30d') as '24h' | '7d' | '30d' | 'lifetime'
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const winnableOnly = searchParams.get('winnableOnly') === 'true'

    console.log(`[API] GET /api/austin/categories (window: ${window}, limit: ${limit}, winnableOnly: ${winnableOnly})`)

    // Validate window
    if (!['24h', '7d', '30d', 'lifetime'].includes(window)) {
      return NextResponse.json(
        { error: 'Invalid window parameter. Must be: 24h, 7d, 30d, or lifetime' },
        { status: 400 }
      )
    }

    // Get categories
    const categories = winnableOnly
      ? await getWinnableCategories(window, limit)
      : await analyzeCategories(window, limit)

    // Export to JSON format
    const exportedCategories = categories.map(exportCategoryAnalysis)

    return NextResponse.json({
      success: true,
      count: categories.length,
      window,
      limit,
      winnableOnly,
      categories: exportedCategories,
      metadata: {
        timestamp: new Date().toISOString(),
        cached: false, // Could add cache detection
      },
    })
  } catch (error) {
    console.error('[API] Failed to get categories:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch categories',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
