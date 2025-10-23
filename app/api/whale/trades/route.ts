/**
 * Whale Trades API
 *
 * Returns recent trades from whale wallets (whale_score >= 7).
 * Aggregates trades from all identified whales in the database.
 *
 * Data source: wallet_trades table joined with wallets table
 * Update frequency: Real-time from database
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
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;
    const minSize = searchParams.get('min_size') ? parseFloat(searchParams.get('min_size')!) : 0;

    // Get whale wallet addresses (whale_score >= 7)
    const { data: whales } = await supabase
      .from('wallets')
      .select('wallet_address')
      .gte('whale_score', 7);

    if (!whales || whales.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        message: 'No whales found in database',
      });
    }

    const whaleAddresses = whales.map(w => w.wallet_address);

    // Create whale lookup map
    const { data: whaleData } = await supabase
      .from('wallets')
      .select('wallet_address, whale_score, wallet_alias')
      .gte('whale_score', 7);

    const whaleLookup = new Map(
      (whaleData || []).map(w => [w.wallet_address, w])
    );

    // Query trades from whale wallets
    let query = supabase
      .from('wallet_trades')
      .select('*')
      .in('wallet_address', whaleAddresses)
      .order('executed_at', { ascending: false })
      .limit(limit);

    // Apply minimum size filter if specified (filter by shares)
    if (minSize > 0) {
      query = query.gte('shares', minSize);
    }

    const { data: trades, error } = await query;

    if (error) {
      console.error('[Whale Trades API] Database error:', error);
      throw error;
    }

    // Format response with whale data
    const formattedTrades = (trades || []).map(trade => {
      const whale = whaleLookup.get(trade.wallet_address);
      return {
        id: trade.id,
        trade_id: trade.trade_id,
        wallet_address: trade.wallet_address,
        wallet_alias: whale?.wallet_alias || trade.wallet_address.slice(0, 8) + '...',
        whale_score: whale?.whale_score || 0,
        market_id: trade.market_id,
        market_title: trade.market_title,
        condition_id: trade.condition_id,
        outcome: trade.outcome,
        side: trade.side,
        shares: parseFloat(trade.shares) || 0,
        price: parseFloat(trade.price) || 0,
        amount_usd: parseFloat(trade.amount_usd) || 0,
        executed_at: trade.executed_at,
        timing_score: trade.timing_score,
      };
    });

    return NextResponse.json({
      success: true,
      data: formattedTrades,
      count: formattedTrades.length,
      filters: {
        limit,
        min_size: minSize,
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Whale Trades API] Error:', message);

    return NextResponse.json(
      {
        success: false,
        error: message,
        data: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
