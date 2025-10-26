/**
 * ORCHESTRATOR NODE EXECUTOR
 *
 * Task Group 15: Approval Workflow and Decision History
 * Subtask 15.2: Orchestrator executor logic
 *
 * This executor implements the Portfolio Orchestrator node logic:
 * - Fetches current portfolio state
 * - Calls AI analysis for each market
 * - Validates position sizing rules
 * - Creates pending decision records (approval mode)
 * - Executes trades immediately (autonomous mode)
 * - Sends notifications for approvals
 */

import type { WorkflowNode, ExecutionContext } from '@/types/workflow'
import { analyzeOpportunity } from '@/lib/ai/orchestrator-analysis'
import type {
  MarketData,
  PortfolioState,
  PositionSizingRules,
  StrategySignal,
  CurrentPosition,
  AnalysisResult,
} from '@/lib/ai/orchestrator-analysis'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface OrchestratorConfig {
  mode: 'approval' | 'autonomous'
  position_sizing_rules: PositionSizingRules
  user_id?: string
}

export interface OrchestratorExecutionResult {
  decisions: OrchestratorDecisionRecord[]
  summary: {
    total: number
    go: number
    no_go: number
    pending_approval: number
    executed: number
  }
}

export interface OrchestratorDecisionRecord {
  id?: string
  execution_id: string
  workflow_id: string
  node_id: string
  market_id: string
  decision: AnalysisResult['decision']
  direction: 'YES' | 'NO'
  recommended_size: number
  risk_score: number
  ai_reasoning: string
  ai_confidence: number
  status: 'pending' | 'approved' | 'rejected' | 'executed'
  portfolio_snapshot: PortfolioState
  created_at?: string
}

// ============================================================================
// MAIN EXECUTOR FUNCTION
// ============================================================================

/**
 * Execute orchestrator node
 *
 * @param node - Workflow node configuration
 * @param input - Input from upstream nodes (markets array)
 * @param context - Execution context
 * @returns Array of decisions made
 */
