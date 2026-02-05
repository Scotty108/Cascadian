/**
 * System Health Check Endpoint
 *
 * Two modes:
 * 1. Fast liveness (default): Returns 200 OK immediately with cached deep-check data.
 *    Never queries ClickHouse. UptimeRobot and external monitors should hit this.
 * 2. Deep check (cron or ?deep=true): Runs ClickHouse freshness queries, triggers
 *    self-healing crons, and sends Discord alerts. Results are cached for the fast path.
 *
 * The Vercel cron (every 15 min) triggers the deep check automatically.
 *
 * GET /api/health          - Fast liveness (no ClickHouse, always fast)
 * GET /api/health?deep=true - Deep check (queries ClickHouse)
 */

import { NextRequest, NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { sendCronFailureAlert } from '@/lib/alerts/discord'

export const runtime = 'nodejs'
export const maxDuration = 120 // Only used during deep checks (cron-triggered)

// Alert rate limiting - only send same alert once per hour
const ALERT_COOLDOWN_MINUTES = 60

// Self-healing: map tables to their refresh crons
const TABLE_TO_CRON: Record<string, string> = {
  pm_canonical_fills_v4: 'update-canonical-fills',
  pm_ctf_split_merge_expanded: 'sync-ctf-expanded',
  pm_erc1155_transfers: 'sync-erc1155',
  pm_market_metadata: 'sync-metadata',
  pm_condition_resolutions: 'sync-ctf-expanded',
  wio_positions_v1: 'sync-wio-positions',
  wio_open_snapshots_v1: 'refresh-wio-snapshots',
  wio_market_snapshots_v1: 'refresh-wio-snapshots',
  wio_dot_events_v1: 'refresh-wio-scores',
}

// Cron Watcher: expected run intervals (in minutes) - trigger if overdue by 50%
const CRON_INTERVALS: Record<string, number> = {
  'update-canonical-fills': 10,
  'sync-metadata': 10,
  'sync-ctf-expanded': 30,
  'sync-erc1155': 30,
  'rebuild-token-map': 30,
  'update-price-snapshots': 15,
  'update-mark-prices': 15,
}

// ============================================================
// In-memory cache for deep check results
// ============================================================
interface CachedHealthResult {
  timestamp: string
  durationMs: number
  status: 'healthy' | 'warning' | 'critical'
  summary: { healthy: number; warning: number; critical: number }
  goldsky: {
    status: string
    tables: { table: string; minutesBehind: number; status: string }[]
    message: string
  }
  selfHealing: Record<string, any> | null
  tables: TableHealth[]
}

let cachedResult: CachedHealthResult | null = null
let lastDeepCheckTime = 0

// ============================================================
// Table health types and thresholds
// ============================================================
interface TableHealth {
  table: string
  latest: string
  minutesBehind: number
  status: 'healthy' | 'warning' | 'critical'
  threshold: { warning: number; critical: number }
  source?: 'goldsky' | 'alchemy' | 'cron' | 'api'
}

const GOLDSKY_TABLES = ['pm_trader_events_v3', 'pm_ctf_events']

const TABLE_THRESHOLDS: Record<string, { warning: number; critical: number }> = {
  pm_trader_events_v3: { warning: 10, critical: 30 },
  pm_ctf_events: { warning: 10, critical: 30 },
  pm_canonical_fills_v4: { warning: 60, critical: 180 },
  pm_ctf_split_merge_expanded: { warning: 60, critical: 180 },
  pm_erc1155_transfers: { warning: 120, critical: 360 },
  pm_market_metadata: { warning: 120, critical: 360 },
  pm_condition_resolutions: { warning: 60, critical: 180 },
  pm_negrisk_token_map_v1: { warning: 4320, critical: 10080 },
  pm_token_to_condition_map_v5: { warning: 360, critical: 720 },
  wio_positions_v1: { warning: 10080, critical: 43200 },
  wio_open_snapshots_v1: { warning: 180, critical: 360 },
  wio_market_snapshots_v1: { warning: 180, critical: 360 },
  wio_dot_events_v1: { warning: 1440, critical: 2880 },
}

function getTableSource(table: string): 'goldsky' | 'alchemy' | 'cron' | 'api' {
  if (GOLDSKY_TABLES.includes(table)) return 'goldsky'
  if (table === 'pm_erc1155_transfers') return 'alchemy'
  if (table === 'pm_market_metadata') return 'api'
  return 'cron'
}

// ============================================================
// Self-healing helpers
// ============================================================
async function getOverdueCrons(): Promise<string[]> {
  try {
    const cronNames = Object.keys(CRON_INTERVALS)
    const placeholders = cronNames.map(n => `'${n}'`).join(',')

    const result = await clickhouse.query({
      query: `
        SELECT
          cron_name,
          max(executed_at) as last_run,
          dateDiff('minute', max(executed_at), now()) as mins_ago
        FROM cron_executions
        WHERE cron_name IN (${placeholders})
          AND status = 'success'
          AND executed_at > now() - INTERVAL 6 HOUR
        GROUP BY cron_name
      `,
      format: 'JSONEachRow'
    })

    const rows = await result.json() as { cron_name: string; mins_ago: number }[]
    const lastRuns = new Map(rows.map(r => [r.cron_name, r.mins_ago]))

    const overdue: string[] = []
    for (const [cronName, interval] of Object.entries(CRON_INTERVALS)) {
      const minsAgo = lastRuns.get(cronName) ?? 999
      if (minsAgo > interval * 1.5) {
        overdue.push(cronName)
      }
    }

    return overdue
  } catch (e) {
    console.error('[cron-watcher] Failed to check overdue crons:', e)
    return []
  }
}

async function triggerCron(cronName: string): Promise<boolean> {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://cascadian.vercel.app'
    const cronSecret = process.env.CRON_SECRET

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    fetch(`${baseUrl}/api/cron/${cronName}`, {
      method: 'GET',
      headers: cronSecret ? { 'Authorization': `Bearer ${cronSecret}` } : {},
      signal: controller.signal,
    }).then(response => {
      clearTimeout(timeoutId)
      console.log(`[self-heal] Triggered ${cronName}: ${response.status}`)
    }).catch(e => {
      clearTimeout(timeoutId)
      if (e.name !== 'AbortError') {
        console.error(`[self-heal] Failed to trigger ${cronName}:`, e)
      } else {
        console.log(`[self-heal] Started ${cronName} (not waiting for completion)`)
      }
    })

    return true
  } catch (e) {
    console.error(`[self-heal] Failed to trigger ${cronName}:`, e)
    return false
  }
}

