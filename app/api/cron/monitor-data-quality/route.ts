import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { sendCronFailureAlert } from '@/lib/alerts/discord'
import { logCronExecution } from '@/lib/alerts/cron-tracker'

export const runtime = 'nodejs'
export const maxDuration = 60

interface DataQualityCheck {
  name: string
  query: string
  warning: number
  critical: number
  description: string
}

const CHECKS: DataQualityCheck[] = [
  {
    name: 'canonical_fills_empty_condition_pct',
    description: 'Empty condition_ids in canonical fills (last hour)',
    query: `
      SELECT
        countIf(condition_id = '') * 100.0 / count() as metric_value
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND event_time >= now() - INTERVAL 1 HOUR
    `,
    warning: 0.1,   // Warn at 0.1%
    critical: 1.0,  // Critical at 1%
  },
  {
    name: 'canonical_fills_null_wallet_pct',
    description: 'Null wallets in canonical fills (last hour)',
    query: `
      SELECT
        countIf(wallet = '0x0000000000000000000000000000000000000000') * 100.0 / count() as metric_value
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 1 HOUR
    `,
    warning: 0.1,
    critical: 1.0,
  },
  {
    name: 'token_map_coverage_recent',
    description: 'Token mapping coverage for recent trades',
    query: `
      SELECT
        countIf(token_id NOT IN (
          SELECT token_id_dec FROM pm_token_to_condition_map_v5
        )) * 100.0 / count() as metric_value
      FROM (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v3
        WHERE trade_time >= now() - INTERVAL 6 HOUR
        LIMIT 10000
      )
    `,
    warning: 1.0,   // Warn at 1% unmapped
    critical: 5.0,  // Critical at 5% unmapped
  },
  {
    name: 'incremental_update_health',
    description: 'Last canonical fills watermark updated within 30 minutes',
    query: `
      SELECT
        CASE
          WHEN max(last_event_time) >= now() - INTERVAL 30 MINUTE THEN 0
          ELSE dateDiff('minute', max(last_event_time), now())
        END as metric_value
      FROM pm_ingest_watermarks_v1 FINAL
      WHERE source = 'clob'
    `,
    warning: 30,
    critical: 60,
  },
  {
    name: 'fifo_missed_resolved_conditions',
    description: 'Recently resolved conditions (last 7 days) with CLOB fills missing from FIFO table',
    query: `
      SELECT count(DISTINCT r.condition_id) as metric_value
      FROM pm_condition_resolutions r
      INNER JOIN pm_canonical_fills_v4 f ON r.condition_id = f.condition_id
      WHERE r.is_deleted = 0
        AND r.payout_numerators != ''
        AND f.source = 'clob'
        AND r.insert_time >= now() - INTERVAL 7 DAY
        AND r.condition_id NOT IN (
          SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3
        )
    `,
    warning: 50,     // Warn if 50+ recent conditions missed
    critical: 500,   // Critical if 500+ recent conditions missed
  },
  {
    name: 'fifo_resolution_freshness_hours',
    description: 'Hours since last resolution was processed into FIFO',
    query: `
      SELECT
        dateDiff('hour', max(resolved_at), now()) as metric_value
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at > '2020-01-01'
    `,
    warning: 6,     // Warn if FIFO hasn't processed resolutions in 6 hours
    critical: 24,   // Critical if 24+ hours stale
  },
  {
    name: 'condition_resolutions_freshness_hours',
    description: 'Hours since last condition resolution was ingested',
    query: `
      SELECT
        dateDiff('hour', max(insert_time), now()) as metric_value
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    warning: 2,     // Warn if no new resolutions in 2 hours
    critical: 6,    // Critical if 6+ hours stale
  },
]

async function runCheck(check: DataQualityCheck): Promise<{
  name: string
  value: number
  status: 'OK' | 'WARNING' | 'CRITICAL'
  description: string
}> {
  try {
    const result = await clickhouse.query({
      query: check.query,
      format: 'JSONEachRow'
    })
    const rows = await result.json() as any[]
    const value = rows[0]?.metric_value || 0

    let status: 'OK' | 'WARNING' | 'CRITICAL' = 'OK'
    if (value >= check.critical) {
      status = 'CRITICAL'
    } else if (value >= check.warning) {
      status = 'WARNING'
    }

    return {
      name: check.name,
      value,
      status,
      description: check.description
    }
  } catch (e: any) {
    return {
      name: check.name,
      value: -1,
      status: 'CRITICAL',
      description: `Query failed: ${e.message}`
    }
  }
}

export async function GET() {
  const startTime = Date.now()

  try {
    const results = await Promise.all(CHECKS.map(runCheck))

    const failures = results.filter(r => r.status === 'CRITICAL')
    const warnings = results.filter(r => r.status === 'WARNING')

    // Send alerts for failures
    if (failures.length > 0) {
      await sendCronFailureAlert({
        cronName: 'monitor-data-quality',
        error: `${failures.length} CRITICAL issues:\n${failures.map(f => `- ${f.name}: ${f.value.toFixed(2)} (${f.description})`).join('\n')}`
      })
    }

    const duration = Date.now() - startTime
    await logCronExecution({
      cron_name: 'monitor-data-quality',
      status: failures.length > 0 ? 'failure' : 'success',
      duration_ms: duration,
      details: {
        checks: results.length,
        ok: results.filter(r => r.status === 'OK').length,
        warnings: warnings.length,
        critical: failures.length
      }
    })

    return NextResponse.json({
      success: true,
      checks: results,
      summary: {
        total: results.length,
        ok: results.filter(r => r.status === 'OK').length,
        warnings: warnings.length,
        critical: failures.length
      }
    })
  } catch (error) {
    const duration = Date.now() - startTime
    console.error('Data quality monitoring error:', error)

    await logCronExecution({
      cron_name: 'monitor-data-quality',
      status: 'failure',
      duration_ms: duration,
      error_message: String(error)
    })

    await sendCronFailureAlert({
      cronName: 'monitor-data-quality',
      error: String(error)
    })

    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
