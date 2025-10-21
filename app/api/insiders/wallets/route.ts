import { NextResponse } from 'next/server';
import type { InsiderWallet } from '@/components/whale-activity-interface/types';

// Mock data generator for flagged insider wallets
// TODO: Replace with actual database queries using insider scoring in Phase 4+
function generateMockInsiderWallets(): InsiderWallet[] {
  const wallets: InsiderWallet[] = [
    {
      address: '0xsuspect1',
      alias: 'EarlyEdge',
      insider_score: 8.7,
      timing_score: 9.2,
      volume_score: 7.8,
      outcome_score: 8.9,
      cluster_score: 8.5,
      total_trades: 67,
      total_volume: 342000,
      win_rate: 0.82,
      avg_time_to_outcome_minutes: 45,
      investigation_status: 'flagged',
      flagged_date: '2025-10-18T10:00:00Z',
      last_activity: '2025-10-20T14:30:00Z',
    },
    {
      address: '0xsuspect2',
      alias: 'TimingMaster',
      insider_score: 8.3,
      timing_score: 9.5,
      volume_score: 6.9,
      outcome_score: 8.1,
      cluster_score: 7.8,
      total_trades: 54,
      total_volume: 287000,
      win_rate: 0.79,
      avg_time_to_outcome_minutes: 38,
      investigation_status: 'monitoring',
      flagged_date: '2025-10-17T08:15:00Z',
      last_activity: '2025-10-20T12:45:00Z',
    },
    {
      address: '0xsuspect3',
      alias: 'InfoArb',
      insider_score: 7.9,
      timing_score: 8.8,
      volume_score: 7.2,
      outcome_score: 7.6,
      cluster_score: 7.9,
      total_trades: 89,
      total_volume: 456000,
      win_rate: 0.76,
      avg_time_to_outcome_minutes: 52,
      investigation_status: 'flagged',
      flagged_date: '2025-10-16T14:20:00Z',
      last_activity: '2025-10-20T09:15:00Z',
    },
    {
      address: '0xsuspect4',
      alias: 'ClusterKing',
      insider_score: 7.5,
      timing_score: 7.2,
      volume_score: 7.8,
      outcome_score: 7.4,
      cluster_score: 8.9,
      total_trades: 102,
      total_volume: 524000,
      win_rate: 0.73,
      avg_time_to_outcome_minutes: 67,
      investigation_status: 'monitoring',
      flagged_date: '2025-10-15T11:30:00Z',
      last_activity: '2025-10-19T22:00:00Z',
    },
    {
      address: '0xsuspect5',
      alias: 'PreMoveTrader',
      insider_score: 7.2,
      timing_score: 8.4,
      volume_score: 6.5,
      outcome_score: 7.1,
      cluster_score: 6.8,
      total_trades: 43,
      total_volume: 198000,
      win_rate: 0.74,
      avg_time_to_outcome_minutes: 41,
      investigation_status: 'flagged',
      flagged_date: '2025-10-14T09:45:00Z',
      last_activity: '2025-10-19T18:30:00Z',
    },
    {
      address: '0xsuspect6',
      alias: 'NewsSniper',
      insider_score: 6.8,
      timing_score: 7.9,
      volume_score: 5.8,
      outcome_score: 6.9,
      cluster_score: 6.5,
      total_trades: 38,
      total_volume: 167000,
      win_rate: 0.71,
      avg_time_to_outcome_minutes: 35,
      investigation_status: 'cleared',
      flagged_date: '2025-10-12T13:00:00Z',
      last_activity: '2025-10-18T16:20:00Z',
    },
  ];

  return wallets;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const min_score = searchParams.get('min_score') ? parseFloat(searchParams.get('min_score')!) : 4.0;
    const status = searchParams.get('status');
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;

    let wallets = generateMockInsiderWallets();

    // Apply filters
    if (min_score > 0) {
      wallets = wallets.filter(w => w.insider_score >= min_score);
    }
    if (status && status !== 'all') {
      wallets = wallets.filter(w => w.investigation_status === status);
    }

    // Sort by insider score desc
    wallets.sort((a, b) => b.insider_score - a.insider_score);

    // Limit results
    wallets = wallets.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: wallets,
      count: wallets.length,
      filters: {
        min_score,
        status,
        limit,
      },
    });
  } catch (error) {
    console.error('Error fetching insider wallets:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch insider wallets' },
      { status: 500 }
    );
  }
}
