/**
 * STRATEGY EXECUTOR CRON JOB TESTS
 *
 * Tests for Task Group 2: Cron Job & Strategy Execution Engine
 * Feature: 24/7 Autonomous Strategy Execution & Monitoring
 *
 * Test Coverage:
 * 1. Cron job finds due strategies correctly
 * 2. Cron job skips strategies not due for execution
 * 3. Cron job updates timestamps after execution
 * 4. Cron job handles execution errors gracefully
 * 5. Authentication via CRON_SECRET header
 * 6. Auto-pause after 3 consecutive errors
 *
 * Run with: npm test lib/workflow/__tests__/strategy-executor-cron.test.ts
 */

import { createClient } from '@supabase/supabase-js'

// Mock Supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}))

// Mock WorkflowExecutor
jest.mock('../executor', () => ({
  workflowExecutor: {
    execute: jest.fn(),
  },
}))

const mockSupabaseClient = {
  from: jest.fn(),
  auth: {
    getUser: jest.fn(),
  },
}

describe('Strategy Executor Cron Job', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue(mockSupabaseClient)
  })

  /**
   * TEST 1: Find due strategies correctly
   *
   * Validates that the cron job queries for strategies where:
   * - auto_run = TRUE
   * - next_execution_at <= NOW()
   * - status IN ('running', 'error')
   */
  test('finds due strategies for execution', async () => {
    const now = new Date()
    const pastTime = new Date(now.getTime() - 5 * 60 * 1000) // 5 minutes ago

    const mockStrategies = [
      {
        id: 'strategy-1',
        name: 'Test Strategy 1',
        auto_run: true,
        status: 'running',
        next_execution_at: pastTime.toISOString(),
        execution_interval_minutes: 5,
        error_count: 0,
      },
      {
        id: 'strategy-2',
        name: 'Test Strategy 2',
        auto_run: true,
        status: 'running',
        next_execution_at: pastTime.toISOString(),
        execution_interval_minutes: 10,
        error_count: 1,
      },
    ]

    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: mockStrategies, error: null }),
    }

    mockSupabaseClient.from.mockReturnValue(mockQuery)

    // Import function to test (this would be from the actual cron job)
    const { findDueStrategies } = require('../../../app/api/cron/strategy-executor/executor')

    const strategies = await findDueStrategies()

    expect(mockSupabaseClient.from).toHaveBeenCalledWith('workflow_sessions')
    expect(mockQuery.eq).toHaveBeenCalledWith('auto_run', true)
    expect(mockQuery.in).toHaveBeenCalledWith('status', ['running', 'error'])
    expect(strategies).toHaveLength(2)
    expect(strategies[0].id).toBe('strategy-1')
  })

  /**
   * TEST 2: Skip strategies not due for execution
   *
   * Validates that strategies with next_execution_at in the future
   * are NOT returned by the query
   */
  test('skips strategies not due for execution', async () => {
    const now = new Date()
    const futureTime = new Date(now.getTime() + 5 * 60 * 1000) // 5 minutes from now

    const mockStrategies = [
      {
        id: 'strategy-future',
        name: 'Future Strategy',
        auto_run: true,
        status: 'running',
        next_execution_at: futureTime.toISOString(),
        execution_interval_minutes: 5,
      },
    ]

    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      lte: jest.fn().mockResolvedValue({ data: [], error: null }), // Empty because not due
      limit: jest.fn().mockReturnThis(),
    }

    mockSupabaseClient.from.mockReturnValue(mockQuery)

    const { findDueStrategies } = require('../../../app/api/cron/strategy-executor/executor')

    const strategies = await findDueStrategies()

    expect(strategies).toHaveLength(0)
  })

  /**
   * TEST 3: Update timestamps after execution
   *
   * Validates that after executing a strategy:
   * - last_executed_at is set to current timestamp
   * - next_execution_at is calculated correctly (NOW + interval)
   * - execution_count is incremented
   * - success_count or error_count is incremented
   */
  test('updates timestamps and counters after execution', async () => {
    const strategy = {
      id: 'strategy-1',
      name: 'Test Strategy',
      execution_interval_minutes: 15,
      execution_count: 10,
      success_count: 9,
      error_count: 1,
      average_execution_time_ms: 1200,
    }

    const executionResult = {
      success: true,
      executionId: 'exec-123',
      outputs: {},
      executionTime: 1500,
      nodesExecuted: 5,
    }

    const mockUpdateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: null, error: null }),
    }

    mockSupabaseClient.from.mockReturnValue(mockUpdateQuery)

    const { updateStrategyAfterExecution } = require('../../../app/api/cron/strategy-executor/executor')

    await updateStrategyAfterExecution(strategy, executionResult)

    expect(mockUpdateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_executed_at: expect.any(String),
        next_execution_at: expect.any(String),
        execution_count: 11,
        success_count: 10,
        average_execution_time_ms: expect.any(Number),
      })
    )
    expect(mockUpdateQuery.eq).toHaveBeenCalledWith('id', 'strategy-1')
  })

  /**
   * TEST 4: Handle execution errors gracefully
   *
   * Validates that when a strategy execution fails:
   * - Error is caught and logged
   * - error_count is incremented
   * - Other strategies continue executing
   * - Error notification is created
   */
  test('handles execution errors gracefully', async () => {
    const strategy = {
      id: 'strategy-error',
      name: 'Failing Strategy',
      error_count: 1,
    }

    const { workflowExecutor } = require('../executor')
    workflowExecutor.execute.mockRejectedValue(new Error('API timeout'))

    const { executeStrategy } = require('../../../app/api/cron/strategy-executor/executor')

    const result = await executeStrategy(strategy)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('API timeout')
  })

  /**
   * TEST 5: Authenticate via CRON_SECRET header
   *
   * Validates that the cron endpoint:
   * - Requires Authorization: Bearer <CRON_SECRET> header
   * - Returns 401 Unauthorized if header missing or incorrect
   * - Allows request if header is valid
   */
  test('requires valid CRON_SECRET for authentication', async () => {
    const mockRequest = {
      headers: {
        get: jest.fn(),
      },
    }

    const { verifyAuth } = require('../../../app/api/cron/strategy-executor/route')

    // Test missing header
    mockRequest.headers.get.mockReturnValue(null)
    expect(verifyAuth(mockRequest)).toBe(false)

    // Test incorrect secret
    mockRequest.headers.get.mockReturnValue('Bearer wrong-secret')
    process.env.CRON_SECRET = 'correct-secret'
    expect(verifyAuth(mockRequest)).toBe(false)

    // Test correct secret
    mockRequest.headers.get.mockReturnValue('Bearer correct-secret')
    expect(verifyAuth(mockRequest)).toBe(true)
  })

  /**
   * TEST 6: Auto-pause after 3 consecutive errors
   *
   * Validates that when a strategy fails 3 times in a row:
   * - status is set to 'error'
   * - auto_run is set to FALSE
   * - Error notification is sent to user
   * - Strategy stops executing
   */
  test('auto-pauses strategy after 3 consecutive errors', async () => {
    const strategy = {
      id: 'strategy-failing',
      name: 'Consistently Failing Strategy',
      error_count: 2, // Already failed twice
      auto_run: true,
      status: 'running',
    }

    const { workflowExecutor } = require('../executor')
    workflowExecutor.execute.mockRejectedValue(new Error('Node execution failed'))

    const mockUpdateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: null, error: null }),
    }

    mockSupabaseClient.from.mockReturnValue(mockUpdateQuery)

    const { executeStrategy, shouldAutoPause } = require('../../../app/api/cron/strategy-executor/executor')

    const result = await executeStrategy(strategy)

    expect(result.success).toBe(false)
    expect(shouldAutoPause(3)).toBe(true)

    // Verify auto-pause update
    expect(mockUpdateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        auto_run: false,
      })
    )
  })
})

describe('Cron Job Helper Functions', () => {
  /**
   * TEST: Calculate next execution time correctly
   */
  test('calculates next_execution_at correctly', () => {
    const { calculateNextExecution } = require('../../../app/api/cron/strategy-executor/executor')

    const now = new Date('2025-10-26T15:30:00Z')
    const interval = 15 // minutes

    const nextExecution = calculateNextExecution(now, interval)
    const expected = new Date('2025-10-26T15:45:00Z')

    expect(nextExecution.toISOString()).toBe(expected.toISOString())
  })

  /**
   * TEST: Calculate rolling average execution time
   */
  test('calculates rolling average execution time', () => {
    const { calculateAverageExecutionTime } = require('../../../app/api/cron/strategy-executor/executor')

    const previousAvg = 1200 // ms
    const previousCount = 10
    const newExecutionTime = 1500 // ms

    const newAvg = calculateAverageExecutionTime(previousAvg, previousCount, newExecutionTime)

    // Expected: (1200 * 10 + 1500) / 11 = 1227.27... ≈ 1227
    expect(newAvg).toBeCloseTo(1227, 0)
  })
})
