/**
 * DUEL Metrics Refresh Cron Job
 *
 * Refreshes the wallet_duel_metrics_latest table for leaderboard.
 * Runs periodically (hourly recommended) to keep metrics fresh.
 *
 * Modes:
 * - Default: Refresh stale wallets (oldest computed_at first)
 * - ?mode=new: Find and compute new CLOB-only wallets not yet in table
 * - ?mode=full: Full rebuild (use sparingly, very slow)
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/refresh-duel-metrics",
 *     "schedule": "0 * * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { clickhouse } from '@/lib/clickhouse/client';
import { createDuelEngine, DuelMetrics } from '@/lib/pnl/duelEngine';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

const TABLE_NAME = 'wallet_duel_metrics_latest';
const DEFAULT_BATCH_LIMIT = 50; // Wallets per cron run
const MIN_CLOB_TRADES = 10;
const STALE_HOURS = 6;

interface RefreshStats {
  mode: string;
  walletsProcessed: number;
  walletsRankable: number;
  errors: number;
  duration: number;
}

interface CandidateWallet {
  wallet_address: string;
  clob_trades?: number;
}

/**
 * Get wallets needing refresh (stale or never computed)
 */
async function getStaleWallets(limit: number): Promise<CandidateWallet[]> {
  const query = `
    WITH clob_active AS (
      SELECT
        lower(trader_wallet) as wallet_address,
        count() as trade_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING trade_count >= ${MIN_CLOB_TRADES}
    ),
    erc_activity AS (
      SELECT lower(address) as address, count() as transfer_count
      FROM (
        SELECT from_address as address FROM pm_erc1155_transfers
        UNION ALL
        SELECT to_address as address FROM pm_erc1155_transfers
      )
      GROUP BY lower(address)
    ),
    ctf_activity AS (
      SELECT lower(user_address) as address, countIf(event_type IN ('PositionSplit', 'PositionsMerge')) as split_merge_count
      FROM pm_ctf_events WHERE is_deleted = 0
      GROUP BY lower(user_address)
    ),
    candidates AS (
      SELECT c.wallet_address, c.trade_count
      FROM clob_active c
      LEFT JOIN erc_activity e ON c.wallet_address = lower(e.address)
      LEFT JOIN ctf_activity t ON c.wallet_address = t.address
      WHERE coalesce(e.transfer_count, 0) <= 10
        AND coalesce(t.split_merge_count, 0) = 0
    ),
    existing AS (
      SELECT wallet_address, computed_at
      FROM ${TABLE_NAME}
    )
    SELECT
      c.wallet_address,
      c.trade_count as clob_trades
    FROM candidates c
    LEFT JOIN existing e ON c.wallet_address = e.wallet_address
    WHERE e.wallet_address IS NULL
       OR e.computed_at < now() - INTERVAL ${STALE_HOURS} HOUR
    ORDER BY
      CASE WHEN e.wallet_address IS NULL THEN 0 ELSE 1 END,  -- New wallets first
      e.computed_at ASC NULLS FIRST,  -- Then oldest
      c.trade_count DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as CandidateWallet[];
}

/**
 * Get new candidate wallets not yet in table
 */
async function getNewWallets(limit: number): Promise<CandidateWallet[]> {
  const query = `
    WITH clob_active AS (
      SELECT lower(trader_wallet) as wallet_address, count() as trade_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING trade_count >= ${MIN_CLOB_TRADES}
    ),
    erc_activity AS (
      SELECT lower(address) as address, count() as transfer_count
      FROM (
        SELECT from_address as address FROM pm_erc1155_transfers
        UNION ALL
        SELECT to_address as address FROM pm_erc1155_transfers
      )
      GROUP BY lower(address)
    ),
    ctf_activity AS (
      SELECT lower(user_address) as address, countIf(event_type IN ('PositionSplit', 'PositionsMerge')) as split_merge_count
      FROM pm_ctf_events WHERE is_deleted = 0
      GROUP BY lower(user_address)
    ),
    candidates AS (
      SELECT c.wallet_address, c.trade_count
      FROM clob_active c
      LEFT JOIN erc_activity e ON c.wallet_address = lower(e.address)
      LEFT JOIN ctf_activity t ON c.wallet_address = t.address
      WHERE coalesce(e.transfer_count, 0) <= 10
        AND coalesce(t.split_merge_count, 0) = 0
    )
    SELECT c.wallet_address, c.trade_count as clob_trades
    FROM candidates c
    LEFT ANTI JOIN ${TABLE_NAME} e ON c.wallet_address = e.wallet_address
    ORDER BY c.trade_count DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as CandidateWallet[];
}