async function shouldSendAlert(alertKey: string, severity: 'warning' | 'error'): Promise<boolean> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM health_alerts
        WHERE alert_key = '${alertKey}'
          AND severity = '${severity}'
          AND sent_at > now() - INTERVAL ${ALERT_COOLDOWN_MINUTES} MINUTE
      `,
      format: 'JSONEachRow'
    })
    const row = (await result.json() as any[])[0]
    return Number(row?.cnt || 0) === 0
  } catch {
    return true
  }
}

async function recordHealingAttempt(table: string, cronName: string): Promise<void> {
  try {
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS health_healing_attempts (
          table_name String,
          cron_name String,
          attempted_at DateTime DEFAULT now(),
          resolved UInt8 DEFAULT 0
        ) ENGINE = MergeTree()
        ORDER BY (table_name, attempted_at)
        TTL attempted_at + INTERVAL 1 DAY
      `
    })
    await clickhouse.command({
      query: `INSERT INTO health_healing_attempts (table_name, cron_name) VALUES ('${table}', '${cronName}')`
    })
  } catch (e) {
    console.error('Failed to record healing attempt:', e)
  }
}

async function markHealingResolved(table: string): Promise<void> {
  try {
    await clickhouse.command({
      query: `
        ALTER TABLE health_healing_attempts
        UPDATE resolved = 1
        WHERE table_name = '${table}' AND attempted_at > now() - INTERVAL 1 HOUR
      `
    })
  } catch {
    // Ignore - table might not exist
  }
}

