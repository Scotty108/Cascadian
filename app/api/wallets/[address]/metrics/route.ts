/**
 * Wallet Metrics API Endpoint
 *
 * GET /api/wallets/[address]/metrics?window=30d|90d|180d|lifetime
 *
 * Returns Austin's Phase 1 metrics (30 core metrics) for a wallet
 */

import { NextRequest, NextResponse } from 'next/server'
import { WalletMetricsCalculator, MetricWindow } from '@/lib/metrics/wallet-metrics-calculator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params
    const { searchParams } = new URL(request.url)

    // Parse window parameter
    const windowParam = searchParams.get('window') || '90d'
    const validWindows = ['30d', '90d', '180d', 'lifetime']

    if (!validWindows.includes(windowParam)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid window. Must be one of: ${validWindows.join(', ')}`,
        },
        { status: 400 }
      )
    }

    const window: MetricWindow = {
      window: windowParam as MetricWindow['window'],
    }

    console.log(`📊 Calculating metrics for ${address} (${window.window})...`)

    // Create calculator and load trades
    const calculator = new WalletMetricsCalculator(address)
    await calculator.loadTrades()

    // Calculate metrics
    const metrics = await calculator.calculateMetrics(window)

    // Format response
    const response = {
      success: true,
      data: {
        wallet_address: address,
        window: window.window,
        calculated_at: metrics.calculated_at.toISOString(),

        // Sample stats
        sample: {
          total_trades: metrics.total_trades,
          resolved_trades: metrics.resolved_trades,
          track_record_days: metrics.track_record_days,
          bets_per_week: metrics.bets_per_week,
        },

        // Omega metrics (Austin's core focus)
        omega: {
          omega_gross: formatNumber(metrics.omega_gross, 4),
          omega_net: formatNumber(metrics.omega_net, 4),
          gain_to_pain: formatNumber(metrics.gain_to_pain, 4),
          profit_factor: formatNumber(metrics.profit_factor, 4),
        },

        // P&L metrics
        pnl: {
          net_pnl_usd: formatNumber(metrics.net_pnl_usd, 2),
          net_pnl_pct: formatNumber(metrics.net_pnl_pct, 2),
          total_gains: formatNumber(metrics.total_gains, 2),
          total_losses: formatNumber(metrics.total_losses, 2),
          total_fees: formatNumber(metrics.total_fees, 2),
        },

        // Performance metrics
        performance: {
          hit_rate: formatNumber(metrics.hit_rate, 4),
          avg_win_usd: formatNumber(metrics.avg_win_usd, 2),
          avg_loss_usd: formatNumber(metrics.avg_loss_usd, 2),
          win_count: metrics.win_count,
          loss_count: metrics.loss_count,
        },

        // Risk metrics
        risk: {
          sharpe: formatNumber(metrics.sharpe, 4),
          sortino: formatNumber(metrics.sortino, 4),
          max_drawdown: formatNumber(metrics.max_drawdown, 4),
          avg_drawdown: formatNumber(metrics.avg_drawdown, 4),
          time_in_drawdown_pct: formatNumber(metrics.time_in_drawdown_pct, 2),
          ulcer_index: formatNumber(metrics.ulcer_index, 4),
          downside_deviation: formatNumber(metrics.downside_deviation, 4),
          max_single_trade_loss_pct: formatNumber(metrics.max_single_trade_loss_pct, 2),
        },

        // Behavioral metrics
        behavior: {
          concentration_hhi: formatNumber(metrics.concentration_hhi, 4),
          stake_sizing_volatility: formatNumber(metrics.stake_sizing_volatility, 2),
          yes_no_bias_count_pct: formatNumber(metrics.yes_no_bias_count_pct, 2),
          yes_no_bias_notional_pct: formatNumber(metrics.yes_no_bias_notional_pct, 2),
          avg_holding_period_hours: formatNumber(metrics.avg_holding_period_hours, 2),
        },

        // Activity metrics
        activity: {
          resolved_bets: metrics.resolved_bets,
          track_record_days: metrics.track_record_days_metric,
          bets_per_week: formatNumber(metrics.bets_per_week_metric, 2),
        },
      },
      meta: {
        phase: 1,
        total_metrics_available: 30,
        austin_spec_version: '2025-10-25',
        note: 'Phase 1 implements 30 core metrics from Austin\'s 102-metric specification',
      },
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (error: any) {
    console.error('Error calculating wallet metrics:', error)

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to calculate metrics',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}

// Helper to format numbers (null-safe)
function formatNumber(value: number | null, decimals: number): number | null {
  if (value === null || value === undefined) return null
  if (!isFinite(value)) return null
  return parseFloat(value.toFixed(decimals))
}
