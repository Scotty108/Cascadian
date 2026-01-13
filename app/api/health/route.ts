/**
 * System Health Check Endpoint
 *
 * Monitors freshness of all critical tables and sends Discord alerts if stale.
 * Use this for monitoring dashboards and alerting.
 *
 * GET /api/health - Returns health status of all tables
 */

import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { sendCronFailureAlert } from '@/lib/alerts/discord'

export const runtime = 'nodejs'
export const maxDuration = 120 // Increased for self-healing cron triggers

// Alert rate limiting - only send same alert once per hour
const ALERT_COOLDOWN_MINUTES = 60

// Self-healing: map tables to their refresh crons
const TABLE_TO_CRON: Record<string, string> = {
  // Core data tables
  pm_canonical_fills_v4: 'update-canonical-fills',
  pm_ctf_split_merge_expanded: 'sync-ctf-expanded',
  pm_erc1155_transfers: 'sync-erc1155',
  pm_market_metadata: 'sync-metadata',
  pm_condition_resolutions: 'sync-ctf-expanded', // Resolutions come from CTF events
  // WIO tables
  wio_positions_v1: 'sync-wio-positions',  // V1 is incrementally synced
  wio_open_snapshots_v1: 'refresh-wio-snapshots',
  wio_market_snapshots_v1: 'refresh-wio-snapshots',
  wio_dot_events_v1: 'refresh-wio-scores',
}

// Trigger a cron to refresh stale data
async function triggerCron(cronName: string): Promise<boolean> {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://cascadian.vercel.app'
    const cronSecret = process.env.CRON_SECRET

    const response = await fetch(`${baseUrl}/api/cron/${cronName}`, {
      method: 'GET',
      headers: cronSecret ? { 'Authorization': `Bearer ${cronSecret}` } : {},
    })

    console.log(`[self-heal] Triggered ${cronName}: ${response.status}`)
    return response.ok
  } catch (e) {
    console.error(`[self-heal] Failed to trigger ${cronName}:`, e)
    return false
  }
}

async function shouldSendAlert(alertKey: string, severity: 'warning' | 'error'): Promise<boolean> {
  try {
    // Check if we sent this alert recently
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
    // Table might not exist yet, allow alert
    return true
  }
}

async function recordAlert(alertKey: string, severity: 'warning' | 'error'): Promise<void> {
  try {
    // Ensure table exists
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
    // Record the alert
    await clickhouse.command({
      query: `INSERT INTO health_alerts (alert_key, severity) VALUES ('${alertKey}', '${severity}')`
    })
  } catch (e) {
    console.error('Failed to record alert:', e)
  }
}

interface TableHealth {
  table: string
  latest: string
  minutesBehind: number
  status: 'healthy' | 'warning' | 'critical'
  threshold: { warning: number; critical: number }
  source?: 'goldsky' | 'alchemy' | 'cron' | 'api'
}

// GoldSky-fed tables (external dependency - if stale, data is LOST)
const GOLDSKY_TABLES = ['pm_trader_events_v3', 'pm_ctf_events']

// Thresholds in minutes
const TABLE_THRESHOLDS: Record<string, { warning: number; critical: number }> = {
  // Core data (GoldSky fed)
  pm_trader_events_v3: { warning: 10, critical: 30 },
  pm_ctf_events: { warning: 10, critical: 30 },
  // Core derived tables
  pm_canonical_fills_v4: { warning: 60, critical: 180 },
  pm_ctf_split_merge_expanded: { warning: 60, critical: 180 },
  pm_erc1155_transfers: { warning: 120, critical: 360 },
  pm_market_metadata: { warning: 120, critical: 360 },          // Gamma API sync
  pm_condition_resolutions: { warning: 60, critical: 180 },     // Resolution data
  pm_negrisk_token_map_v1: { warning: 4320, critical: 10080 },  // Weekly sync OK (has 100% coverage)
  pm_token_to_condition_map_v5: { warning: 360, critical: 720 }, // Token map
  // WIO tables (Wallet Intelligence Ontology)
  wio_positions_v1: { warning: 10080, critical: 43200 },        // Backfilling - disable alerts until caught up
  wio_open_snapshots_v1: { warning: 120, critical: 360 },       // Hourly at :45
  wio_market_snapshots_v1: { warning: 120, critical: 360 },     // Hourly at :45
  wio_dot_events_v1: { warning: 1440, critical: 2880 },         // Daily at 7AM
}

