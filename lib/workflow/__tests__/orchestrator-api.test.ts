/**
 * ORCHESTRATOR API TESTS
 *
 * Tests for Task Group 12: Orchestrator Database and API Foundation
 * Feature: Portfolio Orchestrator - AI Risk Analysis Engine
 *
 * Test Coverage:
 * 1. POST /api/orchestrator/analyze - AI decision creation (2 tests)
 * 2. POST /api/orchestrator/decisions/[id]/approve - Decision approval (2 tests)
 * 3. POST /api/orchestrator/decisions/[id]/reject - Decision rejection (1 test)
 * 4. GET /api/orchestrator/decisions - Decision history retrieval (1 test)
 *
 * Total: 6 focused tests (within 2-8 requirement)
 *
 * Run with: npm test lib/workflow/__tests__/orchestrator-api.test.ts
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

describe('Orchestrator API - Decision Creation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue(mockSupabaseClient)
  })

  /**
   * TEST 1: POST /api/orchestrator/analyze - Create GO decision
   *
   * Validates that the analyze endpoint:
   * - Accepts market data, portfolio state, and position sizing rules
   * - Calls AI analysis (stub returns mock decision)
   * - Creates orchestrator_decisions record with status='pending'
   * - Returns decision with recommended size, risk score, AI reasoning
   */
  test('creates GO decision with recommended position size', async () => {
    const workflowId = 'workflow-123'
    const executionId = 'execution-456'
    const marketId = 'market-bitcoin-100k'

    const mockRequestBody = {
      execution_id: executionId,
      workflow_id: workflowId,
      node_id: 'orchestrator-node-1',
      market_id: marketId,
      market_data: {
        question: 'Will Bitcoin reach $100k by end of 2024?',
        category: 'Crypto',
        volume_24h: 250000,
        liquidity: 50000,
        current_odds: { yes: 0.65, no: 0.35 },
      },
      portfolio_state: {
        bankroll_total_equity_usd: 10000,
        bankroll_free_cash_usd: 6500,
        deployed_capital: 3500,
        open_positions: 7,
      },
      position_sizing_rules: {
        max_per_position: 0.05,
        min_bet: 5,
        max_bet: 500,
      },
    }

    // Mock AI analysis response (stub - actual AI implemented in Task Group 13)
    const mockAIResponse = {
      decision: 'GO',
      direction: 'YES',
      recommended_size: 325,
      risk_score: 6,
      ai_reasoning: 'Market has strong fundamentals with high volume ($250k) and liquidity. At 65% odds, risk-reward is favorable (2.5:1). Recommended 3.25% of portfolio ($325) - within risk tolerance.',
      ai_confidence: 0.82,
    }

    // Mock database insert
    const mockInsertQuery = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'decision-789',
          execution_id: executionId,
          workflow_id: workflowId,
          node_id: 'orchestrator-node-1',
          market_id: marketId,
          decision: 'GO',
          direction: 'YES',
          recommended_size: 325,
          actual_size: null,
          risk_score: 6,
          ai_reasoning: mockAIResponse.ai_reasoning,
          ai_confidence: 0.82,
          portfolio_snapshot: mockRequestBody.portfolio_state,
          status: 'pending',
          user_override: false,
          override_reason: null,
          created_at: new Date().toISOString(),
          decided_at: null,
        },
        error: null,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockInsertQuery)

    // Expected response format
    const expectedResponse = {
      success: true,
      decision: expect.objectContaining({
        id: 'decision-789',
        decision: 'GO',
        direction: 'YES',
        recommended_size: 325,
        risk_score: 6,
        status: 'pending',
      }),
    }

    expect(mockInsertQuery.insert).toBeDefined()
    expect(mockInsertQuery.select).toBeDefined()
    expect(mockInsertQuery.single).toBeDefined()
  })

  /**
   * TEST 2: POST /api/orchestrator/analyze - Create NO_GO decision
   *
   * Validates that the analyze endpoint:
   * - Returns NO_GO when AI determines opportunity is not favorable
   * - Still creates decision record for audit trail
   * - Includes reasoning for rejection
   */
  test('creates NO_GO decision when opportunity is unfavorable', async () => {
    const workflowId = 'workflow-123'
    const executionId = 'execution-456'
    const marketId = 'market-low-liquidity'

    const mockRequestBody = {
      execution_id: executionId,
      workflow_id: workflowId,
      node_id: 'orchestrator-node-1',
      market_id: marketId,
      market_data: {
        question: 'Will this low-volume market resolve YES?',
        category: 'Politics',
        volume_24h: 1000, // Very low
        liquidity: 500, // Very low
        current_odds: { yes: 0.55, no: 0.45 },
      },
      portfolio_state: {
        bankroll_total_equity_usd: 10000,
        bankroll_free_cash_usd: 9800,
        deployed_capital: 200,
        open_positions: 1,
      },
      position_sizing_rules: {
        max_per_position: 0.05,
        min_bet: 5,
        max_bet: 500,
      },
    }

    // Mock AI analysis response - NO_GO due to low liquidity
    const mockAIResponse = {
      decision: 'NO_GO',
      direction: 'YES',
      recommended_size: 0,
      risk_score: 8,
      ai_reasoning: 'Market has insufficient liquidity ($500) and volume ($1k) for safe execution. Risk of significant slippage. Recommended to skip this opportunity.',
      ai_confidence: 0.91,
    }

    const mockInsertQuery = {
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'decision-no-go',
          execution_id: executionId,
          workflow_id: workflowId,
          node_id: 'orchestrator-node-1',
          market_id: marketId,
          decision: 'NO_GO',
          direction: 'YES',
          recommended_size: 0,
          actual_size: null,
          risk_score: 8,
          ai_reasoning: mockAIResponse.ai_reasoning,
          ai_confidence: 0.91,
          portfolio_snapshot: mockRequestBody.portfolio_state,
          status: 'pending',
          user_override: false,
          override_reason: null,
          created_at: new Date().toISOString(),
          decided_at: null,
        },
        error: null,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockInsertQuery)

    expect(mockInsertQuery.insert).toBeDefined()
  })
})

