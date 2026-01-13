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
export const maxDuration = 30

interface TableHealth {
  table: string
  latest: string
  minutesBehind: number
  status: 'healthy' | 'warning' | 'critical'
  threshold: { warning: number; critical: number }
}

// Thresholds in minutes
const TABLE_THRESHOLDS: Record<string, { warning: number; critical: number }> = {
  pm_trader_events_v3: { warning: 10, critical: 30 },
  pm_ctf_events: { warning: 10, critical: 30 },
  pm_canonical_fills_v4: { warning: 60, critical: 180 },
  pm_ctf_split_merge_expanded: { warning: 60, critical: 180 },
  pm_erc1155_transfers: { warning: 120, critical: 360 },
  pm_market_metadata: { warning: 120, critical: 360 },          // Gamma API sync
  pm_condition_resolutions: { warning: 60, critical: 180 },     // Resolution data
  pm_negrisk_token_map_v1: { warning: 1440, critical: 2880 },   // Daily sync OK
  pm_token_to_condition_map_v5: { warning: 360, critical: 720 }, // Token map
}

async function checkTableHealth(
  table: string,
  timestampColumn: string,
  whereClause?: string,
  timestampType: 'datetime' | 'millis' | 'millis64' = 'datetime'
): Promise<TableHealth> {
  const threshold = TABLE_THRESHOLDS[table] || { warning: 60, critical: 180 }

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
      threshold
    }
  } catch (err: any) {
    return {
      table,
      latest: 'error',
      minutesBehind: -1,
      status: 'critical',
      threshold
    }
  }
}

export async function GET() {
  const startTime = Date.now()

  try {
    const checks = await Promise.all([
      // Core trading data
      checkTableHealth('pm_trader_events_v3', 'trade_time'),
      checkTableHealth('pm_ctf_events', 'event_timestamp'),
      checkTableHealth('pm_canonical_fills_v4', 'event_time'),
      checkTableHealth('pm_ctf_split_merge_expanded', 'event_timestamp'),
      checkTableHealth('pm_erc1155_transfers', 'block_timestamp', 'is_deleted = 0'),
      // Metadata and mappings
      checkTableHealth('pm_market_metadata', 'ingested_at', undefined, 'millis'),
      checkTableHealth('pm_condition_resolutions', 'insert_time', 'is_deleted = 0'),
      checkTableHealth('pm_negrisk_token_map_v1', '_version', undefined, 'millis64'),
    ])

    const criticalTables = checks.filter(c => c.status === 'critical')
    const warningTables = checks.filter(c => c.status === 'warning')

    const overallStatus = criticalTables.length > 0 ? 'critical' :
                          warningTables.length > 0 ? 'warning' : 'healthy'

    // Send Discord alert if critical
    if (criticalTables.length > 0) {
      await sendCronFailureAlert({
        cronName: 'system-health',
        error: `${criticalTables.length} table(s) critically stale`,
        details: Object.fromEntries(
          criticalTables.map(t => [t.table, `${t.minutesBehind} min behind`])
        ),
        severity: 'error'
      })
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
