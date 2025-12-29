/**
 * Wallet Cohort API
 *
 * Query ClickHouse for percentile-based wallet cohorts.
 * Used by Strategy Builder WalletCohortNode.
 *
 * Returns a stable schema that can later be backed by Tier A leaderboard.
 *
 * POST /api/wallets/cohort
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clickhouse } from '@/lib/clickhouse/client';

// ============================================================================
// Request Schema
// ============================================================================

const cohortSchema = z.object({
  // PnL percentile filter (top X%)
  pnl_percentile: z.number().min(0).max(100).optional(),

  // Minimum trade count
  min_trade_count: z.number().min(0).optional(),

  // CLOB-only filter (if derivable from data)
  clob_only: z.boolean().optional(),

  // Omega percentile filter (placeholder - disabled until Terminal 1 ready)
  omega_percentile: z.number().min(0).max(100).optional(),

  // Limit results
  limit: z.number().min(1).max(500).optional().default(50),

  // Time window
  time_window: z.enum(['7d', '30d', '90d', 'lifetime']).optional().default('30d'),
});

export type CohortRequest = z.infer<typeof cohortSchema>;

// ============================================================================
// Response Types
// ============================================================================

export interface WalletCohortMember {
  wallet_address: string;
  realized_pnl_estimate: number | null;
  trade_count: number;
  clob_only: boolean | null;
  last_trade: string | null;
  omega_ratio: number | null;
  win_rate: number | null;
  confidence_label: 'INTERNAL_PRE_TIER_A' | 'TIER_A' | 'VERIFIED';
}

export interface CohortResponse {
  success: boolean;
  data?: {
    wallets: WalletCohortMember[];
    filters_applied: CohortRequest;
    total_matching: number;
    source: 'clickhouse' | 'mock';
  };
  error?: string;
}

// ============================================================================
// Handler
// ============================================================================

export async function POST(request: Request): Promise<NextResponse<CohortResponse>> {
  try {
    const body = await request.json();

    // Validate request
    const parseResult = cohortSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid request: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
        },
        { status: 400 }
      );
    }

    const filters = parseResult.data;

    // Check for Omega filter - disabled until Terminal 1 is ready
    if (filters.omega_percentile !== undefined) {
      return NextResponse.json(
        {
          success: false,
          error: 'Omega percentile filtering is coming soon. Use pnl_percentile for now.',
        },
        { status: 400 }
      );
    }

    // Build the query
    const query = buildCohortQuery(filters);

    try {
      const result = await clickhouse.query({
        query,
        format: 'JSONEachRow',
      });

      const rows = await result.json() as any[];

      // Transform to response format
      const wallets: WalletCohortMember[] = rows.map(row => ({
        wallet_address: row.wallet_address,
        realized_pnl_estimate: row.realized_pnl_estimate !== null ? parseFloat(row.realized_pnl_estimate) : null,
        trade_count: parseInt(row.trade_count) || 0,
        clob_only: row.clob_only !== undefined ? Boolean(row.clob_only) : null,
        last_trade: row.last_trade || null,
        omega_ratio: row.omega_ratio !== null ? parseFloat(row.omega_ratio) : null,
        win_rate: row.win_rate !== null ? parseFloat(row.win_rate) : null,
        confidence_label: 'INTERNAL_PRE_TIER_A' as const,
      }));

      return NextResponse.json({
        success: true,
        data: {
          wallets,
          filters_applied: filters,
          total_matching: wallets.length,
          source: 'clickhouse' as const,
        },
      });
    } catch (dbError: any) {
      console.error('[WalletCohort] ClickHouse error:', dbError);

      // Return mock data in development if DB fails
      if (process.env.NODE_ENV === 'development') {
        return NextResponse.json({
          success: true,
          data: {
            wallets: getMockWallets(filters),
            filters_applied: filters,
            total_matching: 10,
            source: 'mock' as const,
          },
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: `Database error: ${dbError.message}`,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('[WalletCohort] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error',
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// Query Builder
// ============================================================================

function buildCohortQuery(filters: CohortRequest): string {
  const { pnl_percentile, min_trade_count, limit, time_window } = filters;

  // Base query using wallet_metrics_complete or available PnL table
  // Using a CTE to calculate percentiles
  let query = `
    WITH ranked_wallets AS (
      SELECT
        wallet_address,
        metric_9_net_pnl as realized_pnl_estimate,
        metric_22_resolved_bets as trade_count,
        metric_2_omega_net as omega_ratio,
        metric_12_win_rate as win_rate,
        max(calculated_at) as last_trade,
        percent_rank() OVER (ORDER BY metric_9_net_pnl DESC) as pnl_percentile_rank
      FROM wallet_metrics_complete
      WHERE window = '${time_window}'
        AND metric_9_net_pnl IS NOT NULL
  `;

  // Add trade count filter
  if (min_trade_count !== undefined && min_trade_count > 0) {
    query += `\n        AND metric_22_resolved_bets >= ${min_trade_count}`;
  }

  query += `
      GROUP BY wallet_address, metric_9_net_pnl, metric_22_resolved_bets, metric_2_omega_net, metric_12_win_rate
    )
    SELECT
      wallet_address,
      realized_pnl_estimate,
      trade_count,
      NULL as clob_only,
      toString(last_trade) as last_trade,
      omega_ratio,
      win_rate
    FROM ranked_wallets
  `;

  // Apply percentile filter
  if (pnl_percentile !== undefined) {
    const percentileThreshold = (100 - pnl_percentile) / 100;
    query += `\n    WHERE pnl_percentile_rank <= ${percentileThreshold}`;
  }

  query += `
    ORDER BY realized_pnl_estimate DESC
    LIMIT ${limit}
  `;

  return query;
}

// ============================================================================
// Mock Data (for development)
// ============================================================================

function getMockWallets(filters: CohortRequest): WalletCohortMember[] {
  const mockWallets: WalletCohortMember[] = [];
  const count = Math.min(filters.limit || 50, 20);

  for (let i = 0; i < count; i++) {
    mockWallets.push({
      wallet_address: `0x${(Math.random().toString(16).slice(2) + '0'.repeat(40)).slice(0, 40)}`,
      realized_pnl_estimate: parseFloat((Math.random() * 100000 - 10000).toFixed(2)),
      trade_count: Math.floor(Math.random() * 500) + 10,
      clob_only: Math.random() > 0.3,
      last_trade: new Date(Date.now() - Math.random() * 7 * 24 * 3600 * 1000).toISOString(),
      omega_ratio: parseFloat((1 + Math.random() * 3).toFixed(3)),
      win_rate: parseFloat((0.4 + Math.random() * 0.3).toFixed(3)),
      confidence_label: 'INTERNAL_PRE_TIER_A' as const,
    });
  }

  // Sort by PnL descending
  mockWallets.sort((a, b) => (b.realized_pnl_estimate || 0) - (a.realized_pnl_estimate || 0));

  return mockWallets;
}

// ============================================================================
// GET endpoint for listing cohort metadata
// ============================================================================

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    success: true,
    data: {
      available_filters: {
        pnl_percentile: {
          type: 'number',
          min: 0,
          max: 100,
          description: 'Filter to top X% by realized PnL',
        },
        min_trade_count: {
          type: 'number',
          min: 0,
          description: 'Minimum number of resolved trades',
        },
        clob_only: {
          type: 'boolean',
          description: 'Filter to CLOB-only traders (coming soon)',
        },
        omega_percentile: {
          type: 'number',
          min: 0,
          max: 100,
          description: 'Filter to top X% by Omega ratio (COMING SOON - Terminal 1 dependency)',
          disabled: true,
        },
        time_window: {
          type: 'enum',
          options: ['7d', '30d', '90d', 'lifetime'],
          default: '30d',
          description: 'Time window for metrics calculation',
        },
        limit: {
          type: 'number',
          min: 1,
          max: 500,
          default: 50,
          description: 'Maximum number of wallets to return',
        },
      },
      integration_point: 'Terminal 1 Tier A leaderboard will provide verified wallet cohorts',
      confidence_labels: {
        INTERNAL_PRE_TIER_A: 'Calculated from internal data, not yet verified',
        TIER_A: 'Verified against Tier A leaderboard (coming soon)',
        VERIFIED: 'Fully verified with external sources',
      },
    },
  });
}