export async function executeOrchestratorNode(
  node: WorkflowNode,
  input: any,
  context: ExecutionContext
): Promise<OrchestratorExecutionResult> {
  const config = node.data.config as OrchestratorConfig

  // Validate config
  if (!config.position_sizing_rules) {
    throw new Error('Orchestrator node requires position_sizing_rules in config')
  }

  // Get markets from input (array of market objects)
  let markets = input?.markets || input?.filtered || input?.data || input || []
  if (!Array.isArray(markets)) {
    markets = [markets]
  }

  const decisions: OrchestratorDecisionRecord[] = []
  let goCount = 0
  let noGoCount = 0
  let pendingCount = 0
  let executedCount = 0

  // Process each market
  for (const market of markets) {
    try {
      // Step 1: Fetch portfolio state
      const portfolio = await fetchPortfolioState(config.user_id || 'anonymous')

      // Step 2: Prepare market data
      const marketData: MarketData = {
        market_id: market.id || market.market_id || market.marketId,
        question: market.question || market.title || 'Unknown market',
        category: market.category || 'Unknown',
        side: market.side || 'YES',
        current_odds: market.current_odds || market.odds || { yes: 0.5, no: 0.5 },
        volume_24h: market.volume_24h || market.volume || 0,
        liquidity: market.liquidity || 0,
        ...market,
      }

      // Step 3: Prepare strategy signal (if available from upstream analysis)
      const signal: StrategySignal | undefined = market.signal
        ? {
            direction: market.signal.direction,
            confidence: market.signal.confidence,
            reasoning: market.signal.reasoning,
            estimated_probability: market.signal.estimated_probability,
          }
        : undefined

      // Step 4: Get current position (if exists)
      const currentPosition: CurrentPosition | undefined = market.current_position
        ? {
            side: market.current_position.side,
            shares: market.current_position.shares,
            avg_entry_cost: market.current_position.avg_entry_cost,
          }
        : undefined

      // Step 5: Call AI analysis
      const analysis = await analyzeOpportunity(
        marketData,
        portfolio,
        config.position_sizing_rules,
        signal,
        currentPosition
      )

      // Step 6: Create decision record
      const decisionRecord = await createDecision({
        execution_id: context.executionId,
        workflow_id: context.workflowId,
        node_id: node.id,
        market_id: marketData.market_id,
        decision: analysis.decision,
        direction: marketData.side,
        recommended_size: analysis.recommended_size,
        risk_score: analysis.risk_score,
        ai_reasoning: analysis.reasoning,
        ai_confidence: analysis.confidence,
        status: 'pending',
        portfolio_snapshot: portfolio,
      })

      // Step 7: Execute or queue for approval
      if (config.mode === 'autonomous' && analysis.decision === 'GO') {
        // Execute trade immediately (stub for now)
        await executeTrade(decisionRecord)
        decisionRecord.status = 'executed'
        executedCount++
      } else if (config.mode === 'approval' && analysis.decision === 'GO') {
        // Send notification for approval
        await sendApprovalNotification(decisionRecord, config.user_id || null)
        decisionRecord.status = 'pending'
        pendingCount++
      }

      // Track counts
      if (analysis.decision === 'GO') {
        goCount++
      } else {
        noGoCount++
      }

      decisions.push(decisionRecord)
    } catch (error) {
      console.error('[Orchestrator Executor] Error processing market:', error)
      // Continue processing other markets
    }
  }

  return {
    decisions,
    summary: {
      total: decisions.length,
      go: goCount,
      no_go: noGoCount,
      pending_approval: pendingCount,
      executed: executedCount,
    },
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Fetch current portfolio state from database
 */
async function fetchPortfolioState(userId: string): Promise<PortfolioState> {
  try {
    // Import Supabase client
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Fetch portfolio data (stub - replace with actual portfolio query)
    // In production, this would aggregate positions, calculate deployed capital, etc.
    const { data: portfolio } = await supabase
      .from('user_settings')
      .select('portfolio_settings')
      .eq('user_id', userId)
      .single()

    // Default portfolio state if no data found
    const defaultPortfolio: PortfolioState = {
      bankroll_total_equity_usd: portfolio?.portfolio_settings?.bankroll_total_equity_usd || 10000,
      bankroll_free_cash_usd: portfolio?.portfolio_settings?.bankroll_free_cash_usd || 10000,
      deployed_capital: 0,
      open_positions: 0,
      recent_pnl: 0,
      win_rate_7d: 0,
      current_drawdown: 0,
    }

    return defaultPortfolio
  } catch (error) {
    console.error('[Orchestrator Executor] Error fetching portfolio:', error)
    // Return default portfolio on error
    return {
      bankroll_total_equity_usd: 10000,
      bankroll_free_cash_usd: 10000,
      deployed_capital: 0,
      open_positions: 0,
      recent_pnl: 0,
      win_rate_7d: 0,
      current_drawdown: 0,
    }
  }
}

/**
 * Create decision record in database
 */
async function createDecision(
  decision: Omit<OrchestratorDecisionRecord, 'id' | 'created_at'>
): Promise<OrchestratorDecisionRecord> {
  try {
    // Import Supabase client
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Insert decision
    const { data, error } = await supabase
      .from('orchestrator_decisions')
      .insert({
        execution_id: decision.execution_id,
        workflow_id: decision.workflow_id,
        node_id: decision.node_id,
        market_id: decision.market_id,
        decision: decision.decision,
        direction: decision.direction,
        recommended_size: decision.recommended_size,
        risk_score: decision.risk_score,
        ai_reasoning: decision.ai_reasoning,
        ai_confidence: decision.ai_confidence,
        portfolio_snapshot: decision.portfolio_snapshot,
        status: decision.status,
        user_override: false,
      })
      .select()
      .single()

    if (error) {
      console.error('[Orchestrator Executor] Error creating decision:', error)
      throw error
    }

    return {
      ...decision,
      id: data.id,
      created_at: data.created_at,
    }
  } catch (error) {
    console.error('[Orchestrator Executor] Error in createDecision:', error)
    throw error
  }
}

/**
 * Execute trade (paper or live based on strategy trading_mode)
 */
async function executeTrade(decision: OrchestratorDecisionRecord): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // Get strategy trading mode
    const { data: strategy, error: strategyError } = await supabase
      .from('strategy_definitions')
      .select('trading_mode, paper_bankroll_usd, created_by')
      .eq('strategy_id', decision.workflow_id)
      .single()

    if (strategyError) {
      console.error('[Orchestrator Executor] Error fetching strategy:', strategyError)
      throw strategyError
    }

    const tradingMode = strategy?.trading_mode || 'paper'

    if (tradingMode === 'paper') {
      // Execute paper trade
      await executePaperTrade(decision, strategy.created_by)
      console.log('[Orchestrator Executor] ✅ Paper trade executed:', {
        market_id: decision.market_id,
        direction: decision.direction,
        size: decision.recommended_size,
      })
    } else {
      // Execute live trade on Polymarket
      await executeLiveTrade(decision)
      console.log('[Orchestrator Executor] ✅ Live trade executed:', {
        market_id: decision.market_id,
        direction: decision.direction,
        size: decision.recommended_size,
      })
    }

    // Update decision status to executed
    await supabase
      .from('orchestrator_decisions')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        actual_size: decision.recommended_size,
      })
      .eq('id', decision.id)
  } catch (error) {
    console.error('[Orchestrator Executor] Error executing trade:', error)
    throw error
  }
}

