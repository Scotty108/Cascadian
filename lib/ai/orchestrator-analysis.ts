/**
 * ORCHESTRATOR ANALYSIS - AI RISK ANALYSIS ENGINE
 *
 * Task Group 13: AI-powered position sizing using fractional Kelly criterion
 *
 * This module implements the core AI analysis logic for the Portfolio Orchestrator node.
 * It uses Claude Sonnet 4.5 with the position-sizing-prompt.md framework to:
 * - Calculate optimal position sizes using fractional Kelly
 * - Apply portfolio constraints and risk limits
 * - Validate position sizing rules
 * - Provide GO/NO_GO decisions with reasoning
 *
 * Key Features:
 * - Fractional Kelly criterion implementation
 * - Portfolio-aware decision making
 * - Break-even probability calculation
 * - Risk-reward analysis
 * - Volatility and drawdown adjustments
 */

import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Market data input for position sizing
 */
export interface MarketData {
  market_id: string
  question: string
  category: string
  side: 'YES' | 'NO'
  current_odds: { yes: number; no: number }
  volume_24h: number
  liquidity: number
  created_at?: string
  end_date?: string
  [key: string]: any
}

/**
 * Portfolio state for context
 */
export interface PortfolioState {
  bankroll_total_equity_usd: number
  bankroll_free_cash_usd: number
  deployed_capital: number
  open_positions: number
  recent_pnl?: number
  win_rate_7d?: number
  current_drawdown?: number
  [key: string]: any
}

/**
 * Position sizing rules configuration
 */
export interface PositionSizingRules {
  // Required rules
  fractional_kelly_lambda: number // Kelly fraction (0-1), e.g. 0.25-0.50
  max_per_position: number // Max % of bankroll per position (0-1)
  min_bet: number // Minimum bet size in USD
  max_bet: number // Maximum bet size in USD

  // Optional constraints
  portfolio_heat_limit?: number // Max % of bankroll deployed total (0-1)
  risk_reward_threshold?: number // Min R:R ratio (e.g. 2.0)
  single_market_limit_pct?: number // Hard cap per market (0-1)
  cluster_limit_pct?: number // Hard cap per cluster (0-1)
  liquidity_cap_usd?: number // Execution/risk cap
  min_edge_prob?: number // Min edge required (p_win - p_break_even)
  kelly_drawdown_scaler?: number // Reduce Kelly when in drawdown (0-1)
  volatility_adjustment_enabled?: boolean // Enable volatility-based sizing
  drawdown_protection_enabled?: boolean // Enable drawdown protection

  [key: string]: any
}

/**
 * Current position in a market
 */
export interface CurrentPosition {
  side: 'YES' | 'NO' | 'NONE'
  shares: number
  avg_entry_cost: number
}

/**
 * Strategy signal (optional - from upstream nodes)
 */
export interface StrategySignal {
  direction: 'YES' | 'NO'
  confidence?: number // 0-1
  reasoning?: string
  estimated_probability?: number // Calibrated p_win
}

/**
 * AI Analysis Result
 */
export interface AnalysisResult {
  // Decision
  decision: 'GO' | 'NO_GO' | 'REDUCE' | 'CLOSE' | 'FLIP' | 'HOLD'

  // Position sizing
  recommended_size: number // USD notional
  recommended_fraction_of_bankroll: number // 0-1
  target_shares?: number
  delta_shares?: number
  delta_notional_usd?: number

  // Risk metrics
  risk_score: number // 1-10
  reasoning: string
  confidence: number // 0-1

  // Kelly metrics
  kelly_fraction_raw?: number
  kelly_fraction_adjusted?: number
  p_win?: number
  p_break_even?: number
  expected_log_growth?: number

  // Constraints applied
  constraints_applied?: string[]
  risk_flags?: string[]

  // Execution notes
  execution_notes?: string
}

/**
 * Kelly AI Input - maps to position-sizing-prompt.md schema
 */