async function insertMetrics(metrics: DuelMetrics[]) {
  if (metrics.length === 0) return;

  const values = metrics
    .map((m) => {
      const wallet = m.wallet.replace(/'/g, "''");
      const lastTradeTs = m.last_trade_ts ? `'${m.last_trade_ts}'` : 'NULL';
      return `(
      '${wallet}',
      ${m.realized_economic}, ${m.realized_cash}, ${m.unrealized}, ${m.total_economic}, ${m.total_cash},
      ${m.resolved_trade_cashflow}, ${m.unresolved_trade_cashflow}, ${m.synthetic_redemptions}, ${m.explicit_redemptions},
      ${m.economic_vs_cash_delta}, ${m.synthetic_vs_explicit_delta},
      ${m.positions_count}, ${m.resolved_positions}, ${m.unresolved_positions}, ${m.markets_traded}, ${m.total_volume},
      ${m.markets_won}, ${m.markets_lost}, ${m.market_win_rate},
      ${m.net_cashflow_30d}, ${m.volume_30d}, ${m.trades_30d}, ${lastTradeTs},
      ${m.data_coverage.total_trades}, ${m.data_coverage.total_usdc}, ${m.data_coverage.mapped_trades}, ${m.data_coverage.mapped_usdc},
      ${m.data_coverage.trade_coverage_pct}, ${m.data_coverage.usdc_coverage_pct},
      ${m.data_coverage.unmapped_trades}, ${m.data_coverage.unmapped_usdc}, ${m.data_coverage.unmapped_net_cashflow},
      '${m.data_coverage.rankability_tier}',
      ${m.clob_only_check.is_clob_only ? 1 : 0}, ${m.clob_only_check.clob_trade_count},
      ${m.clob_only_check.split_merge_count}, ${m.clob_only_check.erc1155_transfer_count},
      ${m.unmapped_cashflow_passes_gate ? 1 : 0}, ${m.is_rankable ? 1 : 0}, now(), 'duel_v1', 'pm_token_to_condition_map_v5'
    )`;
    })
    .join(',\n');

  const insertQuery = `
    INSERT INTO ${TABLE_NAME}
    (wallet_address, realized_economic, realized_cash, unrealized, total_economic, total_cash,
     resolved_trade_cashflow, unresolved_trade_cashflow, synthetic_redemptions, explicit_redemptions,
     economic_vs_cash_delta, synthetic_vs_explicit_delta,
     positions_count, resolved_positions, unresolved_positions, markets_traded, total_volume,
     markets_won, markets_lost, market_win_rate,
     net_cashflow_30d, volume_30d, trades_30d, last_trade_ts,
     total_trades, total_usdc, mapped_trades, mapped_usdc, trade_coverage_pct, usdc_coverage_pct,
     unmapped_trades, unmapped_usdc, unmapped_net_cashflow, rankability_tier,
     is_clob_only, clob_trade_count, split_merge_count, erc1155_transfer_count,
     unmapped_cashflow_passes_gate, is_rankable, computed_at, engine_version, mapping_version)
    VALUES ${values}
  `;

  await clickhouse.command({ query: insertQuery });
}

async function refreshWallets(wallets: CandidateWallet[]): Promise<{ processed: number; rankable: number; errors: number }> {
  const engine = createDuelEngine();
  const results: DuelMetrics[] = [];
  let errors = 0;
  let rankable = 0;

  for (const wallet of wallets) {
    try {
      const metrics = await engine.compute(wallet.wallet_address);
      results.push(metrics);
      if (metrics.is_rankable) rankable++;
    } catch (err: any) {
      console.error(`[DUEL Cron] Error computing ${wallet.wallet_address}: ${err.message}`);
      errors++;
    }
  }

  // Batch insert
  if (results.length > 0) {
    await insertMetrics(results);
  }

  return { processed: results.length, rankable, errors };
}

import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'refresh-duel-metrics');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'stale';
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : DEFAULT_BATCH_LIMIT;

  console.log(`[DUEL Cron] Starting refresh, mode=${mode}, limit=${limit}`);

  try {
    // Verify table exists
    const checkTableQuery = `SELECT count() as cnt FROM system.tables WHERE name = '${TABLE_NAME}'`;
    const checkResult = await clickhouse.query({ query: checkTableQuery, format: 'JSONEachRow' });
    const tableExists = ((await checkResult.json()) as any[])[0]?.cnt > 0;

    if (!tableExists) {
      return NextResponse.json(
        {
          success: false,
          error: `Table ${TABLE_NAME} does not exist. Run build-duel-metrics-table.ts first.`,
        },
        { status: 500 }
      );
    }

    // Get wallets to process based on mode
    let wallets: CandidateWallet[];
    if (mode === 'new') {
      wallets = await getNewWallets(limit);
    } else {
      wallets = await getStaleWallets(limit);
    }

    console.log(`[DUEL Cron] Found ${wallets.length} wallets to process`);

    if (wallets.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No wallets need refresh',
        stats: { mode, walletsProcessed: 0, walletsRankable: 0, errors: 0, duration: Date.now() - startTime },
        timestamp: new Date().toISOString(),
      });
    }

    // Process wallets
    const { processed, rankable, errors } = await refreshWallets(wallets);

    const stats: RefreshStats = {
      mode,
      walletsProcessed: processed,
      walletsRankable: rankable,
      errors,
      duration: Date.now() - startTime,
    };

    console.log(`[DUEL Cron] Complete: ${processed} processed, ${rankable} rankable, ${errors} errors, ${stats.duration}ms`);

    return NextResponse.json({
      success: true,
      message: 'DUEL metrics refresh completed',
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[DUEL Cron] Failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
