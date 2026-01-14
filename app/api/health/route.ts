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

// Trigger a cron to refresh stale data (fire-and-forget, don't wait)
async function triggerCron(cronName: string): Promise<boolean> {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://cascadian.vercel.app'
    const cronSecret = process.env.CRON_SECRET

    // Fire and forget - don't await the cron completion
    // Use AbortController with 5s timeout just to check if it started
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
      // Aborted is expected (we don't wait for completion)
      if (e.name !== 'AbortError') {
        console.error(`[self-heal] Failed to trigger ${cronName}:`, e)
      } else {
        console.log(`[self-heal] Started ${cronName} (not waiting for completion)`)
      }
    })

    return true // Always return true since we just fire and forget
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

// Track tables that have healing in progress (give them time before alerting)
async function isHealingInProgress(table: string): Promise<boolean> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM health_healing_attempts
        WHERE table_name = '${table}'
          AND attempted_at > now() - INTERVAL 20 MINUTE
          AND NOT resolved
      `,
      format: 'JSONEachRow'
    })
    const row = (await result.json() as any[])[0]
    return Number(row?.cnt || 0) > 0
  } catch {
    return false
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
    // Mark recent attempts as resolved
    await clickhouse.command({
      query: `
        ALTER TABLE health_healing_attempts
        UPDATE resolved = 1
        WHERE table_name = '${table}' AND attempted_at > now() - INTERVAL 1 HOUR
      `
    })
  } catch (e) {
    // Ignore - table might not exist
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
  wio_open_snapshots_v1: { warning: 180, critical: 360 },       // Hourly at :45 (max normal: 105 min, 75 min buffer)
  wio_market_snapshots_v1: { warning: 180, critical: 360 },     // Hourly at :45 (max normal: 105 min, 75 min buffer)
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
    // Single efficient query for all tables (UNION ALL is much faster than parallel queries)
    const result = await clickhouse.query({
      query: `
        SELECT 'pm_trader_events_v3' as tbl, abs(dateDiff('minute', max(trade_time), now())) as mins FROM pm_trader_events_v3
        UNION ALL SELECT 'pm_ctf_events', abs(dateDiff('minute', max(event_timestamp), now())) FROM pm_ctf_events
        UNION ALL SELECT 'pm_canonical_fills_v4', abs(dateDiff('minute', max(event_time), now())) FROM pm_canonical_fills_v4
        UNION ALL SELECT 'pm_ctf_split_merge_expanded', abs(dateDiff('minute', max(event_timestamp), now())) FROM pm_ctf_split_merge_expanded
        UNION ALL SELECT 'pm_erc1155_transfers', abs(dateDiff('minute', max(block_timestamp), now())) FROM pm_erc1155_transfers WHERE is_deleted = 0
        UNION ALL SELECT 'pm_market_metadata', abs(dateDiff('minute', fromUnixTimestamp64Milli(max(ingested_at)), now())) FROM pm_market_metadata
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
        latest: 'n/a', // Not fetching timestamp for performance
        minutesBehind: mins,
        status,
        threshold,
        source
      }
    })

    const criticalTables = checks.filter(c => c.status === 'critical')
    const warningTables = checks.filter(c => c.status === 'warning')

    // Self-healing: trigger crons for stale tables (fire-and-forget, won't block response)
    const healingResults: Record<string, boolean> = {}
    const healingTriggered: string[] = []
    const staleTables = [...criticalTables, ...warningTables]

    for (const table of staleTables) {
      const cronName = TABLE_TO_CRON[table.table]
      if (cronName && !healingResults[cronName]) {
        healingResults[cronName] = await triggerCron(cronName)
        healingTriggered.push(table.table)
        // Record healing attempt so we don't alert immediately
        await recordHealingAttempt(table.table, cronName)
      }
    }

    // Mark healthy tables as resolved (clear any pending healing attempts)
    const healthyTables = checks.filter(c => c.status === 'healthy')
    for (const table of healthyTables) {
      await markHealingResolved(table.table)
    }

    // Check GoldSky health specifically (critical external dependency)
    const goldskyTables = checks.filter(c => c.source === 'goldsky')
    const goldskyStatus = goldskyTables.some(c => c.status === 'critical') ? 'critical' :
                          goldskyTables.some(c => c.status === 'warning') ? 'warning' : 'healthy'

    const overallStatus = criticalTables.length > 0 ? 'critical' :
                          warningTables.length > 0 ? 'warning' : 'healthy'

    // Send Discord alerts only AFTER self-healing has had time to work
    // Filter out tables that have healing in progress (give them 20 min grace period)
    const tablesWithFailedHealing: TableHealth[] = []
    for (const table of [...criticalTables, ...warningTables]) {
      const healingActive = await isHealingInProgress(table.table)
      if (!healingActive) {
        // No recent healing attempt, or healing attempt is old (>20 min) - OK to alert
        tablesWithFailedHealing.push(table)
      }
    }

    // Only alert for tables where healing has already been attempted and failed
    if (tablesWithFailedHealing.length > 0) {
      const goldskyDown = tablesWithFailedHealing.filter(t => t.source === 'goldsky' && t.status === 'critical')
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

      const otherFailed = tablesWithFailedHealing.filter(t => t.source !== 'goldsky')
      if (otherFailed.length > 0) {
        const hasCritical = otherFailed.some(t => t.status === 'critical')
        const alertKey = `system-${hasCritical ? 'critical' : 'warning'}-${otherFailed.map(t => t.table).sort().join(',')}`
        const severity = hasCritical ? 'error' : 'warning'
        shouldSendAlert(alertKey, severity).then(shouldSend => {
          if (shouldSend) {
            sendCronFailureAlert({
              cronName: 'system-health',
              error: `${otherFailed.length} table(s) still stale after self-healing attempt`,
              details: Object.fromEntries(otherFailed.map(t => [t.table, `${t.minutesBehind} min behind (threshold: ${t.threshold.warning}, source: ${t.source})`])),
              severity
            }).catch(e => console.error('[health] Discord alert failed:', e))
            recordAlert(alertKey, severity).catch(e => console.error('[health] Record alert failed:', e))
          }
        })
      }
    }

    // If everything is healthy and we had healing attempts, send success notification
    if (healingTriggered.length === 0 && staleTables.length === 0 && checks.every(c => c.status === 'healthy')) {
      // All good - no alerts needed
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
        tablesHealing: healingTriggered,
        message: `Triggered ${Object.keys(healingResults).length} cron(s) for ${healingTriggered.length} stale table(s). Alerts suppressed for 20 min while healing.`
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
