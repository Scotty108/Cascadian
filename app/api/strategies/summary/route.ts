/**
 * Strategy Summary API
 * GET /api/strategies/summary - Get all strategies with aggregated performance metrics
 *
 * Returns strategies with P&L, win rate, trade counts, and other metrics
 * for the main dashboard overview
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch all strategies
    const { data: strategies, error: strategiesError } = await supabase
      .from('strategy_definitions')
      .select('strategy_id, strategy_name, is_active, trading_mode, paper_bankroll_usd, created_at')
      .eq('is_archived', false)
      .order('created_at', { ascending: false });

    if (strategiesError) {
      throw strategiesError;
    }

    if (!strategies || strategies.length === 0) {
      return NextResponse.json({
        success: true,
        strategies: [],
        totalPnL: 0,
        totalCapital: 0,
        activeStrategies: 0,
        openPositions: 0,
        avgWinRate: 0,
      });
    }

    // Fetch performance data for all strategies
    const strategyIds = strategies.map(s => s.strategy_id);

    const { data: portfolios, error: portfoliosError } = await supabase
      .from('paper_portfolios')
      .select('*')
      .in('strategy_id', strategyIds);

    if (portfoliosError) {
      console.error('Error fetching portfolios:', portfoliosError);
    }

    // Fetch trade counts for all strategies
    const { data: tradesData, error: tradesError } = await supabase
      .from('paper_trades')
      .select('strategy_id, status')
      .in('strategy_id', strategyIds);

    if (tradesError) {
      console.error('Error fetching trades:', tradesError);
    }

    // Create portfolio lookup map
    const portfolioMap = new Map();
    (portfolios || []).forEach(p => {
      portfolioMap.set(p.strategy_id, p);
    });

    // Count open positions per strategy
    const positionsMap = new Map();
    (tradesData || []).forEach(trade => {
      if (trade.status === 'open') {
        positionsMap.set(
          trade.strategy_id,
          (positionsMap.get(trade.strategy_id) || 0) + 1
        );
      }
    });

    // Calculate runtime days for each strategy
    const now = new Date();

    // Combine data
    const enrichedStrategies = strategies.map(strategy => {
      const portfolio = portfolioMap.get(strategy.strategy_id);
      const activePositions = positionsMap.get(strategy.strategy_id) || 0;
      const runtimeDays = Math.floor(
        (now.getTime() - new Date(strategy.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Calculate P&L and percentage
      const totalPnL = portfolio?.total_pnl_usd || 0;
      const initialBankroll = portfolio?.initial_bankroll_usd || strategy.paper_bankroll_usd || 10000;
      const pnlPercent = initialBankroll > 0 ? (totalPnL / initialBankroll) * 100 : 0;

      // Win rate
      const totalTrades = portfolio?.total_trades_count || 0;
      const winningTrades = portfolio?.winning_trades_count || 0;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      // Capital at work
      const deployedCapital = portfolio?.deployed_capital_usd || 0;

      return {
        id: strategy.strategy_id,
        name: strategy.strategy_name,
        status: strategy.is_active ? 'active' : 'paused',
        totalPnL,
        pnlPercent,
        winRate,
        totalTrades,
        activePositions,
        capitalAtWork: deployedCapital,
        runtimeDays,
        tradingMode: strategy.trading_mode || 'paper',
        initialBankroll,
        currentBalance: portfolio?.current_bankroll_usd || initialBankroll,
      };
    });

    // Calculate aggregated metrics
    const totalPnL = enrichedStrategies.reduce((sum, s) => sum + s.totalPnL, 0);
    const totalCapital = enrichedStrategies.reduce((sum, s) => sum + s.capitalAtWork, 0);
    const activeStrategies = enrichedStrategies.filter(s => s.status === 'active').length;
    const openPositions = enrichedStrategies.reduce((sum, s) => sum + s.activePositions, 0);

    // Average win rate (weighted by number of trades)
    const totalTradesAll = enrichedStrategies.reduce((sum, s) => sum + s.totalTrades, 0);
    const weightedWinRate = enrichedStrategies.reduce((sum, s) => {
      return sum + (s.winRate * s.totalTrades);
    }, 0);
    const avgWinRate = totalTradesAll > 0 ? weightedWinRate / totalTradesAll : 0;

    return NextResponse.json({
      success: true,
      strategies: enrichedStrategies,
      aggregates: {
        totalPnL,
        totalCapital,
        activeStrategies,
        openPositions,
        avgWinRate,
        totalYield: totalCapital > 0 ? (totalPnL / totalCapital) * 100 : 0,
      },
    });
  } catch (error) {
    console.error('Failed to fetch strategy summary:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch strategy summary',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
