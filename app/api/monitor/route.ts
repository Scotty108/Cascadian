/**
 * Comprehensive System Monitor
 *
 * Monitors multiple aspects of system health:
 * - Database connectivity and freshness
 * - Data consistency (row counts, recent activity)
 * - Cron execution tracking
 * - Critical table health
 *
 * GET /api/monitor - Full system health check with Discord alerts
 */

import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const maxDuration = 60

const DISCORD_WEBHOOK_URL = process.env.DISCORD_ALERT_WEBHOOK_URL

interface Check {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  value?: string | number
}

// Simple in-memory deduplication (resets on cold start, but prevents spam during hot instances)
let lastAlertHash = ''
let lastAlertTime = 0
const ALERT_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes between identical alerts

async function sendDiscordAlert(checks: Check[], overallStatus: string) {
  if (!DISCORD_WEBHOOK_URL) return

  const failedChecks = checks.filter(c => c.status === 'fail')
  const warnChecks = checks.filter(c => c.status === 'warn')

  if (failedChecks.length === 0 && warnChecks.length === 0) return

  // Create hash of current alert to deduplicate
  const alertHash = JSON.stringify(failedChecks.map(c => c.name).sort())
  const now = Date.now()

  // Skip if same alert was sent recently
  if (alertHash === lastAlertHash && (now - lastAlertTime) < ALERT_COOLDOWN_MS) {
    console.log('[monitor] Skipping duplicate alert, cooldown active')
    return
  }

  lastAlertHash = alertHash
  lastAlertTime = now

  const color = failedChecks.length > 0 ? 0xff0000 : 0xffa500

  const fields = [...failedChecks, ...warnChecks].map(c => ({
    name: `${c.status === 'fail' ? '🔴' : '🟡'} ${c.name}`,
    value: c.message + (c.value ? ` (${c.value})` : ''),
    inline: false
  }))

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Cascadian Monitor',
      embeds: [{
        title: `System Alert: ${overallStatus.toUpperCase()}`,
        description: `${failedChecks.length} critical, ${warnChecks.length} warnings`,
        color,
        fields: fields.slice(0, 10), // Discord limit
        timestamp: new Date().toISOString(),
        footer: { text: 'Cascadian System Monitor' }
      }]
    })
  }).catch(console.error)
}

async function checkDatabaseConnection(): Promise<Check> {
  try {
    const start = Date.now()
    await clickhouse.query({ query: 'SELECT 1', format: 'JSONEachRow' })
    const latency = Date.now() - start

    if (latency > 5000) {
      return { name: 'Database Connection', status: 'warn', message: 'Slow response', value: `${latency}ms` }
    }
    return { name: 'Database Connection', status: 'pass', message: 'Connected', value: `${latency}ms` }
  } catch (err: any) {
    return { name: 'Database Connection', status: 'fail', message: err.message }
  }
}

async function checkTableFreshness(): Promise<Check[]> {
  const checks: Check[] = []

  const tables = [
    { name: 'pm_trader_events_v3', col: 'trade_time', warnMin: 10, failMin: 60 },
    { name: 'pm_canonical_fills_v4', col: 'event_time', warnMin: 30, failMin: 120 },
    { name: 'pm_ctf_split_merge_expanded', col: 'event_timestamp', warnMin: 60, failMin: 240 },
    { name: 'pm_erc1155_transfers', col: 'block_timestamp', warnMin: 180, failMin: 720, where: 'is_deleted = 0' },
  ]

  for (const t of tables) {
    try {
      const where = t.where ? `WHERE ${t.where}` : ''
      const result = await clickhouse.query({
        query: `SELECT dateDiff('minute', max(${t.col}), now()) as mins FROM ${t.name} ${where}`,
        format: 'JSONEachRow'
      })
      const mins = Number((await result.json() as any[])[0]?.mins || 9999)

      let status: 'pass' | 'warn' | 'fail' = 'pass'
      if (mins >= t.failMin) status = 'fail'
      else if (mins >= t.warnMin) status = 'warn'

      checks.push({
        name: `Freshness: ${t.name}`,
        status,
        message: `${mins} minutes behind`,
        value: mins
      })
    } catch (err: any) {
      checks.push({ name: `Freshness: ${t.name}`, status: 'fail', message: err.message })
    }
  }

  return checks
}

