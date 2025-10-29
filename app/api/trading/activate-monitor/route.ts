/**
 * Wallet Monitor Activation API
 * POST /api/trading/activate-monitor
 *
 * Activates copy trading monitor for a strategy with ORCHESTRATOR node
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { strategy_id, config } = body;

    if (!strategy_id || !config) {
      return NextResponse.json(
        { error: 'strategy_id and config are required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Store monitoring configuration in strategy metadata
    const { error: updateError } = await supabase
      .from('strategy_definitions')
      .update({
        copy_trading_config: {
          enabled: config.enabled,
          poll_interval_seconds: config.poll_interval_seconds,
          owrr_thresholds: config.owrr_thresholds,
          max_latency_seconds: config.max_latency_seconds,
          tracked_categories: config.tracked_categories,
          activated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('strategy_id', strategy_id);

    if (updateError) {
      console.error('[ActivateMonitor] Failed to update strategy:', updateError);
      return NextResponse.json(
        { error: 'Failed to activate copy trading', details: updateError.message },
        { status: 500 }
      );
    }

    console.log(`[ActivateMonitor] Copy trading activated for strategy ${strategy_id}`, {
      poll_interval: config.poll_interval_seconds,
      max_latency: config.max_latency_seconds,
      owrr_thresholds: config.owrr_thresholds,
    });

    return NextResponse.json({
      success: true,
      strategy_id,
      message: 'Copy trading monitor activated',
      config: {
        poll_interval_seconds: config.poll_interval_seconds,
        max_latency_seconds: config.max_latency_seconds,
        owrr_thresholds: config.owrr_thresholds,
      },
    });
  } catch (error) {
    console.error('[ActivateMonitor] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to activate copy trading',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * Get active copy trading monitors
 * GET /api/trading/activate-monitor
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: strategies, error } = await supabase
      .from('strategy_definitions')
      .select('strategy_id, strategy_name, copy_trading_config, is_active')
      .not('copy_trading_config', 'is', null)
      .eq('is_active', true);

    if (error) {
      console.error('[ActivateMonitor] Failed to fetch active monitors:', error);
      return NextResponse.json(
        { error: 'Failed to fetch active monitors', details: error.message },
        { status: 500 }
      );
    }

    // Filter to only strategies where copy_trading is enabled
    const activeMonitors = (strategies || []).filter(
      (s: any) => s.copy_trading_config?.enabled === true
    );

    return NextResponse.json({
      success: true,
      count: activeMonitors.length,
      monitors: activeMonitors.map((s: any) => ({
        strategy_id: s.strategy_id,
        strategy_name: s.strategy_name,
        config: s.copy_trading_config,
        is_active: s.is_active,
      })),
    });
  } catch (error) {
    console.error('[ActivateMonitor] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch active monitors',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * Deactivate copy trading monitor
 * DELETE /api/trading/activate-monitor?strategy_id=xxx
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const strategy_id = searchParams.get('strategy_id');

    if (!strategy_id) {
      return NextResponse.json(
        { error: 'strategy_id is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Update strategy to disable copy trading
    const { error: updateError } = await supabase
      .from('strategy_definitions')
      .update({
        copy_trading_config: null,
        updated_at: new Date().toISOString(),
      })
      .eq('strategy_id', strategy_id);

    if (updateError) {
      console.error('[ActivateMonitor] Failed to deactivate:', updateError);
      return NextResponse.json(
        { error: 'Failed to deactivate copy trading', details: updateError.message },
        { status: 500 }
      );
    }

    console.log(`[ActivateMonitor] Copy trading deactivated for strategy ${strategy_id}`);

    return NextResponse.json({
      success: true,
      strategy_id,
      message: 'Copy trading monitor deactivated',
    });
  } catch (error) {
    console.error('[ActivateMonitor] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to deactivate copy trading',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