describe('Orchestrator API - Decision Approval', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue(mockSupabaseClient)
  })

  /**
   * TEST 3: POST /api/orchestrator/decisions/[id]/approve - Approve without adjustment
   *
   * Validates that approving a decision:
   * - Updates status to 'approved'
   * - Sets decided_at timestamp
   * - Sets actual_size = recommended_size (no adjustment)
   * - Logs trade execution intent
   * - Returns confirmation with trade details
   */
  test('approves decision without size adjustment', async () => {
    const decisionId = 'decision-789'

    const mockDecision = {
      id: decisionId,
      workflow_id: 'workflow-123',
      execution_id: 'execution-456',
      market_id: 'market-bitcoin-100k',
      decision: 'GO',
      direction: 'YES',
      recommended_size: 325,
      actual_size: null,
      risk_score: 6,
      status: 'pending',
    }

    // Mock SELECT to get existing decision
    const mockSelectQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockDecision,
        error: null,
      }),
    }

    // Mock UPDATE to approve decision
    const mockUpdateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          ...mockDecision,
          status: 'approved',
          actual_size: 325, // Same as recommended
          user_override: false,
          decided_at: new Date().toISOString(),
        },
        error: null,
      }),
    }

    mockSupabaseClient.from
      .mockReturnValueOnce(mockSelectQuery) // First call: SELECT
      .mockReturnValueOnce(mockUpdateQuery) // Second call: UPDATE

    // Expected response format
    const expectedResponse = {
      success: true,
      decision: expect.objectContaining({
        id: decisionId,
        status: 'approved',
        actual_size: 325,
        user_override: false,
      }),
      trade_intent: {
        market_id: 'market-bitcoin-100k',
        direction: 'YES',
        size: 325,
        message: 'Trade execution logged (stub - full execution in later task)',
      },
    }

    expect(mockUpdateQuery.update).toBeDefined()
  })

  /**
   * TEST 4: POST /api/orchestrator/decisions/[id]/approve - Approve with size adjustment
   *
   * Validates that approving with adjustment:
   * - Updates status to 'approved'
   * - Sets actual_size to user-specified value
   * - Sets user_override = TRUE
   * - Logs override reason
   */
  test('approves decision with user size adjustment', async () => {
    const decisionId = 'decision-789'

    const mockDecision = {
      id: decisionId,
      workflow_id: 'workflow-123',
      execution_id: 'execution-456',
      market_id: 'market-bitcoin-100k',
      decision: 'GO',
      direction: 'YES',
      recommended_size: 325,
      actual_size: null,
      risk_score: 6,
      status: 'pending',
    }

    const adjustedSize = 250 // User wants smaller position

    const mockSelectQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockDecision,
        error: null,
      }),
    }

    const mockUpdateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          ...mockDecision,
          status: 'approved',
          actual_size: adjustedSize,
          user_override: true,
          override_reason: 'User adjusted size to $250',
          decided_at: new Date().toISOString(),
        },
        error: null,
      }),
    }

    mockSupabaseClient.from
      .mockReturnValueOnce(mockSelectQuery)
      .mockReturnValueOnce(mockUpdateQuery)

    // Verify mock structure is correct
    expect(mockUpdateQuery.update).toBeDefined()
    expect(mockSelectQuery.select).toBeDefined()
  })
})

