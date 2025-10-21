import { NextResponse } from 'next/server';
import type { WhaleWallet } from '@/components/whale-activity-interface/types';

// Mock data generator for whale scoreboard
// TODO: Replace with actual database queries using SWS calculation in Phase 3+
function generateMockScoreboard(): WhaleWallet[] {
  const wallets: WhaleWallet[] = [
    {
      address: '0xjklmno',
      alias: 'SmartInvestor',
      total_volume: 485000,
      total_trades: 142,
      active_positions: 8,
      win_rate: 0.73,
      realized_pnl: 124500,
      realized_roi: 0.68,
      sws_score: 9.1,
      sws_reliability: 0.92,
      rank: 1,
      last_active: '2025-10-20T13:45:00Z',
    },
    {
      address: '0x1a2b3c',
      alias: 'WhaleTrader42',
      total_volume: 672000,
      total_trades: 198,
      active_positions: 12,
      win_rate: 0.69,
      realized_pnl: 178200,
      realized_roi: 0.56,
      sws_score: 8.5,
      sws_reliability: 0.95,
      rank: 2,
      last_active: '2025-10-20T14:32:00Z',
    },
    {
      address: '0xabcdef',
      alias: 'TheBullRun',
      total_volume: 423000,
      total_trades: 156,
      active_positions: 9,
      win_rate: 0.71,
      realized_pnl: 98600,
      realized_roi: 0.62,
      sws_score: 8.2,
      sws_reliability: 0.89,
      rank: 3,
      last_active: '2025-10-20T10:30:00Z',
    },
    {
      address: '0x9z8y7x',
      alias: 'CryptoWhale88',
      total_volume: 551000,
      total_trades: 187,
      active_positions: 11,
      win_rate: 0.66,
      realized_pnl: 142300,
      realized_roi: 0.54,
      sws_score: 7.9,
      sws_reliability: 0.93,
      rank: 4,
      last_active: '2025-10-20T08:30:00Z',
    },
    {
      address: '0x4d5e6f',
      alias: 'ContraCaptain',
      total_volume: 512000,
      total_trades: 165,
      active_positions: 10,
      win_rate: 0.64,
      realized_pnl: 115800,
      realized_roi: 0.48,
      sws_score: 7.2,
      sws_reliability: 0.88,
      rank: 5,
      last_active: '2025-10-20T14:15:00Z',
    },
    {
      address: '0x7g8h9i',
      alias: 'MomentumMaster',
      total_volume: 394000,
      total_trades: 134,
      active_positions: 7,
      win_rate: 0.61,
      realized_pnl: 78900,
      realized_roi: 0.42,
      sws_score: 6.8,
      sws_reliability: 0.85,
      rank: 6,
      last_active: '2025-10-20T12:20:00Z',
    },
    {
      address: '0xfedcba',
      alias: 'MarketMover',
      total_volume: 298000,
      total_trades: 98,
      active_positions: 6,
      win_rate: 0.63,
      realized_pnl: 56700,
      realized_roi: 0.44,
      sws_score: 6.5,
      sws_reliability: 0.78,
      rank: 7,
      last_active: '2025-10-19T22:15:00Z',
    },
    {
      address: '0x123abc',
      alias: 'ProfitSeeker',
      total_volume: 267000,
      total_trades: 112,
      active_positions: 5,
      win_rate: 0.59,
      realized_pnl: 42300,
      realized_roi: 0.38,
      sws_score: 6.2,
      sws_reliability: 0.82,
      rank: 8,
      last_active: '2025-10-19T20:00:00Z',
    },
    {
      address: '0x456def',
      alias: 'ValueHunter',
      total_volume: 234000,
      total_trades: 89,
      active_positions: 4,
      win_rate: 0.57,
      realized_pnl: 35100,
      realized_roi: 0.35,
      sws_score: 5.9,
      sws_reliability: 0.75,
      rank: 9,
      last_active: '2025-10-19T18:30:00Z',
    },
    {
      address: '0x789ghi',
      alias: 'TrendFollower',
      total_volume: 198000,
      total_trades: 76,
      active_positions: 3,
      win_rate: 0.55,
      realized_pnl: 28700,
      realized_roi: 0.32,
      sws_score: 5.6,
      sws_reliability: 0.71,
      rank: 10,
      last_active: '2025-10-19T16:45:00Z',
    },
  ];

  return wallets;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100;
    const min_sws = searchParams.get('min_sws') ? parseFloat(searchParams.get('min_sws')!) : 0;
    const min_trades = searchParams.get('min_trades') ? parseInt(searchParams.get('min_trades')!) : 0;

    let wallets = generateMockScoreboard();

    // Apply filters
    if (min_sws > 0) {
      wallets = wallets.filter(w => w.sws_score >= min_sws);
    }
    if (min_trades > 0) {
      wallets = wallets.filter(w => w.total_trades >= min_trades);
    }

    // Limit results
    wallets = wallets.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: wallets,
      count: wallets.length,
      filters: {
        limit,
        min_sws,
        min_trades,
      },
    });
  } catch (error) {
    console.error('Error fetching whale scoreboard:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch whale scoreboard' },
      { status: 500 }
    );
  }
}