// Determine data source for a table
function getTableSource(table: string): 'goldsky' | 'alchemy' | 'cron' | 'api' {
  if (GOLDSKY_TABLES.includes(table)) return 'goldsky'
  if (table === 'pm_erc1155_transfers') return 'alchemy'
  if (table === 'pm_market_metadata') return 'api'
  return 'cron'
}

async function checkTableHealth(
  table: string,
  timestampColumn: string,
  whereClause?: string,
  timestampType: 'datetime' | 'millis' | 'millis64' = 'datetime'
): Promise<TableHealth> {
  const threshold = TABLE_THRESHOLDS[table] || { warning: 60, critical: 180 }
  const source = getTableSource(table)

  try {
    const where = whereClause ? `WHERE ${whereClause}` : ''
    // Handle different timestamp formats
    let timeExpr = `max(${timestampColumn})`
    if (timestampType === 'millis') {
      timeExpr = `fromUnixTimestamp64Milli(max(${timestampColumn}))`
    } else if (timestampType === 'millis64') {
      timeExpr = `fromUnixTimestamp64Milli(max(${timestampColumn}))`
    }
    const result = await clickhouse.query({
      query: `SELECT ${timeExpr} as latest, dateDiff('minute', ${timeExpr}, now()) as mins FROM ${table} ${where}`,
      format: 'JSONEachRow'
    })
    const row = (await result.json() as any[])[0]
    // Use abs() to handle timezone differences, fallback to 9999 only if truly missing
    const rawMins = row?.mins
    const minutesBehind = rawMins !== undefined && rawMins !== null ? Math.abs(Number(rawMins)) : 9999

    let status: 'healthy' | 'warning' | 'critical' = 'healthy'
    if (minutesBehind >= threshold.critical) {
      status = 'critical'
    } else if (minutesBehind >= threshold.warning) {
      status = 'warning'
    }

    return {
      table,
      latest: row?.latest || 'unknown',
      minutesBehind,
      status,
      threshold,
      source
    }
  } catch (err: any) {
    return {
      table,
      latest: 'error',
      minutesBehind: -1,
      status: 'critical',
      threshold,
      source
    }
  }
}

