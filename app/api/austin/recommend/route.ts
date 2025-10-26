/**
 * API Route: Get Category Recommendation
 * GET /api/austin/recommend
 *
 * Query params:
 * - preferred: comma-separated list of preferred categories
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getCategoryRecommendation,
  exportCategoryAnalysis,
} from '@/lib/metrics/austin-methodology'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const preferred = searchParams.get('preferred')
    const preferredCategories = preferred ? preferred.split(',').map((c) => c.trim()) : undefined

    console.log(
      `[API] GET /api/austin/recommend (preferred: ${preferredCategories?.join(', ') || 'none'})`
    )

    // Get recommendation
    const recommendation = await getCategoryRecommendation(preferredCategories)

    if (!recommendation) {
      return NextResponse.json(
        { error: 'No suitable category found' },
        { status: 404 }
      )
    }

    // Export to JSON format
    const exported = exportCategoryAnalysis(recommendation)

    return NextResponse.json({
      success: true,
      recommendation: exported,
      metadata: {
        timestamp: new Date().toISOString(),
        preferredCategories: preferredCategories || [],
      },
    })
  } catch (error) {
    console.error('[API] Failed to get recommendation:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch recommendation',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
