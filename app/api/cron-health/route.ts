/**
 * Cron Health Monitor
 *
 * Checks if all crons are running on schedule and alerts if overdue.
 * Runs every hour to catch missed executions.
 */

import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { getCronHealth } from '@/lib/alerts/cron-tracker'

export const runtime = 'nodejs'
export const maxDuration = 30

const DISCORD_WEBHOOK_URL = process.env.DISCORD_ALERT_WEBHOOK_URL

// Expected cron schedules (max minutes between runs)
const CRON_SCHEDULES: Record<string, number> = {
  'sync-erc1155': 60,           // Every 30 min, alert if >60 min
  'sync-ctf-expanded': 60,      // Every 30 min
  'update-canonical-fills': 30, // Every 10 min, alert if >30 min
  'sync-metadata': 30,          // Every 10 min
  'health': 30,                 // Every 15 min
  'monitor': 60,                // Every 30 min
  'refresh-wallets': 60,        // Every 30 min
}

interface CronStatus {
  name: string
  status: 'healthy' | 'warning' | 'critical' | 'unknown'
  lastRun: string | null
  minutesSinceRun: number
  successRate: number
  message: string
}

export async function GET() {
  const startTime = Date.now()
  const statuses: CronStatus[] = []

  try {
    // Get cron execution history
    const cronHealth = await getCronHealth()
    const healthMap = new Map(cronHealth.map(c => [c.cron_name, c]))

    // Check each expected cron
    for (const [cronName, maxMinutes] of Object.entries(CRON_SCHEDULES)) {
      const health = healthMap.get(cronName)

      if (!health) {
        statuses.push({
          name: cronName,
          status: 'unknown',
          lastRun: null,
          minutesSinceRun: -1,
          successRate: 0,
          message: 'No executions recorded'
        })
        continue
      }

      const lastRunTime = new Date(health.last_run + 'Z').getTime()
      const minutesSinceRun = Math.round((Date.now() - lastRunTime) / 60000)

      let status: 'healthy' | 'warning' | 'critical' = 'healthy'
      let message = 'Running normally'

      if (minutesSinceRun > maxMinutes * 2) {
        status = 'critical'
        message = `Overdue by ${minutesSinceRun - maxMinutes} minutes`
      } else if (minutesSinceRun > maxMinutes) {
        status = 'warning'
        message = `Slightly overdue`
      } else if (health.last_status === 'failure') {
        status = 'warning'
        message = 'Last run failed'
      }

      if (health.success_rate_24h < 80) {
        status = 'critical'
        message = `Low success rate: ${health.success_rate_24h}%`
      }

      statuses.push({
        name: cronName,
        status,
        lastRun: health.last_run,
        minutesSinceRun,
        successRate: health.success_rate_24h,
        message
      })
    }

    // Alert on critical crons
    const criticalCrons = statuses.filter(s => s.status === 'critical')
    const warningCrons = statuses.filter(s => s.status === 'warning')

    if (criticalCrons.length > 0 && DISCORD_WEBHOOK_URL) {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'Cron Health Monitor',
          embeds: [{
            title: `⚠️ Cron Schedule Alert`,
            description: `${criticalCrons.length} critical, ${warningCrons.length} warnings`,
            color: 0xff0000,
            fields: criticalCrons.map(c => ({
              name: `🔴 ${c.name}`,
              value: c.message,
              inline: true
            })),
            timestamp: new Date().toISOString()
          }]
        })
      }).catch(console.error)
    }

    const overallStatus = criticalCrons.length > 0 ? 'critical' :
                          warningCrons.length > 0 ? 'warning' : 'healthy'

    return NextResponse.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      summary: {
        healthy: statuses.filter(s => s.status === 'healthy').length,
        warning: warningCrons.length,
        critical: criticalCrons.length,
        unknown: statuses.filter(s => s.status === 'unknown').length
      },
      crons: statuses
    })
  } catch (error: any) {
    return NextResponse.json({
      status: 'error',
      error: error.message,
      durationMs: Date.now() - startTime
    }, { status: 500 })
  }
}
