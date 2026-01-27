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
        countIf(map.token_id_dec IS NULL) * 100.0 / count() as metric_value
      FROM (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v3
        WHERE trade_time >= now() - INTERVAL 6 HOUR
        LIMIT 10000
      ) r
      LEFT JOIN pm_token_to_condition_map_v5 map ON r.token_id = map.token_id_dec
    `,
    warning: 1.0,   // Warn at 1% unmapped
    critical: 5.0,  // Critical at 5% unmapped
  },
  {
    name: 'incremental_update_health',
    description: 'Last incremental update succeeded within 15 minutes',
    query: `
      SELECT
        CASE
          WHEN max(executed_at) >= now() - INTERVAL 15 MINUTE THEN 0
          ELSE 100
        END as metric_value
      FROM cron_executions
      WHERE cron_name = 'update-canonical-fills'
        AND status = 'success'
    `,
    warning: 50,
    critical: 100,
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
