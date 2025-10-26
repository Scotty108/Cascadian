/**
 * API Route: Get Specific Category Analysis
 * GET /api/austin/categories/[category]
 *
 * Query params:
 * - window: '24h' | '7d' | '30d' | 'lifetime' (default: '30d')
 * - includeMarkets: boolean (default: true)
 * - includeSpecialists: boolean (default: true)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getCategoryAnalysis,
  exportCategoryAnalysis,
} from '@/lib/metrics/austin-methodology'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    const { category: rawCategory } = await params
    const category = decodeURIComponent(rawCategory)
    const searchParams = request.nextUrl.searchParams
    const window = (searchParams.get('window') || '30d') as '24h' | '7d' | '30d' | 'lifetime'
    const includeMarkets = searchParams.get('includeMarkets') !== 'false'
    const includeSpecialists = searchParams.get('includeSpecialists') !== 'false'

    console.log(
      `[API] GET /api/austin/categories/${category} (window: ${window}, markets: ${includeMarkets}, specialists: ${includeSpecialists})`
    )

    // Validate window
    if (!['24h', '7d', '30d', 'lifetime'].includes(window)) {
      return NextResponse.json(
        { error: 'Invalid window parameter. Must be: 24h, 7d, 30d, or lifetime' },
        { status: 400 }
      )
    }

    // Get category analysis
    const analysis = await getCategoryAnalysis(
      category,
      window,
      includeMarkets,
      includeSpecialists
    )

    if (!analysis) {
      return NextResponse.json(
        { error: `Category not found: ${category}` },
        { status: 404 }
      )
    }

    // Export to JSON format
    const exported = exportCategoryAnalysis(analysis)

    return NextResponse.json({
      success: true,
      category,
      window,
      analysis: exported,
      metadata: {
        timestamp: new Date().toISOString(),
        includeMarkets,
        includeSpecialists,
      },
    })
  } catch (error) {
    console.error('[API] Failed to get category analysis:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch category analysis',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
