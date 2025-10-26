/**
 * Cron Job: Refresh Category Analytics
 * POST /api/cron/refresh-category-analytics
 *
 * Schedule: Every 5 minutes in production
 *
 * This endpoint should be called by:
 * - Vercel Cron (vercel.json)
 * - External cron service (cron-job.org)
 * - Internal scheduler
 */

import { NextRequest, NextResponse } from 'next/server'
import { refreshCategoryAnalytics } from '@/lib/metrics/austin-methodology'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  console.log('[Cron] Starting category analytics refresh...')

  try {
    // Verify cron secret (if provided)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.error('[Cron] Invalid authorization')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Refresh all windows in parallel
    const windows = ['24h', '7d', '30d', 'lifetime'] as const

    const results = await Promise.allSettled(
      windows.map(async (window) => {
        const windowStart = Date.now()
        console.log(`[Cron] Refreshing ${window} window...`)

        try {
          await refreshCategoryAnalytics(window)
          const duration = Date.now() - windowStart
          console.log(`[Cron] ✅ ${window} refreshed in ${duration}ms`)
          return { window, duration, success: true }
        } catch (error) {
          console.error(`[Cron] ❌ ${window} failed:`, error)
          return {
            window,
            duration: Date.now() - windowStart,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      })
    )

    const totalDuration = Date.now() - startTime

    // Summarize results
    const summary = results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        return {
          window: 'unknown',
          duration: 0,
          success: false,
          error: result.reason,
        }
      }
    })

    const successCount = summary.filter((s) => s.success).length
    const failureCount = summary.filter((s) => !s.success).length

    console.log('[Cron] Category analytics refresh complete')
    console.log(`[Cron] Success: ${successCount}, Failed: ${failureCount}`)
    console.log(`[Cron] Total duration: ${totalDuration}ms`)

    return NextResponse.json({
      success: true,
      totalDuration,
      summary,
      successCount,
      failureCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const duration = Date.now() - startTime
    console.error('[Cron] Fatal error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

// Allow GET for manual testing
export async function GET(request: NextRequest) {
  console.log('[Cron] Manual refresh triggered via GET')
  return POST(request)
}
