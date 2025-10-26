'use client';

import { useState, useEffect } from 'react';
import type { StrategyData } from '@/components/strategy-dashboard/types';

export function useStrategyDashboard(strategyId: string) {
  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // Fetch all data in parallel
      const [watchlistRes, positionsRes, tradesRes, performanceRes, strategyRes] = await Promise.all([
        fetch(`/api/strategies/${strategyId}/watchlist`),
        fetch(`/api/strategies/${strategyId}/positions`),
        fetch(`/api/strategies/${strategyId}/trades`),
        fetch(`/api/strategies/${strategyId}/performance`),
        fetch(`/api/strategies/${strategyId}`),
      ]);

      const [watchlist, positions, trades, performance, strategy] = await Promise.all([
        watchlistRes.json(),
        positionsRes.json(),
        tradesRes.json(),
        performanceRes.json(),
        strategyRes.json(),
      ]);

      // Check for errors in responses
      if (!strategy.success) {
        throw new Error('Strategy not found');
      }

      // Transform to StrategyData format
      const dashboardData: StrategyData = {
        id: strategyId,
        name: strategy.strategy?.strategyName || 'Unnamed Strategy',
        description: strategy.strategy?.strategyDescription || '',
        status: strategy.strategy?.isActive ? 'active' : 'paused',
        createdAt: strategy.strategy?.createdAt || new Date().toISOString(),

        // Add nodeGraph from strategy definition
        nodeGraph: strategy.strategy?.nodeGraph || { nodes: [], edges: [] },

        // Calculate balance from positions and settings
        balance: calculateCurrentBalance(positions.positions, performance.performance),
        initialBalance: 1000, // TODO: Get from strategy_settings

        // Performance metrics
        performance: calculatePerformanceMetrics(trades.trades, performance.performance),
        performanceData: transformPerformanceData(performance.performance),

        // Positions
        positions: transformPositions(positions.positions),
        recentTrades: transformTrades(trades.trades),

        // Watchlist
        watchSignals: transformWatchlist(watchlist.watchlist),

        // Statistics
        statistics: calculateStatistics(trades.trades, positions.positions),

        // Settings placeholder
        settings: {
          maxPositionSize: 100,
          maxPositions: 10,
          stopLoss: 10,
          takeProfit: 20,
          categories: [],
          minVolume: 1000,
          minLiquidity: 5000,
          siiThreshold: 0.5,
          momentumThreshold: 0.5,
          riskLevel: 'medium',
        },

        aiInsights: [],
        marketConditions: {
          overall: 'neutral',
          volume: 'medium',
          volatility: 'medium',
          sentiment: 'neutral',
          topCategories: [],
        },
      };

      setData(dashboardData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (strategyId) {
      fetchDashboardData();
    }
  }, [strategyId]);

  return { data, loading, error, refresh: fetchDashboardData };
}

// Helper functions for data transformation

function calculateCurrentBalance(positions: any, performance: any[]) {
  // Use latest performance snapshot if available
  if (performance && performance.length > 0) {
    const latest = performance[performance.length - 1];
    return latest.portfolio_value_usd || 1000;
  }

  // Calculate from positions
  if (positions) {
    const { open = [], closed = [] } = positions;
    const openValue = open.reduce((sum: number, p: any) => {
      return sum + ((p.current_price || p.entry_price) * p.entry_shares);
    }, 0);
    const closedPnl = closed.reduce((sum: number, p: any) => {
      return sum + (p.realized_pnl || 0);
    }, 0);
    return 1000 + closedPnl + openValue;
  }

  return 1000;
}

function calculatePerformanceMetrics(trades: any[], performance: any[]) {
  // If we have performance snapshots, calculate from those
  if (performance && performance.length > 0) {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const latest = performance[performance.length - 1];
    const latestValue = latest?.portfolio_value_usd || 1000;

    const daySnapshot = performance.find(s => new Date(s.snapshot_timestamp) >= oneDayAgo);
    const weekSnapshot = performance.find(s => new Date(s.snapshot_timestamp) >= oneWeekAgo);
    const monthSnapshot = performance.find(s => new Date(s.snapshot_timestamp) >= oneMonthAgo);
    const firstSnapshot = performance[0];

    return {
      daily: daySnapshot ? ((latestValue - daySnapshot.portfolio_value_usd) / daySnapshot.portfolio_value_usd) * 100 : 0,
      weekly: weekSnapshot ? ((latestValue - weekSnapshot.portfolio_value_usd) / weekSnapshot.portfolio_value_usd) * 100 : 0,
      monthly: monthSnapshot ? ((latestValue - monthSnapshot.portfolio_value_usd) / monthSnapshot.portfolio_value_usd) * 100 : 0,
      total: firstSnapshot ? ((latestValue - firstSnapshot.portfolio_value_usd) / firstSnapshot.portfolio_value_usd) * 100 : 0,
    };
  }

  // Fallback to trades-based calculation
  const completedTrades = trades.filter((t: any) => t.execution_status === 'COMPLETED');
  const totalPnl = completedTrades.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
  const totalRoi = (totalPnl / 1000) * 100;

  return {
    daily: 0,
    weekly: 0,
    monthly: 0,
    total: totalRoi,
  };
}

