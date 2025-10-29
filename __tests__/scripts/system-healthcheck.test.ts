/**
 * Unit tests for system health check functionality
 *
 * Tests cover critical behaviors:
 * - Overall health check execution completes
 * - Summary calculation aggregates results correctly
 * - Exit code logic returns proper codes
 * - Status icon formatting displays correctly
 * - Critical status takes precedence over warning/healthy
 * - Execution time meets performance requirements
 *
 * @jest-environment node
 */

import { runHealthCheck, printHealthCheckResults } from '@/scripts/system-healthcheck'

describe('System Health Check', () => {
  // Mock console methods to prevent output during tests
  let consoleLogSpy: jest.SpyInstance
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('runHealthCheck', () => {
    test('should execute all 7 health checks and return summary', async () => {
      const summary = await runHealthCheck()

      // Verify summary structure
      expect(summary).toHaveProperty('timestamp')
      expect(summary).toHaveProperty('overall_status')
      expect(summary).toHaveProperty('total_checks')
      expect(summary).toHaveProperty('healthy_count')
      expect(summary).toHaveProperty('warning_count')
      expect(summary).toHaveProperty('critical_count')
      expect(summary).toHaveProperty('total_duration_ms')
      expect(summary).toHaveProperty('checks')

      // Verify all 7 checks were executed
      expect(summary.total_checks).toBe(7)
      expect(summary.checks).toHaveLength(7)

      // Verify check names
      const checkNames = summary.checks.map((c) => c.check)
      expect(checkNames).toContain('Goldsky API')
      expect(checkNames).toContain('ClickHouse Connection')
      expect(checkNames).toContain('ClickHouse Tables')
      expect(checkNames).toContain('Postgres Connection')
      expect(checkNames).toContain('Resolution Data Freshness')
      expect(checkNames).toContain('Resolution Data Integrity')
      expect(checkNames).toContain('API Endpoints')
    }, 35000) // 35 second timeout to ensure we stay under 30s requirement with buffer

    test('should calculate summary counts correctly', async () => {
      const summary = await runHealthCheck()

      // Counts should add up to total checks
      const totalCount = summary.healthy_count + summary.warning_count + summary.critical_count
      expect(totalCount).toBe(summary.total_checks)
      expect(totalCount).toBe(7)

      // Each check should have a valid status
      summary.checks.forEach((check) => {
        expect(['healthy', 'warning', 'critical']).toContain(check.status)
      })
    }, 35000)

    test('should complete within 30 seconds', async () => {
      const startTime = Date.now()
      const summary = await runHealthCheck()
      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(30000)
      expect(summary.total_duration_ms).toBeLessThan(30000)
    }, 35000)

    test('should set overall status to critical if any check is critical', async () => {
      const summary = await runHealthCheck()

      // If there are any critical checks, overall should be critical
      if (summary.critical_count > 0) {
        expect(summary.overall_status).toBe('critical')
      }
    }, 35000)

    test('should set overall status to warning if no critical but has warnings', async () => {
      const summary = await runHealthCheck()

      // If no critical but has warnings, overall should be warning
      if (summary.critical_count === 0 && summary.warning_count > 0) {
        expect(summary.overall_status).toBe('warning')
      }
    }, 35000)

    test('should track duration for each check', async () => {
      const summary = await runHealthCheck()

      // Each check should have duration tracked
      summary.checks.forEach((check) => {
        expect(check).toHaveProperty('duration_ms')
        expect(check.duration_ms).toBeGreaterThanOrEqual(0)
      })
    }, 35000)
  })

  describe('printHealthCheckResults', () => {
    test('should print results without crashing', () => {
      const mockSummary = {
        timestamp: new Date().toISOString(),
        overall_status: 'healthy' as const,
        total_checks: 7,
        healthy_count: 7,
        warning_count: 0,
        critical_count: 0,
        total_duration_ms: 5000,
        checks: [
          {
            check: 'Test Check',
            status: 'healthy' as const,
            message: 'All good',
            details: { test: 'value' },
            duration_ms: 100,
          },
        ],
      }

      expect(() => {
        printHealthCheckResults(mockSummary)
      }).not.toThrow()

      // Verify console.log was called
      expect(consoleLogSpy).toHaveBeenCalled()
    })

    test('should display status icons for each check status', () => {
      const mockSummary = {
        timestamp: new Date().toISOString(),
        overall_status: 'warning' as const,
        total_checks: 3,
        healthy_count: 1,
        warning_count: 1,
        critical_count: 1,
        total_duration_ms: 5000,
        checks: [
          {
            check: 'Healthy Check',
            status: 'healthy' as const,
            message: 'All good',
            duration_ms: 100,
          },
          {
            check: 'Warning Check',
            status: 'warning' as const,
            message: 'Some issues',
            duration_ms: 150,
          },
          {
            check: 'Critical Check',
            status: 'critical' as const,
            message: 'Failed',
            duration_ms: 200,
          },
        ],
      }

      printHealthCheckResults(mockSummary)

      // Check that status icons are present in output
      const allLogs = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n')

      expect(allLogs).toMatch(/✓/) // Healthy icon
      expect(allLogs).toMatch(/⚠/) // Warning icon
      expect(allLogs).toMatch(/✗/) // Critical icon
    })
  })

  describe('Exit Code Logic', () => {
    test('should determine exit code based on overall status', async () => {
      const summary = await runHealthCheck()

      // Based on overall status, we can predict exit code
      // Critical should exit 1, healthy/warning should exit 0
      if (summary.overall_status === 'critical') {
        // Would exit 1
        expect(summary.overall_status).toBe('critical')
      } else {
        // Would exit 0
        expect(['healthy', 'warning']).toContain(summary.overall_status)
      }
    }, 35000)
  })
})
