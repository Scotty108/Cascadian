import { NextResponse } from 'next/server';
import type { ConcentrationData } from '@/components/whale-activity-interface/types';

// Mock data generator for market concentration
// TODO: Replace with actual database queries calculating Herfindahl index in Phase 3+
function generateMockConcentration(): ConcentrationData[] {
  const data: ConcentrationData[] = [
    {
      market_id: '1',
      market_title: 'Will Trump win the 2024 election?',
      total_whale_volume: 485000,
      whale_share_pct: 68.5,
      unique_whales: 42,
      herfindahl_index: 0.12,
      top_wallet: {
        address: '0x1a2b3c',
        alias: 'WhaleTrader42',
        volume: 124000,
        share_pct: 25.6,
      },
      sentiment: 'BULLISH',
    },
    {
      market_id: '5',
      market_title: 'Will Ethereum reach $10k in 2025?',
      total_whale_volume: 390000,
      whale_share_pct: 72.3,
      unique_whales: 35,
      herfindahl_index: 0.18,
      top_wallet: {
        address: '0xjklmno',
        alias: 'SmartInvestor',
        volume: 98000,
        share_pct: 25.1,
      },
      sentiment: 'BULLISH',
    },
    {
      market_id: '2',
      market_title: 'Will Bitcoin reach $100k by end of 2024?',
      total_whale_volume: 324000,
      whale_share_pct: 65.2,
      unique_whales: 38,
      herfindahl_index: 0.15,
      top_wallet: {
        address: '0x4d5e6f',
        alias: 'ContraCaptain',
        volume: 87000,
        share_pct: 26.9,
      },
      sentiment: 'BEARISH',
    },
    {
      market_id: '8',
      market_title: 'Will S&P 500 reach 6000 by end of 2025?',
      total_whale_volume: 298000,
      whale_share_pct: 59.8,
      unique_whales: 31,
      herfindahl_index: 0.21,
      top_wallet: {
        address: '0x7g8h9i',
        alias: 'MomentumMaster',
        volume: 76000,
        share_pct: 25.5,
      },
      sentiment: 'BULLISH',
    },
    {
      market_id: '12',
      market_title: 'Will Apple release AR glasses in 2025?',
      total_whale_volume: 267000,
      whale_share_pct: 71.4,
      unique_whales: 29,
      herfindahl_index: 0.19,
      top_wallet: {
        address: '0xabcdef',
        alias: 'TheBullRun',
        volume: 64000,
        share_pct: 24.0,
      },
      sentiment: 'BULLISH',
    },
    {
      market_id: '15',
      market_title: 'Will Lakers win NBA Championship 2025?',
      total_whale_volume: 234000,
      whale_share_pct: 63.7,
      unique_whales: 26,
      herfindahl_index: 0.22,
      top_wallet: {
        address: '0x9z8y7x',
        alias: 'CryptoWhale88',
        volume: 58000,
        share_pct: 24.8,
      },
      sentiment: 'MIXED',
    },
    {
      market_id: '18',
      market_title: 'Will Fed cut rates in Q1 2025?',
      total_whale_volume: 198000,
      whale_share_pct: 56.2,
      unique_whales: 24,
      herfindahl_index: 0.28,
      top_wallet: {
        address: '0xfedcba',
        alias: 'MarketMover',
        volume: 51000,
        share_pct: 25.8,
      },
      sentiment: 'BULLISH',
    },
    {
      market_id: '22',
      market_title: 'Will OpenAI release GPT-5 in 2025?',
      total_whale_volume: 187000,
      whale_share_pct: 68.9,
      unique_whales: 22,
      herfindahl_index: 0.31,
      top_wallet: {
        address: '0x123abc',
        alias: 'ProfitSeeker',
        volume: 47000,
        share_pct: 25.1,
      },
      sentiment: 'BULLISH',
    },
    {
      market_id: '25',
      market_title: 'Will Tesla stock hit $500 in 2025?',
      total_whale_volume: 156000,
      whale_share_pct: 61.3,
      unique_whales: 19,
      herfindahl_index: 0.35,
      top_wallet: {
        address: '0x456def',
        alias: 'ValueHunter',
        volume: 42000,
        share_pct: 26.9,
      },
      sentiment: 'BEARISH',
    },
    {
      market_id: '28',
      market_title: 'Will inflation fall below 2% by end of 2025?',
      total_whale_volume: 142000,
      whale_share_pct: 54.8,
      unique_whales: 17,
      herfindahl_index: 0.38,
      top_wallet: {
        address: '0x789ghi',
        alias: 'TrendFollower',
        volume: 38000,
        share_pct: 26.8,
      },
      sentiment: 'MIXED',
    },
  ];

  return data;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20;
    const min_whale_share = searchParams.get('min_whale_share') ? parseFloat(searchParams.get('min_whale_share')!) : 0;
    const sentiment = searchParams.get('sentiment');
    const sort_by = searchParams.get('sort_by') || 'whale_share_pct'; // whale_share_pct, herfindahl_index, total_whale_volume

    let data = generateMockConcentration();

    // Apply filters
    if (min_whale_share > 0) {
      data = data.filter(d => d.whale_share_pct >= min_whale_share);
    }
    if (sentiment && sentiment !== 'all') {
      data = data.filter(d => d.sentiment === sentiment.toUpperCase());
    }

    // Sort
    switch (sort_by) {
      case 'herfindahl_index':
        data.sort((a, b) => b.herfindahl_index - a.herfindahl_index);
        break;
      case 'total_whale_volume':
        data.sort((a, b) => b.total_whale_volume - a.total_whale_volume);
        break;
      case 'whale_share_pct':
      default:
        data.sort((a, b) => b.whale_share_pct - a.whale_share_pct);
        break;
    }

    // Limit results
    data = data.slice(0, limit);

    return NextResponse.json({
      success: true,
      data,
      count: data.length,
      filters: {
        limit,
        min_whale_share,
        sentiment,
        sort_by,
      },
    });
  } catch (error) {
    console.error('Error fetching whale concentration:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch whale concentration' },
      { status: 500 }
    );
  }
}
