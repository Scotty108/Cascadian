import { NextResponse } from 'next/server';
import type { InsiderMarket } from '@/components/whale-activity-interface/types';

// Mock data generator for markets with insider activity
// TODO: Replace with actual database queries in Phase 4+
function generateMockInsiderMarkets(): InsiderMarket[] {
  const markets: InsiderMarket[] = [
    {
      market_id: '1',
      market_title: 'Will Trump win the 2024 election?',
      insider_activity_score: 7.8,
      suspicious_wallets: 12,
      unusual_timing_count: 8,
      unusual_volume_count: 5,
      cluster_involvement: 3,
      investigation_priority: 'high',
    },
    {
      market_id: '25',
      market_title: 'Will Tesla stock hit $500 in 2025?',
      insider_activity_score: 7.2,
      suspicious_wallets: 9,
      unusual_timing_count: 11,
      unusual_volume_count: 6,
      cluster_involvement: 2,
      investigation_priority: 'high',
    },
    {
      market_id: '18',
      market_title: 'Will Fed cut rates in Q1 2025?',
      insider_activity_score: 6.9,
      suspicious_wallets: 7,
      unusual_timing_count: 14,
      unusual_volume_count: 4,
      cluster_involvement: 1,
      investigation_priority: 'medium',
    },
    {
      market_id: '12',
      market_title: 'Will Apple release AR glasses in 2025?',
      insider_activity_score: 6.5,
      suspicious_wallets: 8,
      unusual_timing_count: 6,
      unusual_volume_count: 7,
      cluster_involvement: 2,
      investigation_priority: 'medium',
    },
    {
      market_id: '22',
      market_title: 'Will OpenAI release GPT-5 in 2025?',
      insider_activity_score: 6.1,
      suspicious_wallets: 6,
      unusual_timing_count: 9,
      unusual_volume_count: 3,
      cluster_involvement: 1,
      investigation_priority: 'medium',
    },
    {
      market_id: '5',
      market_title: 'Will Ethereum reach $10k in 2025?',
      insider_activity_score: 5.8,
      suspicious_wallets: 5,
      unusual_timing_count: 4,
      unusual_volume_count: 5,
      cluster_involvement: 0,
      investigation_priority: 'low',
    },
  ];

  return markets;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const min_score = searchParams.get('min_score') ? parseFloat(searchParams.get('min_score')!) : 0;
    const priority = searchParams.get('priority');
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20;

    let markets = generateMockInsiderMarkets();

    // Apply filters
    if (min_score > 0) {
      markets = markets.filter(m => m.insider_activity_score >= min_score);
    }
    if (priority && priority !== 'all') {
      markets = markets.filter(m => m.investigation_priority === priority);
    }

    // Sort by insider activity score desc
    markets.sort((a, b) => b.insider_activity_score - a.insider_activity_score);

    // Limit results
    markets = markets.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: markets,
      count: markets.length,
      filters: {
        min_score,
        priority,
        limit,
      },
    });
  } catch (error) {
    console.error('Error fetching insider markets:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch insider markets' },
      { status: 500 }
    );
  }
}
