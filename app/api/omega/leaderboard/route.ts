import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const minTrades = parseInt(searchParams.get('min_trades') || '10');
    const sortBy = searchParams.get('sort_by') || 'omega_ratio';
    let window = searchParams.get('window') || 'lifetime'; // 30d, 90d, 180d, lifetime
    const category = searchParams.get('category') || 'all'; // Category filter

    // TEMPORARY FIX: If category-specific and lifetime not available, use 30d
    // TODO: Remove this once wallet_metrics_by_category has lifetime data
    if (category !== 'all' && window === 'lifetime') {
      window = '30d'; // Fallback to 30d which we know exists
    }

    // Validate window parameter
    const validWindows = ['30d', '90d', '180d', 'lifetime'];
    if (!validWindows.includes(window)) {
      return NextResponse.json(
        { success: false, error: 'Invalid window parameter. Must be one of: 30d, 90d, 180d, lifetime' },
        { status: 400 }
      );
    }

    // Map sort_by parameter to ClickHouse column
    const sortColumnMap: Record<string, string> = {
      'omega_ratio': 'metric_2_omega_net',
      'omega_net': 'metric_2_omega_net',
      'pnl': 'metric_9_net_pnl_usd',
      'win_rate': 'metric_12_hit_rate',
      'sharpe': 'metric_6_sharpe',
      'resolved_bets': 'metric_22_resolved_bets',
      'tail_ratio': 'metric_60_tail_ratio',
      'ev_per_hour': 'metric_69_ev_per_hour_capital',
    };

    const sortColumn = sortColumnMap[sortBy] || 'metric_2_omega_net';

    // Determine which table to query based on category filter
    let query: string;
    let queryParams: any;

    if (category === 'all') {
      // Query wallet_metrics_complete for overall metrics
      // Use FINAL to deduplicate rows (ReplacingMergeTree)
      query = `
        SELECT
          wallet_address,
          '' as category,
          window,
          calculated_at,
          metric_2_omega_net as omega_net,
          metric_6_sharpe as sharpe_ratio,
          metric_9_net_pnl_usd as net_pnl,
          metric_12_hit_rate as hit_rate,
          metric_13_avg_win_usd as avg_win,
          metric_14_avg_loss_usd as avg_loss,
          metric_22_resolved_bets as resolved_bets,
          metric_23_track_record_days as track_record_days,
          metric_24_bets_per_week as bets_per_week,
          metric_56_omega_momentum_30d as omega_momentum,
          metric_60_tail_ratio as tail_ratio,
          metric_69_ev_per_hour_capital as ev_per_hour,
          'stable' as performance_trend,
          0 as sizing_discipline,
          trades_analyzed,
          resolved_trades,
          0 as trades_in_category,
          0 as pct_of_total_trades
        FROM wallet_metrics_complete FINAL
        WHERE window = {window:String}
          AND metric_22_resolved_bets >= {minTrades:UInt32}
          AND metric_2_omega_net >= 1.0
        ORDER BY ${sortColumn} DESC
        LIMIT {limit:UInt32}
      `;

      queryParams = {
        window,
        minTrades,
        limit: Math.min(limit, 1000), // Cap at 1000
      };
    } else {
      // Query wallet_metrics_by_category for category-specific metrics
      // Use FINAL to deduplicate rows (ReplacingMergeTree)
      query = `
        SELECT
          wallet_address,
          category,
          window,
          calculated_at,
          metric_2_omega_net as omega_net,
          metric_6_sharpe as sharpe_ratio,
          metric_9_net_pnl_usd as net_pnl,
          metric_12_hit_rate as hit_rate,
          metric_13_avg_win_usd as avg_win,
          metric_14_avg_loss_usd as avg_loss,
          metric_22_resolved_bets as resolved_bets,
          metric_23_track_record_days as track_record_days,
          metric_24_bets_per_week as bets_per_week,
          0 as omega_momentum,
          0 as tail_ratio,
          0 as ev_per_hour,
          'stable' as performance_trend,
          0 as sizing_discipline,
          trades_in_category as trades_analyzed,
          metric_22_resolved_bets as resolved_trades,
          trades_in_category,
          pct_of_total_trades
        FROM wallet_metrics_by_category FINAL
        WHERE window = {window:String}
          AND category = {category:String}
          AND metric_22_resolved_bets >= {minTrades:UInt32}
          AND metric_2_omega_net >= 1.0
        ORDER BY ${sortColumn} DESC
        LIMIT {limit:UInt32}
      `;

      queryParams = {
        window,
        category,
        minTrades,
        limit: Math.min(limit, 1000), // Cap at 1000
      };
    }

    const result = await clickhouse.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    const wallets = (await result.json()) as any[];

    // Transform data to match frontend format
    const transformedData = wallets.map((wallet: any) => {
      const netPnl = parseFloat(wallet.net_pnl || '0');
      const avgWin = parseFloat(wallet.avg_win || '0');
      const avgLoss = parseFloat(wallet.avg_loss || '0');
      const omegaNet = parseFloat(wallet.omega_net || '0');
      const resolvedBets = parseInt(wallet.resolved_bets || '0');

      // Calculate total gains/losses from omega ratio
      // Omega = gains / losses, so if we have omega and losses, we can calculate gains
      const totalLosses = avgLoss * resolvedBets;
      const totalGains = omegaNet > 0 ? totalLosses * omegaNet : 0;

      // Calculate ROI metrics
      const roiPerBet = resolvedBets > 0 ? netPnl / resolvedBets : 0;
      const totalCapitalDeployed = Math.abs(totalGains) + Math.abs(totalLosses);
      const overallRoi = totalCapitalDeployed > 0 ? (netPnl / totalCapitalDeployed) * 100 : 0;

      // Grade calculation based on omega ratio
      let grade = 'F';
      if (omegaNet >= 5.0) grade = 'S';
      else if (omegaNet >= 3.0) grade = 'A';
      else if (omegaNet >= 2.0) grade = 'B';
      else if (omegaNet >= 1.5) grade = 'C';
      else if (omegaNet >= 1.0) grade = 'D';

      // Momentum direction from performance trend
      let momentumDirection = 'stable';
      if (wallet.performance_trend === 'improving') momentumDirection = 'up';
      else if (wallet.performance_trend === 'declining') momentumDirection = 'down';

      return {
        wallet_id: wallet.wallet_address,
        wallet_alias: wallet.wallet_address.slice(0, 8) + '...',
        omega_ratio: omegaNet,
        omega_momentum: parseFloat(wallet.omega_momentum || '0'),
        grade: grade,
        momentum_direction: momentumDirection,
        total_pnl: netPnl,
        total_gains: totalGains,
        total_losses: Math.abs(totalLosses),
        win_rate: parseFloat(wallet.hit_rate || '0') * 100, // Convert to percentage
        avg_gain: avgWin,
        avg_loss: Math.abs(avgLoss),
        total_positions: parseInt(wallet.trades_analyzed || '0'),
        closed_positions: resolvedBets,
        calculated_at: wallet.calculated_at,
        roi_per_bet: roiPerBet,
        overall_roi: overallRoi,

        // NEW TIER 1 METRICS
        sharpe_ratio: parseFloat(wallet.sharpe_ratio || '0'),
        tail_ratio: parseFloat(wallet.tail_ratio || '0'),
        ev_per_hour: parseFloat(wallet.ev_per_hour || '0'),
        track_record_days: parseInt(wallet.track_record_days || '0'),
        bets_per_week: parseFloat(wallet.bets_per_week || '0'),
        performance_trend: wallet.performance_trend || 'stable',
        window: wallet.window,

        // CATEGORY-SPECIFIC FIELDS
        category: wallet.category || null,
        trades_in_category: parseInt(wallet.trades_in_category || '0'),
        pct_of_total_trades: parseFloat(wallet.pct_of_total_trades || '0') * 100, // Convert to percentage
      };
    });

    return NextResponse.json({
      success: true,
      data: transformedData,
      count: transformedData.length,
      window: window,
      category: category,
      min_trades: minTrades,
      sort_by: sortBy,
    });
  } catch (error) {
    console.error('Error in omega leaderboard API:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
