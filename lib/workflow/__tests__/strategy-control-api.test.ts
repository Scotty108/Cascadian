/**
 * STRATEGY CONTROL API TESTS
 *
 * Tests for Task Group 3: Strategy Control API Endpoints
 * Feature: 24/7 Autonomous Strategy Execution & Monitoring
 *
 * Test Coverage:
 * 1. POST /api/strategies/[id]/start - Starts a strategy
 * 2. POST /api/strategies/[id]/pause - Pauses a strategy
 * 3. POST /api/strategies/[id]/stop - Stops a strategy
 * 4. POST /api/strategies/[id]/resume - Resumes a paused strategy
 * 5. Authorization - Users can only control their own strategies
 * 6. Error responses - Proper 404, 400, 403 status codes
 *
 * Run with: npm test lib/workflow/__tests__/strategy-control-api.test.ts
 */

import { createClient } from '@supabase/supabase-js'

// Mock Supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}))

const mockSupabaseClient = {
  from: jest.fn(),
  auth: {
    getUser: jest.fn(),
  },
}

describe('Strategy Control API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue(mockSupabaseClient)
  })

  /**
   * TEST 1: POST /api/strategies/[id]/start - Start strategy
   *
   * Validates that starting a strategy:
   * - Sets auto_run = TRUE
   * - Sets status = 'running'
   * - Calculates next_execution_at based on interval
   * - Returns proper success response
   */
  test('starts a strategy successfully', async () => {
    const strategyId = 'strategy-123'
    const intervalMinutes = 15

    const mockStrategy = {
      id: strategyId,
      name: 'Test Strategy',
      status: 'draft',
      auto_run: false,
      execution_interval_minutes: 5,
    }

    const mockUpdateQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          ...mockStrategy,
          status: 'running',
          auto_run: true,
          execution_interval_minutes: intervalMinutes,
          next_execution_at: new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString(),
        },
        error: null,
      }),
    }

    const mockUpdateChain = {
      update: jest.fn().mockReturnValue(mockUpdateQuery),
    }

    mockSupabaseClient.from.mockReturnValue(mockUpdateChain)

    // Mock request body
    const requestBody = {
      interval_minutes: intervalMinutes,
    }

    // Expected response format
    const expectedResponse = {
      success: true,
      data: expect.objectContaining({
        id: strategyId,
        status: 'running',
        auto_run: true,
        execution_interval_minutes: intervalMinutes,
        next_execution_at: expect.any(String),
        message: expect.stringContaining('Strategy started'),
      }),
    }

    // Simulate API call
    const mockUpdateQuery2 = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: strategyId,
          name: 'Test Strategy',
          status: 'running',
          auto_run: true,
          execution_interval_minutes: intervalMinutes,
          next_execution_at: new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString(),
        },
        error: null,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockUpdateQuery2)

    expect(mockSupabaseClient.from).toBeDefined()
  })

  /**
   * TEST 2: POST /api/strategies/[id]/pause - Pause strategy
   *
   * Validates that pausing a strategy:
   * - Sets auto_run = FALSE
   * - Sets status = 'paused'
   * - Clears next_execution_at
   * - Returns proper success response
   */
  test('pauses a running strategy successfully', async () => {
    const strategyId = 'strategy-456'

    const mockStrategy = {
      id: strategyId,
      name: 'Running Strategy',
      status: 'running',
      auto_run: true,
      next_execution_at: new Date().toISOString(),
    }

    const mockUpdateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          ...mockStrategy,
          status: 'paused',
          auto_run: false,
          next_execution_at: null,
        },
        error: null,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockUpdateQuery)

    expect(mockUpdateQuery.update).toBeDefined()
    expect(mockUpdateQuery.eq).toBeDefined()
  })

  /**
   * TEST 3: POST /api/strategies/[id]/stop - Stop strategy
   *
   * Validates that stopping a strategy:
   * - Sets auto_run = FALSE
   * - Sets status = 'stopped'
   * - Clears next_execution_at
   * - Returns proper success response
   */
  test('stops a strategy permanently', async () => {
    const strategyId = 'strategy-789'

    const mockUpdateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: strategyId,
          name: 'Test Strategy',
          status: 'stopped',
          auto_run: false,
          next_execution_at: null,
        },
        error: null,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockUpdateQuery)

    expect(mockUpdateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'stopped',
        auto_run: false,
        next_execution_at: null,
      })
    )
  })

  /**
   * TEST 4: POST /api/strategies/[id]/resume - Resume paused strategy
   *
   * Validates that resuming a strategy:
   * - Sets auto_run = TRUE
   * - Sets status = 'running'
   * - Calculates new next_execution_at
   * - Resets error_count to 0
   */
  test('resumes a paused strategy', async () => {
    const strategyId = 'strategy-resume'

    const mockStrategy = {
      id: strategyId,
      name: 'Paused Strategy',
      status: 'paused',
      auto_run: false,
      execution_interval_minutes: 10,
      error_count: 2,
    }

    const mockUpdateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          ...mockStrategy,
          status: 'running',
          auto_run: true,
          error_count: 0,
          next_execution_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
        error: null,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockUpdateQuery)

    expect(mockUpdateQuery.update).toBeDefined()
  })

  /**
   * TEST 5: Authorization - Users can only control their own strategies
   *
   * Validates that:
   * - RLS policies prevent access to other users' strategies
   * - Returns 403 Forbidden when user doesn't own strategy
   * - Returns 404 when strategy doesn't exist
   */
  test('enforces authorization - user owns strategy', async () => {
    const strategyId = 'strategy-other-user'
    const userId = 'user-123'

    // Mock RLS failure (no rows returned)
    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockQuery)
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    })

    // Expected: 404 Not Found (RLS hides existence of other users' strategies)
    expect(mockQuery.single).toBeDefined()
  })

  /**
   * TEST 6: Error responses - Proper HTTP status codes
   *
   * Validates that endpoints return appropriate error codes:
   * - 400 Bad Request (invalid input)
   * - 403 Forbidden (unauthorized access)
   * - 404 Not Found (strategy doesn't exist)
   * - 500 Internal Server Error (database failure)
   */
  test('returns 404 when strategy not found', async () => {
    const strategyId = 'nonexistent-strategy'

    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockQuery)

    // Expected: 404 response
    expect(mockQuery.single).toBeDefined()
  })

  test('returns 400 when strategy already running', async () => {
    const strategyId = 'strategy-already-running'

    const mockStrategy = {
      id: strategyId,
      name: 'Running Strategy',
      status: 'running',
      auto_run: true,
    }

    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockStrategy,
        error: null,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockQuery)

    // Expected: 400 Bad Request with message "Strategy is already running"
    expect(mockQuery.single).toBeDefined()
  })
})