/**
 * Execute paper trade (virtual money)
 */
async function executePaperTrade(
  decision: OrchestratorDecisionRecord,
  userId: string
): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get current market price (from Polymarket public API or use estimated price)
  const estimatedPrice = decision.direction === 'YES' ? 0.55 : 0.45 // Placeholder
  const shares = decision.recommended_size / estimatedPrice

  // Extract market question from AI reasoning
  const marketQuestion =
    decision.ai_reasoning.split('Market: ')[1]?.split('.')[0] || decision.market_id

  // Create paper trade record
  const { error: tradeError } = await supabase.from('paper_trades').insert({
    strategy_id: decision.workflow_id,
    execution_id: decision.execution_id,
    decision_id: decision.id,
    market_id: decision.market_id,
    market_question: marketQuestion,
    side: decision.direction,
    action: 'BUY',
    entry_price: estimatedPrice,
    entry_shares: shares,
    entry_notional_usd: decision.recommended_size,
    entry_date: new Date().toISOString(),
    status: 'open',
    created_by: userId,
  })

  if (tradeError) {
    console.error('[Orchestrator Executor] Error creating paper trade:', tradeError)
    throw tradeError
  }

  console.log('[Orchestrator Executor] Paper trade created:', {
    market: marketQuestion,
    side: decision.direction,
    shares: shares.toFixed(2),
    price: estimatedPrice,
    notional: decision.recommended_size,
  })
}

/**
 * Execute live trade on Polymarket (stub - to be implemented)
 */
async function executeLiveTrade(decision: OrchestratorDecisionRecord): Promise<void> {
  console.log('[Orchestrator Executor] Live trading not yet implemented:', {
    market_id: decision.market_id,
    direction: decision.direction,
    size: decision.recommended_size,
  })

  // TODO: Implement Polymarket CLOB API integration
  // 1. Initialize PolymarketCLOBClient
  // 2. Get current market state and order book
  // 3. Calculate optimal entry price
  // 4. Place limit order
  // 5. Sign and submit order
  // 6. Track position in database

  throw new Error(
    'Live trading not yet implemented. Please use paper trading mode or implement Polymarket CLOB integration.'
  )
}

/**
 * Send notification for pending approval
 */
async function sendApprovalNotification(
  decision: OrchestratorDecisionRecord,
  userId: string | null
): Promise<void> {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Get market question for notification
    const marketQuestion = decision.ai_reasoning.split('Market: ')[1]?.split('.')[0] || decision.market_id

    await supabase.from('notifications').insert({
      user_id: userId,
      workflow_id: decision.workflow_id,
      type: 'trade_approval_needed',
      title: `Trade approval needed: ${marketQuestion}`,
      message: `Recommended: BUY ${decision.direction} for $${Math.round(decision.recommended_size)} (risk: ${decision.risk_score}/10)`,
      link: `/strategies/${decision.workflow_id}?decision_id=${decision.id}`,
      priority: 'high',
      metadata: {
        decision_id: decision.id,
        market_id: decision.market_id,
        direction: decision.direction,
        recommended_size: decision.recommended_size,
        risk_score: decision.risk_score,
      },
    })

    console.log('[Orchestrator Executor] Notification sent for decision:', decision.id)
  } catch (error) {
    console.error('[Orchestrator Executor] Error sending notification:', error)
    // Don't throw - notification failure shouldn't fail the workflow
  }
}
