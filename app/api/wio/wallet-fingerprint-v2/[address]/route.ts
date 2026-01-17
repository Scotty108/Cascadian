/**
 * API: Get WIO Wallet Fingerprint V2 (TRADE-LEVEL)
 *
 * Returns normalized fingerprint metrics using TRADE-LEVEL data (pm_wallet_trade_metrics_v2).
 * This is more accurate than position-level for assessing trading skill.
 *
 * Key differences from V1:
 * - Win rate measures individual trade decisions, not net position outcomes
 * - Includes long vs short breakdown
 * - Profit factor from actual trade wins/losses
 *
 * Path: /api/wio/wallet-fingerprint-v2/[address]
 * Query params:
 * - window: Time window ('ALL' | '90d' | '30d' | '14d' | '7d') - default '90d'
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';

interface FingerprintMetric {
  name: string;
  key: string;
  raw: number;
  normalized: number;
  displayValue: string;
  percentile: number;
  description: string;
}

interface FingerprintResponse {
  success: boolean;
  fingerprint: {
    wallet_id: string;
    window_id: string;
    metrics: FingerprintMetric[];
    trade_metrics: {
      trades_total: number;
      trades_long: number;
      trades_short: number;
      win_rate_long: number;
      win_rate_short: number;
    };
    overall_score: number;
    tier: string;
    tier_label: string;
    computed_at: string;
  } | null;
  error?: string;
}

// Normalize trade-level metrics to 0-100 scale
function normalizeTradeMetrics(raw: {
  win_rate: number;
  roi_cost_weighted: number;
  profit_factor: number;
  avg_win_roi: number;
  avg_loss_roi: number;
  trades_total: number;
  credibility_score?: number;
}): FingerprintMetric[] {
  return [
    {
      name: 'Credibility',
      key: 'credibility',
      raw: raw.credibility_score ?? 0,
      normalized: Math.min(100, Math.max(0, (raw.credibility_score ?? 0) * 100)),
      displayValue: `${((raw.credibility_score ?? 0) * 100).toFixed(0)}%`,
      percentile: 0,
      description: 'Overall trustworthiness (from WIO scores)',
    },
    {
      name: 'Win Rate',
      key: 'win_rate',
      raw: raw.win_rate ?? 0,
      // Trade-level win rate (already 0-1 scale)
      normalized: Math.min(100, Math.max(0, (raw.win_rate ?? 0) * 100)),
      displayValue: `${((raw.win_rate ?? 0) * 100).toFixed(1)}%`,
      percentile: 0,
      description: 'Percentage of profitable trades (per-trade, not per-position)',
    },
    {
      name: 'ROI',
      key: 'roi',
      raw: raw.roi_cost_weighted ?? 0,
      // Cap at ±200%, scale to 0-100 (0% = 50, +100% = 75, +200% = 100)
      normalized: Math.min(100, Math.max(0, ((raw.roi_cost_weighted ?? 0) + 1) * 50)),
      displayValue: `${((raw.roi_cost_weighted ?? 0) * 100).toFixed(1)}%`,
      percentile: 0,
      description: 'Return on investment (cost-weighted across all trades)',
    },
    {
      name: 'Consistency',
      key: 'consistency',
      raw: raw.profit_factor ?? 1,
      // Profit factor 0-3 mapped to 0-100
      normalized: Math.min(100, Math.max(0, ((raw.profit_factor ?? 1) / 3) * 100)),
      displayValue: `${(raw.profit_factor ?? 1).toFixed(2)}x`,
      percentile: 0,
      description: 'Profit factor (gross wins / gross losses per trade)',
    },
    {
      name: 'Win Size',
      key: 'win_size',
      raw: raw.avg_win_roi ?? 0,
      // Avg win ROI typically 0-50%, scale to 0-100
      normalized: Math.min(100, Math.max(0, (raw.avg_win_roi ?? 0) * 200)),
      displayValue: `+${((raw.avg_win_roi ?? 0) * 100).toFixed(1)}%`,
      percentile: 0,
      description: 'Average ROI on winning trades',
    },
    {
      name: 'Experience',
      key: 'experience',
      raw: raw.trades_total ?? 0,
      // Log scale: 5 trades = 0, 50 = 50, 500+ = 100
      normalized: Math.min(100, Math.max(0, Math.log10((raw.trades_total ?? 5) / 5) * 50)),
      displayValue: `${raw.trades_total ?? 0}`,
      percentile: 0,
      description: 'Number of resolved trades (sample size)',
    },
  ];
}

function getTierFromWinRate(winRate: number, trades: number): string {
  if (trades < 10) return 'INSUFFICIENT_DATA';
  if (winRate >= 0.60) return 'SUPERFORECASTER';
  if (winRate >= 0.55) return 'SMART_MONEY';
  if (winRate >= 0.50) return 'PROFITABLE';
  if (winRate >= 0.45) return 'BREAKEVEN';
  return 'LOSING';
}

function getTierLabel(tier: string): string {
  const labels: Record<string, string> = {
    SUPERFORECASTER: 'Superforecaster',
    SMART_MONEY: 'Smart Money',
    PROFITABLE: 'Profitable',
    BREAKEVEN: 'Break Even',
    LOSING: 'Losing',
    INSUFFICIENT_DATA: 'Insufficient Data',
  };
  return labels[tier] ?? 'Unclassified';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
): Promise<NextResponse<FingerprintResponse>> {
  try {
    const { address } = await params;
    const { searchParams } = new URL(request.url);
    const window = searchParams.get('window') ?? '90d';

    // Validate address
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { success: false, fingerprint: null, error: 'Invalid wallet address' },
        { status: 400 }
      );
    }

    const walletId = address.toLowerCase();

    // Query trade-level metrics + WIO credibility score
    const query = `
      SELECT
        t.win_rate AS win_rate,
        t.win_rate_long AS win_rate_long,
        t.win_rate_short AS win_rate_short,
        t.roi_cost_weighted AS roi_cost_weighted,
        t.profit_factor AS profit_factor,
        t.avg_win_roi AS avg_win_roi,
        t.avg_loss_roi AS avg_loss_roi,
        t.trades_total AS trades_total,
        t.trades_long AS trades_long,
        t.trades_short AS trades_short,
        t.pnl_total_usd AS pnl_total_usd,
        t.active_days AS active_days,
        -- Get credibility from WIO scores
        coalesce(s.credibility_score, 0) AS credibility_score
      FROM pm_wallet_trade_metrics_v2 t
      LEFT JOIN wio_wallet_scores_v1 s
        ON t.wallet = s.wallet_id
        AND s.window_id = '90d'
      WHERE t.wallet = '${walletId}'
        AND t.window_id = '${window}'
      LIMIT 1
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as {
      win_rate: number;
      win_rate_long: number;
      win_rate_short: number;
      roi_cost_weighted: number;
      profit_factor: number;
      avg_win_roi: number;
      avg_loss_roi: number;
      trades_total: number;
      trades_long: number;
      trades_short: number;
      pnl_total_usd: number;
      active_days: number;
      credibility_score: number;
    }[];

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        success: true,
        fingerprint: null,
        error: 'Wallet not found in trade metrics. May need 5+ resolved trades.',
      });
    }

    const data = rows[0];

    const metrics = normalizeTradeMetrics({
      win_rate: data.win_rate,
      roi_cost_weighted: data.roi_cost_weighted,
      profit_factor: data.profit_factor,
      avg_win_roi: data.avg_win_roi,
      avg_loss_roi: data.avg_loss_roi,
      trades_total: data.trades_total,
      credibility_score: data.credibility_score,
    });

    // Calculate overall score (weighted average)
    const weights = [0.20, 0.25, 0.20, 0.15, 0.10, 0.10]; // Credibility, WinRate, ROI, Consistency, WinSize, Experience
    const overallScore = metrics.reduce(
      (sum, metric, i) => sum + metric.normalized * weights[i],
      0
    );

    const tier = getTierFromWinRate(data.win_rate, data.trades_total);

    return NextResponse.json({
      success: true,
      fingerprint: {
        wallet_id: walletId,
        window_id: window,
        metrics,
        trade_metrics: {
          trades_total: data.trades_total,
          trades_long: data.trades_long,
          trades_short: data.trades_short,
          win_rate_long: data.win_rate_long,
          win_rate_short: data.win_rate_short,
        },
        overall_score: Math.round(overallScore),
        tier,
        tier_label: getTierLabel(tier),
        computed_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching wallet fingerprint v2:', error);
    return NextResponse.json(
      {
        success: false,
        fingerprint: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
