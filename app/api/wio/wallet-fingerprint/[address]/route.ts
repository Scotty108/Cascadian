/**
 * API: Get WIO Wallet Fingerprint
 *
 * Returns normalized fingerprint metrics for radar/polar/hex visualizations.
 *
 * Path: /api/wio/wallet-fingerprint/[address]
 * Query params:
 * - window: Time window ('ALL' | '90d' | '30d') - default '90d'
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
    overall_score: number;
    tier: string;
    tier_label: string;
    computed_at: string;
  } | null;
  error?: string;
}

// Normalize metrics to 0-100 scale for chart display
function normalizeMetrics(raw: {
  credibility_score: number;
  win_rate: number;
  roi_cost_weighted: number;
  brier_mean: number;
  profit_factor: number;
  clv_24h_cost_weighted: number;
}): FingerprintMetric[] {
  return [
    {
      name: 'Credibility',
      key: 'credibility',
      raw: raw.credibility_score ?? 0,
      normalized: Math.min(100, Math.max(0, (raw.credibility_score ?? 0) * 100)),
      displayValue: `${((raw.credibility_score ?? 0) * 100).toFixed(0)}%`,
      percentile: 0, // Will be computed separately if needed
      description: 'Overall trustworthiness as a forecaster',
    },
    {
      name: 'Win Rate',
      key: 'win_rate',
      raw: raw.win_rate ?? 0,
      normalized: Math.min(100, Math.max(0, (raw.win_rate ?? 0) * 100)),
      displayValue: `${((raw.win_rate ?? 0) * 100).toFixed(1)}%`,
      percentile: 0,
      description: 'Percentage of profitable positions',
    },
    {
      name: 'ROI',
      key: 'roi',
      raw: raw.roi_cost_weighted ?? 0,
      // Cap at ±200%, scale to 0-100 (0% = 50, +100% = 75, +200% = 100)
      normalized: Math.min(100, Math.max(0, ((raw.roi_cost_weighted ?? 0) + 1) * 50)),
      displayValue: `${((raw.roi_cost_weighted ?? 0) * 100).toFixed(1)}%`,
      percentile: 0,
      description: 'Return on investment (cost-weighted)',
    },
    {
      name: 'Accuracy',
      key: 'brier',
      raw: raw.brier_mean ?? 0.25,
      // Invert: 0 (perfect) → 100, 0.25 (random) → 0
      normalized: Math.max(0, Math.min(100, 100 - ((raw.brier_mean ?? 0.25) * 400))),
      displayValue: (raw.brier_mean ?? 0.25).toFixed(3),
      percentile: 0,
      description: 'Prediction accuracy (Brier score inverted)',
    },
    {
      name: 'Consistency',
      key: 'consistency',
      raw: raw.profit_factor ?? 1,
      // profit_factor 0-3 mapped to 0-100
      normalized: Math.min(100, Math.max(0, ((raw.profit_factor ?? 1) / 3) * 100)),
      displayValue: `${(raw.profit_factor ?? 1).toFixed(2)}x`,
      percentile: 0,
      description: 'Profit factor (gross wins / gross losses)',
    },
    {
      name: 'Edge',
      key: 'edge',
      raw: raw.clv_24h_cost_weighted ?? 0,
      // CLV typically -0.1 to +0.1, map to 0-100
      normalized: Math.min(100, Math.max(0, ((raw.clv_24h_cost_weighted ?? 0) + 0.1) * 500)),
      displayValue: `${((raw.clv_24h_cost_weighted ?? 0) * 100).toFixed(1)}bp`,
      percentile: 0,
      description: 'Closing line value (market-moving ability)',
    },
  ];
}

function getTierLabel(tier: string | null): string {
  const labels: Record<string, string> = {
    SUPERFORECASTER: 'Superforecaster',
    SMART_MONEY: 'Smart Money',
    PROFITABLE: 'Profitable',
    BREAKEVEN: 'Break Even',
    LOSING: 'Losing',
  };
  return labels[tier ?? ''] ?? 'Unclassified';
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

    // Query WIO tables for fingerprint metrics
    const query = `
      SELECT
        m.win_rate,
        m.roi_cost_weighted,
        m.brier_mean,
        m.profit_factor,
        m.clv_24h_cost_weighted,
        m.pnl_total_usd,
        m.positions_n,
        m.resolved_positions_n,
        s.credibility_score,
        s.copyability_score,
        s.bot_likelihood,
        c.tier
      FROM wio_metric_observations_v1 m
      LEFT JOIN wio_wallet_scores_v1 s
        ON m.wallet_id = s.wallet_id
        AND m.window_id = s.window_id
      LEFT JOIN wio_wallet_classification_v1 c
        ON m.wallet_id = c.wallet_id
      WHERE m.wallet_id = '${walletId}'
        AND m.scope_type = 'GLOBAL'
        AND m.window_id = '${window}'
      LIMIT 1
    `;

    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
    });

    const rows = (await result.json()) as {
      win_rate: number;
      roi_cost_weighted: number;
      brier_mean: number;
      profit_factor: number;
      clv_24h_cost_weighted: number;
      pnl_total_usd: number;
      positions_n: number;
      resolved_positions_n: number;
      credibility_score: number;
      copyability_score: number;
      bot_likelihood: number;
      tier: string;
    }[];

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        success: true,
        fingerprint: null,
        error: 'Wallet not found in WIO database',
      });
    }

    const data = rows[0];

    const metrics = normalizeMetrics({
      credibility_score: data.credibility_score,
      win_rate: data.win_rate,
      roi_cost_weighted: data.roi_cost_weighted,
      brier_mean: data.brier_mean,
      profit_factor: data.profit_factor,
      clv_24h_cost_weighted: data.clv_24h_cost_weighted,
    });

    // Calculate overall score (weighted average of normalized metrics)
    const weights = [0.25, 0.15, 0.20, 0.20, 0.10, 0.10]; // Credibility, WinRate, ROI, Accuracy, Consistency, Edge
    const overallScore = metrics.reduce(
      (sum, metric, i) => sum + metric.normalized * weights[i],
      0
    );

    return NextResponse.json({
      success: true,
      fingerprint: {
        wallet_id: walletId,
        window_id: window,
        metrics,
        overall_score: Math.round(overallScore),
        tier: data.tier ?? 'UNCLASSIFIED',
        tier_label: getTierLabel(data.tier),
        computed_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching wallet fingerprint:', error);
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
