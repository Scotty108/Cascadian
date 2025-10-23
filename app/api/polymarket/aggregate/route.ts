/**
 * Polymarket Trade Aggregation API
 *
 * POST /api/polymarket/aggregate
 * - Triggers trade data aggregation from CLOB API
 * - Intended for cron job or manual trigger
 * - Protected by API key authentication
 *
 * GET /api/polymarket/aggregate
 * - Returns aggregation status and last run time
 * - Public endpoint for monitoring
 */

import { NextRequest, NextResponse } from 'next/server';
import { aggregateAllMarkets, getAnalyticsStaleness } from '@/lib/polymarket/trade-aggregator';
import { supabaseAdmin } from '@/lib/supabase';

// Vercel configuration
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for Vercel Pro

// =====================================================================
// POST: Trigger Aggregation
// =====================================================================

/**
 * Trigger trade data aggregation
 *
 * Protected endpoint - requires Bearer token
 * Use ADMIN_API_KEY or CRON_SECRET environment variable
 *
 * Example:
 * ```bash
 * curl -X POST https://yourdomain.com/api/polymarket/aggregate \
 *   -H "Authorization: Bearer YOUR_SECRET_KEY"
 * ```
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const authHeader = request.headers.get('authorization');
    const adminKey = process.env.ADMIN_API_KEY || process.env.CRON_SECRET;

    if (adminKey && (!authHeader || authHeader !== `Bearer ${adminKey}`)) {
      console.warn('[API] Unauthorized aggregation attempt');
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          message: 'Valid API key required'
        },
        { status: 401 }
      );
    }

    console.log('[API] Trade aggregation triggered');

    // Parse optional parameters
    const { searchParams } = new URL(request.url);
    const marketLimit = parseInt(searchParams.get('limit') || '100', 10);

    // Run aggregation
    const result = await aggregateAllMarkets(marketLimit);

    // Return success response with aggregation results
    return NextResponse.json({
      message: 'Trade aggregation completed',
      ...result,
    });

  } catch (error) {
    console.error('[API] Aggregation failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Aggregation failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// =====================================================================
// GET: Check Aggregation Status
// =====================================================================

/**
 * Get aggregation status and metadata
 *
 * Public endpoint - no authentication required
 *
 * Returns:
 * - Last aggregation timestamp
 * - Staleness (time since last update)
 * - Total markets with analytics
 * - Summary statistics
 *
 * Example:
 * ```bash
 * curl https://yourdomain.com/api/polymarket/aggregate
 * ```
 */
export async function GET() {
  try {
    // Get last aggregation timestamp
    const { data: lastAggregation, error: timestampError } = await supabaseAdmin
      .from('market_analytics')
      .select('last_aggregated_at')
      .order('last_aggregated_at', { ascending: false })
      .limit(1)
      .single();

    // Get total count
    const { count, error: countError } = await supabaseAdmin
      .from('market_analytics')
      .select('*', { count: 'exact', head: true });

    // Get summary statistics
    const { data: stats, error: statsError } = await supabaseAdmin
      .from('market_analytics')
      .select('trades_24h, buyers_24h, sellers_24h, buy_volume_24h, sell_volume_24h')
      .not('trades_24h', 'eq', 0);

    // Calculate aggregates
    const totalTrades = stats?.reduce((sum, s) => sum + s.trades_24h, 0) || 0;
    const totalBuyers = stats?.reduce((sum, s) => sum + s.buyers_24h, 0) || 0;
    const totalSellers = stats?.reduce((sum, s) => sum + s.sellers_24h, 0) || 0;
    const totalBuyVolume = stats?.reduce((sum, s) => sum + parseFloat(s.buy_volume_24h.toString()), 0) || 0;
    const totalSellVolume = stats?.reduce((sum, s) => sum + parseFloat(s.sell_volume_24h.toString()), 0) || 0;

    // Get staleness
    const staleness = await getAnalyticsStaleness();

    return NextResponse.json({
      success: true,
      last_aggregation: lastAggregation?.last_aggregated_at || null,
      staleness: staleness || 'unknown',
      total_markets: count || 0,
      active_markets: stats?.length || 0,
      summary: {
        total_trades_24h: totalTrades,
        total_buyers_24h: totalBuyers,
        total_sellers_24h: totalSellers,
        total_buy_volume_24h: parseFloat(totalBuyVolume.toFixed(2)),
        total_sell_volume_24h: parseFloat(totalSellVolume.toFixed(2)),
      }
    });

  } catch (error) {
    console.error('[API] Failed to get aggregation status:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get aggregation status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
