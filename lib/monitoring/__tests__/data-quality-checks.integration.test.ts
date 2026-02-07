/**
 * Integration tests that run each monitor query against real ClickHouse.
 * These catch stale table names, missing columns, and SQL syntax errors.
 *
 * Run with: npx jest data-quality-checks.integration --no-cache
 * Requires: .env.local with CLICKHOUSE_* credentials
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { CHECKS, evaluateStatus, type CheckResult } from '../data-quality-checks'

let clickhouse: any

beforeAll(async () => {
  const mod = await import('@/lib/clickhouse/client')
  clickhouse = mod.clickhouse
})

// Some queries hit large tables — allow 60s per test
jest.setTimeout(60000)

describe('DataQualityChecks integration (live ClickHouse)', () => {
  for (const check of CHECKS) {
    it(`${check.name}: query executes and returns numeric metric_value`, async () => {
      const result = await clickhouse.query({
        query: check.query,
        format: 'JSONEachRow',
      })
      const rows = (await result.json()) as any[]

      expect(rows.length).toBe(1)
      expect(rows[0]).toHaveProperty('metric_value')
      expect(typeof rows[0].metric_value).toBe('number')

      const value = rows[0].metric_value
      const status = evaluateStatus(value, check)
      console.log(`  ${check.name}: ${value} → ${status}`)

      // No query should return NaN
      expect(isNaN(value)).toBe(false)
    })
  }

  it('no check currently fires as CRITICAL against production', async () => {
    const results: CheckResult[] = []

    // Run sequentially to avoid connection pool pressure
    for (const check of CHECKS) {
      try {
        const result = await clickhouse.query({
          query: check.query,
          format: 'JSONEachRow',
        })
        const rows = (await result.json()) as any[]
        const value = rows[0]?.metric_value || 0
        results.push({
          name: check.name,
          value,
          status: evaluateStatus(value, check),
          description: check.description,
        })
      } catch (e: any) {
        results.push({
          name: check.name,
          value: -1,
          status: 'CRITICAL',
          description: `Query failed: ${e.message}`,
        })
      }
    }

    const criticals = results.filter(r => r.status === 'CRITICAL')
    if (criticals.length > 0) {
      console.warn('CRITICAL checks:', criticals)
    }
    expect(criticals).toHaveLength(0)
  })
})
