/**
 * Cron: Refresh WIO Snapshots
 *
 * Hourly refresh of position snapshots and market smart/dumb money signals.
 *
 * Creates:
 * - wio_open_snapshots_v1: Current open positions per wallet×market
 * - wio_market_snapshots_v1: Smart vs dumb money signals per market
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Hourly (vercel.json)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { logCronExecution } from '@/lib/alerts/cron-tracker';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface SnapshotResult {
  success: boolean;
  openSnapshots: number;
  marketSnapshots: number;
  asOfTs: string;
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

  // Get current timestamp (rounded to hour)
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const asOfTs = now.toISOString().replace('T', ' ').slice(0, 19);

  try {
    // Step 1: Populate open position snapshots
    const openQuery = `
      INSERT INTO wio_open_snapshots_v1
      SELECT
        p.wallet_id,
        p.condition_id as market_id,
        toDateTime('${asOfTs}') as as_of_ts,

        -- Position state
        p.side,
        p.qty_shares_remaining as open_shares_net,
        p.cost_usd as open_cost_usd,
        p.p_entry_side as avg_entry_price_side,

        -- Mark-to-market
        ifNull(mp.mark_price, 0.5) as mark_price_side,
        IF(p.side = 'YES',
          (ifNull(mp.mark_price, 0.5) - p.p_entry_side) * p.qty_shares_remaining,
          (p.p_entry_side - ifNull(mp.mark_price, 0.5)) * p.qty_shares_remaining
        ) as unrealized_pnl_usd,
        IF(p.cost_usd > 0,
          IF(p.side = 'YES',
            (ifNull(mp.mark_price, 0.5) - p.p_entry_side) * p.qty_shares_remaining / p.cost_usd,
            (p.p_entry_side - ifNull(mp.mark_price, 0.5)) * p.qty_shares_remaining / p.cost_usd
          ),
          0
        ) as unrealized_roi,

        -- Metadata
        p.primary_bundle_id as bundle_id,
        p.event_id

      FROM wio_positions_v2 p
      LEFT JOIN pm_latest_mark_price_v1 mp ON p.condition_id = mp.condition_id
      WHERE p.is_resolved = 0
        AND p.qty_shares_remaining > 0
    `;

    await clickhouse.command({ query: openQuery });

    // Count open snapshots
    const openCount = await clickhouse.query({
      query: `SELECT count() as cnt FROM wio_open_snapshots_v1 WHERE as_of_ts = toDateTime('${asOfTs}')`,
      format: 'JSONEachRow',
    });
    const openSnapshots = Number(((await openCount.json()) as any[])[0]?.cnt || 0);

    // Step 2: Populate market snapshots with smart/dumb money
    const marketQuery = `
      INSERT INTO wio_market_snapshots_v1
      SELECT
        market_id,
        toDateTime('${asOfTs}') as as_of_ts,

        -- Crowd metrics
        ifNull(mp.mark_price, 0.5) as crowd_odds,
        total_open_usd as total_open_interest_usd,

        -- Smart money metrics
        smart_odds as smart_money_odds,
        smart_shares as smart_holdings_shares,
        smart_usd as smart_holdings_usd,
        smart_roi as smart_unrealized_roi,
        toInt32(smart_count) as smart_wallet_count,

        -- Dumb money metrics
        dumb_odds as dumb_money_odds,
        dumb_shares as dumb_holdings_shares,
        dumb_usd as dumb_holdings_usd,
        dumb_roi as dumb_unrealized_roi,
        toInt32(dumb_count) as dumb_wallet_count,

        -- Divergence signals
        smart_odds - ifNull(mp.mark_price, 0.5) as smart_vs_crowd_delta,
        smart_odds - dumb_odds as smart_vs_dumb_delta,

        now() as computed_at

      FROM (
        SELECT
          os.market_id,
          sum(os.open_cost_usd) as total_open_usd,

          -- Smart money
          sumIf(os.open_shares_net, wc.tier IN ('superforecaster', 'smart', 'profitable')) as smart_shares,
          sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable')) as smart_usd,
          IF(sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'YES') +
             sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'NO') > 0,
            sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'YES') /
            (sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'YES') +
             sumIf(os.open_cost_usd, wc.tier IN ('superforecaster', 'smart', 'profitable') AND os.side = 'NO')),
            0.5
          ) as smart_odds,
          avgIf(os.unrealized_roi, wc.tier IN ('superforecaster', 'smart', 'profitable')) as smart_roi,
          countDistinctIf(os.wallet_id, wc.tier IN ('superforecaster', 'smart', 'profitable')) as smart_count,

          -- Dumb money
          sumIf(os.open_shares_net, wc.tier = 'heavy_loser') as dumb_shares,
          sumIf(os.open_cost_usd, wc.tier = 'heavy_loser') as dumb_usd,
          IF(sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'YES') +
             sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'NO') > 0,
            sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'YES') /
            (sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'YES') +
             sumIf(os.open_cost_usd, wc.tier = 'heavy_loser' AND os.side = 'NO')),
            0.5
          ) as dumb_odds,
          avgIf(os.unrealized_roi, wc.tier = 'heavy_loser') as dumb_roi,
          countDistinctIf(os.wallet_id, wc.tier = 'heavy_loser') as dumb_count

        FROM wio_open_snapshots_v1 os
        LEFT JOIN wio_wallet_classification_v1 wc ON os.wallet_id = wc.wallet_id AND wc.window_id = 2
        WHERE os.as_of_ts = toDateTime('${asOfTs}')
        GROUP BY os.market_id
        HAVING total_open_usd > 0
      ) agg
      LEFT JOIN pm_latest_mark_price_v1 mp ON agg.market_id = mp.condition_id
    `;

    await clickhouse.command({ query: marketQuery });

    // Count market snapshots
    const marketCount = await clickhouse.query({
      query: `SELECT count() as cnt FROM wio_market_snapshots_v1 WHERE as_of_ts = toDateTime('${asOfTs}')`,
      format: 'JSONEachRow',
    });
    const marketSnapshots = Number(((await marketCount.json()) as any[])[0]?.cnt || 0);

    const durationMs = Date.now() - startTime;
    const result: SnapshotResult = {
      success: true,
      openSnapshots,
      marketSnapshots,
      asOfTs,
      durationMs,
    };

    await logCronExecution({
      cron_name: 'refresh-wio-snapshots',
      status: 'success',
      duration_ms: durationMs,
      details: { openSnapshots, marketSnapshots, asOfTs }
    });

    console.log(`[refresh-wio-snapshots] Complete:`, result);
    return NextResponse.json(result);

  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[refresh-wio-snapshots] Error:', error);

    await logCronExecution({
      cron_name: 'refresh-wio-snapshots',
      status: 'failure',
      duration_ms: durationMs,
      error_message: error.message
    });

    return NextResponse.json({
      success: false,
      openSnapshots: 0,
      marketSnapshots: 0,
      asOfTs,
      durationMs,
      error: error.message,
    } as SnapshotResult, { status: 500 });
  }
}
