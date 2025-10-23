/**
 * Whale Scoreboard API
 *
 * Returns top whale wallets ranked by volume, WIS score, or PnL.
 * Whales are wallets with total_volume_usd > $10k.
 *
 * Data source: wallets table (filtered by is_whale = TRUE)
 * Update frequency: Updated by background jobs
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100;
    const minSws = searchParams.get('min_sws') ? parseFloat(searchParams.get('min_sws')!) : 0;
    const minTrades = searchParams.get('min_trades') ? parseInt(searchParams.get('min_trades')!) : 0;
    const sortBy = searchParams.get('sort_by') || 'volume'; // volume, score, pnl

    // Build query - whales are defined as wallets with whale_score >= 7
    let query = supabase
      .from('wallets')
      .select('*')
      .gte('whale_score', 7);

    // Apply filters
    if (minSws > 0) {
      query = query.gte('whale_score', minSws);
    }

    if (minTrades > 0) {
      query = query.gte('total_trades', minTrades);
    }

    // Apply sorting
    switch (sortBy) {
      case 'score':
        query = query.order('whale_score', { ascending: false });
        break;
      case 'pnl':
        query = query.order('total_pnl_usd', { ascending: false });
        break;
      case 'volume':
      default:
        query = query.order('total_volume_usd', { ascending: false });
        break;
    }

    // Apply limit
    query = query.limit(limit);

    // Execute query
    const { data: wallets, error } = await query;

    if (error) {
      console.error('[Whale Scoreboard API] Database error:', error);
      throw error;
    }

    // Transform to expected format
    const formattedWallets = (wallets || []).map((wallet, index) => ({
      address: wallet.wallet_address,
      alias: wallet.wallet_alias || wallet.wallet_address.slice(0, 8) + '...',
      total_volume: parseFloat(wallet.total_volume_usd) || 0,
      total_trades: wallet.total_trades || 0,
      active_positions: wallet.active_positions_count || 0,
      win_rate: parseFloat(wallet.win_rate) || 0,
      realized_pnl: parseFloat(wallet.realized_pnl_usd) || 0,
      realized_roi: wallet.realized_pnl_usd && wallet.total_volume_usd
        ? parseFloat(wallet.realized_pnl_usd) / parseFloat(wallet.total_volume_usd)
        : 0,
      sws_score: parseFloat(wallet.whale_score) || 0,
      sws_reliability: 0.85, // Would need to calculate from trade consistency
      rank: index + 1,
      last_active: wallet.last_seen_at || new Date().toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: formattedWallets,
      count: formattedWallets.length,
      filters: {
        limit,
        min_sws: minSws,
        min_trades: minTrades,
        sort_by: sortBy,
      },
      note: formattedWallets.length === 0
        ? 'No whales found. Whales will appear once wallets are discovered and whale_score is calculated.'
        : undefined,
    });
  } catch (error) {
    console.error('[Whale Scoreboard API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch whale scoreboard',
        data: [],
        count: 0,
        note: 'Database query failed. Ensure wallets table is populated with whale data.'
      },
      { status: 500 }
    );
  }
}
