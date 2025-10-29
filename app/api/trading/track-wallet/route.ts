/**
 * Track Wallet API Endpoint
 *
 * POST /api/trading/track-wallet
 *
 * Add a wallet to a strategy's watchlist for copy trading.
 * Validates that the wallet has good metrics before adding.
 *
 * @module app/api/trading/track-wallet
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clickhouse } from '@/lib/clickhouse/client';

// ============================================================================
// Types
// ============================================================================

interface TrackWalletRequest {
  strategy_id: string;
  wallet_address: string;
  selection_reason?: string;
  selection_filters?: Record<string, any>;
  expected_metrics?: {
    omega?: number;
    omega_lag_30s?: number;
    omega_lag_2min?: number;
    ev_per_hour?: number;
  };
  primary_category?: string;
}

interface TrackWalletResponse {
  success: boolean;
  watchlist_item?: any;
  error?: string;
  validation?: {
    has_metrics: boolean;
    omega?: number;
    resolved_bets?: number;
    meets_minimum: boolean;
  };
}

// ============================================================================
// Handler
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<TrackWalletResponse>> {
  try {
    // Parse request body
    const body: TrackWalletRequest = await request.json();

    // Validate required fields
    if (!body.strategy_id || !body.wallet_address) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: strategy_id, wallet_address',
        },
        { status: 400 }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validate strategy exists
    const { data: strategy, error: strategyError } = await supabase
      .from('strategy_definitions')
      .select('strategy_id, name')
      .eq('strategy_id', body.strategy_id)
      .single();

    if (strategyError || !strategy) {
      return NextResponse.json(
        {
          success: false,
          error: 'Strategy not found',
        },
        { status: 404 }
      );
    }

    // Validate wallet has good metrics
    const validation = await validateWalletMetrics(body.wallet_address, body.primary_category);

    if (!validation.has_metrics) {
      return NextResponse.json(
        {
          success: false,
          error: 'Wallet has insufficient metrics (need 10+ resolved bets)',
          validation,
        },
        { status: 400 }
      );
    }

    if (!validation.meets_minimum) {
      return NextResponse.json(
        {
          success: false,
          error: 'Wallet does not meet minimum quality requirements (Omega < 1.0)',
          validation,
        },
        { status: 400 }
      );
    }

    // Check if wallet is already tracked by this strategy
    const { data: existing } = await supabase
      .from('strategy_watchlist_items')
      .select('id')
      .eq('strategy_id', body.strategy_id)
      .eq('item_type', 'WALLET')
      .eq('item_id', body.wallet_address)
      .single();

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'Wallet is already tracked by this strategy',
        },
        { status: 409 }
      );
    }

    // Add to watchlist
    const { data: watchlistItem, error: insertError } = await supabase
      .from('strategy_watchlist_items')
      .insert({
        strategy_id: body.strategy_id,
        item_type: 'WALLET',
        item_id: body.wallet_address,
        item_data: {
          wallet_address: body.wallet_address,
          omega: validation.omega,
          resolved_bets: validation.resolved_bets,
          primary_category: body.primary_category,
        },
        signal_reason: body.selection_reason || 'Manually added for copy trading',
        confidence: validation.omega && validation.omega > 2.0 ? 'HIGH' : 'MEDIUM',
        status: 'WATCHING',
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to add wallet to watchlist: ${insertError.message}`);
    }

    console.log('[TrackWallet] Added wallet to strategy:', {
      strategy: strategy.name,
      wallet: body.wallet_address,
      omega: validation.omega,
    });

    return NextResponse.json({
      success: true,
      watchlist_item: watchlistItem,
      validation,
    });
  } catch (error) {
    console.error('[TrackWallet] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate wallet has sufficient metrics for copy trading
 */
async function validateWalletMetrics(
  walletAddress: string,
  category?: string
): Promise<{
  has_metrics: boolean;
  omega?: number;
  resolved_bets?: number;
  meets_minimum: boolean;
}> {
  try {
    // Query wallet metrics from ClickHouse
    const query = category
      ? `
          SELECT
            metric_2_omega_net as omega,
            metric_22_resolved_bets as resolved_bets
          FROM wallet_metrics_by_category
          WHERE wallet_address = {wallet:String}
            AND category = {category:String}
            AND window = 'lifetime'
          LIMIT 1
        `
      : `
          SELECT
            metric_2_omega_net as omega,
            metric_22_resolved_bets as resolved_bets
          FROM wallet_metrics_complete
          WHERE wallet_address = {wallet:String}
            AND window = 'lifetime'
          LIMIT 1
        `;

    const result = await clickhouse.query({
      query,
      query_params: {
        wallet: walletAddress,
        ...(category && { category }),
      },
      format: 'JSONEachRow',
    });

    const data = (await result.json()) as any[];

    if (data.length === 0) {
      return {
        has_metrics: false,
        meets_minimum: false,
      };
    }

    const metrics = data[0];
    const omega = parseFloat(metrics.omega);
    const resolvedBets = parseInt(metrics.resolved_bets);

    return {
      has_metrics: resolvedBets >= 10,
      omega,
      resolved_bets: resolvedBets,
      meets_minimum: omega >= 1.0 && resolvedBets >= 10,
    };
  } catch (error) {
    console.error('[ValidateWallet] Error querying metrics:', error);
    return {
      has_metrics: false,
      meets_minimum: false,
    };
  }
}
