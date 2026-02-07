import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { sendCronFailureAlert } from '@/lib/alerts/discord'
import { logCronExecution } from '@/lib/alerts/cron-tracker'
import {
  CHECKS,
  evaluateStatus,
  buildAlertMessage,
  type DataQualityCheck,
  type CheckResult,
} from '@/lib/monitoring/data-quality-checks'

export const runtime = 'nodejs'
export const maxDuration = 60

async function runCheck(check: DataQualityCheck): Promise<CheckResult> {
  try {
    const result = await clickhouse.query({
      query: check.query,
      format: 'JSONEachRow'
    })
    const rows = await result.json() as any[]
    const value = rows[0]?.metric_value || 0

    return {
      name: check.name,
      value,
      status: evaluateStatus(value, check),
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

    // Send alerts only for CRITICAL failures
    const alertMsg = buildAlertMessage(results)
    if (alertMsg) {
      await sendCronFailureAlert({
        cronName: 'monitor-data-quality',
        error: alertMsg
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
