import { NextResponse } from 'next/server';
import type { WhalePosition } from '@/components/whale-activity-interface/types';

// Mock data generator for whale positions
// TODO: Replace with actual database queries in Phase 2+
function generateMockPositions(): WhalePosition[] {
  const positions: WhalePosition[] = [
    {
      position_id: 'pos_1',
      wallet_address: '0x1a2b3c',
      wallet_alias: 'WhaleTrader42',
      market_id: '1',
      market_title: 'Will Trump win the 2024 election?',
      category: 'Politics',
      side: 'YES',
      shares: 120000,
      avg_entry_price: 0.55,
      current_price: 0.63,
      invested_usd: 66000,
      current_value_usd: 75600,
      unrealized_pnl: 9600,
      unrealized_pnl_pct: 14.55,
      first_trade_date: '2025-09-10T10:00:00Z',
      last_trade_date: '2025-10-20T14:32:00Z',
      total_trades: 8,
      sws_score: 8.5,
    },
    {
      position_id: 'pos_2',
      wallet_address: '0x4d5e6f',
      wallet_alias: 'ContraCaptain',
      market_id: '2',
      market_title: 'Will Bitcoin reach $100k by end of 2024?',
      category: 'Crypto',
      side: 'NO',
      shares: 200000,
      avg_entry_price: 0.38,
      current_price: 0.72,
      invested_usd: 76000,
      current_value_usd: 144000,
      unrealized_pnl: 68000,
      unrealized_pnl_pct: 89.47,
      first_trade_date: '2025-08-15T12:00:00Z',
      last_trade_date: '2025-10-20T14:15:00Z',
      total_trades: 12,
      sws_score: 7.2,
    },
    {
      position_id: 'pos_3',
      wallet_address: '0xjklmno',
      wallet_alias: 'SmartInvestor',
      market_id: '5',
      market_title: 'Will Ethereum reach $10k in 2025?',
      category: 'Crypto',
      side: 'YES',
      shares: 150000,
      avg_entry_price: 0.48,
      current_price: 0.72,
      invested_usd: 72000,
      current_value_usd: 108000,
      unrealized_pnl: 36000,
      unrealized_pnl_pct: 50.0,
      first_trade_date: '2025-09-01T09:30:00Z',
      last_trade_date: '2025-10-20T12:20:00Z',
      total_trades: 6,
      sws_score: 9.1,
    },
    {
      position_id: 'pos_4',
      wallet_address: '0x7g8h9i',
      wallet_alias: 'MomentumMaster',
      market_id: '8',
      market_title: 'Will S&P 500 reach 6000 by end of 2025?',
      category: 'Finance',
      side: 'YES',
      shares: 85000,
      avg_entry_price: 0.60,
      current_price: 0.58,
      invested_usd: 51000,
      current_value_usd: 49300,
      unrealized_pnl: -1700,
      unrealized_pnl_pct: -3.33,
      first_trade_date: '2025-10-01T11:00:00Z',
      last_trade_date: '2025-10-18T16:45:00Z',
      total_trades: 4,
      sws_score: 6.8,
    },
    {
      position_id: 'pos_5',
      wallet_address: '0xabcdef',
      wallet_alias: 'TheBullRun',
      market_id: '12',
      market_title: 'Will Apple release AR glasses in 2025?',
      category: 'Tech',
      side: 'YES',
      shares: 95000,
      avg_entry_price: 0.42,
      current_price: 0.65,
      invested_usd: 39900,
      current_value_usd: 61750,
      unrealized_pnl: 21850,
      unrealized_pnl_pct: 54.76,
      first_trade_date: '2025-07-20T14:00:00Z',
      last_trade_date: '2025-10-15T10:30:00Z',
      total_trades: 9,
      sws_score: 8.2,
    },
    {
      position_id: 'pos_6',
      wallet_address: '0x9z8y7x',
      wallet_alias: 'CryptoWhale88',
      market_id: '15',
      market_title: 'Will Lakers win NBA Championship 2025?',
      category: 'Sports',
      side: 'NO',
      shares: 110000,
      avg_entry_price: 0.65,
      current_price: 0.82,
      invested_usd: 71500,
      current_value_usd: 90200,
      unrealized_pnl: 18700,
      unrealized_pnl_pct: 26.15,
      first_trade_date: '2025-09-25T08:15:00Z',
      last_trade_date: '2025-10-19T20:00:00Z',
      total_trades: 5,
      sws_score: 7.9,
    },
  ];

  return positions;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const timeframe = searchParams.get('timeframe') || 'all';
    const min_amount = searchParams.get('min_amount') ? parseFloat(searchParams.get('min_amount')!) : undefined;
    const max_amount = searchParams.get('max_amount') ? parseFloat(searchParams.get('max_amount')!) : undefined;
    const category = searchParams.get('category');
    const wallet = searchParams.get('wallet');
    const min_sws = searchParams.get('min_sws') ? parseFloat(searchParams.get('min_sws')!) : undefined;

    let positions = generateMockPositions();

    // Apply filters
    if (min_amount !== undefined) {
      positions = positions.filter(p => p.invested_usd >= min_amount);
    }
    if (max_amount !== undefined) {
      positions = positions.filter(p => p.invested_usd <= max_amount);
    }
    if (category) {
      positions = positions.filter(p => p.category === category);
    }
    if (wallet) {
      positions = positions.filter(p => p.wallet_address === wallet);
    }
    if (min_sws !== undefined && min_sws > 0) {
      positions = positions.filter(p => (p.sws_score || 0) >= min_sws);
    }

    // Apply timeframe filter based on last_trade_date
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

      positions = positions.filter(p => new Date(p.last_trade_date) >= cutoffDate);
    }

    return NextResponse.json({
      success: true,
      data: positions,
      count: positions.length,
      filters: {
        timeframe,
        min_amount,
        max_amount,
        category,
        wallet,
        min_sws,
      },
    });
  } catch (error) {
    console.error('Error fetching whale positions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch whale positions' },
      { status: 500 }
    );
  }
}
