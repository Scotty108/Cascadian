/**
 * Market Price API
 *
 * Proxies to Dome API /market-price endpoint for current or historical price.
 * Used by Strategy Builder MarketMonitorNode for lightweight price checks.
 *
 * GET /api/markets/price?token_id=...&at_time=...
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getMarketPrice } from '@/lib/dome';

// ============================================================================
// Request Schema
// ============================================================================

const priceSchema = z.object({
  token_id: z.string().min(1),
  at_time: z.string().optional().transform(v => v ? parseInt(v) : undefined),
});

// ============================================================================
// Response Types
// ============================================================================

export interface PriceResponse {
  success: boolean;
  data?: {
    price: number;
    at_time: number;
    token_id: string;
  };
  error?: string;
  source: 'dome' | 'mock';
}

// ============================================================================
// Handler
// ============================================================================

export async function GET(request: Request): Promise<NextResponse<PriceResponse>> {
  try {
    const { searchParams } = new URL(request.url);

    // Validate request
    const parseResult = priceSchema.safeParse({
      token_id: searchParams.get('token_id'),
      at_time: searchParams.get('at_time'),
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

    const { token_id, at_time } = parseResult.data;

    // Call Dome API
    const result = await getMarketPrice(token_id, at_time);

    if (!result.success || !result.data) {
      // Return mock data if Dome fails (development mode)
      if (process.env.NODE_ENV === 'development' && !process.env.DOME_API_KEY) {
        const mockPrice = 0.3 + Math.random() * 0.4;
        return NextResponse.json({
          success: true,
          data: {
            price: parseFloat(mockPrice.toFixed(4)),
            at_time: at_time || Math.floor(Date.now() / 1000),
            token_id,
          },
          source: 'mock' as const,
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to fetch price from Dome',
          source: 'dome' as const,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        price: result.data.price,
        at_time: result.data.at_time,
        token_id,
      },
      source: 'dome' as const,
    });
  } catch (error: any) {
    console.error('[MarketPrice] Error:', error);
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
