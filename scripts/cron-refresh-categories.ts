/**
 * Cron Script: Refresh Category Analytics
 *
 * Run this script on a schedule to keep category analytics up to date.
 *
 * Usage:
 *   npx tsx scripts/cron-refresh-categories.ts
 *
 * Recommended schedule:
 *   - Production: Every 5 minutes
 *   - Development: Every 30 minutes
 */

import { refreshCategoryAnalytics } from '@/lib/metrics/austin-methodology'

const WINDOWS = ['24h', '7d', '30d', 'lifetime'] as const

async function main() {
  const startTime = Date.now()
  console.log('🔄 Starting category analytics refresh...')
  console.log(`   Time: ${new Date().toISOString()}`)
  console.log(`   Windows: ${WINDOWS.join(', ')}`)
  console.log('')

  const results = []

  for (const window of WINDOWS) {
    const windowStart = Date.now()
    console.log(`⏳ Refreshing ${window} window...`)

    try {
      await refreshCategoryAnalytics(window)
      const duration = Date.now() - windowStart
      console.log(`✅ ${window} refreshed in ${duration}ms`)
      results.push({ window, success: true, duration })
    } catch (error) {
      const duration = Date.now() - windowStart
      console.error(`❌ ${window} failed:`, error)
      results.push({
        window,
        success: false,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    console.log('')
  }

  const totalDuration = Date.now() - startTime
  const successCount = results.filter((r) => r.success).length
  const failureCount = results.filter((r) => !r.success).length

  console.log('📊 Refresh Summary:')
  console.log(`   Total Duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`)
  console.log(`   Success: ${successCount}/${WINDOWS.length}`)
  console.log(`   Failed: ${failureCount}/${WINDOWS.length}`)
  console.log('')

  results.forEach((result) => {
    const status = result.success ? '✅' : '❌'
    const duration = `${result.duration}ms`
    const error = result.success ? '' : ` - ${result.error}`
    console.log(`   ${status} ${result.window.padEnd(10)} ${duration.padStart(8)}${error}`)
  })

  if (failureCount > 0) {
    console.error('\n⚠️  Some windows failed to refresh. Check logs above.')
    process.exit(1)
  } else {
    console.log('\n✅ All windows refreshed successfully!')
    process.exit(0)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