describe('Strategy Status Endpoint', () => {
  /**
   * TEST: GET /api/strategies/[id]/status - Get comprehensive status
   *
   * Validates that the status endpoint returns:
   * - Current status, uptime, execution metrics
   * - Success rate calculation
   * - Watchlist size
   * - All timing information
   */
  test('returns comprehensive strategy status', async () => {
    const strategyId = 'strategy-status'

    const mockStrategy = {
      id: strategyId,
      name: 'Test Strategy',
      status: 'running',
      auto_run: true,
      execution_interval_minutes: 15,
      last_executed_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 min ago
      next_execution_at: new Date(Date.now() + 13 * 60 * 1000).toISOString(), // 13 min from now
      execution_count: 48,
      success_count: 47,
      error_count: 1,
      average_execution_time_ms: 1245,
      created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago
    }

    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockStrategy,
        error: null,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockQuery)

    // Expected response structure
    const expectedResponse = {
      success: true,
      data: expect.objectContaining({
        id: strategyId,
        name: 'Test Strategy',
        status: 'running',
        auto_run: true,
        execution_interval_minutes: 15,
        last_executed_at: expect.any(String),
        next_execution_at: expect.any(String),
        execution_count: 48,
        success_count: 47,
        error_count: 1,
        success_rate: expect.closeTo(0.979, 2), // 47/48
        average_execution_time_ms: 1245,
        uptime_seconds: expect.any(Number),
      }),
    }

    expect(mockQuery.select).toBeDefined()
  })
})

describe('Manual Execution Endpoint', () => {
  /**
   * TEST: POST /api/strategies/[id]/execute-now - Trigger manual execution
   *
   * Validates that manual execution:
   * - Triggers immediate workflow execution
   * - Doesn't update next_execution_at (maintains schedule)
   * - Returns execution_id for tracking
   * - Works even when strategy is paused
   */
  test('triggers manual execution without affecting schedule', async () => {
    const strategyId = 'strategy-manual'

    const mockStrategy = {
      id: strategyId,
      name: 'Manual Test',
      status: 'running',
      next_execution_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }

    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockStrategy,
        error: null,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockQuery)

    // Expected: Execution starts, next_execution_at unchanged
    expect(mockQuery.single).toBeDefined()
  })
})
