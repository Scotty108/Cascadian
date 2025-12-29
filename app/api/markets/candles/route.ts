/**
 * Market Candles API
 *
 * Proxies to Dome API /candlesticks endpoint for historical OHLC data.
 * Used by Strategy Builder MarketMonitorNode and ProjectionNode.
 *
 * GET /api/markets/candles?condition_id=...&interval=...&start_time=...&end_time=...
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCandles, flattenCandles, calculateCandleStats, type CandleInterval } from '@/lib/dome';

// ============================================================================
// Request Schema
// ============================================================================

const candlesSchema = z.object({
  condition_id: z.string().min(1),
  interval: z.enum(['1', '60', '1440']).transform(v => parseInt(v) as CandleInterval),
  start_time: z.string().transform(v => parseInt(v)),
  end_time: z.string().transform(v => parseInt(v)),
});

// ============================================================================
// Response Types
// ============================================================================

export interface CandlesResponse {
  success: boolean;
  data?: {
    candles: Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume?: number;
    }>;
    stats: {
      trendSlope: number;
      recentVolatility: number;
      priceChange: number;
      priceChangePercent: number;
    };
    conditionId: string;
    interval: CandleInterval;
  };
  error?: string;
  source: 'dome' | 'mock';
}

// ============================================================================
// Handler
// ============================================================================

export async function GET(request: Request): Promise<NextResponse<CandlesResponse>> {
  try {
    const { searchParams } = new URL(request.url);

    // Validate request
    const parseResult = candlesSchema.safeParse({
      condition_id: searchParams.get('condition_id'),
      interval: searchParams.get('interval') || '60',
      start_time: searchParams.get('start_time'),
      end_time: searchParams.get('end_time'),
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

    const { condition_id, interval, start_time, end_time } = parseResult.data;

    // Call Dome API
    const result = await getCandles(condition_id, interval, start_time, end_time);

    if (!result.success || !result.data) {
      // Return mock data if Dome fails (development mode)
      if (process.env.NODE_ENV === 'development' && !process.env.DOME_API_KEY) {
        const mockCandles = getMockCandles(start_time, end_time, interval);
        return NextResponse.json({
          success: true,
          data: {
            candles: mockCandles,
            stats: calculateStatsFromMock(mockCandles),
            conditionId: condition_id,
            interval,
          },
          source: 'mock' as const,
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to fetch candles from Dome',
          source: 'dome' as const,
        },
        { status: 500 }
      );
    }

    // Flatten and calculate stats
    const candles = flattenCandles(result.data);
    const stats = calculateCandleStats(candles);

    return NextResponse.json({
      success: true,
      data: {
        candles: candles.map(c => ({
          timestamp: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
        stats,
        conditionId: condition_id,
        interval,
      },
      source: 'dome' as const,
    });
  } catch (error: any) {
    console.error('[MarketCandles] Error:', error);
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

function getMockCandles(
  startTime: number,
  endTime: number,
  interval: CandleInterval
): Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }> {
  const intervalSeconds = interval * 60;
  const candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }> = [];

  let currentPrice = 0.5 + Math.random() * 0.3;

  for (let ts = startTime; ts <= endTime; ts += intervalSeconds) {
    const change = (Math.random() - 0.5) * 0.1;
    const open = currentPrice;
    const close = Math.max(0.01, Math.min(0.99, currentPrice + change));
    const high = Math.max(open, close) + Math.random() * 0.02;
    const low = Math.min(open, close) - Math.random() * 0.02;

    candles.push({
      timestamp: ts,
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(Math.min(0.99, high).toFixed(4)),
      low: parseFloat(Math.max(0.01, low).toFixed(4)),
      close: parseFloat(close.toFixed(4)),
      volume: Math.floor(Math.random() * 100000),
    });

    currentPrice = close;
  }

  return candles;
}

function calculateStatsFromMock(
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }>
) {
  if (candles.length < 2) {
    return { trendSlope: 0, recentVolatility: 0, priceChange: 0, priceChangePercent: 0 };
  }

  const firstClose = candles[0].close;
  const lastClose = candles[candles.length - 1].close;
  const priceChange = lastClose - firstClose;
  const priceChangePercent = firstClose > 0 ? (priceChange / firstClose) * 100 : 0;

  // Simple trend slope
  const n = candles.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += candles[i].close;
    sumXY += i * candles[i].close;
    sumXX += i * i;
  }
  const trendSlope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) : 0;

  // Volatility
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
  }

  let recentVolatility = 0;
  if (returns.length > 0) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    recentVolatility = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / returns.length);
  }

  return { trendSlope, recentVolatility, priceChange, priceChangePercent };
}
