import { NextResponse } from 'next/server';
import type { PositionFlip } from '@/components/whale-activity-interface/types';

// Mock data generator for position flips
// TODO: Replace with actual database queries detecting flips in Phase 3+
function generateMockFlips(): PositionFlip[] {
  const flips: PositionFlip[] = [
    {
      flip_id: 'flip_1',
      wallet_address: '0xjklmno',
      wallet_alias: 'SmartInvestor',
      market_id: '2',
      market_title: 'Will Bitcoin reach $100k by end of 2024?',
      from_side: 'YES',
      to_side: 'NO',
      flip_date: '2025-10-19T22:15:00Z',
      prev_investment: 15000,
      new_investment: 22400,
      price_at_flip: 0.28,
      sws_score: 9.1,
    },
    {
      flip_id: 'flip_2',
      wallet_address: '0x1a2b3c',
      wallet_alias: 'WhaleTrader42',
      market_id: '5',
      market_title: 'Will Ethereum reach $10k in 2025?',
      from_side: 'YES',
      to_side: 'NO',
      flip_date: '2025-10-20T09:45:00Z',
      prev_investment: 28000,
      new_investment: 16800,
      price_at_flip: 0.28,
      sws_score: 8.5,
    },
    {
      flip_id: 'flip_3',
      wallet_address: '0x9z8y7x',
      wallet_alias: 'CryptoWhale88',
      market_id: '1',
      market_title: 'Will Trump win the 2024 election?',
      from_side: 'NO',
      to_side: 'YES',
      flip_date: '2025-10-18T16:30:00Z',
      prev_investment: 18500,
      new_investment: 32000,
      price_at_flip: 0.64,
      sws_score: 7.9,
    },
    {
      flip_id: 'flip_4',
      wallet_address: '0x4d5e6f',
      wallet_alias: 'ContraCaptain',
      market_id: '8',
      market_title: 'Will S&P 500 reach 6000 by end of 2025?',
      from_side: 'NO',
      to_side: 'YES',
      flip_date: '2025-10-17T14:20:00Z',
      prev_investment: 12000,
      new_investment: 21000,
      price_at_flip: 0.60,
      sws_score: 7.2,
    },
    {
      flip_id: 'flip_5',
      wallet_address: '0xabcdef',
      wallet_alias: 'TheBullRun',
      market_id: '12',
      market_title: 'Will Apple release AR glasses in 2025?',
      from_side: 'NO',
      to_side: 'YES',
      flip_date: '2025-10-16T11:45:00Z',
      prev_investment: 8500,
      new_investment: 19000,
      price_at_flip: 0.54,
      sws_score: 8.2,
    },
    {
      flip_id: 'flip_6',
      wallet_address: '0xfedcba',
      wallet_alias: 'MarketMover',
      market_id: '15',
      market_title: 'Will Lakers win NBA Championship 2025?',
      from_side: 'YES',
      to_side: 'NO',
      flip_date: '2025-10-15T09:30:00Z',
      prev_investment: 14000,
      new_investment: 18500,
      price_at_flip: 0.37,
      sws_score: 6.5,
    },
    {
      flip_id: 'flip_7',
      wallet_address: '0x123abc',
      wallet_alias: 'ProfitSeeker',
      market_id: '18',
      market_title: 'Will Fed cut rates in Q1 2025?',
      from_side: 'NO',
      to_side: 'YES',
      flip_date: '2025-10-14T15:10:00Z',
      prev_investment: 9800,
      new_investment: 15200,
      price_at_flip: 0.68,
      sws_score: 6.2,
    },
    {
      flip_id: 'flip_8',
      wallet_address: '0x456def',
      wallet_alias: 'ValueHunter',
      market_id: '22',
      market_title: 'Will OpenAI release GPT-5 in 2025?',
      from_side: 'YES',
      to_side: 'NO',
      flip_date: '2025-10-13T12:00:00Z',
      prev_investment: 11000,
      new_investment: 13800,
      price_at_flip: 0.46,
      sws_score: 5.9,
    },
  ];

  return flips;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const timeframe = searchParams.get('timeframe') || '30d';
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;
    const min_sws = searchParams.get('min_sws') ? parseFloat(searchParams.get('min_sws')!) : 0;
    const wallet = searchParams.get('wallet');

    let flips = generateMockFlips();

    // Apply filters
    if (wallet) {
      flips = flips.filter(f => f.wallet_address === wallet);
    }
    if (min_sws > 0) {
      flips = flips.filter(f => (f.sws_score || 0) >= min_sws);
    }

    // Apply timeframe filter
    if (timeframe !== 'all') {
      const now = new Date();
      let cutoffDate: Date;

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
        default:
          cutoffDate = new Date(0);
      }

      flips = flips.filter(f => new Date(f.flip_date) >= cutoffDate);
    }

    // Sort by date desc (most recent first)
    flips.sort((a, b) => new Date(b.flip_date).getTime() - new Date(a.flip_date).getTime());

    // Limit results
    flips = flips.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: flips,
      count: flips.length,
      filters: {
        timeframe,
        limit,
        min_sws,
        wallet,
      },
    });
  } catch (error) {
    console.error('Error fetching position flips:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch position flips' },
      { status: 500 }
    );
  }
}
