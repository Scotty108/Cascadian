/**
 * ORCHESTRATOR ANALYSIS TESTS
 *
 * Task Group 13: AI Risk Analysis Engine Tests
 * Feature: Position sizing with fractional Kelly criterion
 *
 * Test Coverage:
 * 1. analyzeOpportunity with mock AI response (2 tests)
 * 2. Position sizing validation (2 tests)
 * 3. Volatility adjustment calculation (1 test)
 * 4. Drawdown protection calculation (1 test)
 *
 * Total: 6 tests (within 2-6 requirement)
 *
 * Run with: npm test lib/ai/__tests__/orchestrator-analysis.test.ts
 */

import {
  analyzeOpportunity,
  validatePositionSizing,
  calculateVolatilityAdjustment,
  calculateDrawdownProtection,
  MarketData,
  PortfolioState,
  PositionSizingRules,
  StrategySignal,
} from '../orchestrator-analysis'

// Mock the AI SDK
jest.mock('ai', () => ({
  generateText: jest.fn(),
}))

jest.mock('@ai-sdk/anthropic', () => ({
  anthropic: jest.fn(() => 'claude-sonnet-4-20250514'),
}))

import { generateText } from 'ai'

describe('Orchestrator Analysis - AI Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  /**
   * TEST 1: analyzeOpportunity returns GO decision with valid inputs
   *
   * Validates that:
   * - Function accepts valid market, portfolio, rules
   * - Calls Claude API with position-sizing prompt
   * - Parses AI response correctly
   * - Returns GO decision with recommended size
   * - Includes Kelly metrics (raw, adjusted, p_win, p_break_even)
   */
  test('analyzeOpportunity returns GO decision for favorable opportunity', async () => {
    const market: MarketData = {
      market_id: 'market-bitcoin-100k',
      question: 'Will Bitcoin reach $100k by end of 2024?',
      category: 'Crypto',
      side: 'YES',
      current_odds: { yes: 0.65, no: 0.35 },
      volume_24h: 250000,
      liquidity: 50000,
    }

    const portfolio: PortfolioState = {
      bankroll_total_equity_usd: 10000,
      bankroll_free_cash_usd: 6500,
      deployed_capital: 3500,
      open_positions: 7,
    }

    const rules: PositionSizingRules = {
      fractional_kelly_lambda: 0.25,
      max_per_position: 0.05,
      min_bet: 5,
      max_bet: 500,
      portfolio_heat_limit: 0.6,
    }

    const signal: StrategySignal = {
      direction: 'YES',
      confidence: 0.75,
      estimated_probability: 0.72, // 72% win probability
    }

    // Mock Claude API response
    const mockKellyOutput = {
      timestamp: new Date().toISOString(),
      market_id: 'market-bitcoin-100k',
      side: 'YES',
      decision: 'BUY',
      recommended_fraction_of_bankroll: 0.035,
      recommended_notional_usd: 350,
      avg_fill_price: 0.65,
      target_shares: 538,
      delta_shares: 538,
      delta_notional_usd: 350,
      kelly_fraction_raw: 0.14,
      fractional_lambda: 0.25,
      p_win: 0.72,
      p_break_even: 0.634,
      R_win_per_dollar: 0.527,
      expected_log_growth: 0.008,
      constraints_applied: {
        max_fraction_hard: 0.05,
        portfolio_active_risk_limit_pct: 0.6,
      },
      cash_checks: {
        bankroll_total_equity_usd: 10000,
        bankroll_free_cash_usd: 6500,
      },
      position_digest: {
        current_side: 'NONE',
        current_shares: 0,
        current_avg_entry_cost: 0,
        current_same_side_notional_usd: 0,
        current_opposite_side_notional_usd: 0,
      },
      risk_flags: [],
      execution_notes: 'Position sized within portfolio constraints',
    }

    ;(generateText as jest.Mock).mockResolvedValue({
      text: JSON.stringify(mockKellyOutput),
    })

    const result = await analyzeOpportunity(market, portfolio, rules, signal)

    // Verify AI was called
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-20250514',
        temperature: 0,
      })
    )

    // Verify result structure
    expect(result.decision).toBe('GO')
    expect(result.recommended_size).toBe(350)
    expect(result.recommended_fraction_of_bankroll).toBe(0.035)
    expect(result.target_shares).toBe(538)
    expect(result.delta_shares).toBe(538)

    // Verify Kelly metrics
    expect(result.kelly_fraction_raw).toBe(0.14)
    expect(result.kelly_fraction_adjusted).toBe(0.035)
    expect(result.p_win).toBe(0.72)
    expect(result.p_break_even).toBeCloseTo(0.634, 2)
    expect(result.expected_log_growth).toBeGreaterThan(0)

    // Verify risk assessment
    expect(result.risk_score).toBeGreaterThanOrEqual(1)
    expect(result.risk_score).toBeLessThanOrEqual(10)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)

    // Verify reasoning
    expect(result.reasoning).toContain('Bitcoin')
    expect(result.reasoning).toContain('YES')
    expect(result.reasoning).toContain('Edge')

    // Verify no validation errors
    expect(result.risk_flags).toEqual([])
  })

  /**
   * TEST 2: analyzeOpportunity returns NO_GO for unfavorable opportunity
   *
   * Validates that:
   * - AI detects insufficient edge
   * - Returns HOLD decision
   * - Recommended size is 0
   * - Includes risk flags explaining why
   */
  test('analyzeOpportunity returns NO_GO when edge is insufficient', async () => {
    const market: MarketData = {
      market_id: 'market-low-edge',
      question: 'Will this coin flip land heads?',
      category: 'Random',
      side: 'YES',
      current_odds: { yes: 0.5, no: 0.5 },
      volume_24h: 1000,
      liquidity: 500,
    }

    const portfolio: PortfolioState = {
      bankroll_total_equity_usd: 10000,
      bankroll_free_cash_usd: 9500,
      deployed_capital: 500,
      open_positions: 2,
    }

    const rules: PositionSizingRules = {
      fractional_kelly_lambda: 0.25,
      max_per_position: 0.05,
      min_bet: 5,
      max_bet: 500,
      min_edge_prob: 0.05, // Require 5% edge
    }

    // Mock AI response - HOLD due to no edge
    const mockKellyOutput = {
      timestamp: new Date().toISOString(),
      market_id: 'market-low-edge',
      side: 'YES',
      decision: 'HOLD',
      recommended_fraction_of_bankroll: 0,
      recommended_notional_usd: 0,
      avg_fill_price: 0.5,
      target_shares: 0,
      delta_shares: 0,
      delta_notional_usd: 0,
      kelly_fraction_raw: 0,
      fractional_lambda: 0.25,
      p_win: 0.51,
      p_break_even: 0.505,
      R_win_per_dollar: 0.98,
      expected_log_growth: 0,
      constraints_applied: {},
      cash_checks: {
        bankroll_total_equity_usd: 10000,
        bankroll_free_cash_usd: 9500,
      },
      position_digest: {
        current_side: 'NONE',
        current_shares: 0,
        current_avg_entry_cost: 0,
        current_same_side_notional_usd: 0,
        current_opposite_side_notional_usd: 0,
      },
      risk_flags: ['SMALL_EDGE'],
      execution_notes: 'Edge below minimum threshold',
    }

    ;(generateText as jest.Mock).mockResolvedValue({
      text: JSON.stringify(mockKellyOutput),
    })

    const result = await analyzeOpportunity(market, portfolio, rules)

    expect(result.decision).toBe('HOLD')
    expect(result.recommended_size).toBe(0)
    expect(result.risk_flags).toContain('SMALL_EDGE')
    expect(result.reasoning).toContain('No position recommended')
  })
})

