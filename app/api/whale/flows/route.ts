/**
 * Whale Capital Flows API
 *
 * Returns aggregated buy/sell volume from whale wallets over time.
 * Shows net flow (buy volume - sell volume) to identify capital movement.
 *
 * Data source: wallet_trades table (filtered for whales)
 * Update frequency: Real-time (calculated from recent trades)
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
    const timeframe = searchParams.get('timeframe') || '24h';

    // Calculate time range
    let hours = 24;
    switch (timeframe) {
      case '24h':
        hours = 24;
        break;
      case '7d':
        hours = 24 * 7;
        break;
      case '30d':
        hours = 24 * 30;
        break;
      default:
        hours = 24;
    }

    const cutoffDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Query whale trades grouped by hour
    const { data: trades, error } = await supabase
      .from('wallet_trades')
      .select(`
        *,
        wallets!inner(is_whale)
      `)
      .eq('wallets.is_whale', true)
      .gte('executed_at', cutoffDate.toISOString())
      .order('executed_at', { ascending: true });

    if (error) {
      console.error('[Whale Flows API] Database error:', error);
      throw error;
    }

    // Group trades by hour
    const flowMap = new Map();

    for (const trade of trades || []) {
      // Round to hour
      const timestamp = new Date(trade.executed_at);
      timestamp.setMinutes(0, 0, 0);
      const hourKey = timestamp.toISOString();

      if (!flowMap.has(hourKey)) {
        flowMap.set(hourKey, {
          timestamp: hourKey,
          buy_volume: 0,
          sell_volume: 0,
          buyers: new Set(),
          sellers: new Set(),
        });
      }

      const flow = flowMap.get(hourKey);

      if (trade.side === 'BUY') {
        flow.buy_volume += parseFloat(trade.amount_usd) || 0;
        flow.buyers.add(trade.wallet_address);
      } else if (trade.side === 'SELL') {
        flow.sell_volume += parseFloat(trade.amount_usd) || 0;
        flow.sellers.add(trade.wallet_address);
      }
    }

    // Convert to array and format
    const flows = Array.from(flowMap.values()).map(flow => ({
      timestamp: flow.timestamp,
      buy_volume: Math.round(flow.buy_volume),
      sell_volume: Math.round(flow.sell_volume),
      net_flow: Math.round(flow.buy_volume - flow.sell_volume),
      unique_buyers: flow.buyers.size,
      unique_sellers: flow.sellers.size,
    }));

    // Calculate aggregates
    const totalBuyVolume = flows.reduce((sum, f) => sum + f.buy_volume, 0);
    const totalSellVolume = flows.reduce((sum, f) => sum + f.sell_volume, 0);
    const netFlow = totalBuyVolume - totalSellVolume;

    return NextResponse.json({
      success: true,
      data: flows,
      count: flows.length,
      aggregates: {
        total_buy_volume: totalBuyVolume,
        total_sell_volume: totalSellVolume,
        net_flow: netFlow,
        sentiment: netFlow > 0 ? 'BULLISH' : 'BEARISH',
      },
      filters: {
        timeframe,
      },
      note: flows.length === 0
        ? 'No whale flow data found. Data will be available once wallet trades are synced from Polymarket Data-API.'
        : undefined,
    });
  } catch (error) {
    console.error('[Whale Flows API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch whale flows',
        data: [],
        count: 0,
        aggregates: {
          total_buy_volume: 0,
          total_sell_volume: 0,
          net_flow: 0,
          sentiment: 'NEUTRAL',
        },
        note: 'Database query failed. Ensure wallet_trades table is populated with whale trade data.'
      },
      { status: 500 }
    );
  }
}