function transformPerformanceData(snapshots: any[]) {
  if (!snapshots || snapshots.length === 0) {
    // Return default data point
    return [
      {
        date: new Date().toISOString(),
        balance: 1000,
        profit: 0,
        trades: 0,
        winRate: 0,
      }
    ];
  }

  return snapshots.map(s => ({
    date: s.snapshot_timestamp,
    balance: s.portfolio_value_usd,
    profit: s.total_realized_pnl || 0,
    trades: s.total_trades || 0,
    winRate: s.win_rate || 0,
  }));
}

function transformPositions(positions: any) {
  if (!positions) {
    return [];
  }

  const { open = [], closed = [] } = positions;

  return [
    ...open.map((p: any) => ({
      id: p.id,
      marketId: p.market_id,
      marketTitle: p.market_title || 'Unknown Market',
      marketSlug: p.market_slug || '',
      outcome: p.outcome,
      shares: p.entry_shares,
      averagePrice: p.entry_price,
      currentPrice: p.current_price || p.entry_price,
      unrealizedPnL: p.unrealized_pnl || ((p.current_price || p.entry_price) - p.entry_price) * p.entry_shares,
      realizedPnL: 0,
      category: p.category || 'Unknown',
      status: 'open' as const,
      openedAt: p.entry_timestamp,
    })),
    ...closed.slice(0, 10).map((p: any) => ({
      id: p.id,
      marketId: p.market_id,
      marketTitle: p.market_title || 'Unknown Market',
      marketSlug: p.market_slug || '',
      outcome: p.outcome,
      shares: p.entry_shares,
      averagePrice: p.entry_price,
      currentPrice: p.exit_price || p.entry_price,
      unrealizedPnL: 0,
      realizedPnL: p.realized_pnl || 0,
      category: p.category || 'Unknown',
      status: 'closed' as const,
      openedAt: p.entry_timestamp,
      closedAt: p.exit_timestamp,
    })),
  ];
}

function transformTrades(trades: any[]) {
  if (!trades || trades.length === 0) {
    return [];
  }

  return trades.slice(0, 20).map((t: any) => ({
    id: t.id,
    timestamp: t.executed_at,
    marketTitle: t.market_title || 'Unknown Market',
    type: t.trade_type?.toLowerCase() === 'buy' ? 'buy' : 'sell',
    outcome: t.outcome,
    shares: t.shares,
    price: t.price,
    amount: t.amount_usd,
    status: (t.execution_status?.toLowerCase() || 'pending') as 'completed' | 'pending' | 'failed',
    pnl: t.pnl,
    fees: t.fees || 0,
  }));
}

function transformWatchlist(watchlist: any[]) {
  if (!watchlist || watchlist.length === 0) {
    return [];
  }

  return watchlist
    .filter((w: any) => w.status === 'WATCHING')
    .slice(0, 20)
    .map((w: any) => {
      const itemData = w.item_data || {};

      return {
        id: w.id,
        marketId: w.item_id,
        marketTitle: itemData.market_title || itemData.title || w.item_id,
        category: itemData.category || 'Unknown',
        currentPrice: itemData.current_price || itemData.price || 0.5,
        sii: itemData.sii || 0,
        volume24h: itemData.volume_24h || itemData.volume || 0,
        momentum: 0,
        flaggedAt: w.created_at,
        reason: w.signal_reason,
        confidence: w.confidence?.toLowerCase() as 'high' | 'medium' | 'low',
        suggestedOutcome: 'YES' as const,
      };
    });
}

function calculateStatistics(trades: any[], positions: any) {
  const completedTrades = trades.filter((t: any) => t.execution_status === 'COMPLETED');
  const wins = completedTrades.filter((t: any) => t.pnl && t.pnl > 0);
  const losses = completedTrades.filter((t: any) => t.pnl && t.pnl < 0);

  const totalWins = wins.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.pnl || 0), 0));

  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

  const openPositions = positions?.open?.length || 0;
  const closedPositions = positions?.closed?.length || 0;

  return {
    totalTrades: completedTrades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: wins.length + losses.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : 0,
    averageWin: avgWin,
    averageLoss: avgLoss,
    profitFactor: profitFactor,
    sharpeRatio: 0, // TODO: Calculate properly
    maxDrawdown: 0, // TODO: Calculate from performance snapshots
    currentDrawdown: 0, // TODO: Calculate from performance snapshots
    activePositions: openPositions,
    closedPositions: closedPositions,
  };
}