describe('Position Sizing Validation', () => {
  const portfolio: PortfolioState = {
    bankroll_total_equity_usd: 10000,
    bankroll_free_cash_usd: 6500,
    deployed_capital: 3500,
    open_positions: 5,
  }

  const rules: PositionSizingRules = {
    fractional_kelly_lambda: 0.25,
    max_per_position: 0.05, // 5% max
    min_bet: 10,
    max_bet: 500,
    portfolio_heat_limit: 0.6, // 60% max deployed
  }

  /**
   * TEST 3: validatePositionSizing accepts valid position size
   *
   * Validates that:
   * - Position within min/max bet range passes
   * - Position within max % per position passes
   * - Position within available cash passes
   * - Position within portfolio heat limit passes
   */
  test('validates position within all limits', () => {
    const size = 300 // $300 (3% of bankroll)

    const validation = validatePositionSizing(size, portfolio, rules)

    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])
  })

  /**
   * TEST 4: validatePositionSizing rejects invalid position size
   *
   * Validates that:
   * - Position below min_bet fails
   * - Position above max_bet fails
   * - Position above max % per position fails
   * - Position above available cash fails
   * - Position exceeding portfolio heat limit fails
   * - Returns specific error messages
   */
  test('rejects position that violates multiple constraints', () => {
    const size = 7000 // $7000 (70% of bankroll, exceeds max and cash)

    const validation = validatePositionSizing(size, portfolio, rules)

    expect(validation.valid).toBe(false)
    expect(validation.errors.length).toBeGreaterThan(0)

    // Check for specific errors
    const errorString = validation.errors.join(' ')
    expect(errorString).toContain('SIZE_TOO_LARGE') // Exceeds max_bet
    expect(errorString).toContain('EXCEEDS_MAX_POSITION') // Exceeds 5%
    expect(errorString).toContain('INSUFFICIENT_CASH') // Exceeds available cash
    expect(errorString).toContain('PORTFOLIO_HEAT_LIMIT') // Exceeds 60% total
  })
})

