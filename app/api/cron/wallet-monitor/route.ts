/**
 * Wallet Monitor Cron Job
 * GET /api/cron/wallet-monitor
 *
 * Called every 30-60 seconds by Vercel cron
 * Polls for new trades from tracked wallets and generates copy signals
 */

import { NextRequest, NextResponse } from 'next/server';
import { walletMonitor } from '@/lib/trading/wallet-monitor';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds max

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    console.log('[WalletMonitorCron] Starting poll cycle');

    // Execute wallet monitor poll
    const result = await walletMonitor.poll();

    const executionTime = Date.now() - startTime;

    console.log('[WalletMonitorCron] Poll complete', {
      strategiesChecked: result.strategiesChecked,
      newTrades: result.newTrades,
      signalsGenerated: result.signalsGenerated,
      decisionsBy: result.decisionsBy,
      executionTimeMs: executionTime,
      errors: result.errors?.length || 0,
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      execution_time_ms: executionTime,
      ...result,
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error('[WalletMonitorCron] Poll failed:', errorMsg);

    return NextResponse.json(
      {
        success: false,
        timestamp: new Date().toISOString(),
        execution_time_ms: executionTime,
        error: errorMsg,
        strategiesChecked: 0,
        newTrades: 0,
        signalsGenerated: 0,
        decisionsBy: { copy: 0, skip: 0, copy_reduced: 0, error: 1 },
      },
      { status: 500 }
    );
  }
}
