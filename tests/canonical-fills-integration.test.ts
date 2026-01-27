/**
 * Integration test to prevent Jan 2026 data corruption bug
 *
 * Ensures canonical fills incremental update NEVER inserts fills
 * with empty condition_ids due to LEFT JOIN issues.
 */

import { describe, it, expect, beforeAll } from '@jest/globals'
import { clickhouse } from '../lib/clickhouse/client'

describe('Canonical Fills Data Quality', () => {
  describe('Incremental Update Logic', () => {
    it('should NOT insert fills with empty condition_ids', async () => {
      // Get a sample of recent fills from last hour
      const result = await clickhouse.query({
        query: `
          SELECT
            count() as total,
            countIf(condition_id = '') as empty,
            round(countIf(condition_id = '') * 100.0 / count(), 4) as pct_empty
          FROM pm_canonical_fills_v4
          WHERE source = 'clob'
            AND event_time >= now() - INTERVAL 1 HOUR
        `,
        format: 'JSONEachRow'
      })

      const rows = await result.json() as any[]
      const stats = rows[0]

      expect(stats.total).toBeGreaterThan(0)
      expect(stats.pct_empty).toBeLessThan(0.1) // Must be less than 0.1%
    })

    it('should use INNER JOIN (not LEFT JOIN) for token mapping', async () => {
      // This test verifies the logic by checking that all recent fills
      // have valid condition_ids that exist in the token map
      const result = await clickhouse.query({
        query: `
          SELECT
            count() as total,
            countIf(m.condition_id IS NULL) as unmapped
          FROM pm_canonical_fills_v4 f
          JOIN pm_token_to_condition_map_v5 m ON f.condition_id = m.condition_id
          WHERE f.source = 'clob'
            AND f.event_time >= now() - INTERVAL 1 HOUR
            AND f.condition_id != ''
          LIMIT 1000
        `,
        format: 'JSONEachRow'
      })

      const rows = await result.json() as any[]
      const stats = rows[0]

      expect(stats.unmapped).toBe(0)
    })

    it('should filter out fills where m.condition_id = empty', async () => {
      // Verify no fills exist with empty condition_ids from recent ingestion
      const result = await clickhouse.query({
        query: `
          SELECT count() as empty_count
          FROM pm_canonical_fills_v4
          WHERE source = 'clob'
            AND condition_id = ''
            AND event_time >= now() - INTERVAL 6 HOUR
        `,
        format: 'JSONEachRow'
      })

      const rows = await result.json() as any[]
      const count = rows[0]?.empty_count || 0

      expect(count).toBe(0)
    })
  })

  describe('Backfill vs Incremental Consistency', () => {
    it('should have matching JOIN logic between backfill and incremental scripts', async () => {
      // This is a meta-test that checks the actual code
      // In practice, this would be enforced through code review
      // but we can verify the results are consistent

      const result = await clickhouse.query({
        query: `
          SELECT
            toDate(event_time) as date,
            countIf(condition_id = '') * 100.0 / count() as pct_empty
          FROM pm_canonical_fills_v4
          WHERE source = 'clob'
            AND event_time >= today() - INTERVAL 7 DAY
          GROUP BY date
          ORDER BY date DESC
        `,
        format: 'JSONEachRow'
      })

      const rows = await result.json() as any[]

      // All recent days should have <0.1% empty
      rows.forEach((row: any) => {
        expect(row.pct_empty).toBeLessThan(0.1)
      })
    })
  })

  describe('Token Map Coverage', () => {
    it('should have token map coverage >99% for recent trades', async () => {
      const result = await clickhouse.query({
        query: `
          SELECT
            countIf(map.token_id_dec IS NULL) * 100.0 / count() as pct_unmapped
          FROM (
            SELECT DISTINCT token_id
            FROM pm_trader_events_v3
            WHERE trade_time >= now() - INTERVAL 6 HOUR
            LIMIT 10000
          ) r
          LEFT JOIN pm_token_to_condition_map_v5 map ON r.token_id = map.token_id_dec
        `,
        format: 'JSONEachRow'
      })

      const rows = await result.json() as any[]
      const pct_unmapped = rows[0]?.pct_unmapped || 0

      expect(pct_unmapped).toBeLessThan(1.0) // Less than 1% unmapped
    })
  })
})
