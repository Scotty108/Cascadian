import { NextResponse } from 'next/server';
import type { FlowData } from '@/components/whale-activity-interface/types';

// Mock data generator for whale flows (buy/sell volume over time)
// TODO: Replace with actual database queries aggregating whale trades in Phase 3+
function generateMockFlows(hours: number): FlowData[] {
  const flows: FlowData[] = [];
  const now = new Date();

  for (let i = hours - 1; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);

    // Generate semi-realistic volume data
    const baseVolume = 15000 + Math.random() * 10000;
    const buyBias = Math.sin(i / 12) * 0.3 + 0.5; // Oscillating buy/sell bias

    const buy_volume = baseVolume * buyBias * (0.8 + Math.random() * 0.4);
    const sell_volume = baseVolume * (1 - buyBias) * (0.8 + Math.random() * 0.4);

    flows.push({
      timestamp: timestamp.toISOString(),
      buy_volume: Math.round(buy_volume),
      sell_volume: Math.round(sell_volume),
      net_flow: Math.round(buy_volume - sell_volume),
      unique_buyers: Math.floor(5 + Math.random() * 15),
      unique_sellers: Math.floor(5 + Math.random() * 15),
    });
  }

  return flows;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const timeframe = searchParams.get('timeframe') || '24h';

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

    const flows = generateMockFlows(hours);

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
    });
  } catch (error) {
    console.error('Error fetching whale flows:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch whale flows' },
      { status: 500 }
    );
  }
}
