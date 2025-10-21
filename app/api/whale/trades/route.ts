import { NextResponse } from 'next/server';
import type { WhaleTrade } from '@/components/whale-activity-interface/types';

// Mock data generator for whale trades
// TODO: Replace with actual database queries in Phase 2+
function generateMockTrades(): WhaleTrade[] {
  const trades: WhaleTrade[] = [
    {
      trade_id: 'trade_1',
      wallet_address: '0x1a2b3c',
      wallet_alias: 'WhaleTrader42',
      market_id: '1',
      market_title: 'Will Trump win the 2024 election?',
      category: 'Politics',
      side: 'YES',
      action: 'BUY',
      shares: 50000,
      price: 0.63,
      amount_usd: 31500,
      timestamp: '2025-10-20T14:32:00Z',
      sws_score: 8.5,
    },
    {
      trade_id: 'trade_2',
      wallet_address: '0x4d5e6f',
      wallet_alias: 'ContraCaptain',
      market_id: '2',
      market_title: 'Will Bitcoin reach $100k by end of 2024?',
      category: 'Crypto',
      side: 'NO',
      action: 'BUY',
      shares: 75000,
      price: 0.72,
      amount_usd: 54000,
      timestamp: '2025-10-20T14:15:00Z',
      sws_score: 7.2,
    },
    {
      trade_id: 'trade_3',
      wallet_address: '0xjklmno',
      wallet_alias: 'SmartInvestor',
      market_id: '1',
      market_title: 'Will Trump win the 2024 election?',
      category: 'Politics',
      side: 'YES',
      action: 'SELL',
      shares: 30000,
      price: 0.64,
      amount_usd: 19200,
      timestamp: '2025-10-20T13:45:00Z',
      sws_score: 9.1,
    },
    {
      trade_id: 'trade_4',
      wallet_address: '0x7g8h9i',
      wallet_alias: 'MomentumMaster',
      market_id: '5',
      market_title: 'Will Ethereum reach $10k in 2025?',
      category: 'Crypto',
      side: 'YES',
      action: 'BUY',
      shares: 100000,
      price: 0.72,
      amount_usd: 72000,
      timestamp: '2025-10-20T12:20:00Z',
      sws_score: 6.8,
      is_unusual: true,
      unusual_reasons: ['Volume 3.2x above 30-day average', 'Price impact >5%'],
    },
    {
      trade_id: 'trade_5',
      wallet_address: '0xabcdef',
      wallet_alias: 'TheBullRun',
      market_id: '8',
      market_title: 'Will S&P 500 reach 6000 by end of 2025?',
      category: 'Finance',
      side: 'YES',
      action: 'BUY',
      shares: 45000,
      price: 0.58,
      amount_usd: 26100,
      timestamp: '2025-10-20T11:30:00Z',
      sws_score: 8.2,
    },
    {
      trade_id: 'trade_6',
      wallet_address: '0x9z8y7x',
      wallet_alias: 'CryptoWhale88',
      market_id: '12',
      market_title: 'Will Apple release AR glasses in 2025?',
      category: 'Tech',
      side: 'YES',
      action: 'BUY',
      shares: 35000,
      price: 0.65,
      amount_usd: 22750,
      timestamp: '2025-10-20T10:15:00Z',
      sws_score: 7.9,
    },
    {
      trade_id: 'trade_7',
      wallet_address: '0x1a2b3c',
      wallet_alias: 'WhaleTrader42',
      market_id: '5',
      market_title: 'Will Ethereum reach $10k in 2025?',
      category: 'Crypto',
      side: 'NO',
      action: 'SELL',
      shares: 60000,
      price: 0.28,
      amount_usd: 16800,
      timestamp: '2025-10-20T09:45:00Z',
      sws_score: 8.5,
    },
    {
      trade_id: 'trade_8',
      wallet_address: '0x4d5e6f',
      wallet_alias: 'ContraCaptain',
      market_id: '15',
      market_title: 'Will Lakers win NBA Championship 2025?',
      category: 'Sports',
      side: 'NO',
      action: 'BUY',
      shares: 55000,
      price: 0.82,
      amount_usd: 45100,
      timestamp: '2025-10-20T08:30:00Z',
      sws_score: 7.2,
    },
    {
      trade_id: 'trade_9',
      wallet_address: '0xjklmno',
      wallet_alias: 'SmartInvestor',
      market_id: '2',
      market_title: 'Will Bitcoin reach $100k by end of 2024?',
      category: 'Crypto',
      side: 'YES',
      action: 'BUY',
      shares: 80000,
      price: 0.28,
      amount_usd: 22400,
      timestamp: '2025-10-19T22:15:00Z',
      sws_score: 9.1,
      is_unusual: true,
      unusual_reasons: ['Wallet previously held opposite position', 'Large position flip'],
    },
    {
      trade_id: 'trade_10',
      wallet_address: '0x7g8h9i',
      wallet_alias: 'MomentumMaster',
      market_id: '8',
      market_title: 'Will S&P 500 reach 6000 by end of 2025?',
      category: 'Finance',
      side: 'YES',
      action: 'BUY',
      shares: 40000,
      price: 0.60,
      amount_usd: 24000,
      timestamp: '2025-10-19T20:00:00Z',
      sws_score: 6.8,
    },
    {
      trade_id: 'trade_11',
      wallet_address: '0xabcdef',
      wallet_alias: 'TheBullRun',
      market_id: '12',
      market_title: 'Will Apple release AR glasses in 2025?',
      category: 'Tech',
      side: 'YES',
      action: 'SELL',
      shares: 25000,
      price: 0.68,
      amount_usd: 17000,
      timestamp: '2025-10-19T18:30:00Z',
      sws_score: 8.2,
    },
    {
      trade_id: 'trade_12',
      wallet_address: '0x9z8y7x',
      wallet_alias: 'CryptoWhale88',
      market_id: '1',
      market_title: 'Will Trump win the 2024 election?',
      category: 'Politics',
      side: 'NO',
      action: 'BUY',
      shares: 95000,
      price: 0.37,
      amount_usd: 35150,
      timestamp: '2025-10-19T16:45:00Z',
      sws_score: 7.9,
      is_unusual: true,
      unusual_reasons: ['Timing within 2 hours of major news event', 'Volume spike'],
    },
  ];

  return trades;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const timeframe = searchParams.get('timeframe') || '24h';
    const min_amount = searchParams.get('min_amount') ? parseFloat(searchParams.get('min_amount')!) : undefined;
    const max_amount = searchParams.get('max_amount') ? parseFloat(searchParams.get('max_amount')!) : undefined;
    const category = searchParams.get('category');
    const wallet = searchParams.get('wallet');
    const action = searchParams.get('action');
    const side = searchParams.get('side');
    const min_sws = searchParams.get('min_sws') ? parseFloat(searchParams.get('min_sws')!) : undefined;
    const only_unusual = searchParams.get('only_unusual') === 'true';

    let trades = generateMockTrades();

    // Apply filters
    if (min_amount !== undefined) {
      trades = trades.filter(t => t.amount_usd >= min_amount);
    }
    if (max_amount !== undefined) {
      trades = trades.filter(t => t.amount_usd <= max_amount);
    }
    if (category) {
      trades = trades.filter(t => t.category === category);
    }
    if (wallet) {
      trades = trades.filter(t => t.wallet_address === wallet);
    }
    if (action && action !== 'all') {
      trades = trades.filter(t => t.action === action);
    }
    if (side && side !== 'all') {
      trades = trades.filter(t => t.side === side);
    }
    if (min_sws !== undefined && min_sws > 0) {
      trades = trades.filter(t => (t.sws_score || 0) >= min_sws);
    }
    if (only_unusual) {
      trades = trades.filter(t => t.is_unusual === true);
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

      trades = trades.filter(t => new Date(t.timestamp) >= cutoffDate);
    }

    // Sort by timestamp desc (most recent first)
    trades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({
      success: true,
      data: trades,
      count: trades.length,
      filters: {
        timeframe,
        min_amount,
        max_amount,
        category,
        wallet,
        action,
        side,
        min_sws,
        only_unusual,
      },
    });
  } catch (error) {
    console.error('Error fetching whale trades:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch whale trades' },
      { status: 500 }
    );
  }
}
