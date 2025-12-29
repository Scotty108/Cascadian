/**
 * Market Search API
 *
 * Proxies to Dome API /markets endpoint with filtering support.
 * Used by Strategy Builder MarketFilterNode and MarketUniverseNode.
 *
 * POST /api/markets/search
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listMarkets, type DomeMarketFilters } from '@/lib/dome';

// ============================================================================
// Request Schema
// ============================================================================

const searchSchema = z.object({
  market_slug: z.array(z.string()).optional(),
  event_slug: z.array(z.string()).optional(),
  condition_id: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['open', 'closed']).optional(),
  min_volume: z.number().optional(),
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  start_time: z.number().optional(),
  end_time: z.number().optional(),
});

export type MarketSearchRequest = z.infer<typeof searchSchema>;

// ============================================================================
// Response Types
// ============================================================================

export interface MarketSearchResponse {
  success: boolean;
  data?: {
    markets: Array<{
      market_slug: string;
      condition_id: string;
      title: string;
      status: 'open' | 'closed';
      event_slug?: string;
      tags?: string[];
      volume?: number;
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

export async function POST(request: Request): Promise<NextResponse<MarketSearchResponse>> {
  try {
    const body = await request.json();

    // Validate request
    const parseResult = searchSchema.safeParse(body);
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

    const filters: DomeMarketFilters = parseResult.data;

    // Call Dome API
    const result = await listMarkets(filters);

    if (!result.success || !result.data) {
      // Return mock data if Dome fails or API key missing (development mode)
      if (process.env.NODE_ENV === 'development' && !process.env.DOME_API_KEY) {
        return NextResponse.json({
          success: true,
          data: {
            markets: getMockMarkets(filters),
            pagination: {
              limit: filters.limit || 20,
              offset: filters.offset || 0,
              total: 100,
              has_more: true,
            },
          },
          source: 'mock' as const,
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to fetch markets from Dome',
          source: 'dome' as const,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        markets: result.data.markets.map(m => ({
          market_slug: m.market_slug,
          condition_id: m.condition_id,
          title: m.title,
          status: m.status,
          event_slug: m.event_slug,
          tags: m.tags,
          volume: m.volume,
        })),
        pagination: result.data.pagination,
      },
      source: 'dome' as const,
    });
  } catch (error: any) {
    console.error('[MarketSearch] Error:', error);
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

function getMockMarkets(filters: DomeMarketFilters): NonNullable<MarketSearchResponse['data']>['markets'] {
  const mockMarkets = [
    {
      market_slug: 'btc-100k-by-2025',
      condition_id: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      title: 'Will BTC reach $100k by end of 2025?',
      status: 'open' as const,
      event_slug: 'crypto-milestones',
      tags: ['crypto', 'bitcoin', 'price'],
      volume: 5000000,
    },
    {
      market_slug: 'eth-merge-success',
      condition_id: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      title: 'Will Ethereum complete the next upgrade successfully?',
      status: 'open' as const,
      event_slug: 'crypto-upgrades',
      tags: ['crypto', 'ethereum', 'technology'],
      volume: 2500000,
    },
    {
      market_slug: 'fed-rate-cut-jan-2025',
      condition_id: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
      title: 'Will the Fed cut rates in January 2025?',
      status: 'open' as const,
      event_slug: 'fed-decisions-2025',
      tags: ['economics', 'fed', 'interest-rates'],
      volume: 10000000,
    },
    {
      market_slug: 'superbowl-2025-winner',
      condition_id: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      title: 'Who will win Super Bowl 2025?',
      status: 'open' as const,
      event_slug: 'superbowl-2025',
      tags: ['sports', 'nfl', 'superbowl'],
      volume: 50000000,
    },
  ];

  let filtered = mockMarkets;

  if (filters.status) {
    filtered = filtered.filter(m => m.status === filters.status);
  }

  if (filters.tags?.length) {
    filtered = filtered.filter(m =>
      m.tags?.some(t => filters.tags?.includes(t))
    );
  }

  if (filters.min_volume) {
    filtered = filtered.filter(m => (m.volume || 0) >= filters.min_volume!);
  }

  return filtered.slice(filters.offset || 0, (filters.offset || 0) + (filters.limit || 20));
}
