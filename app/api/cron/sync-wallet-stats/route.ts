/**
 * Cron: Sync Wallet Stats Table
 *
 * Rebuilds pm_wallet_stats_v1 from pm_wallet_position_fact_v1.
 * This is a simple aggregation - no complex window functions.
 *
 * Formula:
 * - realized_pnl = cash_flow + final_shares * payout_norm (for resolved)
 * - total_pnl = realized_pnl + unrealized (unrealized = cash_flow + shares * 0.5 for unresolved)
 * - gains = sum of positive position PnLs
 * - losses = abs(sum of negative position PnLs)
 * - omega = gains / losses
 * - is_clob_only = 1 if no positions have external_inventory flag
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Every 30 minutes (after position-fact sync)
 */

import { NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

interface SyncResult {
  success: boolean;
  walletsProcessed: number;
  durationMs: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!cronSecret && !isProduction) {
    console.warn('[sync-wallet-stats] CRON_SECRET not set (dev mode) - allowing request');
    return true;
  }

  if (!cronSecret && isProduction) {
    console.error('[sync-wallet-stats] CRON_SECRET not set in production - rejecting');
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const url = new URL(request.url);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam === cronSecret) {
    return true;
  }

  return false;
}

export async function GET(request: Request) {
  const startTime = Date.now();

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[sync-wallet-stats] Starting rebuild...');

    // Force FINAL to get deduplicated rows from ReplacingMergeTree
    const rebuildQuery = `
      INSERT INTO pm_wallet_stats_v1
        (wallet, total_pnl, realized_pnl, gains, losses, omega, n_trades, n_markets, n_positions, first_trade_at, last_trade_at, external_inventory_positions, is_clob_only)
      SELECT
        wallet,
        -- Total PnL: realized + unrealized (unresolved at 0.5 mark)
        sumIf(cash_flow_usd + final_shares * coalesce(payout_norm, 0), is_resolved = 1) +
        sumIf(cash_flow_usd + final_shares * 0.5, is_resolved = 0) AS total_pnl,
        -- Realized PnL: only resolved positions
        sumIf(cash_flow_usd + final_shares * payout_norm, is_resolved = 1) AS realized_pnl,
        -- Gains: sum of positive position PnLs (resolved only for stability)
        sumIf(
          cash_flow_usd + final_shares * payout_norm,
          is_resolved = 1 AND (cash_flow_usd + final_shares * payout_norm) > 0
        ) AS gains,
        -- Losses: abs of negative position PnLs
        -sumIf(
          cash_flow_usd + final_shares * payout_norm,
          is_resolved = 1 AND (cash_flow_usd + final_shares * payout_norm) < 0
        ) AS losses,
        -- Omega: gains / losses (handle div by zero)
        if(
          sumIf(cash_flow_usd + final_shares * payout_norm, is_resolved = 1 AND (cash_flow_usd + final_shares * payout_norm) < 0) = 0,
          if(sumIf(cash_flow_usd + final_shares * payout_norm, is_resolved = 1 AND (cash_flow_usd + final_shares * payout_norm) > 0) > 0, 999, 0),
          sumIf(cash_flow_usd + final_shares * payout_norm, is_resolved = 1 AND (cash_flow_usd + final_shares * payout_norm) > 0) /
          -sumIf(cash_flow_usd + final_shares * payout_norm, is_resolved = 1 AND (cash_flow_usd + final_shares * payout_norm) < 0)
        ) AS omega,
        -- Trade/market counts
        sum(trade_count) AS n_trades,
        uniqExact(condition_id) AS n_markets,
        count() AS n_positions,
        min(first_trade_at) AS first_trade_at,
        max(last_trade_at) AS last_trade_at,
        -- External inventory detection
        countIf(is_external_inventory = 1) AS external_inventory_positions,
        if(countIf(is_external_inventory = 1) = 0, 1, 0) AS is_clob_only
      FROM pm_wallet_position_fact_v1 FINAL
      GROUP BY wallet
    `;

    await clickhouse.command({ query: rebuildQuery });

    // Count wallets processed
    const countResult = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_wallet_stats_v1 FINAL`,
      format: 'JSONEachRow',
    });
    const walletsProcessed = Number(((await countResult.json()) as any[])[0]?.cnt || 0);

    const durationMs = Date.now() - startTime;

    const result: SyncResult = {
      success: true,
      walletsProcessed,
      durationMs,
    };

    console.log(`[sync-wallet-stats] Complete: ${walletsProcessed.toLocaleString()} wallets in ${durationMs}ms`);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[sync-wallet-stats] Error:', error);

    const result: SyncResult = {
      success: false,
      walletsProcessed: 0,
      durationMs: Date.now() - startTime,
      error: error.message,
    };

    return NextResponse.json(result, { status: 500 });
  }
}
