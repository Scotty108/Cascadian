/**
 * Cron: Capture WIO Anchor Prices
 *
 * Captures market prices at +4h, +24h, +72h after position opens.
 * These "anchor prices" enable CLV (Closing Line Value) calculations.
 *
 * Logic:
 * - Find positions opened 4h, 24h, or 72h ago (within a window)
 * - Look up current market price
 * - Update the position with the anchor price
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Hourly (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface CaptureResult {
  success: boolean;
  anchor4hUpdated: number;
  anchor24hUpdated: number;
  anchor72hUpdated: number;
  durationMs: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!cronSecret && !isProduction) return true;
  if (!cronSecret && isProduction) return false;

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get('token') === cronSecret) return true;

  return false;
}

export async function GET(request: Request) {
  const startTime = Date.now();

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // For each anchor window, find positions that are due for price capture
    // and update them with current market price

    // Note: This requires a market price source. Options:
    // 1. wio_market_price_history (if we're capturing hourly prices)
    // 2. Live API call to Polymarket
    // 3. Derived from recent fills

    // For now, we'll use recent fills as price proxy
    // A position opened 4h ago should get the price from fills ~4h later

    const anchors = [
      { name: '4h', hours: 4, column: 'p_anchor_4h_side' },
      { name: '24h', hours: 24, column: 'p_anchor_24h_side' },
      { name: '72h', hours: 72, column: 'p_anchor_72h_side' },
    ];

    const results: Record<string, number> = {};

    for (const anchor of anchors) {
      // Find positions opened ~anchor.hours ago that don't have this anchor yet
      // Window: between (anchor.hours - 1) and anchor.hours ago
      const updateQuery = `
        ALTER TABLE wio_positions_v1
        UPDATE ${anchor.column} = prices.avg_price
        FROM (
          SELECT
            p.position_id,
            avg(abs(f.usdc_delta) / nullIf(abs(f.tokens_delta), 0)) as avg_price
          FROM wio_positions_v1 p
          INNER JOIN pm_canonical_fills_v4 f
            ON p.market_id = f.condition_id
            AND f.outcome_index = if(p.side = 'YES', 0, 1)
            AND f.event_time BETWEEN p.ts_open + INTERVAL ${anchor.hours} HOUR - INTERVAL 30 MINUTE
                                  AND p.ts_open + INTERVAL ${anchor.hours} HOUR + INTERVAL 30 MINUTE
          WHERE p.${anchor.column} IS NULL
            AND p.ts_open BETWEEN now() - INTERVAL ${anchor.hours + 2} HOUR
                               AND now() - INTERVAL ${anchor.hours - 1} HOUR
            AND p.is_resolved = 0
          GROUP BY p.position_id
        ) as prices
        WHERE wio_positions_v1.position_id = prices.position_id
      `;

      try {
        await clickhouse.command({ query: updateQuery });

        // Count how many we updated
        const countResult = await clickhouse.query({
          query: `
            SELECT count() as cnt
            FROM wio_positions_v1
            WHERE ${anchor.column} IS NOT NULL
              AND ts_open BETWEEN now() - INTERVAL ${anchor.hours + 2} HOUR
                               AND now() - INTERVAL ${anchor.hours - 1} HOUR
          `,
          format: 'JSONEachRow',
        });
        results[anchor.name] = Number(((await countResult.json()) as any[])[0]?.cnt || 0);
      } catch (e: any) {
        console.error(`[capture-wio-anchor-prices] Error updating ${anchor.name}:`, e.message);
        results[anchor.name] = 0;
      }
    }

    const result: CaptureResult = {
      success: true,
      anchor4hUpdated: results['4h'] || 0,
      anchor24hUpdated: results['24h'] || 0,
      anchor72hUpdated: results['72h'] || 0,
      durationMs: Date.now() - startTime,
    };

    console.log(`[capture-wio-anchor-prices] Complete:`, result);
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('[capture-wio-anchor-prices] Error:', error);
    return NextResponse.json({
      success: false,
      anchor4hUpdated: 0,
      anchor24hUpdated: 0,
      anchor72hUpdated: 0,
      durationMs: Date.now() - startTime,
      error: error.message,
    } as CaptureResult, { status: 500 });
  }
}
