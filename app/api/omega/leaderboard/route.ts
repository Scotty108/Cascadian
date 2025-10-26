import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const minTrades = parseInt(searchParams.get('min_trades') || '5');
    const sortBy = searchParams.get('sort_by') || 'omega_ratio';

    // Query wallet_scores table
    let query = supabase
      .from('wallet_scores')
      .select('*')
      .gte('closed_positions', minTrades)
      .not('omega_ratio', 'is', null)
      .order(sortBy as string, { ascending: false });

    // Only apply limit if it's a reasonable number
    if (limit > 0 && limit <= 1000) {
      query = query.limit(limit);
    }

    const { data: wallets, error } = await query;

    if (error) {
      console.error('Error fetching wallet scores:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch wallet scores' },
        { status: 500 }
      );
    }

    // Transform data to match frontend format
    const transformedData = wallets.map((wallet) => {
      const totalPnl = parseFloat(wallet.total_pnl || '0');
      const totalGains = parseFloat(wallet.total_gains || '0');
      const totalLosses = parseFloat(wallet.total_losses || '0');
      const closedPositions = wallet.closed_positions || 0;

      // Calculate ROI metrics
      const roiPerBet = closedPositions > 0 ? totalPnl / closedPositions : 0;
      const totalCapitalDeployed = totalGains + totalLosses;
      const overallRoi = totalCapitalDeployed > 0 ? (totalPnl / totalCapitalDeployed) * 100 : 0;

      return {
        wallet_id: wallet.wallet_address,
        wallet_alias: wallet.wallet_address.slice(0, 8) + '...',
        omega_ratio: parseFloat(wallet.omega_ratio || '0'),
        omega_momentum: parseFloat(wallet.omega_momentum || '0'),
        grade: wallet.grade,
        momentum_direction: wallet.momentum_direction,
        total_pnl: totalPnl,
        total_gains: totalGains,
        total_losses: totalLosses,
        win_rate: parseFloat(wallet.win_rate || '0') * 100, // Convert to percentage
        avg_gain: parseFloat(wallet.avg_gain || '0'),
        avg_loss: parseFloat(wallet.avg_loss || '0'),
        total_positions: wallet.total_positions || 0,
        closed_positions: closedPositions,
        calculated_at: wallet.calculated_at,
        roi_per_bet: roiPerBet,
        overall_roi: overallRoi,
      };
    });

    return NextResponse.json({
      success: true,
      data: transformedData,
      count: transformedData.length,
    });
  } catch (error) {
    console.error('Error in omega leaderboard API:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
