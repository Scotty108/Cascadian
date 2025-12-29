/**
 * Market Trades API
 *
 * Proxies to Dome API /orders endpoint for trade history.
 * Used for audit views and strategy outcome analysis.
 *
 * GET /api/markets/trades?market_slug=...&user=...&limit=...
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTradeHistory, type DomeTradeFilters } from '@/lib/dome';

// ============================================================================
// Request Schema
// ============================================================================

const tradesSchema = z.object({
  market_slug: z.string().optional(),
  condition_id: z.string().optional(),
  token_id: z.string().optional(),
  user: z.string().optional(),
  start_time: z.string().optional().transform(v => v ? parseInt(v) : undefined),
  end_time: z.string().optional().transform(v => v ? parseInt(v) : undefined),
  limit: z.string().optional().transform(v => v ? Math.min(parseInt(v), 1000) : 100),
  offset: z.string().optional().transform(v => v ? parseInt(v) : 0),
});

// ============================================================================
// Response Types
// ============================================================================

export interface TradesResponse {
  success: boolean;
  data?: {
    trades: Array<{
      token_id: string;
      token_label: string;
      side: 'BUY' | 'SELL';
      market_slug: string;
      condition_id: string;
      shares: number;
      shares_normalized: number;
      price: number;
      timestamp: number;
      user?: string;
      tx_hash?: string;
    }>;
    pagination: {
      limit: number;
      offset: number;
      total: number;
      has_more: boolean;
    };
  };
  error?: string;
  source: 'dome' | 'mock';
}

// ============================================================================
// Handler
// ============================================================================

export async function GET(request: Request): Promise<NextResponse<TradesResponse>> {
  try {
    const { searchParams } = new URL(request.url);

    // Validate request
    const parseResult = tradesSchema.safeParse({
      market_slug: searchParams.get('market_slug'),
      condition_id: searchParams.get('condition_id'),
      token_id: searchParams.get('token_id'),
      user: searchParams.get('user'),
      start_time: searchParams.get('start_time'),
      end_time: searchParams.get('end_time'),
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    });

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid request: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
          source: 'dome' as const,
        },
        { status: 400 }
      );
    }

    const filters: DomeTradeFilters = parseResult.data;

    // Call Dome API
    const result = await getTradeHistory(filters);

    if (!result.success || !result.data) {
      // Return mock data if Dome fails (development mode)
      if (process.env.NODE_ENV === 'development' && !process.env.DOME_API_KEY) {
        return NextResponse.json({
          success: true,
          data: {
            trades: getMockTrades(filters),
            pagination: {
              limit: filters.limit || 100,
              offset: filters.offset || 0,
              total: 500,
              has_more: true,
            },
          },
          source: 'mock' as const,
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to fetch trades from Dome',
          source: 'dome' as const,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        trades: result.data.orders.map(o => ({
          token_id: o.token_id,
          token_label: o.token_label,
          side: o.side,
          market_slug: o.market_slug,
          condition_id: o.condition_id,
          shares: o.shares,
          shares_normalized: o.shares_normalized,
          price: o.price,
          timestamp: o.timestamp,
          user: o.user,
          tx_hash: o.tx_hash,
        })),
        pagination: result.data.pagination,
      },
      source: 'dome' as const,
    });
  } catch (error: any) {
    console.error('[MarketTrades] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error',
        source: 'dome' as const,
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// Mock Data (for development without API key)
// ============================================================================

function getMockTrades(filters: DomeTradeFilters): NonNullable<TradesResponse['data']>['trades'] {
  const now = Math.floor(Date.now() / 1000);
  const mockTrades: NonNullable<TradesResponse['data']>['trades'] = [];

  for (let i = 0; i < (filters.limit || 10); i++) {
    mockTrades.push({
      token_id: `mock_token_${i}`,
      token_label: Math.random() > 0.5 ? 'Yes' : 'No',
      side: Math.random() > 0.5 ? 'BUY' : 'SELL',
      market_slug: filters.market_slug || 'mock-market',
      condition_id: filters.condition_id || '0xmockCondition',
      shares: Math.floor(Math.random() * 100000),
      shares_normalized: parseFloat((Math.random() * 100).toFixed(2)),
      price: parseFloat((0.3 + Math.random() * 0.4).toFixed(4)),
      timestamp: now - i * 3600,
      user: filters.user || `0xmockUser${i}`,
      tx_hash: `0xmockTx${i}`,
    });
  }

  return mockTrades;
}
