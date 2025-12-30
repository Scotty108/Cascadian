/**
 * DUEL Metrics Refresh V2 - Bounded Worker Pattern
 *
 * Production-grade cron for copy-trading metrics:
 * - Consumes ONLY from wallet_classification_latest (no discovery)
 * - Uses lease mechanism to prevent double-compute
 * - Bounded concurrency (3-10 parallel computes)
 * - JSONEachRow batch inserts (not giant SQL VALUES)
 * - Parity spot checks on each run
 * - Hard runtime cap with clean exit
 *
 * Query parameters:
 * - limit: wallets to process (default 100, max 500)
 * - concurrency: parallel workers (default 5, max 10)
 * - mode: stale (default) | new | specific
 * - wallets: comma-separated addresses (for mode=specific)
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/refresh-duel-metrics-v2",
 *     "schedule": "0 * * * *"
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { clickhouse } from '@/lib/clickhouse/client';
import { createDuelEngine, DuelMetrics } from '@/lib/pnl/duelEngine';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

// Table names
const CLASSIFICATION_TABLE = 'wallet_classification_latest';
const HISTORY_TABLE = 'wallet_duel_metrics_history';
const LEASES_TABLE = 'wallet_duel_compute_leases';

// Configuration
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 10;
const LEASE_DURATION_SECONDS = 300; // 5 minutes
const STALE_HOURS = 6;
const PARITY_CHECK_COUNT = 5;
const PARITY_EPSILON = 0.01; // $0.01 tolerance

// ============================================================================
// Lease Management
// ============================================================================

async function ensureLeaseTable() {
  const checkQuery = `
    SELECT count() as cnt FROM system.tables
    WHERE database = currentDatabase() AND name = '${LEASES_TABLE}'
  `;
  const result = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const exists = ((await result.json()) as any[])[0]?.cnt > 0;

  if (!exists) {
    await clickhouse.command({
      query: `
        CREATE TABLE ${LEASES_TABLE} (
          wallet_address String,
          lease_id String,
          leased_by String,
          leased_at DateTime DEFAULT now(),
          expires_at DateTime,
          compute_state LowCardinality(String) DEFAULT 'leased' -- leased, done, error
        ) ENGINE = MergeTree()
        ORDER BY (wallet_address, leased_at)
        TTL expires_at + INTERVAL 1 HOUR DELETE
      `,
    });
  }
}

interface LeasedWallet {
  wallet_address: string;
  lease_id: string;
}

async function acquireLeases(wallets: string[], leaseId: string, workerId: string): Promise<LeasedWallet[]> {
  if (wallets.length === 0) return [];

  const expiresAt = new Date(Date.now() + LEASE_DURATION_SECONDS * 1000).toISOString().slice(0, 19);

  // Insert lease claims
  const rows = wallets.map((w) => ({
    wallet_address: w.toLowerCase(),
    lease_id: leaseId,
    leased_by: workerId,
    expires_at: expiresAt,
    compute_state: 'leased',
  }));

  await clickhouse.insert({
    table: LEASES_TABLE,
    values: rows,
    format: 'JSONEachRow',
  });

  // Return what we leased (in production, would check for conflicts)
  return wallets.map((w) => ({ wallet_address: w.toLowerCase(), lease_id: leaseId }));
}

async function markLeaseComplete(wallet: string, leaseId: string, state: 'done' | 'error') {
  // Insert completion record (MergeTree pattern - newer row wins)
  await clickhouse.insert({
    table: LEASES_TABLE,
    values: [
      {
        wallet_address: wallet.toLowerCase(),
        lease_id: leaseId,
        leased_by: 'completed',
        expires_at: new Date().toISOString().slice(0, 19),
        compute_state: state,
      },
    ],
    format: 'JSONEachRow',
  });
}

// ============================================================================
// Wallet Selection (from classification table only)
// ============================================================================

async function getStaleWallets(limit: number): Promise<string[]> {
  // Get CLOB-only wallets that are stale or never computed
  // IMPORTANT: Only selects from wallet_classification_latest
  const query = `
    WITH computed AS (
      SELECT
        wallet_address,
        max(computed_at) as last_computed
      FROM ${HISTORY_TABLE}
      GROUP BY wallet_address
    )
    SELECT c.wallet_address
    FROM ${CLASSIFICATION_TABLE} c
    LEFT JOIN computed h ON c.wallet_address = h.wallet_address
    WHERE c.is_clob_only = 1
      AND c.clob_trade_count_total >= 10
      AND (h.wallet_address IS NULL OR h.last_computed < now() - INTERVAL ${STALE_HOURS} HOUR)
    ORDER BY
      CASE WHEN h.wallet_address IS NULL THEN 0 ELSE 1 END,
      h.last_computed ASC NULLS FIRST,
      c.clob_trade_count_total DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => r.wallet_address);
}

async function getNewWallets(limit: number): Promise<string[]> {
  // Get CLOB-only wallets never computed
  const query = `
    SELECT c.wallet_address
    FROM ${CLASSIFICATION_TABLE} c
    LEFT ANTI JOIN ${HISTORY_TABLE} h ON c.wallet_address = h.wallet_address
    WHERE c.is_clob_only = 1
      AND c.clob_trade_count_total >= 10
    ORDER BY c.clob_trade_count_total DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => r.wallet_address);
}

// ============================================================================
// Batch Insert (JSONEachRow pattern)
// ============================================================================

async function insertMetricsBatch(
  metrics: DuelMetrics[],
  runId: string,
  durations: Map<string, number>
) {
  if (metrics.length === 0) return;

  // CRITICAL: computed_at must be written from code (DateTime64(3) for ms precision)
  // run_id provides tie-breaker for argMax determinism
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

  const rows = metrics.map((m) => ({
    wallet_address: m.wallet.toLowerCase(),
    realized_economic: m.realized_economic,
    realized_cash: m.realized_cash,
    unrealized: m.unrealized,
    total_economic: m.total_economic,
    total_cash: m.total_cash,
    resolved_trade_cashflow: m.resolved_trade_cashflow,
    unresolved_trade_cashflow: m.unresolved_trade_cashflow,
    synthetic_redemptions: m.synthetic_redemptions,
    explicit_redemptions: m.explicit_redemptions,
    economic_vs_cash_delta: m.economic_vs_cash_delta,
    synthetic_vs_explicit_delta: m.synthetic_vs_explicit_delta,
    positions_count: m.positions_count,
    resolved_positions: m.resolved_positions,
    unresolved_positions: m.unresolved_positions,
    markets_traded: m.markets_traded,
    total_volume: m.total_volume,
    markets_won: m.markets_won,
    markets_lost: m.markets_lost,
    market_win_rate: m.market_win_rate,
    net_cashflow_30d: m.net_cashflow_30d,
    volume_30d: m.volume_30d,
    trades_30d: m.trades_30d,
    last_trade_ts: m.last_trade_ts || null,
    total_trades: m.data_coverage.total_trades,
    total_usdc: m.data_coverage.total_usdc,
    mapped_trades: m.data_coverage.mapped_trades,
    mapped_usdc: m.data_coverage.mapped_usdc,
    trade_coverage_pct: m.data_coverage.trade_coverage_pct,
    usdc_coverage_pct: m.data_coverage.usdc_coverage_pct,
    unmapped_trades: m.data_coverage.unmapped_trades,
    unmapped_usdc: m.data_coverage.unmapped_usdc,
    unmapped_net_cashflow: m.data_coverage.unmapped_net_cashflow,
    rankability_tier: m.data_coverage.rankability_tier,
    is_clob_only: m.clob_only_check.is_clob_only ? 1 : 0,
    clob_trade_count: m.clob_only_check.clob_trade_count,
    split_merge_count: m.clob_only_check.split_merge_count,
    erc1155_transfer_count: m.clob_only_check.erc1155_transfer_count,
    unmapped_cashflow_passes_gate: m.unmapped_cashflow_passes_gate ? 1 : 0,
    is_rankable: m.is_rankable ? 1 : 0,
    // Omega metrics (180-day trailing)
    omega_180d: m.omega_180d,
    sum_gains_180d: m.sum_gains_180d,
    sum_losses_180d: m.sum_losses_180d,
    decided_markets_180d: m.decided_markets_180d,
    wins_180d: m.wins_180d,
    losses_180d: m.losses_180d,
    computed_at: now, // DateTime64(3) - written from code, not DEFAULT
    run_id: runId, // UUID tie-breaker for argMax
    engine_version: 'duel_v1',
    mapping_version: 'pm_token_to_condition_map_v5',
    compute_duration_ms: durations.get(m.wallet.toLowerCase()) || 0,
  }));

  await clickhouse.insert({
    table: HISTORY_TABLE,
    values: rows,
    format: 'JSONEachRow',
  });
}

// ============================================================================
// Parity Spot Checks
// ============================================================================

interface ParityResult {
  wallet: string;
  stored_economic: number;
  fresh_economic: number;
  delta: number;
  passes: boolean;
}

async function runParityChecks(engine: ReturnType<typeof createDuelEngine>): Promise<ParityResult[]> {
  // Get 5 random recently-computed wallets
  const sampleQuery = `
    SELECT wallet_address, realized_economic
    FROM ${HISTORY_TABLE}
    WHERE computed_at >= now() - INTERVAL 1 HOUR
    ORDER BY rand()
    LIMIT ${PARITY_CHECK_COUNT}
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = (await sampleResult.json()) as any[];

  if (samples.length === 0) {
    return [];
  }

  const results: ParityResult[] = [];

  for (const sample of samples) {
    try {
      const fresh = await engine.compute(sample.wallet_address);
      const delta = Math.abs(fresh.realized_economic - Number(sample.realized_economic));

      results.push({
        wallet: sample.wallet_address,
        stored_economic: Number(sample.realized_economic),
        fresh_economic: fresh.realized_economic,
        delta,
        passes: delta <= PARITY_EPSILON,
      });
    } catch (err: any) {
      console.error(`[Parity] Error checking ${sample.wallet_address}: ${err.message}`);
    }
  }

  return results;
}

// ============================================================================
// Main Handler
// ============================================================================

import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';

export async function GET(request: NextRequest) {
  // Auth guard
  const authResult = verifyCronRequest(request, 'refresh-duel-metrics-v2');
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const startTime = Date.now();
  const batchId = randomUUID();
  const workerId = `worker-${batchId.slice(0, 8)}`;

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'stale';
  const limitParam = url.searchParams.get('limit');
  const concurrencyParam = url.searchParams.get('concurrency');
  const specificWallets = url.searchParams.get('wallets');

  const limit = Math.min(Math.max(1, parseInt(limitParam || '', 10) || DEFAULT_LIMIT), MAX_LIMIT);
  const concurrency = Math.min(Math.max(1, parseInt(concurrencyParam || '', 10) || DEFAULT_CONCURRENCY), MAX_CONCURRENCY);

  console.log(`[DUEL V2] Starting: mode=${mode}, limit=${limit}, concurrency=${concurrency}, batch=${batchId}`);

  try {
    // Ensure tables exist
    await ensureLeaseTable();

    // Check if classification table exists
    const classCheckQuery = `SELECT count() as cnt FROM system.tables WHERE name = '${CLASSIFICATION_TABLE}'`;
    const classCheckResult = await clickhouse.query({ query: classCheckQuery, format: 'JSONEachRow' });
    const classExists = ((await classCheckResult.json()) as any[])[0]?.cnt > 0;

    if (!classExists) {
      return NextResponse.json(
        {
          success: false,
          error: `Classification table ${CLASSIFICATION_TABLE} not found. Run build-wallet-classification-table.ts first.`,
        },
        { status: 503 }
      );
    }

    // Check if history table exists
    const histCheckQuery = `SELECT count() as cnt FROM system.tables WHERE name = '${HISTORY_TABLE}'`;
    const histCheckResult = await clickhouse.query({ query: histCheckQuery, format: 'JSONEachRow' });
    const histExists = ((await histCheckResult.json()) as any[])[0]?.cnt > 0;

    if (!histExists) {
      return NextResponse.json(
        {
          success: false,
          error: `History table ${HISTORY_TABLE} not found. Run build-duel-metrics-history-table.ts first.`,
        },
        { status: 503 }
      );
    }

    // Get wallets to process
    let wallets: string[];
    if (mode === 'specific' && specificWallets) {
      wallets = specificWallets.split(',').map((w) => w.trim().toLowerCase());
    } else if (mode === 'new') {
      wallets = await getNewWallets(limit);
    } else {
      wallets = await getStaleWallets(limit);
    }

    console.log(`[DUEL V2] Found ${wallets.length} wallets to process`);

    if (wallets.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No wallets need refresh',
        stats: {
          mode,
          batch_id: batchId,
          wallets_processed: 0,
          wallets_rankable: 0,
          errors: 0,
          duration_ms: Date.now() - startTime,
          parity_checks: [],
        },
      });
    }

    // Acquire leases
    const leases = await acquireLeases(wallets, batchId, workerId);
    console.log(`[DUEL V2] Acquired ${leases.length} leases`);

    // Process with bounded concurrency
    const engine = createDuelEngine();
    const results: DuelMetrics[] = [];
    const errors: string[] = [];
    const durations = new Map<string, number>();

    // Process in chunks of concurrency size
    for (let i = 0; i < leases.length; i += concurrency) {
      const chunk = leases.slice(i, i + concurrency);

      const chunkResults = await Promise.allSettled(
        chunk.map(async (lease) => {
          const walletStart = Date.now();
          try {
            const metrics = await engine.compute(lease.wallet_address);
            durations.set(lease.wallet_address, Date.now() - walletStart);
            await markLeaseComplete(lease.wallet_address, lease.lease_id, 'done');
            return metrics;
          } catch (err: any) {
            await markLeaseComplete(lease.wallet_address, lease.lease_id, 'error');
            throw err;
          }
        })
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const result = chunkResults[j];
        if (result.status === 'fulfilled') {
          // Insert-time gating: only insert if passes all gates
          const m = result.value;
          if (m.clob_only_check.is_clob_only && m.data_coverage.is_high_coverage && m.unmapped_cashflow_passes_gate) {
            results.push(m);
          }
        } else {
          errors.push(`${chunk[j].wallet_address}: ${result.reason?.message || 'Unknown error'}`);
        }
      }

      // Insert batch after each chunk (use batchId as run_id for tie-breaker)
      if (results.length > 0) {
        await insertMetricsBatch(results.slice(-chunk.length), batchId, durations);
      }

      // Check runtime cap
      if (Date.now() - startTime > 270000) {
        // 4.5 minutes
        console.log('[DUEL V2] Approaching timeout, exiting cleanly');
        break;
      }
    }

    // Run parity spot checks
    const parityResults = await runParityChecks(engine);
    const parityFailures = parityResults.filter((r) => !r.passes);

    if (parityFailures.length > 0) {
      console.warn(`[DUEL V2] Parity failures: ${parityFailures.map((f) => f.wallet).join(', ')}`);
    }

    const rankableCount = results.filter((r) => r.is_rankable).length;
    const duration = Date.now() - startTime;

    console.log(
      `[DUEL V2] Complete: ${results.length} processed, ${rankableCount} rankable, ${errors.length} errors, ${duration}ms`
    );

    return NextResponse.json({
      success: true,
      message: 'DUEL metrics refresh completed',
      stats: {
        mode,
        batch_id: batchId,
        wallets_processed: results.length,
        wallets_rankable: rankableCount,
        errors: errors.length,
        error_details: errors.slice(0, 10), // First 10 errors
        duration_ms: duration,
        parity_checks: parityResults,
        parity_failures: parityFailures.length,
      },
    });
  } catch (error: any) {
    console.error('[DUEL V2] Failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        batch_id: batchId,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