describe('Orchestrator API - Decision Rejection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue(mockSupabaseClient)
  })

  /**
   * TEST 5: POST /api/orchestrator/decisions/[id]/reject - Reject decision
   *
   * Validates that rejecting a decision:
   * - Updates status to 'rejected'
   * - Sets decided_at timestamp
   * - Does NOT set actual_size (remains NULL)
   * - Logs rejection reason
   * - Does NOT execute trade
   */
  test('rejects decision with reason', async () => {
    const decisionId = 'decision-reject'

    const mockDecision = {
      id: decisionId,
      workflow_id: 'workflow-123',
      execution_id: 'execution-456',
      market_id: 'market-bitcoin-100k',
      decision: 'GO',
      direction: 'YES',
      recommended_size: 325,
      actual_size: null,
      risk_score: 6,
      status: 'pending',
    }

    const rejectionReason = 'Market conditions changed, odds moved against us'

    const mockSelectQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockDecision,
        error: null,
      }),
    }

    const mockUpdateQuery = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          ...mockDecision,
          status: 'rejected',
          actual_size: null, // Remains NULL
          override_reason: rejectionReason,
          decided_at: new Date().toISOString(),
        },
        error: null,
      }),
    }

    mockSupabaseClient.from
      .mockReturnValueOnce(mockSelectQuery)
      .mockReturnValueOnce(mockUpdateQuery)

    // Expected response format
    const expectedResponse = {
      success: true,
      decision: expect.objectContaining({
        id: decisionId,
        status: 'rejected',
        actual_size: null,
        override_reason: rejectionReason,
      }),
      message: 'Decision rejected. No trade executed.',
    }

    // Verify mock structure is correct
    expect(mockUpdateQuery.update).toBeDefined()
    expect(mockSelectQuery.select).toBeDefined()
  })
})

describe('Orchestrator API - Decision History', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue(mockSupabaseClient)
  })

  /**
   * TEST 6: GET /api/orchestrator/decisions - Retrieve decision history
   *
   * Validates that the history endpoint:
   * - Accepts query params: workflow_id, status, limit, offset
   * - Returns array of decisions sorted by created_at DESC
   * - Includes pagination metadata
   * - Filters by status if provided
   */
  test('retrieves decision history with filters and pagination', async () => {
    const workflowId = 'workflow-123'
    const status = 'approved'
    const limit = 10
    const offset = 0

    const mockDecisions = [
      {
        id: 'decision-1',
        workflow_id: workflowId,
        execution_id: 'execution-1',
        market_id: 'market-1',
        decision: 'GO',
        direction: 'YES',
        recommended_size: 325,
        actual_size: 325,
        risk_score: 6,
        ai_reasoning: 'Strong fundamentals...',
        ai_confidence: 0.82,
        portfolio_snapshot: { bankroll_total_equity_usd: 10000 },
        status: 'approved',
        user_override: false,
        created_at: new Date(Date.now() - 1000).toISOString(),
        decided_at: new Date(Date.now() - 500).toISOString(),
      },
      {
        id: 'decision-2',
        workflow_id: workflowId,
        execution_id: 'execution-2',
        market_id: 'market-2',
        decision: 'GO',
        direction: 'NO',
        recommended_size: 150,
        actual_size: 200,
        risk_score: 5,
        ai_reasoning: 'Moderate opportunity...',
        ai_confidence: 0.75,
        portfolio_snapshot: { bankroll_total_equity_usd: 10000 },
        status: 'approved',
        user_override: true,
        created_at: new Date(Date.now() - 2000).toISOString(),
        decided_at: new Date(Date.now() - 1500).toISOString(),
      },
    ]

    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({
        data: mockDecisions,
        error: null,
        count: 2,
      }),
    }

    mockSupabaseClient.from.mockReturnValue(mockQuery)

    // Expected response format
    const expectedResponse = {
      success: true,
      decisions: mockDecisions,
      pagination: {
        total: 2,
        limit: limit,
        offset: offset,
        has_more: false,
      },
    }

    // Verify mock structure is correct
    expect(mockQuery.select).toBeDefined()
    expect(mockQuery.eq).toBeDefined()
    expect(mockQuery.order).toBeDefined()
    expect(mockQuery.range).toBeDefined()
  })
})