export async function GET() {
  const startTime = Date.now()

  try {
    const checks = await Promise.all([
      // Core trading data (GoldSky fed)
      checkTableHealth('pm_trader_events_v3', 'trade_time'),
      checkTableHealth('pm_ctf_events', 'event_timestamp'),
      // Derived data tables
      checkTableHealth('pm_canonical_fills_v4', 'event_time'),
      checkTableHealth('pm_ctf_split_merge_expanded', 'event_timestamp'),
      checkTableHealth('pm_erc1155_transfers', 'block_timestamp', 'is_deleted = 0'),
      // Metadata and mappings
      checkTableHealth('pm_market_metadata', 'ingested_at', undefined, 'millis'),
      checkTableHealth('pm_condition_resolutions', 'insert_time', 'is_deleted = 0'),
      checkTableHealth('pm_negrisk_token_map_v1', '_version', undefined, 'millis64'),
      // WIO tables (Wallet Intelligence Ontology)
      checkTableHealth('wio_positions_v1', 'ts_open'),  // V1 is incrementally synced
      checkTableHealth('wio_open_snapshots_v1', 'as_of_ts'),
      checkTableHealth('wio_market_snapshots_v1', 'as_of_ts'),
      checkTableHealth('wio_dot_events_v1', 'created_at'),
    ])

    const criticalTables = checks.filter(c => c.status === 'critical')
    const warningTables = checks.filter(c => c.status === 'warning')

    // Self-healing: trigger crons for stale tables (not GoldSky - we can't fix those)
    const staleTables = [...criticalTables, ...warningTables].filter(t => t.source !== 'goldsky')
    const triggeredCrons = new Set<string>()
    const healingResults: Record<string, boolean> = {}

    for (const table of staleTables) {
      const cronName = TABLE_TO_CRON[table.table]
      if (cronName && !triggeredCrons.has(cronName)) {
        triggeredCrons.add(cronName)
        healingResults[cronName] = await triggerCron(cronName)
      }
    }

    // Check GoldSky health specifically (critical external dependency)
    const goldskyTables = checks.filter(c => c.source === 'goldsky')
    const goldskyStatus = goldskyTables.some(c => c.status === 'critical') ? 'critical' :
                          goldskyTables.some(c => c.status === 'warning') ? 'warning' : 'healthy'

    const overallStatus = criticalTables.length > 0 ? 'critical' :
                          warningTables.length > 0 ? 'warning' : 'healthy'

    // Send Discord alert if critical (with rate limiting)
    if (criticalTables.length > 0) {
      // Check if it's a GoldSky issue specifically
      const goldskyDown = criticalTables.filter(t => t.source === 'goldsky')
      if (goldskyDown.length > 0) {
        const alertKey = 'goldsky-critical'
        if (await shouldSendAlert(alertKey, 'error')) {
          await sendCronFailureAlert({
            cronName: 'goldsky-feed',
            error: `EXTERNAL DATA FEED DOWN - GoldSky not streaming (DATA LOSS RISK)`,
            details: Object.fromEntries(
              goldskyDown.map(t => [t.table, `${t.minutesBehind} min behind`])
            ),
            severity: 'error'
          })
          await recordAlert(alertKey, 'error')
        }
      }

      // Send general alert for other critical tables
      const otherCritical = criticalTables.filter(t => t.source !== 'goldsky')
      if (otherCritical.length > 0) {
        const alertKey = `system-critical-${otherCritical.map(t => t.table).sort().join(',')}`
        if (await shouldSendAlert(alertKey, 'error')) {
          await sendCronFailureAlert({
            cronName: 'system-health',
            error: `${otherCritical.length} table(s) critically stale`,
            details: Object.fromEntries(
              otherCritical.map(t => [t.table, `${t.minutesBehind} min behind (${t.source})`])
            ),
            severity: 'error'
          })
          await recordAlert(alertKey, 'error')
        }
      }
    }

    // Send Discord alert if warning (with rate limiting)
    if (warningTables.length > 0 && criticalTables.length === 0) {
      // Check if it's a GoldSky warning
      const goldskyWarning = warningTables.filter(t => t.source === 'goldsky')
      if (goldskyWarning.length > 0) {
        const alertKey = 'goldsky-warning'
        if (await shouldSendAlert(alertKey, 'warning')) {
          await sendCronFailureAlert({
            cronName: 'goldsky-feed',
            error: `GoldSky feed delayed - monitoring closely`,
            details: Object.fromEntries(
              goldskyWarning.map(t => [t.table, `${t.minutesBehind} min behind (threshold: ${t.threshold.warning})`])
            ),
            severity: 'warning'
          })
          await recordAlert(alertKey, 'warning')
        }
      }

      // Send warning for other tables
      const otherWarning = warningTables.filter(t => t.source !== 'goldsky')
      if (otherWarning.length > 0) {
        const alertKey = `system-warning-${otherWarning.map(t => t.table).sort().join(',')}`
        if (await shouldSendAlert(alertKey, 'warning')) {
          await sendCronFailureAlert({
            cronName: 'system-health',
            error: `${otherWarning.length} table(s) delayed - crons may be stalled`,
            details: Object.fromEntries(
              otherWarning.map(t => [t.table, `${t.minutesBehind} min behind (threshold: ${t.threshold.warning}, source: ${t.source})`])
            ),
            severity: 'warning'
          })
          await recordAlert(alertKey, 'warning')
        }
      }
    }

    return NextResponse.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
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
        results: healingResults
      } : null,
      tables: checks
    })
  } catch (error: any) {
    await sendCronFailureAlert({
      cronName: 'system-health',
      error: `Health check failed: ${error.message}`,
      severity: 'error'
    })

    return NextResponse.json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime
    }, { status: 500 })
  }
}
