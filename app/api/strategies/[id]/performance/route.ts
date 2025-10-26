/**
 * Strategy Performance API
 * GET /api/strategies/[id]/performance - Get complete performance data for dashboard
 *
 * Returns portfolio metrics, positions, trades, and statistics
 * Supports both paper trading and live trading modes
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: strategyId } = await params;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch strategy definition
    const { data: strategy, error: strategyError } = await supabase
      .from('strategy_definitions')
      .select('*')
      .eq('strategy_id', strategyId)
      .single();

    if (strategyError || !strategy) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }

    const tradingMode = strategy.trading_mode || 'paper';

    // Fetch paper portfolio
    const { data: portfolio } = await supabase
      .from('paper_portfolios')
      .select('*')
      .eq('strategy_id', strategyId)
      .single();

    // Fetch open positions
    const { data: openTrades } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('strategy_id', strategyId)
      .eq('status', 'open')
      .order('entry_date', { ascending: false });

    // Fetch recent trades (last 50)
    const { data: recentTrades } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('strategy_id', strategyId)
      .order('created_at', { ascending: false })
      .limit(50);

    // Default portfolio if none exists
    const portfolioData = portfolio || {
      initial_bankroll_usd: strategy.paper_bankroll_usd || 10000,
      current_bankroll_usd: strategy.paper_bankroll_usd || 10000,
      total_pnl_usd: 0,
      open_positions_count: 0,
      total_trades_count: 0,
      winning_trades_count: 0,
      losing_trades_count: 0,
      win_rate: 0,
    };

    // Calculate ROI
    const roi = portfolioData.initial_bankroll_usd > 0
      ? ((portfolioData.current_bankroll_usd - portfolioData.initial_bankroll_usd) / portfolioData.initial_bankroll_usd) * 100
      : 0;

    return NextResponse.json({
      success: true,
      trading_mode: tradingMode,
      portfolio: {
        initial_balance: portfolioData.initial_bankroll_usd,
        current_balance: portfolioData.current_bankroll_usd,
        total_pnl: portfolioData.total_pnl_usd,
        roi: roi,
      },
      statistics: {
        total_trades: portfolioData.total_trades_count,
        winning_trades: portfolioData.winning_trades_count,
        losing_trades: portfolioData.losing_trades_count,
        win_rate: portfolioData.win_rate * 100,
        active_positions: portfolioData.open_positions_count || 0,
      },
      positions: (openTrades || []).map((trade: any) => ({
        id: trade.trade_id,
        market_id: trade.market_id,
        market_question: trade.market_question,
        side: trade.side,
        entry_price: trade.entry_price,
        entry_shares: trade.entry_shares,
        entry_notional_usd: trade.entry_notional_usd,
        unrealized_pnl_usd: trade.unrealized_pnl_usd || 0,
        entry_date: trade.entry_date,
      })),
      recent_trades: (recentTrades || []).map((trade: any) => ({
        id: trade.trade_id,
        market_question: trade.market_question,
        side: trade.side,
        action: trade.action,
        entry_price: trade.entry_price,
        entry_shares: trade.entry_shares,
        entry_notional_usd: trade.entry_notional_usd,
        realized_pnl_usd: trade.realized_pnl_usd || 0,
        status: trade.status,
        created_at: trade.created_at,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch performance:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch performance',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