async function checkDataConsistency(): Promise<Check[]> {
  const checks: Check[] = []

  // Check for recent trading activity (should have trades in last hour)
  try {
    const recentTrades = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_trader_events_v3 WHERE trade_time >= now() - INTERVAL 1 HOUR`,
      format: 'JSONEachRow'
    })
    const tradeCount = Number((await recentTrades.json() as any[])[0]?.cnt || 0)

    if (tradeCount === 0) {
      checks.push({ name: 'Recent Trading Activity', status: 'warn', message: 'No trades in last hour', value: 0 })
    } else {
      checks.push({ name: 'Recent Trading Activity', status: 'pass', message: 'Active', value: tradeCount })
    }
  } catch (err: any) {
    checks.push({ name: 'Recent Trading Activity', status: 'fail', message: err.message })
  }

  // Check token mapping coverage
  try {
    const unmapped = await clickhouse.query({
      query: `
        SELECT count() as cnt FROM (
          SELECT DISTINCT token_id FROM pm_trader_events_v3
          WHERE trade_time >= now() - INTERVAL 24 HOUR
        ) t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE m.token_id_dec IS NULL
      `,
      format: 'JSONEachRow'
    })
    const unmappedCount = Number((await unmapped.json() as any[])[0]?.cnt || 0)

    if (unmappedCount > 10) {
      checks.push({ name: 'Token Mapping', status: 'warn', message: `${unmappedCount} unmapped tokens (24h)`, value: unmappedCount })
    } else {
      checks.push({ name: 'Token Mapping', status: 'pass', message: 'Healthy', value: unmappedCount })
    }
  } catch (err: any) {
    checks.push({ name: 'Token Mapping', status: 'fail', message: err.message })
  }

  return checks
}

async function checkRowCounts(): Promise<Check[]> {
  const checks: Check[] = []

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          'pm_trader_events_v3' as tbl, count() as cnt FROM pm_trader_events_v3
        UNION ALL
        SELECT 'pm_canonical_fills_v4', count() FROM pm_canonical_fills_v4
        UNION ALL
        SELECT 'pm_token_to_condition_map_v5', count() FROM pm_token_to_condition_map_v5
      `,
      format: 'JSONEachRow'
    })
    const rows = await result.json() as any[]

    for (const r of rows) {
      const cnt = Number(r.cnt)
      // Alert if tables are suspiciously empty
      if (cnt < 1000) {
        checks.push({ name: `Row Count: ${r.tbl}`, status: 'fail', message: 'Table nearly empty', value: cnt })
      }
    }

    if (checks.length === 0) {
      checks.push({ name: 'Row Counts', status: 'pass', message: 'All tables have data' })
    }
  } catch (err: any) {
    checks.push({ name: 'Row Counts', status: 'fail', message: err.message })
  }

  return checks
}

export async function GET() {
  const startTime = Date.now()
  const allChecks: Check[] = []

  // Run all checks
  allChecks.push(await checkDatabaseConnection())
  allChecks.push(...await checkTableFreshness())
  allChecks.push(...await checkDataConsistency())
  allChecks.push(...await checkRowCounts())

  const failCount = allChecks.filter(c => c.status === 'fail').length
  const warnCount = allChecks.filter(c => c.status === 'warn').length

  let overallStatus = 'healthy'
  if (failCount > 0) overallStatus = 'critical'
  else if (warnCount > 0) overallStatus = 'degraded'

  // Send Discord alert if issues found
  await sendDiscordAlert(allChecks, overallStatus)

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    summary: {
      total: allChecks.length,
      pass: allChecks.filter(c => c.status === 'pass').length,
      warn: warnCount,
      fail: failCount
    },
    checks: allChecks
  })
}
