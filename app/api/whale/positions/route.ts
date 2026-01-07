/**
 * Whale Positions API
 *
 * Returns aggregated position data for whale wallets across all markets.
 * Whales are identified as wallets with large positions (>$10k invested).
 *
 * Data source: wallet_positions + market_holders tables
 * Update frequency: Real-time (fetched on-demand from Data-API)
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const timeframe = searchParams.get('timeframe') || 'all';
    const minAmount = searchParams.get('min_amount') ? parseFloat(searchParams.get('min_amount')!) : 10000; // Default $10k whale threshold
    const maxAmount = searchParams.get('max_amount') ? parseFloat(searchParams.get('max_amount')!) : undefined;
    const category = searchParams.get('category');
    const wallet = searchParams.get('wallet');
    const minSws = searchParams.get('min_sws') ? parseFloat(searchParams.get('min_sws')!) : undefined;

    // Query wallet_positions joined with wallets for SWS score
    let query = supabase
      .from('wallet_positions')
      .select(`
        *,
        wallets!inner(
          wallet_alias,
          whale_score
        )
      `)
      .gte('position_value_usd', minAmount);

    // Apply filters
    if (maxAmount !== undefined) {
      query = query.lte('position_value_usd', maxAmount);
    }

    if (category) {
      // Note: This would require joining with markets table to filter by category
      // For now, we'll skip category filtering
    }

    if (wallet) {
      query = query.eq('wallet_address', wallet);
    }

    if (minSws !== undefined && minSws > 0) {
      query = query.gte('wallets.whale_score', minSws);
    }

    // Execute query
    const { data: positions, error } = await query.order('position_value_usd', { ascending: false }).limit(100);

    if (error) {
      console.error('[Whale Positions API] Database error:', error);
      throw error;
    }

    // Transform to expected format
    const formattedPositions = (positions || []).map(pos => ({
      position_id: pos.id.toString(),
      wallet_address: pos.wallet_address,
      wallet_alias: pos.wallets?.wallet_alias || pos.wallet_address.slice(0, 8) + '...',
      market_id: pos.market_id,
      market_title: pos.market_title || 'Unknown Market',
      category: 'Unknown', // Would need to join with markets table
      side: pos.outcome,
      shares: parseFloat(pos.shares),
      avg_entry_price: pos.entry_price ? parseFloat(pos.entry_price) : 0,
      current_price: pos.current_price ? parseFloat(pos.current_price) : 0,
      invested_usd: parseFloat(pos.position_value_usd) || 0,
      current_value_usd: parseFloat(pos.position_value_usd) || 0,
      unrealized_pnl: parseFloat(pos.unrealized_pnl_usd) || 0,
      unrealized_pnl_pct: pos.entry_price ? ((parseFloat(pos.current_price || 0) - parseFloat(pos.entry_price)) / parseFloat(pos.entry_price)) * 100 : 0,
      first_trade_date: pos.opened_at || new Date().toISOString(),
      last_trade_date: pos.last_updated || new Date().toISOString(),
      total_trades: 1, // Would need to count from wallet_trades
      sws_score: pos.wallets?.whale_score || 0,
    }));

    return NextResponse.json({
      success: true,
      data: formattedPositions,
      count: formattedPositions.length,
      filters: {
        timeframe,
        min_amount: minAmount,
        max_amount: maxAmount,
        category,
        wallet,
        min_sws: minSws,
      },
      note: formattedPositions.length === 0
        ? 'No whale positions found. Data will be available once wallets are discovered and positions are fetched from Data-API.'
        : undefined,
    });
  } catch (error) {
    console.error('[Whale Positions API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch whale positions',
        data: [],
        count: 0,
        note: 'Database query failed. Ensure wallet_positions table is populated with data from Polymarket Data-API.'
      },
      { status: 500 }
    );
  }
}
