/**
 * DUEL Metrics API Endpoint
 *
 * GET /api/wallets/[address]/duel
 *
 * Returns dual PnL metrics (economic + cash) with data coverage and rankability.
 * This is the production endpoint for wallet detail pages and leaderboard data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createDuelEngine, DuelMetrics, DataCoverage } from '@/lib/pnl/duelEngine';
import { ClobOnlyCheckResult } from '@/lib/pnl/walletClassifier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// API contract version - increment when breaking changes occur
const ENGINE_VERSION = 'duel_v1';
const MAPPING_VERSION = 'pm_token_to_condition_map_v5';

export interface DuelApiResponse {
  success: true;
  data: {
    wallet: string;

    // Primary metrics
    realized_economic: number;
    realized_cash: number;
    unrealized: number;
    total_economic: number;
    total_cash: number;

    // Decomposition (for debugging/transparency)
    decomposition: {
      resolved_trade_cashflow: number;
      unresolved_trade_cashflow: number;
      synthetic_redemptions: number;
      explicit_redemptions: number;
    };

    // Delta analysis
    deltas: {
      economic_vs_cash: number;
      synthetic_vs_explicit: number;
    };

    // Activity
    activity: {
      positions_count: number;
      resolved_positions: number;
      unresolved_positions: number;
      markets_traded: number;
      total_volume: number;
    };

    // Win rate (market-level, not trade-level)
    win_rate: {
      markets_won: number;
      markets_lost: number;
      market_win_rate: number; // as percentage (0-100)
    };

    // Recency metrics (from mapped trades only)
    recency: {
      net_cashflow_30d: number; // sell - buy (NOT PnL - accumulating wallets will be negative)
      volume_30d: number;
      trades_30d: number;
      last_trade_ts: string | null;
    };

    // Omega metrics (180-day trailing) - market-level PnL ratio
    omega: {
      omega_180d: number; // sum(gains) / sum(losses), capped at 100 if no losses
      sum_gains_180d: number;
      sum_losses_180d: number;
      decided_markets_180d: number; // markets resolved in 180d window with $5+ cost basis
      wins_180d: number;
      losses_180d: number;
    };

    // Data quality
    data_coverage: DataCoverage;

    // Classification
    classification: {
      is_clob_only: boolean;
      clob_trade_count: number;
      split_merge_count: number;
      erc1155_transfer_count: number;
      reasons: string[];
    };

    // Gates
    gates: {
      unmapped_cashflow_passes: boolean;
    };

    // Final rankability
    is_rankable: boolean;
  };
  meta: {
    computed_at: string;
    engine_version: string;
    mapping_version: string;
  };
}

export interface DuelApiError {
  success: false;
  error: string;
  details?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
): Promise<NextResponse<DuelApiResponse | DuelApiError>> {
  const computedAt = new Date().toISOString();

  try {
    const { address } = await params;

    // Validate address format
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid wallet address. Must be a 42-character hex string starting with 0x.',
        },
        { status: 400 }
      );
    }

    console.log(`[DUEL] Computing metrics for ${address}...`);

    const engine = createDuelEngine();
    const metrics = await engine.compute(address);

    const response: DuelApiResponse = {
      success: true,
      data: {
        wallet: metrics.wallet,

        // Primary metrics
        realized_economic: roundTo(metrics.realized_economic, 2),
        realized_cash: roundTo(metrics.realized_cash, 2),
        unrealized: roundTo(metrics.unrealized, 2),
        total_economic: roundTo(metrics.total_economic, 2),
        total_cash: roundTo(metrics.total_cash, 2),

        // Decomposition
        decomposition: {
          resolved_trade_cashflow: roundTo(metrics.resolved_trade_cashflow, 2),
          unresolved_trade_cashflow: roundTo(metrics.unresolved_trade_cashflow, 2),
          synthetic_redemptions: roundTo(metrics.synthetic_redemptions, 2),
          explicit_redemptions: roundTo(metrics.explicit_redemptions, 2),
        },

        // Delta analysis
        deltas: {
          economic_vs_cash: roundTo(metrics.economic_vs_cash_delta, 2),
          synthetic_vs_explicit: roundTo(metrics.synthetic_vs_explicit_delta, 2),
        },

        // Activity
        activity: {
          positions_count: metrics.positions_count,
          resolved_positions: metrics.resolved_positions,
          unresolved_positions: metrics.unresolved_positions,
          markets_traded: metrics.markets_traded,
          total_volume: roundTo(metrics.total_volume, 2),
        },

        // Win rate (market-level)
        win_rate: {
          markets_won: metrics.markets_won,
          markets_lost: metrics.markets_lost,
          market_win_rate: roundTo(metrics.market_win_rate * 100, 1), // as percentage
        },

        // Recency metrics (mapped trades only)
        recency: {
          net_cashflow_30d: roundTo(metrics.net_cashflow_30d, 2),
          volume_30d: roundTo(metrics.volume_30d, 2),
          trades_30d: metrics.trades_30d,
          last_trade_ts: metrics.last_trade_ts,
        },

        // Omega metrics (180-day trailing)
        omega: {
          omega_180d: roundTo(metrics.omega_180d, 2),
          sum_gains_180d: roundTo(metrics.sum_gains_180d, 2),
          sum_losses_180d: roundTo(metrics.sum_losses_180d, 2),
          decided_markets_180d: metrics.decided_markets_180d,
          wins_180d: metrics.wins_180d,
          losses_180d: metrics.losses_180d,
        },

        // Data quality
        data_coverage: {
          total_trades: metrics.data_coverage.total_trades,
          total_usdc: roundTo(metrics.data_coverage.total_usdc, 2),
          mapped_trades: metrics.data_coverage.mapped_trades,
          mapped_usdc: roundTo(metrics.data_coverage.mapped_usdc, 2),
          trade_coverage_pct: roundTo(metrics.data_coverage.trade_coverage_pct, 2),
          usdc_coverage_pct: roundTo(metrics.data_coverage.usdc_coverage_pct, 2),
          unmapped_trades: metrics.data_coverage.unmapped_trades,
          unmapped_usdc: roundTo(metrics.data_coverage.unmapped_usdc, 2),
          unmapped_net_cashflow: roundTo(metrics.data_coverage.unmapped_net_cashflow, 2),
          rankability_tier: metrics.data_coverage.rankability_tier,
          is_high_coverage: metrics.data_coverage.is_high_coverage,
        },

        // Classification
        classification: {
          is_clob_only: metrics.clob_only_check.is_clob_only,
          clob_trade_count: metrics.clob_only_check.clob_trade_count,
          split_merge_count: metrics.clob_only_check.split_merge_count,
          erc1155_transfer_count: metrics.clob_only_check.erc1155_transfer_count,
          reasons: metrics.clob_only_check.reasons,
        },

        // Gates
        gates: {
          unmapped_cashflow_passes: metrics.unmapped_cashflow_passes_gate,
        },

        // Final rankability
        is_rankable: metrics.is_rankable,
      },
      meta: {
        computed_at: computedAt,
        engine_version: ENGINE_VERSION,
        mapping_version: MAPPING_VERSION,
      },
    };

    console.log(
      `[DUEL] ${address}: economic=${response.data.realized_economic}, tier=${response.data.data_coverage.rankability_tier}, rankable=${response.data.is_rankable}`
    );

    return NextResponse.json(response, {
      headers: {
        // No caching - compute fresh each time for accuracy
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[DUEL] Error computing metrics:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to compute DUEL metrics',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

function roundTo(value: number, decimals: number): number {
  if (!isFinite(value)) return 0;
  return parseFloat(value.toFixed(decimals));
}
