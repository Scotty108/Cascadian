/**
 * Wallet Monitor API Endpoint
 *
 * GET /api/trading/monitor - Check monitor status and recent signals
 * POST /api/trading/monitor - Trigger manual poll
 *
 * @module app/api/trading/monitor
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { walletMonitor } from '@/lib/trading/wallet-monitor';

// ============================================================================
// Types
// ============================================================================

interface MonitorStatusResponse {
  success: boolean;
  status: {
    enabled: boolean;
    mock_trading: boolean;
    last_poll?: Date | null;
    recent_signals?: any[];
    recent_trades?: any[];
  };
  error?: string;
}

interface TriggerPollResponse {
  success: boolean;
  poll_result?: any;
  error?: string;
}

// ============================================================================
// GET Handler - Status
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse<MonitorStatusResponse>> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get recent signals (last 24 hours)
    const { data: signals, error: signalsError } = await supabase
      .from('copy_trade_signals')
      .select('*')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    if (signalsError) {
      console.error('[Monitor] Error fetching signals:', signalsError);
    }

    // Get recent trades (last 24 hours)
    const { data: trades, error: tradesError } = await supabase
      .from('copy_trades')
      .select('*')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    if (tradesError) {
      console.error('[Monitor] Error fetching trades:', tradesError);
    }

    // Get last poll timestamp from most recent signal
    const lastPoll = signals && signals.length > 0
      ? new Date(signals[0].signal_received_at)
      : null;

    return NextResponse.json({
      success: true,
      status: {
        enabled: process.env.TRADING_ENABLED === 'true',
        mock_trading: process.env.MOCK_TRADING !== 'false',
        last_poll: lastPoll,
        recent_signals: signals || [],
        recent_trades: trades || [],
      },
    });
  } catch (error) {
    console.error('[Monitor] Error in GET:', error);

    return NextResponse.json(
      {
        success: false,
        status: {
          enabled: false,
          mock_trading: true,
        },
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST Handler - Trigger Manual Poll
// ============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<TriggerPollResponse>> {
  try {
    // Verify authorization (optional - add your auth logic here)
    const authHeader = request.headers.get('authorization');
    const expectedAuth = process.env.CRON_SECRET;

    if (expectedAuth && authHeader !== `Bearer ${expectedAuth}`) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    console.log('[Monitor] Triggering manual poll...');

    // Execute poll
    const pollResult = await walletMonitor.poll();

    console.log('[Monitor] Manual poll complete:', pollResult);

    return NextResponse.json({
      success: true,
      poll_result: pollResult,
    });
  } catch (error) {
    console.error('[Monitor] Error in POST:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
