import {
  CHECKS,
  evaluateStatus,
  buildAlertMessage,
  type DataQualityCheck,
  type CheckResult,
  KNOWN_TABLES,
} from '../data-quality-checks'

describe('DataQualityChecks', () => {
  // ────────────────────────────────────────────────────────────────────
  // 1. Check configuration validation
  // ────────────────────────────────────────────────────────────────────
  describe('check configuration', () => {
    it('every check has required fields', () => {
      for (const check of CHECKS) {
        expect(check.name).toBeTruthy()
        expect(check.description).toBeTruthy()
        expect(check.query).toBeTruthy()
        expect(typeof check.warning).toBe('number')
        expect(typeof check.critical).toBe('number')
      }
    })

    it('warning threshold is always less than critical', () => {
      for (const check of CHECKS) {
        expect(check.warning).toBeLessThan(check.critical)
      }
    })

    it('thresholds are positive', () => {
      for (const check of CHECKS) {
        expect(check.warning).toBeGreaterThan(0)
        expect(check.critical).toBeGreaterThan(0)
      }
    })

    it('check names are unique', () => {
      const names = CHECKS.map(c => c.name)
      expect(new Set(names).size).toBe(names.length)
    })

    it('every query selects metric_value', () => {
      for (const check of CHECKS) {
        expect(check.query.toLowerCase()).toContain('metric_value')
      }
    })

    it('queries only reference known production tables', () => {
      for (const check of CHECKS) {
        // Extract table names from FROM and JOIN clauses
        const fromMatches = check.query.match(/(?:FROM|JOIN)\s+(\w+)/gi) || []
        const tableNames = fromMatches
          .map(m => m.replace(/^(FROM|JOIN)\s+/i, '').trim())
          .filter(t => !['SELECT', 'DISTINCT', 'INTERVAL'].includes(t.toUpperCase()))

        for (const table of tableNames) {
          expect(KNOWN_TABLES).toContain(table)
        }
      }
    })

    it('percentage-based checks have thresholds between 0 and 100', () => {
      const pctChecks = CHECKS.filter(c =>
        c.name.includes('pct') || c.name.includes('coverage')
      )
      for (const check of pctChecks) {
        expect(check.critical).toBeLessThanOrEqual(100)
        expect(check.warning).toBeLessThanOrEqual(100)
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────
  // 2. Status evaluation logic
  // ────────────────────────────────────────────────────────────────────
  describe('evaluateStatus', () => {
    const check: DataQualityCheck = {
      name: 'test_check',
      description: 'test',
      query: 'SELECT 1 as metric_value',
      warning: 10,
      critical: 50,
    }

    it('returns OK when value is below warning', () => {
      expect(evaluateStatus(0, check)).toBe('OK')
      expect(evaluateStatus(9.99, check)).toBe('OK')
    })

    it('returns WARNING when value equals warning threshold', () => {
      expect(evaluateStatus(10, check)).toBe('WARNING')
    })

    it('returns WARNING when value is between warning and critical', () => {
      expect(evaluateStatus(25, check)).toBe('WARNING')
      expect(evaluateStatus(49.99, check)).toBe('WARNING')
    })

    it('returns CRITICAL when value equals critical threshold', () => {
      expect(evaluateStatus(50, check)).toBe('CRITICAL')
    })

    it('returns CRITICAL when value exceeds critical threshold', () => {
      expect(evaluateStatus(100, check)).toBe('CRITICAL')
      expect(evaluateStatus(999, check)).toBe('CRITICAL')
    })

    it('returns CRITICAL for negative values (query failure sentinel)', () => {
      expect(evaluateStatus(-1, check)).toBe('CRITICAL')
    })
  })

  // ────────────────────────────────────────────────────────────────────
  // 3. Alert message building
  // ────────────────────────────────────────────────────────────────────
  describe('buildAlertMessage', () => {
    it('returns null when no critical results', () => {
      const results: CheckResult[] = [
        { name: 'check1', value: 0, status: 'OK', description: 'all good' },
        { name: 'check2', value: 15, status: 'WARNING', description: 'meh' },
      ]
      expect(buildAlertMessage(results)).toBeNull()
    })

    it('returns message with critical count for critical results', () => {
      const results: CheckResult[] = [
        { name: 'check1', value: 99, status: 'CRITICAL', description: 'bad' },
        { name: 'check2', value: 0, status: 'OK', description: 'fine' },
      ]
      const msg = buildAlertMessage(results)
      expect(msg).toContain('1 CRITICAL')
      expect(msg).toContain('check1')
      expect(msg).toContain('99.00')
    })

    it('includes all critical checks in message', () => {
      const results: CheckResult[] = [
        { name: 'check1', value: 99, status: 'CRITICAL', description: 'bad1' },
        { name: 'check2', value: 88, status: 'CRITICAL', description: 'bad2' },
      ]
      const msg = buildAlertMessage(results)!
      expect(msg).toContain('2 CRITICAL')
      expect(msg).toContain('check1')
      expect(msg).toContain('check2')
    })

    it('excludes WARNING results from alert message', () => {
      const results: CheckResult[] = [
        { name: 'critical_one', value: 99, status: 'CRITICAL', description: 'bad' },
        { name: 'warning_one', value: 15, status: 'WARNING', description: 'meh' },
      ]
      const msg = buildAlertMessage(results)!
      expect(msg).toContain('critical_one')
      expect(msg).not.toContain('warning_one')
    })
  })

  // ────────────────────────────────────────────────────────────────────
  // 4. Real-world threshold validation (based on known production values)
  // ────────────────────────────────────────────────────────────────────
  describe('threshold sanity for production', () => {
    it('token_map_coverage_recent tolerates 20% unmapped (new markets lag)', () => {
      const check = CHECKS.find(c => c.name === 'token_map_coverage_recent')!
      // 17% unmapped is normal — new tokens from events appear before map rebuild
      expect(evaluateStatus(17, check)).not.toBe('CRITICAL')
    })

    it('token_map_coverage_recent warns above 25%', () => {
      const check = CHECKS.find(c => c.name === 'token_map_coverage_recent')!
      expect(evaluateStatus(25, check)).toBe('WARNING')
    })

    it('fifo_missed_resolved_conditions tolerates 2000 missed (normal backlog)', () => {
      const check = CHECKS.find(c => c.name === 'fifo_missed_resolved_conditions')!
      // 2000 missed with 4h buffer is normal during active development
      expect(evaluateStatus(2000, check)).not.toBe('CRITICAL')
    })

    it('canonical_fills_empty_condition_pct alerts on 1%+ empty conditions', () => {
      const check = CHECKS.find(c => c.name === 'canonical_fills_empty_condition_pct')!
      expect(evaluateStatus(1.0, check)).toBe('CRITICAL')
    })

    it('fifo_resolution_freshness warns after 6 hours stale', () => {
      const check = CHECKS.find(c => c.name === 'fifo_resolution_freshness_hours')!
      expect(evaluateStatus(6, check)).toBe('WARNING')
      expect(evaluateStatus(5, check)).toBe('OK')
    })
  })
})