async function recordAlert(alertKey: string, severity: 'warning' | 'error'): Promise<void> {
  try {
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS health_alerts (
          alert_key String,
          severity String,
          sent_at DateTime DEFAULT now()
        ) ENGINE = MergeTree()
        ORDER BY (alert_key, sent_at)
        TTL sent_at + INTERVAL 7 DAY
      `
    })
    await clickhouse.command({
      query: `INSERT INTO health_alerts (alert_key, severity) VALUES ('${alertKey}', '${severity}')`
    })
  } catch (e) {
    console.error('Failed to record alert:', e)
  }
}

// ============================================================
// Deep health check (runs during cron or ?deep=true)
// ============================================================
async function runDeepHealthCheck(): Promise<CachedHealthResult> {
  const startTime = Date.now()

  const result = await clickhouse.query({
    query: `
      SELECT 'pm_trader_events_v3' as tbl, abs(dateDiff('minute', trade_time, now())) as mins FROM pm_trader_events_v3 ORDER BY trade_time DESC LIMIT 1
      UNION ALL SELECT 'pm_ctf_events', abs(dateDiff('minute', event_timestamp, now())) FROM pm_ctf_events ORDER BY event_timestamp DESC LIMIT 1
      UNION ALL SELECT 'pm_canonical_fills_v4', abs(dateDiff('minute', event_time, now())) FROM pm_canonical_fills_v4 ORDER BY event_time DESC LIMIT 1
      UNION ALL SELECT 'pm_ctf_split_merge_expanded', abs(dateDiff('minute', event_timestamp, now())) FROM pm_ctf_split_merge_expanded ORDER BY event_timestamp DESC LIMIT 1
      UNION ALL SELECT 'pm_erc1155_transfers', abs(dateDiff('minute', block_timestamp, now())) FROM pm_erc1155_transfers WHERE is_deleted = 0 ORDER BY block_timestamp DESC LIMIT 1
      UNION ALL SELECT 'pm_market_metadata', abs(dateDiff('minute', fromUnixTimestamp64Milli(ingested_at), now())) FROM pm_market_metadata ORDER BY ingested_at DESC LIMIT 1
    `,
    format: 'JSONEachRow'
  })

  const rows = await result.json() as { tbl: string; mins: number }[]

  const checks: TableHealth[] = rows.map(row => {
    const threshold = TABLE_THRESHOLDS[row.tbl] || { warning: 60, critical: 180 }
    const source = getTableSource(row.tbl)
    const mins = row.mins !== undefined && row.mins !== null ? Math.abs(Number(row.mins)) : 9999

    let status: 'healthy' | 'warning' | 'critical' = 'healthy'
    if (mins >= threshold.critical) status = 'critical'
    else if (mins >= threshold.warning) status = 'warning'

    return {
      table: row.tbl,
      latest: 'n/a',
      minutesBehind: mins,
      status,
      threshold,
      source
    }
  })

  const criticalTables = checks.filter(c => c.status === 'critical')
  const warningTables = checks.filter(c => c.status === 'warning')

  // Self-healing: trigger crons for stale tables
  const healingResults: Record<string, boolean> = {}
  const healingTriggered: string[] = []
  const staleTables = [...criticalTables, ...warningTables]

  for (const table of staleTables) {
    const cronName = TABLE_TO_CRON[table.table]
    if (cronName && !healingResults[cronName]) {
      healingResults[cronName] = await triggerCron(cronName)
      healingTriggered.push(table.table)
      await recordHealingAttempt(table.table, cronName)
    }
  }

  // Mark healthy tables as resolved
  const healthyTables = checks.filter(c => c.status === 'healthy')
  for (const table of healthyTables) {
    markHealingResolved(table.table).catch(() => {})
  }

  // Cron watcher: trigger overdue crons
  let overdueCrons: string[] = []
  try {
    overdueCrons = await getOverdueCrons()
    for (const cronName of overdueCrons) {
      if (!healingResults[cronName]) {
        healingResults[cronName] = true
        triggerCron(cronName).catch(() => {})
        console.log(`[cron-watcher] Triggered overdue cron: ${cronName}`)
      }
    }
  } catch {
    // Non-critical
  }

  // GoldSky health
  const goldskyTables = checks.filter(c => c.source === 'goldsky')
  const goldskyStatus = goldskyTables.some(c => c.status === 'critical') ? 'critical' :
                        goldskyTables.some(c => c.status === 'warning') ? 'warning' : 'healthy'

  const overallStatus = criticalTables.length > 0 ? 'critical' :
                        warningTables.length > 0 ? 'warning' : 'healthy'

  // Discord alerts (only if no healing was triggered this run)
  const healingWasTriggered = Object.keys(healingResults).length > 0

  if (!healingWasTriggered && (criticalTables.length > 0 || warningTables.length > 0)) {
    const goldskyDown = criticalTables.filter(t => t.source === 'goldsky')
    if (goldskyDown.length > 0) {
      const alertKey = 'goldsky-critical'
      shouldSendAlert(alertKey, 'error').then(shouldSend => {
        if (shouldSend) {
          sendCronFailureAlert({
            cronName: 'goldsky-feed',
            error: `EXTERNAL DATA FEED DOWN - GoldSky not streaming (DATA LOSS RISK)`,
            details: Object.fromEntries(goldskyDown.map(t => [t.table, `${t.minutesBehind} min behind`])),
            severity: 'error'
          }).catch(e => console.error('[health] Discord alert failed:', e))
          recordAlert(alertKey, 'error').catch(e => console.error('[health] Record alert failed:', e))
        }
      })
    }

    const otherStale = [...criticalTables, ...warningTables].filter(t => t.source !== 'goldsky')
    if (otherStale.length > 0) {
      const hasCritical = otherStale.some(t => t.status === 'critical')
      const alertKey = `system-${hasCritical ? 'critical' : 'warning'}-${otherStale.map(t => t.table).sort().join(',')}`
      const severity = hasCritical ? 'error' : 'warning'
      shouldSendAlert(alertKey, severity).then(shouldSend => {
        if (shouldSend) {
          sendCronFailureAlert({
            cronName: 'system-health',
            error: `${otherStale.length} table(s) still stale after self-healing attempt`,
            details: Object.fromEntries(otherStale.map(t => [t.table, `${t.minutesBehind} min behind (threshold: ${t.threshold.warning}, source: ${t.source})`])),
            severity
          }).catch(e => console.error('[health] Discord alert failed:', e))
          recordAlert(alertKey, severity).catch(e => console.error('[health] Record alert failed:', e))
        }
      })
    }
  }

  return {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    status: overallStatus,
    summary: {
      healthy: checks.filter(c => c.status === 'healthy').length,
      warning: warningTables.length,
      critical: criticalTables.length
    },
    goldsky: {
      status: goldskyStatus,
      tables: goldskyTables.map(t => ({ table: t.table, minutesBehind: t.minutesBehind, status: t.status })),
      message: goldskyStatus === 'critical'
        ? 'CRITICAL: GoldSky feed down - data loss occurring!'
        : goldskyStatus === 'warning'
        ? 'WARNING: GoldSky feed delayed'
        : 'GoldSky streaming normally'
    },
    selfHealing: Object.keys(healingResults).length > 0 ? {
      triggered: Object.keys(healingResults),
      tablesHealing: healingTriggered,
      overdueCrons,
      message: overdueCrons.length > 0
        ? `Triggered ${overdueCrons.length} overdue cron(s): ${overdueCrons.join(', ')}`
        : healingTriggered.length > 0
        ? `Triggered ${Object.keys(healingResults).length} cron(s) for ${healingTriggered.length} stale table(s)`
        : 'No healing needed'
    } : null,
    tables: checks
  }
}

// ============================================================
// GET handler - fast liveness by default, deep check on demand
// ============================================================
export async function GET(request: NextRequest) {
  const isDeepCheck = request.nextUrl.searchParams.get('deep') === 'true'

  // Vercel cron requests include a specific header; treat them as deep checks
  const isCronInvocation = request.headers.get('x-vercel-cron') !== null

  if (isDeepCheck || isCronInvocation) {
    // Deep check: query ClickHouse, trigger self-healing, update cache
    try {
      const deepResult = await runDeepHealthCheck()
      cachedResult = deepResult
      lastDeepCheckTime = Date.now()

      return NextResponse.json({
        mode: 'deep',
        ...deepResult
      })
    } catch (error: any) {
      await sendCronFailureAlert({
        cronName: 'system-health',
        error: `Health deep check failed: ${error.message}`,
        severity: 'error'
      })

      return NextResponse.json({
        mode: 'deep',
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      }, { status: 500 })
    }
  }

  // Fast liveness check: no ClickHouse queries, always returns quickly
  const cacheAgeMs = cachedResult ? Date.now() - lastDeepCheckTime : null
  const cacheAgeMinutes = cacheAgeMs !== null ? Math.round(cacheAgeMs / 60000) : null

  // If cache is older than 30 minutes, flag it as stale but still return 200
  const cacheStale = cacheAgeMinutes !== null && cacheAgeMinutes > 30

  return NextResponse.json({
    mode: 'fast',
    status: cachedResult?.status ?? 'unknown',
    timestamp: new Date().toISOString(),
    uptime: true,
    cache: cachedResult ? {
      lastDeepCheck: cachedResult.timestamp,
      ageMinutes: cacheAgeMinutes,
      stale: cacheStale,
      summary: cachedResult.summary,
      goldsky: cachedResult.goldsky,
      tables: cachedResult.tables
    } : {
      lastDeepCheck: null,
      ageMinutes: null,
      stale: true,
      message: 'No deep check has run yet since last deploy. Data will populate on next cron cycle (every 15 min).'
    }
  })
}