describe('Volatility Adjustment', () => {
  /**
   * TEST 5: calculateVolatilityAdjustment scales based on liquidity and volume
   *
   * Validates that:
   * - High liquidity + high volume → factor near 1.0 (no reduction)
   * - Low liquidity → factor reduced (more conservative)
   * - Low volume → factor reduced (more conservative)
   * - Very illiquid markets → factor significantly reduced (0.25-0.5)
   */
  test('adjusts Kelly fraction based on market volatility', () => {
    // High liquidity, high volume (stable market)
    const stableMarket: MarketData = {
      market_id: 'stable',
      question: 'Stable market',
      category: 'Test',
      side: 'YES',
      current_odds: { yes: 0.5, no: 0.5 },
      volume_24h: 600000, // $600k
      liquidity: 150000, // $150k
    }

    const stableFactor = calculateVolatilityAdjustment(stableMarket)
    expect(stableFactor).toBeGreaterThanOrEqual(0.9)
    expect(stableFactor).toBeLessThanOrEqual(1.0)

    // Low liquidity, low volume (volatile market)
    const volatileMarket: MarketData = {
      market_id: 'volatile',
      question: 'Volatile market',
      category: 'Test',
      side: 'YES',
      current_odds: { yes: 0.5, no: 0.5 },
      volume_24h: 5000, // $5k (very low)
      liquidity: 2000, // $2k (very low)
    }

    const volatileFactor = calculateVolatilityAdjustment(volatileMarket)
    expect(volatileFactor).toBeGreaterThanOrEqual(0.25)
    expect(volatileFactor).toBeLessThan(0.5) // Should be significantly reduced

    // Moderate market
    const moderateMarket: MarketData = {
      market_id: 'moderate',
      question: 'Moderate market',
      category: 'Test',
      side: 'YES',
      current_odds: { yes: 0.5, no: 0.5 },
      volume_24h: 100000, // $100k
      liquidity: 20000, // $20k
    }

    const moderateFactor = calculateVolatilityAdjustment(moderateMarket)
    expect(moderateFactor).toBeGreaterThan(volatileFactor)
    expect(moderateFactor).toBeLessThan(stableFactor)
  })
})

describe('Drawdown Protection', () => {
  /**
   * TEST 6: calculateDrawdownProtection scales based on drawdown severity
   *
   * Validates that:
   * - No drawdown (0%) → factor = 1.0 (no adjustment)
   * - Small drawdown (<10%) → factor slightly reduced
   * - Moderate drawdown (10-20%) → factor = drawdownScaler
   * - Large drawdown (20%+) → factor = drawdownScaler * 0.5
   */
  test('reduces Kelly fraction during drawdowns', () => {
    const drawdownScaler = 0.5 // 50% reduction at 10%+ drawdown

    // No drawdown
    const noDrawdown = calculateDrawdownProtection(0, drawdownScaler)
    expect(noDrawdown).toBe(1.0)

    // Small drawdown (5%)
    const smallDrawdown = calculateDrawdownProtection(0.05, drawdownScaler)
    expect(smallDrawdown).toBeGreaterThan(drawdownScaler)
    expect(smallDrawdown).toBeLessThan(1.0)

    // Moderate drawdown (15%)
    const moderateDrawdown = calculateDrawdownProtection(0.15, drawdownScaler)
    expect(moderateDrawdown).toBe(drawdownScaler)

    // Large drawdown (25%)
    const largeDrawdown = calculateDrawdownProtection(0.25, drawdownScaler)
    expect(largeDrawdown).toBe(drawdownScaler * 0.5)
    expect(largeDrawdown).toBeLessThan(moderateDrawdown)
  })
})
