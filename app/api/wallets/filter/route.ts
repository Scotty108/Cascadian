import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';

/**
 * Filter Wallets API
 *
 * Supports flexible filtering with multiple criteria:
 * - Omega ratio range
 * - ROI per bet minimum
 * - Minimum trades
 * - Grade levels
 * - Momentum direction
 * - Category (when category-specific data available)
 *
 * Use this for:
 * - Strategy builder nodes
 * - Copy trading wallet selection
 * - Custom alerts/notifications
 */
export async function POST(request: Request) {
  try {
    const criteria = await request.json();

    // Build dynamic query
    let query = supabase
      .from('wallet_scores')
      .select('*');

    // Omega ratio filters
    if (criteria.min_omega_ratio !== undefined) {
      query = query.gte('omega_ratio', criteria.min_omega_ratio);
    }
    if (criteria.max_omega_ratio !== undefined) {
      query = query.lte('omega_ratio', criteria.max_omega_ratio);
    }

    // Performance filters
    if (criteria.min_total_pnl !== undefined) {
      query = query.gte('total_pnl', criteria.min_total_pnl);
    }
    if (criteria.min_win_rate !== undefined) {
      query = query.gte('win_rate', criteria.min_win_rate);
    }

    // Volume filters
    if (criteria.min_closed_positions !== undefined) {
      query = query.gte('closed_positions', criteria.min_closed_positions);
    }
    if (criteria.min_total_positions !== undefined) {
      query = query.gte('total_positions', criteria.min_total_positions);
    }

    // Grade filter
    if (criteria.allowed_grades && criteria.allowed_grades.length > 0) {
      query = query.in('grade', criteria.allowed_grades);
    }

    // Momentum filter
    if (criteria.allowed_momentum && criteria.allowed_momentum.length > 0) {
      query = query.in('momentum_direction', criteria.allowed_momentum);
    }

    // Always filter for minimum trade threshold
    query = query.eq('meets_minimum_trades', true);

    // Sort
    const sortBy = criteria.sort_by || 'omega_ratio';
    const sortDirection = criteria.sort_direction || 'desc';
    query = query.order(sortBy, { ascending: sortDirection === 'asc' });

    // Limit
    const limit = Math.min(criteria.limit || 100, 1000);
    query = query.limit(limit);

    const { data: wallets, error } = await query;

    if (error) {
      console.error('Error filtering wallets:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to filter wallets' },
        { status: 500 }
      );
    }

    // Calculate ROI metrics
    const enrichedWallets = (wallets || []).map((wallet) => {
      const totalPnl = parseFloat(wallet.total_pnl || '0');
      const totalGains = parseFloat(wallet.total_gains || '0');
      const totalLosses = parseFloat(wallet.total_losses || '0');
      const closedPositions = wallet.closed_positions || 0;

      const roiPerBet = closedPositions > 0 ? totalPnl / closedPositions : 0;
      const totalCapitalDeployed = totalGains + totalLosses;
      const overallRoi = totalCapitalDeployed > 0 ? (totalPnl / totalCapitalDeployed) * 100 : 0;

      return {
        ...wallet,
        roi_per_bet: roiPerBet,
        overall_roi: overallRoi,
      };
    });

    // Apply ROI filters (post-query since these are calculated fields)
    let filteredWallets = enrichedWallets;

    if (criteria.min_roi_per_bet !== undefined) {
      filteredWallets = filteredWallets.filter(w => w.roi_per_bet >= criteria.min_roi_per_bet);
    }
    if (criteria.min_overall_roi !== undefined) {
      filteredWallets = filteredWallets.filter(w => w.overall_roi >= criteria.min_overall_roi);
    }

    return NextResponse.json({
      success: true,
      data: filteredWallets,
      count: filteredWallets.length,
      criteria: criteria,
    });
  } catch (error) {
    console.error('Error in wallet filter API:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint - retrieve saved criteria or list all wallets
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const criteriaId = searchParams.get('criteria_id');

    if (criteriaId) {
      // Fetch saved criteria and apply it
      const { data: criteria, error } = await supabase
        .from('wallet_tracking_criteria')
        .select('*')
        .eq('id', criteriaId)
        .single();

      if (error || !criteria) {
        return NextResponse.json(
          { success: false, error: 'Criteria not found' },
          { status: 404 }
        );
      }

      // Apply the criteria using POST logic
      return POST(new Request(request.url, {
        method: 'POST',
        body: JSON.stringify(criteria),
      }));
    }

    // List all available criteria
    const { data: allCriteria, error } = await supabase
      .from('wallet_tracking_criteria')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch criteria' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: allCriteria,
    });
  } catch (error) {
    console.error('Error in wallet filter GET:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
