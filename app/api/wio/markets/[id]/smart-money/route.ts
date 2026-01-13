/**
 * API: WIO Market Smart Money Analysis
 *
 * Returns smart money signals, positions, and crowd divergence for a specific market.
 *
 * Path: /api/wio/markets/[id]/smart-money
 * - id: condition_id (market ID)
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface MarketSnapshot {
  market_id: string;
  as_of_ts: string;
  crowd_odds: number;
  smart_money_odds: number;
  smart_vs_crowd_delta: number;
  smart_wallet_count: number;
  smart_holdings_usd: number;
  smart_unrealized_roi: number;
  dumb_wallet_count: number;
  dumb_holdings_usd: number;
  total_open_interest_usd: number;
}

interface DotEvent {
  dot_id: string;
  ts: string;
  wallet_id: string;
  action: string;
  side: string;
  size_usd: number;
  dot_type: string;
  confidence: number;
  reason_metrics: string[];
  credibility_score: number;
  entry_price: number;
  crowd_odds: number;
}

interface SmartPosition {
  wallet_id: string;
  tier: string;
  credibility_score: number;
  side: string;
  open_shares_net: number;
  open_cost_usd: number;
  avg_entry_price: number;
  unrealized_pnl_usd: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const marketId = id.toLowerCase().replace('0x', '');

    // Run queries in parallel
    const [snapshotResult, dotEventsResult, smartPositionsResult] = await Promise.all([
      // 1. Latest market snapshot
      clickhouse.query({
        query: `
          SELECT
            market_id,
            toString(as_of_ts) as as_of_ts,
            crowd_odds,
            smart_money_odds,
            smart_vs_crowd_delta,
            smart_wallet_count,
            smart_holdings_usd,
            smart_unrealized_roi,
            dumb_wallet_count,
            dumb_holdings_usd,
            total_open_interest_usd
          FROM wio_market_snapshots_v1
          WHERE market_id = '${marketId}'
          ORDER BY as_of_ts DESC
          LIMIT 1
        `,
        format: 'JSONEachRow',
      }),

      // 2. Recent dot events for this market
      clickhouse.query({
        query: `
          SELECT
            dot_id,
            toString(ts) as ts,
            wallet_id,
            action,
            side,
            size_usd,
            dot_type,
            confidence,
            reason_metrics,
            credibility_score,
            entry_price,
            crowd_odds
          FROM wio_dot_events_v1
          WHERE market_id = '${marketId}'
          ORDER BY ts DESC
          LIMIT 10
        `,
        format: 'JSONEachRow',
      }),

      // 3. Smart money positions (superforecasters + smart wallets)
      clickhouse.query({
        query: `
          SELECT
            o.wallet_id,
            c.tier,
            c.credibility_score,
            o.side,
            o.open_shares_net,
            o.open_cost_usd,
            o.avg_entry_price_side as avg_entry_price,
            o.unrealized_pnl_usd
          FROM wio_open_snapshots_v1 o
          JOIN wio_wallet_classification_v1 c
            ON o.wallet_id = c.wallet_id
            AND c.window_id = '90d'
          WHERE o.market_id = '${marketId}'
            AND o.open_shares_net > 0
            AND c.tier IN ('superforecaster', 'smart')
          ORDER BY c.credibility_score DESC, o.open_cost_usd DESC
          LIMIT 20
        `,
        format: 'JSONEachRow',
      }),
    ]);

    const snapshots = (await snapshotResult.json()) as MarketSnapshot[];
    const dotEvents = (await dotEventsResult.json()) as DotEvent[];
    const smartPositions = (await smartPositionsResult.json()) as SmartPosition[];

    const snapshot = snapshots[0] || null;

    // Calculate smart money consensus
    let smartMoneyConsensus = 'NEUTRAL';
    let signalStrength = 0;

    if (snapshot) {
      const delta = snapshot.smart_vs_crowd_delta;
      if (delta > 0.1) {
        smartMoneyConsensus = 'BULLISH'; // Smart money more optimistic than crowd
        signalStrength = Math.min(delta * 2, 1);
      } else if (delta < -0.1) {
        smartMoneyConsensus = 'BEARISH'; // Smart money less optimistic than crowd
        signalStrength = Math.min(Math.abs(delta) * 2, 1);
      }
    }

    // Count positions by side
    const yesSidePositions = smartPositions.filter(p => p.side === 'YES');
    const noSidePositions = smartPositions.filter(p => p.side === 'NO');

    const yesCredibilitySum = yesSidePositions.reduce((sum, p) => sum + p.credibility_score, 0);
    const noCredibilitySum = noSidePositions.reduce((sum, p) => sum + p.credibility_score, 0);

    // Superforecaster breakdown
    const superforecasters = {
      yes: smartPositions.filter(p => p.tier === 'superforecaster' && p.side === 'YES'),
      no: smartPositions.filter(p => p.tier === 'superforecaster' && p.side === 'NO'),
    };

    return NextResponse.json({
      success: true,
      market_id: marketId,
      snapshot: snapshot ? {
        crowd_odds: snapshot.crowd_odds,
        smart_money_odds: snapshot.smart_money_odds,
        delta: snapshot.smart_vs_crowd_delta,
        smart_wallet_count: snapshot.smart_wallet_count,
        smart_holdings_usd: snapshot.smart_holdings_usd,
        smart_roi: snapshot.smart_unrealized_roi,
        dumb_wallet_count: snapshot.dumb_wallet_count,
        total_oi: snapshot.total_open_interest_usd,
        as_of: snapshot.as_of_ts,
      } : null,
      consensus: {
        signal: smartMoneyConsensus,
        strength: signalStrength,
        yes_wallets: yesSidePositions.length,
        no_wallets: noSidePositions.length,
        yes_credibility_sum: yesCredibilitySum,
        no_credibility_sum: noCredibilitySum,
      },
      superforecasters: {
        yes_count: superforecasters.yes.length,
        no_count: superforecasters.no.length,
        yes_positions: superforecasters.yes.slice(0, 5),
        no_positions: superforecasters.no.slice(0, 5),
      },
      dot_events: dotEvents,
      smart_positions: smartPositions,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

  } catch (error: any) {
    console.error('[wio/markets/smart-money] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