interface KellyAIInput {
  timestamp: string
  market_id: string
  side: 'YES' | 'NO'
  p_win: number
  entry_cost_per_share: number
  resolution_fee_rate: number
  fractional_kelly_lambda: number

  // Bankroll
  bankroll_total_equity_usd: number
  bankroll_free_cash_usd: number

  // Current position
  current_position: CurrentPosition

  // Cluster
  cluster_id: string
  cluster_used_fraction_pct: number

  // Optional constraints
  single_market_limit_pct?: number
  cluster_limit_pct?: number
  portfolio_active_risk_limit_pct?: number
  portfolio_used_fraction_pct?: number
  liquidity_cap_usd?: number
  min_notional_usd?: number
  lot_size?: number
  max_fraction_hard?: number
  min_edge_prob?: number
  kelly_drawdown_scaler?: number
  mark_price_for_delta?: number
  min_kelly_step_fraction?: number
}

/**
 * Kelly AI Output - from Claude API (matches position-sizing-prompt.md)
 */
interface KellyAIOutput {
  timestamp: string
  market_id: string
  side: 'YES' | 'NO'
  decision: 'BUY' | 'SELL' | 'HOLD' | 'REDUCE' | 'CLOSE' | 'FLIP'
  recommended_fraction_of_bankroll: number
  recommended_notional_usd: number
  avg_fill_price: number
  target_shares: number
  delta_shares: number
  delta_notional_usd: number
  kelly_fraction_raw: number
  fractional_lambda: number
  p_win: number
  p_break_even: number
  R_win_per_dollar: number
  expected_log_growth: number
  constraints_applied: Record<string, any>
  cash_checks: {
    bankroll_total_equity_usd: number
    bankroll_free_cash_usd: number
  }
  position_digest: {
    current_side: 'YES' | 'NO' | 'NONE'
    current_shares: number
    current_avg_entry_cost: number
    current_same_side_notional_usd: number
    current_opposite_side_notional_usd: number
  }
  risk_flags: string[]
  execution_notes: string
}

// ============================================================================
// CORE FUNCTION: ANALYZE OPPORTUNITY
// ============================================================================

/**
 * Analyze trading opportunity using AI-powered fractional Kelly position sizing
 *
 * This is the main entry point for the orchestrator node. It:
 * 1. Validates inputs
 * 2. Prepares data for AI analysis
 * 3. Calls Claude API with position-sizing-prompt
 * 4. Parses AI response
 * 5. Validates results against portfolio rules
 * 6. Returns structured decision
 */
