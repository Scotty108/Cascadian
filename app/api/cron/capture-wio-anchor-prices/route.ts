/**
 * Cron: Capture WIO Anchor Prices
 *
 * Captures market prices at +4h, +24h, +72h after position opens.
 * These "anchor prices" enable CLV (Closing Line Value) calculations.
 *
 * Uses pm_price_snapshots_15m for price lookups.
 * Updates wio_positions_v2 with anchor prices and CLV values.
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Hourly (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface CaptureResult {
  success: boolean;
  positionsProcessed: number;
  anchor4hCaptured: number;
  anchor24hCaptured: number;
  anchor72hCaptured: number;
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
    // Get token mapping for positions (to look up prices by token_id)
    // We need to map condition_id + outcome_index -> token_id

    // Strategy: For each anchor window, find eligible positions and
    // look up prices from pm_price_snapshots_15m at the anchor time

    const results = {
      positionsProcessed: 0,
      anchor4h: 0,
      anchor24h: 0,
      anchor72h: 0,
    };

    // Process each anchor window
    // 4h anchor: positions opened 4-5 hours ago that need anchor price
    // 24h anchor: positions opened 24-25 hours ago
    // 72h anchor: positions opened 72-73 hours ago

    const anchors = [
      { name: '4h', hours: 4, priceCol: 'p_anchor_4h_side', clvCol: 'clv_4h' },
      { name: '24h', hours: 24, priceCol: 'p_anchor_24h_side', clvCol: 'clv_24h' },
      { name: '72h', hours: 72, priceCol: 'p_anchor_72h_side', clvCol: 'clv_72h' },
    ];

    for (const anchor of anchors) {
      try {
        // Find positions that need this anchor and look up prices
        // JOIN to token map, then to price snapshots
        const updateQuery = `
          ALTER TABLE wio_positions_v2
          UPDATE
            ${anchor.priceCol} = anchor_data.anchor_price,
            ${anchor.clvCol} = IF(
              side = 'YES',
              anchor_data.anchor_price - p_entry_side,
              p_entry_side - anchor_data.anchor_price
            )
          IN PARTITION tuple()
          WHERE position_id IN (
            SELECT position_id
            FROM wio_positions_v2
            WHERE ${anchor.priceCol} IS NULL
              AND ts_open BETWEEN now() - INTERVAL ${anchor.hours + 2} HOUR
                               AND now() - INTERVAL ${anchor.hours - 1} HOUR
              AND is_resolved = 0
          )
          AND position_id IN (
            SELECT p.position_id
            FROM wio_positions_v2 p
            INNER JOIN pm_token_to_condition_map_v5 m
              ON p.condition_id = m.condition_id
              AND m.outcome_index = if(p.side = 'YES', 0, 1)
            INNER JOIN (
              SELECT
                token_id,
                bucket,
                vwap as price
              FROM pm_price_snapshots_15m
              WHERE bucket >= now() - INTERVAL ${anchor.hours + 2} HOUR
            ) ps
              ON m.token_id_dec = ps.token_id
              AND ps.bucket = toStartOfFifteenMinutes(p.ts_open + INTERVAL ${anchor.hours} HOUR)
            WHERE p.${anchor.priceCol} IS NULL
              AND p.ts_open BETWEEN now() - INTERVAL ${anchor.hours + 2} HOUR
                                 AND now() - INTERVAL ${anchor.hours - 1} HOUR
          )
          WITH (
            SELECT
              p.position_id,
              ps.price as anchor_price
            FROM wio_positions_v2 p
            INNER JOIN pm_token_to_condition_map_v5 m
              ON p.condition_id = m.condition_id
              AND m.outcome_index = if(p.side = 'YES', 0, 1)
            INNER JOIN pm_price_snapshots_15m ps
              ON m.token_id_dec = ps.token_id
              AND ps.bucket = toStartOfFifteenMinutes(p.ts_open + INTERVAL ${anchor.hours} HOUR)
            WHERE p.${anchor.priceCol} IS NULL
              AND p.ts_open BETWEEN now() - INTERVAL ${anchor.hours + 2} HOUR
                                 AND now() - INTERVAL ${anchor.hours - 1} HOUR
          ) as anchor_data
        `;

        // The above query is complex. Let's simplify to a two-step approach:
        // 1. Find positions needing update and their anchor prices
        // 2. Update them

        // Step 1: Get positions and their anchor prices
        const positionsQuery = `
          SELECT
            p.position_id,
            p.side,
            p.p_entry_side,
            ps.vwap as anchor_price
          FROM wio_positions_v2 p
          INNER JOIN pm_token_to_condition_map_v5 m
            ON p.condition_id = m.condition_id
            AND m.outcome_index = if(p.side = 'YES', 0, 1)
          INNER JOIN pm_price_snapshots_15m ps
            ON m.token_id_dec = ps.token_id
            AND ps.bucket = toStartOfFifteenMinutes(p.ts_open + INTERVAL ${anchor.hours} HOUR)
          WHERE p.${anchor.priceCol} IS NULL
            AND p.ts_open BETWEEN now() - INTERVAL ${anchor.hours + 2} HOUR
                               AND now() - INTERVAL ${anchor.hours - 1} HOUR
            AND p.is_resolved = 0
            AND ps.vwap > 0 AND ps.vwap < 1
          LIMIT 10000
        `;

        const posResult = await clickhouse.query({
          query: positionsQuery,
          format: 'JSONEachRow'
        });
        const positions = await posResult.json() as any[];

        if (positions.length === 0) {
          results[anchor.name as keyof typeof results] = 0;
          continue;
        }

        // Step 2: Update positions in batches
        // Since ClickHouse ALTER UPDATE is async and slow, use INSERT approach
        // by creating updated rows that replace old ones (ReplacingMergeTree)

        // Build VALUES for multi-row update
        // Note: This is a workaround for ClickHouse's async ALTER UPDATE
        for (const pos of positions) {
          const anchorPrice = pos.anchor_price;
          const clv = pos.side === 'YES'
            ? anchorPrice - pos.p_entry_side
            : pos.p_entry_side - anchorPrice;

          // Update individual position
          await clickhouse.command({
            query: `
              ALTER TABLE wio_positions_v2
              UPDATE
                ${anchor.priceCol} = ${anchorPrice},
                ${anchor.clvCol} = ${clv}
              WHERE position_id = ${pos.position_id}
            `
          });
        }

        results[anchor.name as keyof typeof results] = positions.length;
        results.positionsProcessed += positions.length;

      } catch (e: any) {
        console.error(`[capture-wio-anchor-prices] Error for ${anchor.name}:`, e.message);
      }
    }

    const durationMs = Date.now() - startTime;
    const result: CaptureResult = {
      success: true,
      positionsProcessed: results.positionsProcessed,
      anchor4hCaptured: results.anchor4h,
      anchor24hCaptured: results.anchor24h,
      anchor72hCaptured: results.anchor72h,
      durationMs,
    };

    await logCronExecution({
      cron_name: 'capture-wio-anchor-prices',
      status: 'success',
      duration_ms: durationMs,
      details: result
    });

    console.log(`[capture-wio-anchor-prices] Complete:`, result);
    return NextResponse.json(result);

  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[capture-wio-anchor-prices] Error:', error);

    await logCronExecution({
      cron_name: 'capture-wio-anchor-prices',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message
    });

    return NextResponse.json({
      success: false,
      positionsProcessed: 0,
      anchor4hCaptured: 0,
      anchor24hCaptured: 0,
      anchor72hCaptured: 0,
      durationMs,
      error: error.message,
    } as CaptureResult, { status: 500 });
  }
}
