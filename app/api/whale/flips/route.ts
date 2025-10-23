/**
 * Whale Position Flips API
 *
 * Returns recent instances where whale wallets flipped their position
 * from YES to NO or vice versa on a market.
 *
 * Data source: whale_activity_log table (activity_type = 'POSITION_FLIP')
 * Update frequency: Real-time (logged when detected)
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
    const timeframe = searchParams.get('timeframe') || '30d';
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;
    const minSws = searchParams.get('min_sws') ? parseFloat(searchParams.get('min_sws')!) : 0;
    const wallet = searchParams.get('wallet');

    // Calculate cutoff date based on timeframe
    let cutoffDate: Date;
    const now = new Date();

    switch (timeframe) {
      case '24h':
        cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        cutoffDate = new Date(0);
        break;
    }

    // Build query
    let query = supabase
      .from('whale_activity_log')
      .select(`
        *,
        wallets!inner(wallet_alias, whale_score)
      `)
      .eq('activity_type', 'POSITION_FLIP')
      .gte('occurred_at', cutoffDate.toISOString());

    // Apply filters
    if (wallet) {
      query = query.eq('wallet_address', wallet);
    }

    if (minSws > 0) {
      query = query.gte('wallets.whale_score', minSws);
    }

    // Sort by most recent first
    query = query.order('occurred_at', { ascending: false }).limit(limit);

    // Execute query
    const { data: flips, error } = await query;

    if (error) {
      console.error('[Whale Flips API] Database error:', error);
      throw error;
    }

    // Transform to expected format
    const formattedFlips = (flips || []).map(flip => ({
      flip_id: flip.id.toString(),
      wallet_address: flip.wallet_address,
      wallet_alias: flip.wallets?.wallet_alias || flip.wallet_address.slice(0, 8) + '...',
      market_id: flip.market_id,
      market_title: flip.market_title || 'Unknown Market',
      from_side: flip.previous_outcome || 'Unknown',
      to_side: flip.new_outcome || 'Unknown',
      flip_date: flip.occurred_at,
      prev_investment: parseFloat(flip.amount_usd) || 0, // Would need historical data
      new_investment: parseFloat(flip.amount_usd) || 0,
      price_at_flip: parseFloat(flip.price) || 0,
      sws_score: flip.wallets?.whale_score || 0,
    }));

    return NextResponse.json({
      success: true,
      data: formattedFlips,
      count: formattedFlips.length,
      filters: {
        timeframe,
        limit,
        min_sws: minSws,
        wallet,
      },
      note: formattedFlips.length === 0
        ? 'No position flips found. Flips will be detected and logged once whale activity monitoring is active.'
        : undefined,
    });
  } catch (error) {
    console.error('[Whale Flips API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch position flips',
        data: [],
        count: 0,
        note: 'Database query failed. Ensure whale_activity_log table is populated with flip events.'
      },
      { status: 500 }
    );
  }
}
