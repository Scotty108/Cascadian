/**
 * Cron Execution Tracker
 *
 * Logs cron executions to ClickHouse and sends Discord alerts on failures.
 * Use this to wrap cron handlers for automatic tracking.
 */

import { clickhouse } from '@/lib/clickhouse/client'

const DISCORD_WEBHOOK_URL = process.env.DISCORD_ALERT_WEBHOOK_URL

interface CronExecution {
  cron_name: string
  status: 'success' | 'failure'
  duration_ms: number
  error_message?: string
  details?: Record<string, any>
}

// Ensure the tracking table exists
async function ensureTrackingTable() {
  try {
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS cron_executions (
          cron_name String,
          executed_at DateTime DEFAULT now(),
          status String,
          duration_ms UInt32,
          error_message String DEFAULT '',
          details String DEFAULT '{}'
        ) ENGINE = MergeTree()
        ORDER BY (cron_name, executed_at)
        TTL executed_at + INTERVAL 30 DAY
      `
    })
  } catch (err) {
    console.error('[cron-tracker] Failed to create tracking table:', err)
  }
}

export async function logCronExecution(execution: CronExecution) {
  await ensureTrackingTable()

  try {
    await clickhouse.insert({
      table: 'cron_executions',
      values: [{
        cron_name: execution.cron_name,
        status: execution.status,
        duration_ms: execution.duration_ms,
        error_message: execution.error_message || '',
        details: JSON.stringify(execution.details || {})
      }],
      format: 'JSONEachRow'
    })
  } catch (err) {
    console.error('[cron-tracker] Failed to log execution:', err)
  }

  // Send Discord alert on failure
  if (execution.status === 'failure' && DISCORD_WEBHOOK_URL) {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Cron Monitor',
        embeds: [{
          title: `🔴 Cron Failed: ${execution.cron_name}`,
          color: 0xff0000,
          fields: [
            { name: 'Error', value: execution.error_message?.slice(0, 500) || 'Unknown error', inline: false },
            { name: 'Duration', value: `${execution.duration_ms}ms`, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      })
    }).catch(console.error)
  }
}

export async function getCronHealth(): Promise<{
  cron_name: string
  last_run: string
  last_status: string
  success_rate_24h: number
  runs_24h: number
  avg_duration_ms: number
}[]> {
  await ensureTrackingTable()

  const result = await clickhouse.query({
    query: `
      SELECT
        cron_name,
        max(executed_at) as last_run,
        argMax(status, executed_at) as last_status,
        round(countIf(status = 'success') * 100.0 / count(), 1) as success_rate_24h,
        count() as runs_24h,
        round(avg(duration_ms)) as avg_duration_ms
      FROM cron_executions
      WHERE executed_at >= now() - INTERVAL 24 HOUR
      GROUP BY cron_name
      ORDER BY cron_name
    `,
    format: 'JSONEachRow'
  })

  return await result.json() as any[]
}
