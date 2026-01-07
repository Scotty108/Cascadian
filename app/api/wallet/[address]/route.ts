/**
 * Wallet Detail API
 *
 * Returns comprehensive wallet data including positions, trades, and scores.
 * Features on-demand discovery: if wallet doesn't exist, automatically fetches and caches it.
 *
 * Path: /api/wallet/[address]
 * Method: GET
 */

import { NextRequest, NextResponse } from 'next/server';
import { ensureWalletCached } from '@/lib/wallet-cache';
import { supabaseAdmin as supabase } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid Ethereum address format',
        },
        { status: 400 }
      );
    }

    // Ensure wallet is cached (auto-discovers if not exists)
    const cacheResult = await ensureWalletCached(address);

    if (!cacheResult || !cacheResult.wallet) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch wallet data from Polymarket',
        },
        { status: 404 }
      );
    }

    const wallet = cacheResult.wallet;
    const wasCached = cacheResult.cached;

    // Fetch additional data if needed
    const { searchParams } = new URL(request.url);
    const includePositions = searchParams.get('include_positions') === 'true';
    const includeTrades = searchParams.get('include_trades') === 'true';
    const tradesLimit = parseInt(searchParams.get('trades_limit') || '50');

    let positions = null;
    let trades = null;

    if (includePositions) {
      const { data: positionsData } = await supabase
        .from('wallet_positions')
        .select('*')
        .eq('wallet_address', address.toLowerCase())
        .order('value', { ascending: false });

      positions = positionsData || [];
    }

    if (includeTrades) {
      const { data: tradesData } = await supabase
        .from('wallet_trades')
        .select('*')
        .eq('wallet_address', address.toLowerCase())
        .order('timestamp', { ascending: false })
        .limit(tradesLimit);

      trades = tradesData || [];
    }

    // Format response
    return NextResponse.json({
      success: true,
      data: {
        address: wallet.wallet_address,
        alias: wallet.wallet_alias || null,
        whale_score: wallet.whale_score || 0,
        insider_score: wallet.insider_score || 0,
        is_whale: wallet.is_whale || false,
        is_suspected_insider: wallet.is_suspected_insider || false,
        stats: {
          total_volume_usd: wallet.total_volume_usd || 0,
          total_trades: wallet.total_trades || 0,
          active_positions: wallet.active_positions_count || 0,
          win_rate: wallet.win_rate || 0,
          realized_pnl_usd: wallet.realized_pnl_usd || 0,
          unrealized_pnl_usd: wallet.unrealized_pnl_usd || 0,
          total_pnl_usd: wallet.total_pnl_usd || 0,
        },
        timeline: {
          first_seen_at: wallet.first_seen_at || null,
          last_seen_at: wallet.last_seen_at || null,
        },
        positions: positions,
        trades: trades,
      },
      meta: {
        cached: wasCached,
        processed: cacheResult.processed,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[Wallet Detail API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch wallet details',
      },
      { status: 500 }
    );
  }
}