export async function analyzeOpportunity(
  market: MarketData,
  portfolio: PortfolioState,
  rules: PositionSizingRules,
  signal?: StrategySignal,
  currentPosition?: CurrentPosition
): Promise<AnalysisResult> {
  try {
    // Step 1: Validate inputs
    const validationErrors = validateInputs(market, portfolio, rules)
    if (validationErrors.length > 0) {
      return {
        decision: 'NO_GO',
        recommended_size: 0,
        recommended_fraction_of_bankroll: 0,
        risk_score: 10,
        reasoning: `Validation failed: ${validationErrors.join(', ')}`,
        confidence: 1.0,
        risk_flags: ['MISSING_INPUT'],
      }
    }

    // Step 2: Apply volatility adjustment (if enabled)
    let adjustedKellyLambda = rules.fractional_kelly_lambda
    if (rules.volatility_adjustment_enabled) {
      const volatilityFactor = calculateVolatilityAdjustment(market)
      adjustedKellyLambda = adjustedKellyLambda * volatilityFactor
    }

    // Step 3: Apply drawdown protection (if enabled)
    if (rules.drawdown_protection_enabled && portfolio.current_drawdown) {
      const drawdownFactor = calculateDrawdownProtection(
        portfolio.current_drawdown,
        rules.kelly_drawdown_scaler || 0.5
      )
      adjustedKellyLambda = adjustedKellyLambda * drawdownFactor
    }

    // Step 4: Prepare Kelly AI input
    const kellyInput = prepareKellyInput(
      market,
      portfolio,
      rules,
      signal,
      currentPosition,
      adjustedKellyLambda
    )

    // Step 5: Call Claude API with position-sizing prompt
    const kellyOutput = await callKellyAI(kellyInput)

    // Step 6: Map to AnalysisResult
    const result = mapKellyOutputToAnalysisResult(kellyOutput, market, portfolio)

    // Step 7: Validate position sizing rules
    const sizeValidation = validatePositionSizing(result.recommended_size, portfolio, rules)
    if (sizeValidation.errors.length > 0) {
      result.decision = 'NO_GO'
      result.recommended_size = 0
      result.risk_flags = [...(result.risk_flags || []), ...sizeValidation.errors]
      result.reasoning += ` Validation errors: ${sizeValidation.errors.join(', ')}`
    }

    return result

  } catch (error) {
    console.error('Orchestrator analysis error:', error)
    return {
      decision: 'NO_GO',
      recommended_size: 0,
      recommended_fraction_of_bankroll: 0,
      risk_score: 10,
      reasoning: `AI analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      confidence: 0,
      risk_flags: ['AI_ERROR'],
    }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate required inputs
 */
function validateInputs(
  market: MarketData,
  portfolio: PortfolioState,
  rules: PositionSizingRules
): string[] {
  const errors: string[] = []

  // Market validation
  if (!market.market_id) errors.push('market_id required')
  if (!market.side || !['YES', 'NO'].includes(market.side)) errors.push('valid side required')
  if (!market.current_odds?.yes || !market.current_odds?.no) errors.push('current_odds required')

  // Portfolio validation
  if (typeof portfolio.bankroll_total_equity_usd !== 'number' || portfolio.bankroll_total_equity_usd <= 0) {
    errors.push('bankroll_total_equity_usd must be > 0')
  }
  if (typeof portfolio.bankroll_free_cash_usd !== 'number' || portfolio.bankroll_free_cash_usd < 0) {
    errors.push('bankroll_free_cash_usd must be >= 0')
  }

  // Rules validation
  if (typeof rules.fractional_kelly_lambda !== 'number' || rules.fractional_kelly_lambda <= 0 || rules.fractional_kelly_lambda > 1) {
    errors.push('fractional_kelly_lambda must be in (0, 1]')
  }
  if (typeof rules.max_per_position !== 'number' || rules.max_per_position <= 0 || rules.max_per_position > 1) {
    errors.push('max_per_position must be in (0, 1]')
  }
  if (typeof rules.min_bet !== 'number' || rules.min_bet < 0) {
    errors.push('min_bet must be >= 0')
  }
  if (typeof rules.max_bet !== 'number' || rules.max_bet < rules.min_bet) {
    errors.push('max_bet must be >= min_bet')
  }

  return errors
}

/**
 * Prepare Kelly AI input from market data, portfolio, and rules
 */
function prepareKellyInput(
  market: MarketData,
  portfolio: PortfolioState,
  rules: PositionSizingRules,
  signal?: StrategySignal,
  currentPosition?: CurrentPosition,
  adjustedKellyLambda?: number
): KellyAIInput {
  // Determine p_win (calibrated probability)
  let p_win = signal?.estimated_probability || 0.5

  // If signal provides confidence but not probability, use a heuristic
  if (!signal?.estimated_probability && signal?.confidence) {
    // Simple heuristic: confidence * slight edge over current odds
    const marketImpliedProb = market.side === 'YES' ? market.current_odds.yes : market.current_odds.no
    p_win = marketImpliedProb + (signal.confidence * 0.1) // Add up to 10% edge based on confidence
  }

  // Entry cost per share (current market price for the side)
  const entry_cost_per_share = market.side === 'YES' ? market.current_odds.yes : market.current_odds.no

  // Resolution fee rate (Polymarket charges ~2% on profits)
  const resolution_fee_rate = 0.02

  // Current position (default to NONE if not provided)
  const current_position: CurrentPosition = currentPosition || {
    side: 'NONE',
    shares: 0,
    avg_entry_cost: 0,
  }

  // Cluster (for now, use category as cluster_id)
  const cluster_id = market.category || 'default'
  const cluster_used_fraction_pct = 0 // TODO: Track cluster exposure in portfolio state

  // Calculate portfolio used fraction
  const portfolio_used_fraction_pct = portfolio.deployed_capital / portfolio.bankroll_total_equity_usd

  return {
    timestamp: new Date().toISOString(),
    market_id: market.market_id,
    side: market.side,
    p_win,
    entry_cost_per_share,
    resolution_fee_rate,
    fractional_kelly_lambda: adjustedKellyLambda || rules.fractional_kelly_lambda,

    bankroll_total_equity_usd: portfolio.bankroll_total_equity_usd,
    bankroll_free_cash_usd: portfolio.bankroll_free_cash_usd,

    current_position,

    cluster_id,
    cluster_used_fraction_pct,

    // Optional constraints
    single_market_limit_pct: rules.single_market_limit_pct,
    cluster_limit_pct: rules.cluster_limit_pct,
    portfolio_active_risk_limit_pct: rules.portfolio_heat_limit,
    portfolio_used_fraction_pct,
    liquidity_cap_usd: rules.liquidity_cap_usd || market.liquidity,
    min_notional_usd: rules.min_bet,
    lot_size: 1, // Polymarket uses integer shares
    max_fraction_hard: rules.max_per_position,
    min_edge_prob: rules.min_edge_prob,
    kelly_drawdown_scaler: rules.kelly_drawdown_scaler,
  }
}

/**
 * Call Claude API with position-sizing prompt
 */
async function callKellyAI(input: KellyAIInput): Promise<KellyAIOutput> {
  // Load system prompt from position-sizing-prompt.md
  const systemPrompt = getPositionSizingPrompt()

  // Build user message with input data
  const userMessage = JSON.stringify(input, null, 2)

  // Call Claude API
  const response = await generateText({
    model: anthropic('claude-sonnet-4-20250514'), // Claude Sonnet 4.5
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Analyze this position sizing request and return ONLY the JSON output (no explanation, no markdown):\n\n${userMessage}`,
      },
    ],
    temperature: 0, // Deterministic for financial calculations
  })

  // Parse JSON response
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = response.text.match(/```json\n?([\s\S]*?)\n?```/)
    const jsonText = jsonMatch ? jsonMatch[1] : response.text

    const output: KellyAIOutput = JSON.parse(jsonText.trim())
    return output
  } catch (error) {
    console.error('Failed to parse Kelly AI output:', response.text)
    throw new Error(`Invalid AI response: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Get position sizing system prompt
 * This is the exact prompt from position-sizing-prompt.md
 */
function getPositionSizingPrompt(): string {
  return `# Position Sizing Agent — Fractional Kelly, Portfolio-Aware (Binary Prediction Markets)

**Usage**: Use as a system prompt for the AI Risk Analysis Engine (Task Group 13)

This agent computes fractional Kelly target size for a given market side in the context of the entire portfolio.

**Responsibilities**:
- ✅ Compute target fraction of bankroll, notional, and delta (shares/$) for specified side using fractional Kelly
- ✅ Enforce portfolio/cluster/market/cash/lot constraints and existing positions
- ❌ Does NOT: infer or modify inputs, estimate probabilities, choose sides, simulate order books, schedule execution, or provide explanations

**Output**: Strictly JSON schema below — no prose, no chain-of-thought.

If any required input is missing/invalid, return "decision":"HOLD" with risk_flags explaining why.

---

## Sizing Mathematics (closed-form, fee-aware, stable)

Treat the requested side as a binary bet:

**Let** c = entry_cost_per_share (all-in)

**Win**: profit/share π_win = (1 - c) * (1 - resolution_fee_rate)
**Lose**: loss/share π_loss = c

**Per-$ return multipliers** (relative to $1 staked on this side at cost c):
- R = π_win / c = ((1 - c) * (1 - resolution_fee_rate)) / c → win return per $1
- L = π_loss / c = 1 → loss per $1

**Break-even (infinitesimal) win probability**:
p_break_even = 1 / (1 + R)

**Raw Kelly fraction** (binary R/L with L=1):
If p_win ≤ p_break_even → f_raw = 0
Else f_raw = (p_win*R - (1 - p_win)) / R

**Fractional Kelly base**:
f_kelly = fractional_kelly_lambda * f_raw

**Optional drawdown dampener**:
If kelly_drawdown_scaler provided:
  f_kelly = f_kelly * kelly_drawdown_scaler

**Log-growth sanity at f_kelly**:
g = p_win * ln(1 + f_kelly * R) + (1 - p_win) * ln(1 - f_kelly)
If g ≤ 0 → set f_kelly = 0

**Numerical safety clamp**:
Enforce 0 ≤ f_kelly ≤ 0.99  (ensures 1 - f_kelly > 0 with L=1)

**Edge gate (optional)**:
If min_edge_prob provided and (p_win - p_break_even) < min_edge_prob:
  f_kelly = 0

---

## Portfolio & Constraint Application (in this exact order)

### 1. Single-market cap (if provided)
f1 = min(f_kelly, single_market_limit_pct) else f1 = f_kelly

### 2. Hard cap (if provided)
f2 = min(f1, max_fraction_hard) else f2 = f1

### 3. Cluster cap (if provided)
cluster_remain = max(0, cluster_limit_pct - cluster_used_fraction_pct)
f3 = min(f2, cluster_remain) else f3 = f2

### 4. Portfolio active cap (if provided)
require portfolio_used_fraction_pct
portfolio_remain = max(0, portfolio_active_risk_limit_pct - portfolio_used_fraction_pct)
f4 = min(f3, portfolio_remain) else f4 = f3

### 5. Dust gate (optional)
If min_kelly_step_fraction provided and f4 < min_kelly_step_fraction:
  set f4 = 0

### 6. Translate to target notional (pre-cash, pre-liquidity)
target_notional = bankroll_total_equity_usd * f4

### 7. Liquidity cap (if provided)
target_notional = min(target_notional, liquidity_cap_usd)

### 8. Cash availability
**Determine current notional on same side**:
mark = mark_price_for_delta if provided else entry_cost_per_share
cur_same = (current_position.side == side) ? current_position.shares * mark : 0

**Determine current notional on opposite side**:
cur_opp = (current_position.side != side && current_position.side != "NONE")
          ? current_position.shares * mark
          : 0

**Rounded target shares**:
lot = lot_size if provided else 1
target_shares = floor( (target_notional / entry_cost_per_share) / lot ) * lot
target_notional = target_shares * entry_cost_per_share  # recompute after rounding

**Delta** (positive = buy this side; negative = sell/close something):
If cur_opp > 0:
  # Must close opposite first
  delta_notional = target_notional - cur_same + cur_opp
Else:
  delta_notional = target_notional - cur_same

delta_shares = round_to_lot( delta_notional / entry_cost_per_share, lot )

**Cash check for net buys**:
If delta_notional > 0 and delta_notional > bankroll_free_cash_usd:
  # Cap delta_notional to available cash
  # Recompute delta_shares/target_shares/target_notional accordingly

**Minimum order size**:
If min_notional_usd provided and abs(delta_notional) < min_notional_usd:
  → HOLD (unless closing opposite ≥ min_notional_usd)

**Final decision mapping**:
If f4 == 0 and cur_same == 0 and cur_opp == 0:
  → HOLD

If cur_opp > 0 and target_shares == 0:
  → CLOSE (opposite)

If cur_opp > 0 and target_shares > 0:
  → FLIP (close opposite, then open same)

If delta_shares > 0 and cur_opp == 0:
  → BUY

If delta_shares < 0 and cur_same > 0:
  → REDUCE (to target)

If target_shares == 0 and cur_same > 0:
  → CLOSE

---

## Output (JSON only; print exactly this object)

You MUST return valid JSON with this exact structure:

{
  "timestamp": "<ISO8601>",
  "market_id": "<string>",
  "side": "YES or NO",
  "decision": "BUY | SELL | HOLD | REDUCE | CLOSE | FLIP",
  "recommended_fraction_of_bankroll": 0.0,
  "recommended_notional_usd": 0.0,
  "avg_fill_price": 0.0,
  "target_shares": 0,
  "delta_shares": 0,
  "delta_notional_usd": 0.0,
  "kelly_fraction_raw": 0.0,
  "fractional_lambda": 0.0,
  "p_win": 0.0,
  "p_break_even": 0.0,
  "R_win_per_dollar": 0.0,
  "expected_log_growth": 0.0,
  "constraints_applied": {},
  "cash_checks": {
    "bankroll_total_equity_usd": 0.0,
    "bankroll_free_cash_usd": 0.0
  },
  "position_digest": {
    "current_side": "YES|NO|NONE",
    "current_shares": 0,
    "current_avg_entry_cost": 0.0,
    "current_same_side_notional_usd": 0.0,
    "current_opposite_side_notional_usd": 0.0
  },
  "risk_flags": [],
  "execution_notes": ""
}

---

## Behavioral Rules (must follow)

1. **JSON only**. No explanations, no markdown, no additional keys.

2. **Deterministic rounding**: always round shares down to the nearest lot_size. Then recompute notional.

3. **Conservatism first**: if any cap binds or g ≤ 0, shrink to feasibility or HOLD.

4. **Opposite exposure**: if present, set "decision":"FLIP" when target implies net exposure switch; otherwise CLOSE or REDUCE.

5. **Validation**: if any required field is missing/invalid, output HOLD with "risk_flags":["MISSING_INPUT"] and include which fields in execution_notes.

6. **Idempotence**: re-running with the same inputs should produce the same output.`
}

/**
 * Map Kelly AI output to AnalysisResult
 */
function mapKellyOutputToAnalysisResult(
  kellyOutput: KellyAIOutput,
  market: MarketData,
  portfolio: PortfolioState
): AnalysisResult {
  // Map decision to our enum
  let decision: AnalysisResult['decision'] = 'NO_GO'
  if (kellyOutput.decision === 'BUY') decision = 'GO'
  else if (kellyOutput.decision === 'HOLD') decision = 'HOLD'
  else if (kellyOutput.decision === 'CLOSE') decision = 'CLOSE'
  else if (kellyOutput.decision === 'REDUCE') decision = 'REDUCE'
  else if (kellyOutput.decision === 'FLIP') decision = 'FLIP'

  // Calculate risk score (1-10) based on Kelly fraction and edge
  const edge = kellyOutput.p_win - kellyOutput.p_break_even
  const riskScore = calculateRiskScore(kellyOutput.kelly_fraction_raw, edge, kellyOutput.expected_log_growth)

  // Extract constraints applied
  const constraintsApplied: string[] = []
  for (const [key, value] of Object.entries(kellyOutput.constraints_applied)) {
    if (value !== null && value !== undefined) {
      constraintsApplied.push(key)
    }
  }

  return {
    decision,
    recommended_size: kellyOutput.recommended_notional_usd,
    recommended_fraction_of_bankroll: kellyOutput.recommended_fraction_of_bankroll,
    target_shares: kellyOutput.target_shares,
    delta_shares: kellyOutput.delta_shares,
    delta_notional_usd: kellyOutput.delta_notional_usd,
    risk_score: riskScore,
    reasoning: buildReasoning(kellyOutput, market),
    confidence: calculateConfidence(kellyOutput),
    kelly_fraction_raw: kellyOutput.kelly_fraction_raw,
    kelly_fraction_adjusted: kellyOutput.recommended_fraction_of_bankroll,
    p_win: kellyOutput.p_win,
    p_break_even: kellyOutput.p_break_even,
    expected_log_growth: kellyOutput.expected_log_growth,
    constraints_applied: constraintsApplied,
    risk_flags: kellyOutput.risk_flags,
    execution_notes: kellyOutput.execution_notes,
  }
}

/**
 * Calculate risk score (1-10) based on Kelly metrics
 */
function calculateRiskScore(kellyFractionRaw: number, edge: number, logGrowth: number): number {
  // Base risk from Kelly fraction (higher fraction = higher risk)
  let risk = 5 + (kellyFractionRaw * 10) // 0.5 Kelly = risk 10

  // Adjust for edge (higher edge = lower risk)
  if (edge > 0.1) risk -= 2 // Strong edge
  else if (edge < 0.05) risk += 2 // Weak edge

  // Adjust for log growth (negative = very high risk)
  if (logGrowth < 0) risk = 10
  else if (logGrowth < 0.01) risk += 1

  return Math.max(1, Math.min(10, Math.round(risk)))
}

/**
 * Build human-readable reasoning
 */
function buildReasoning(kellyOutput: KellyAIOutput, market: MarketData): string {
  const edge = ((kellyOutput.p_win - kellyOutput.p_break_even) * 100).toFixed(1)
  const kellyPct = (kellyOutput.recommended_fraction_of_bankroll * 100).toFixed(1)

  if (kellyOutput.decision === 'HOLD' || kellyOutput.recommended_notional_usd === 0) {
    if (kellyOutput.risk_flags.length > 0) {
      return `No position recommended. Issues: ${kellyOutput.risk_flags.join(', ')}`
    }
    return 'No edge detected or constraints prevent position.'
  }

  let reasoning = `Market: ${market.question}. `
  reasoning += `Recommended ${kellyPct}% of bankroll ($${kellyOutput.recommended_notional_usd.toFixed(0)}) on ${kellyOutput.side}. `
  reasoning += `Edge: ${edge}% (p_win=${(kellyOutput.p_win * 100).toFixed(0)}% vs break-even=${(kellyOutput.p_break_even * 100).toFixed(0)}%). `
  reasoning += `Kelly: ${(kellyOutput.kelly_fraction_raw * 100).toFixed(1)}% raw, ${kellyPct}% after constraints. `

  if (kellyOutput.risk_flags.length > 0) {
    reasoning += `Flags: ${kellyOutput.risk_flags.join(', ')}. `
  }

  return reasoning
}

/**
 * Calculate AI confidence (0-1) based on output quality
 */
function calculateConfidence(kellyOutput: KellyAIOutput): number {
  let confidence = 0.8 // Base confidence

  // Reduce confidence for risk flags
  if (kellyOutput.risk_flags.includes('SMALL_EDGE')) confidence -= 0.1
  if (kellyOutput.risk_flags.includes('NEG_EXPECTED_LOG_GROWTH')) confidence -= 0.2
  if (kellyOutput.risk_flags.includes('INSUFFICIENT_CASH')) confidence -= 0.05

  // Increase confidence for strong metrics
  const edge = kellyOutput.p_win - kellyOutput.p_break_even
  if (edge > 0.1) confidence += 0.1
  if (kellyOutput.expected_log_growth > 0.05) confidence += 0.05

  return Math.max(0, Math.min(1, confidence))
}

// ============================================================================
// POSITION SIZING VALIDATION
// ============================================================================

export interface PositionSizingValidation {
  valid: boolean
  errors: string[]
}

/**
 * Validate position size against portfolio rules
 */
export function validatePositionSizing(
  size: number,
  portfolio: PortfolioState,
  rules: PositionSizingRules
): PositionSizingValidation {
  const errors: string[] = []

  // Check min bet
  if (size > 0 && size < rules.min_bet) {
    errors.push(`SIZE_TOO_SMALL: $${size.toFixed(2)} < min_bet $${rules.min_bet}`)
  }

  // Check max bet
  if (size > rules.max_bet) {
    errors.push(`SIZE_TOO_LARGE: $${size.toFixed(2)} > max_bet $${rules.max_bet}`)
  }

  // Check max % per position
  const fraction = size / portfolio.bankroll_total_equity_usd
  if (fraction > rules.max_per_position) {
    errors.push(`EXCEEDS_MAX_POSITION: ${(fraction * 100).toFixed(1)}% > ${(rules.max_per_position * 100).toFixed(1)}%`)
  }

  // Check available cash
  if (size > portfolio.bankroll_free_cash_usd) {
    errors.push(`INSUFFICIENT_CASH: $${size.toFixed(2)} > available $${portfolio.bankroll_free_cash_usd.toFixed(2)}`)
  }

  // Check portfolio heat limit
  if (rules.portfolio_heat_limit) {
    const newDeployed = portfolio.deployed_capital + size
    const newHeat = newDeployed / portfolio.bankroll_total_equity_usd
    if (newHeat > rules.portfolio_heat_limit) {
      errors.push(`PORTFOLIO_HEAT_LIMIT: ${(newHeat * 100).toFixed(1)}% > ${(rules.portfolio_heat_limit * 100).toFixed(1)}%`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ============================================================================
// VOLATILITY ADJUSTMENT
// ============================================================================

/**
 * Calculate volatility adjustment factor
 * Returns a multiplier (0-1) to scale Kelly fraction
 */
export function calculateVolatilityAdjustment(market: MarketData): number {
  // Use liquidity and volume as proxies for market stability
  const liquidity = market.liquidity || 0
  const volume = market.volume_24h || 0

  // Thresholds
  const HIGH_LIQUIDITY = 100000 // $100k+
  const HIGH_VOLUME = 500000 // $500k+

  let volatilityScore = 1.0 // Low volatility (stable)

  // Reduce position size for low liquidity (higher volatility risk)
  if (liquidity < 10000) volatilityScore *= 0.5 // Very illiquid
  else if (liquidity < HIGH_LIQUIDITY) volatilityScore *= 0.75 // Moderate liquidity

  // Reduce position size for low volume (less market consensus)
  if (volume < 50000) volatilityScore *= 0.5 // Very low volume
  else if (volume < HIGH_VOLUME) volatilityScore *= 0.85 // Moderate volume

  // Cap adjustment factor (don't go below 0.25)
  return Math.max(0.25, Math.min(1.0, volatilityScore))
}

// ============================================================================
// DRAWDOWN PROTECTION
// ============================================================================

/**
 * Calculate drawdown protection factor
 * Returns a multiplier (0-1) to scale Kelly fraction during drawdowns
 */
export function calculateDrawdownProtection(
  currentDrawdown: number,
  drawdownScaler: number = 0.5
): number {
  // currentDrawdown is a fraction (e.g., 0.10 for 10% drawdown)

  if (currentDrawdown <= 0) {
    return 1.0 // No drawdown, no adjustment
  }

  // Apply exponential scaling based on drawdown severity
  if (currentDrawdown >= 0.20) {
    // 20%+ drawdown: reduce Kelly significantly
    return drawdownScaler * 0.5
  } else if (currentDrawdown >= 0.10) {
    // 10-20% drawdown: reduce Kelly moderately
    return drawdownScaler
  } else {
    // <10% drawdown: slight reduction
    return 1 - (currentDrawdown * (1 - drawdownScaler))
  }
}
