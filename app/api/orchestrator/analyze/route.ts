/**
 * Orchestrator Analysis API
 * POST /api/orchestrator/analyze
 *
 * AI-powered position sizing analysis using fractional Kelly criterion.
 * This endpoint analyzes market opportunities and makes GO/NO_GO decisions
 * based on portfolio state, risk parameters, and position sizing rules.
 *
 * Task Group 12: Database and API Foundation
 * Task Group 13: Full AI Risk Analysis Engine (IMPLEMENTED)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  analyzeOpportunity,
  MarketData,
  PortfolioState,
  PositionSizingRules,
  StrategySignal,
  CurrentPosition,
} from '@/lib/ai/orchestrator-analysis';

export const runtime = 'nodejs';

interface AnalyzeRequest {
  execution_id: string;
  workflow_id: string;
  node_id: string;
  market_id: string;
  market_data: {
    question: string;
    category: string;
    volume_24h: number;
    liquidity: number;
    current_odds: { yes: number; no: number };
    side?: 'YES' | 'NO'; // Optional: which side to analyze
    [key: string]: any;
  };
  portfolio_state: {
    bankroll_total_equity_usd: number;
    bankroll_free_cash_usd: number;
    deployed_capital: number;
    open_positions: number;
    recent_pnl?: number;
    win_rate_7d?: number;
    current_drawdown?: number;
    [key: string]: any;
  };
  position_sizing_rules: {
    fractional_kelly_lambda?: number; // Default: 0.25
    max_per_position: number; // Fraction of bankroll (0-1)
    min_bet: number; // USD
    max_bet: number; // USD
    portfolio_heat_limit?: number;
    risk_reward_threshold?: number;
    single_market_limit_pct?: number;
    cluster_limit_pct?: number;
    liquidity_cap_usd?: number;
    min_edge_prob?: number;
    kelly_drawdown_scaler?: number;
    volatility_adjustment_enabled?: boolean;
    drawdown_protection_enabled?: boolean;
    [key: string]: any;
  };
  strategy_signal?: {
    direction: 'YES' | 'NO';
    confidence?: number;
    reasoning?: string;
    estimated_probability?: number;
  };
  current_position?: {
    side: 'YES' | 'NO' | 'NONE';
    shares: number;
    avg_entry_cost: number;
  };
}

interface AIDecision {
  decision: 'GO' | 'NO_GO' | 'REDUCE' | 'CLOSE' | 'FLIP' | 'HOLD';
  direction: 'YES' | 'NO';
  recommended_size: number;
  risk_score: number;
  ai_reasoning: string;
  ai_confidence: number;
  kelly_fraction_raw?: number;
  kelly_fraction_adjusted?: number;
  p_win?: number;
  p_break_even?: number;
  target_shares?: number;
  delta_shares?: number;
  risk_flags?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json();

    // Validate required fields
    if (!body.execution_id || !body.workflow_id || !body.node_id || !body.market_id) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          message: 'execution_id, workflow_id, node_id, and market_id are required'
        },
        { status: 400 }
      );
    }

    if (!body.market_data || !body.portfolio_state || !body.position_sizing_rules) {
      return NextResponse.json(
        {
          error: 'Missing required data',
          message: 'market_data, portfolio_state, and position_sizing_rules are required'
        },
        { status: 400 }
      );
    }

    // Prepare inputs for AI analysis
    const market: MarketData = {
      market_id: body.market_id,
      question: body.market_data.question,
      category: body.market_data.category,
      side: body.market_data.side || body.strategy_signal?.direction || 'YES',
      current_odds: body.market_data.current_odds,
      volume_24h: body.market_data.volume_24h,
      liquidity: body.market_data.liquidity,
      ...body.market_data,
    };

    const portfolio: PortfolioState = {
      bankroll_total_equity_usd: body.portfolio_state.bankroll_total_equity_usd,
      bankroll_free_cash_usd: body.portfolio_state.bankroll_free_cash_usd,
      deployed_capital: body.portfolio_state.deployed_capital,
      open_positions: body.portfolio_state.open_positions,
      recent_pnl: body.portfolio_state.recent_pnl,
      win_rate_7d: body.portfolio_state.win_rate_7d,
      current_drawdown: body.portfolio_state.current_drawdown,
      ...body.portfolio_state,
    };

    const rules: PositionSizingRules = {
      fractional_kelly_lambda: body.position_sizing_rules.fractional_kelly_lambda || 0.25,
      max_per_position: body.position_sizing_rules.max_per_position,
      min_bet: body.position_sizing_rules.min_bet,
      max_bet: body.position_sizing_rules.max_bet,
      portfolio_heat_limit: body.position_sizing_rules.portfolio_heat_limit,
      risk_reward_threshold: body.position_sizing_rules.risk_reward_threshold,
      single_market_limit_pct: body.position_sizing_rules.single_market_limit_pct,
      cluster_limit_pct: body.position_sizing_rules.cluster_limit_pct,
      liquidity_cap_usd: body.position_sizing_rules.liquidity_cap_usd,
      min_edge_prob: body.position_sizing_rules.min_edge_prob,
      kelly_drawdown_scaler: body.position_sizing_rules.kelly_drawdown_scaler,
      volatility_adjustment_enabled: body.position_sizing_rules.volatility_adjustment_enabled,
      drawdown_protection_enabled: body.position_sizing_rules.drawdown_protection_enabled,
      ...body.position_sizing_rules,
    };

    const signal: StrategySignal | undefined = body.strategy_signal;
    const currentPosition: CurrentPosition | undefined = body.current_position;

    // Call AI analysis (Task Group 13 implementation)
    const analysisResult = await analyzeOpportunity(
      market,
      portfolio,
      rules,
      signal,
      currentPosition
    );

    // Map AnalysisResult to AIDecision for database
    const aiDecision: AIDecision = {
      decision: analysisResult.decision,
      direction: market.side,
      recommended_size: analysisResult.recommended_size,
      risk_score: analysisResult.risk_score,
      ai_reasoning: analysisResult.reasoning,
      ai_confidence: analysisResult.confidence,
      kelly_fraction_raw: analysisResult.kelly_fraction_raw,
      kelly_fraction_adjusted: analysisResult.kelly_fraction_adjusted,
      p_win: analysisResult.p_win,
      p_break_even: analysisResult.p_break_even,
      target_shares: analysisResult.target_shares,
      delta_shares: analysisResult.delta_shares,
      risk_flags: analysisResult.risk_flags,
    };

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Insert decision into database
    const { data: decision, error: insertError } = await supabase
      .from('orchestrator_decisions')
      .insert({
        execution_id: body.execution_id,
        workflow_id: body.workflow_id,
        node_id: body.node_id,
        market_id: body.market_id,
        decision: aiDecision.decision,
        direction: aiDecision.direction,
        recommended_size: aiDecision.recommended_size,
        risk_score: aiDecision.risk_score,
        ai_reasoning: aiDecision.ai_reasoning,
        ai_confidence: aiDecision.ai_confidence,
        portfolio_snapshot: body.portfolio_state,
        status: 'pending',
        user_override: false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to insert orchestrator decision:', insertError);
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      decision,
      analysis: {
        kelly_metrics: {
          kelly_fraction_raw: aiDecision.kelly_fraction_raw,
          kelly_fraction_adjusted: aiDecision.kelly_fraction_adjusted,
          p_win: aiDecision.p_win,
          p_break_even: aiDecision.p_break_even,
        },
        position_sizing: {
          target_shares: aiDecision.target_shares,
          delta_shares: aiDecision.delta_shares,
          recommended_size: aiDecision.recommended_size,
        },
        risk_flags: aiDecision.risk_flags,
      },
      message: 'AI analysis completed and decision created',
    });

  } catch (error) {
    console.error('Orchestrator analyze API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to analyze opportunity',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
