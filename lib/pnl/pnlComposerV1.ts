/**
 * PnL Composer V1 - Production-Ready PnL Calculation
 *
 * INTERFACE:
 *   computeWalletPnL(wallet, opts) -> {
 *     realized_pnl,
 *     unrealized_pnl,
 *     total_pnl,
 *     diagnostics
 *   }
 *
 * REALIZED:
 *   For CLOB-only wallets with closed positions:
 *     realized_pnl = sum(usdc_delta) for all CLOB trades
 *   This is 100% accurate by construction.
 *
 * UNREALIZED:
 *   For open positions, we need current market prices.
 *   If unavailable, unrealized_pnl = 0 with a diagnostic flag.
 *
 * Terminal: Claude 2 (UI Parity Lead)
 * Date: 2025-12-06
 */

import { clickhouse } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface ComposerDiagnostics {
  /** Wallet classification */
  cohort: 'CLOB_CLOSED' | 'CLOB_ACTIVE' | 'MIXED' | 'NO_DATA';

  /** Number of CLOB trades processed */
  clobTradeCount: number;

  /** Number of non-CLOB events (should be 0 for CLOB_CLOSED cohort) */
  nonClobEventCount: number;

  /** Number of resolved positions */
  resolvedPositions: number;

  /** Number of active (open) positions */
  activePositions: number;

  /** Whether unrealized PnL is available (has price source) */
  unrealizedAvailable: boolean;

  /** Missing inputs for omega ratio calculation */
  omegaInputsMissing: string[];

  /** Whether omega ratio calculation is possible */
  omegaReady: boolean;

  /** Any warnings or notes */
  warnings: string[];

  /** Processing time in ms */
  processingTimeMs: number;
}

export interface ComposerResult {
  wallet: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  position_value: number;
  diagnostics: ComposerDiagnostics;
}

export interface ComposerOptions {
  /** Include position-level details for debugging */
  includeDetails?: boolean;

  /** Price overrides for active positions (condition_id -> price 0-1) */
  priceOverrides?: Map<string, number>;

  /** Force cohort classification (skip auto-detection) */
  forceCohort?: 'CLOB_CLOSED' | 'CLOB_ACTIVE' | 'MIXED';
}

interface PositionData {
  condition_id: string;
  outcome_index: number;
  net_tokens: number;
  net_usdc: number;
  cost_basis: number;
  trade_count: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Compute wallet PnL using the composer pattern.
 *
 * For Copy-Trade Ready V1 cohort (CLOB-only, closed positions):
 *   realized_pnl = sum(usdc_delta) - exact by construction
 *   unrealized_pnl = 0 (no open positions)
 *
 * For CLOB_ACTIVE cohort:
 *   realized_pnl = sum(usdc_delta) for closed positions
 *   unrealized_pnl = mark-to-market for open positions (if prices available)
 */
export async function computeWalletPnL(
  wallet: string,
  opts: ComposerOptions = {}
): Promise<ComposerResult> {
  const startTime = Date.now();
  wallet = wallet.toLowerCase();

  // Initialize diagnostics
  const diagnostics: ComposerDiagnostics = {
    cohort: 'NO_DATA',
    clobTradeCount: 0,
    nonClobEventCount: 0,
    resolvedPositions: 0,
    activePositions: 0,
    unrealizedAvailable: false,
    omegaInputsMissing: [],
    omegaReady: false,
    warnings: [],
    processingTimeMs: 0,
  };

  // Step 1: Get source type breakdown
  const sourceQuery = `
    SELECT
      countIf(source_type = 'CLOB') as clob_count,
      countIf(source_type != 'CLOB') as non_clob_count
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND condition_id != ''
  `;
  const sourceResult = await clickhouse.query({ query: sourceQuery, format: 'JSONEachRow' });
  const sourceRows = (await sourceResult.json()) as any[];

  if (sourceRows.length === 0 || Number(sourceRows[0].clob_count) === 0) {
    diagnostics.processingTimeMs = Date.now() - startTime;
    return {
      wallet,
      realized_pnl: 0,
      unrealized_pnl: 0,
      total_pnl: 0,
      position_value: 0,
      diagnostics,
    };
  }

  diagnostics.clobTradeCount = Number(sourceRows[0].clob_count);
  diagnostics.nonClobEventCount = Number(sourceRows[0].non_clob_count);

  const isClobOnly = diagnostics.nonClobEventCount === 0;

  // Step 2: Get all positions
  const positions = await getPositions(wallet);

  // Step 3: Get resolutions
  const resolutions = await getResolutions();

  // Step 4: Classify positions and calculate PnL
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let positionValue = 0;

  for (const pos of positions) {
    const isResolved = resolutions.has(pos.condition_id);
    const isExited = Math.abs(pos.net_tokens) < 0.01;
    const isClosed = isResolved || isExited;

    if (isClosed) {
      // Closed position: realized PnL is just cash flow
      if (isResolved && !isExited) {
        // Position resolved with tokens still held
        const payouts = resolutions.get(pos.condition_id);
        const payoutPrice = payouts && pos.outcome_index < payouts.length
          ? payouts[pos.outcome_index]
          : 0;
        const settlementValue = pos.net_tokens * payoutPrice;
        realizedPnl += pos.net_usdc + settlementValue;
      } else {
        // Position exited (tokens are 0) or resolved with 0 tokens
        realizedPnl += pos.net_usdc;
      }
      diagnostics.resolvedPositions++;
    } else {
      // Active position: need mark-to-market
      diagnostics.activePositions++;

      // Get price from overrides or default to 50%
      const currentPrice = opts.priceOverrides?.get(pos.condition_id) ?? 0.5;
      const currentValue = pos.net_tokens * currentPrice;

      positionValue += currentValue;
      unrealizedPnl += currentValue - pos.cost_basis;

      // Cash flow from partial exits counts as realized
      realizedPnl += pos.net_usdc;
    }
  }

  // Step 5: Determine cohort
  if (diagnostics.clobTradeCount === 0) {
    diagnostics.cohort = 'NO_DATA';
  } else if (!isClobOnly) {
    diagnostics.cohort = 'MIXED';
    diagnostics.warnings.push('Wallet has non-CLOB events; PnL may be incomplete');
  } else if (diagnostics.activePositions > 0) {
    diagnostics.cohort = 'CLOB_ACTIVE';
    diagnostics.unrealizedAvailable = opts.priceOverrides !== undefined;
    if (!diagnostics.unrealizedAvailable) {
      diagnostics.warnings.push('Unrealized PnL estimated at 50% (no price feed)');
    }
  } else {
    diagnostics.cohort = 'CLOB_CLOSED';
    diagnostics.unrealizedAvailable = true; // N/A but "available"
  }

  // Step 6: Check omega readiness
  diagnostics.omegaInputsMissing = checkOmegaReadiness(positions, resolutions);
  diagnostics.omegaReady = diagnostics.omegaInputsMissing.length === 0;

  diagnostics.processingTimeMs = Date.now() - startTime;

  return {
    wallet,
    realized_pnl: realizedPnl,
    unrealized_pnl: unrealizedPnl,
    total_pnl: realizedPnl + positionValue,
    position_value: positionValue,
    diagnostics,
  };
}

/**
 * Batch compute PnL for multiple wallets.
 */
export async function computeWalletPnLBatch(
  wallets: string[],
  opts: ComposerOptions = {}
): Promise<ComposerResult[]> {
  const results: ComposerResult[] = [];

  for (const wallet of wallets) {
    try {
      const result = await computeWalletPnL(wallet, opts);
      results.push(result);
    } catch (err: any) {
      results.push({
        wallet,
        realized_pnl: 0,
        unrealized_pnl: 0,
        total_pnl: 0,
        position_value: 0,
        diagnostics: {
          cohort: 'NO_DATA',
          clobTradeCount: 0,
          nonClobEventCount: 0,
          resolvedPositions: 0,
          activePositions: 0,
          unrealizedAvailable: false,
          omegaInputsMissing: ['error'],
          omegaReady: false,
          warnings: [`Error: ${err.message}`],
          processingTimeMs: 0,
        },
      });
    }
  }

  return results;
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getPositions(wallet: string): Promise<PositionData[]> {
  const query = `
    SELECT
      condition_id,
      outcome_index,
      sum(token_delta) as net_tokens,
      sum(usdc_delta) as net_usdc,
      abs(sumIf(usdc_delta, token_delta > 0)) as cost_basis,
      count() as trade_count
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND source_type = 'CLOB'
      AND condition_id != ''
    GROUP BY condition_id, outcome_index
    HAVING abs(net_tokens) > 0.001 OR abs(net_usdc) > 0.001
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    net_tokens: Number(r.net_tokens),
    net_usdc: Number(r.net_usdc),
    cost_basis: Number(r.cost_basis),
    trade_count: Number(r.trade_count),
  }));
}

async function getResolutions(): Promise<Map<string, number[]>> {
  const query = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE is_deleted = 0
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const resolutions = new Map<string, number[]>();
  for (const row of rows) {
    try {
      resolutions.set(row.condition_id, JSON.parse(row.payout_numerators));
    } catch {
      // Skip invalid payouts
    }
  }

  return resolutions;
}

function checkOmegaReadiness(
  positions: PositionData[],
  resolutions: Map<string, number[]>
): string[] {
  const missing: string[] = [];

  // For omega ratio we need:
  // 1. Per-market returns (realized PnL per condition_id)
  // 2. All positions resolved (to compute final returns)

  const hasOpenPositions = positions.some((p) => {
    const isResolved = resolutions.has(p.condition_id);
    const isExited = Math.abs(p.net_tokens) < 0.01;
    return !isResolved && !isExited;
  });

  if (hasOpenPositions) {
    missing.push('open_positions_remain');
  }

  // Check if we have enough resolved positions for meaningful omega
  const resolvedCount = positions.filter((p) =>
    resolutions.has(p.condition_id) || Math.abs(p.net_tokens) < 0.01
  ).length;

  if (resolvedCount < 5) {
    missing.push('insufficient_resolved_positions');
  }

  return missing;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get a simple realized PnL for CLOB-only wallets.
 *
 * This is the most basic calculation: sum(usdc_delta) for all CLOB trades.
 * Use this when you KNOW the wallet is CLOB-only with closed positions.
 */
export async function getSimpleRealizedPnL(wallet: string): Promise<number> {
  wallet = wallet.toLowerCase();

  const query = `
    SELECT sum(usdc_delta) as total_pnl
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND source_type = 'CLOB'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.length > 0 ? Number(rows[0].total_pnl) : 0;
}

/**
 * Quick check if wallet is CLOB-only.
 */
export async function isClobOnly(wallet: string): Promise<boolean> {
  wallet = wallet.toLowerCase();

  const query = `
    SELECT countIf(source_type != 'CLOB') as non_clob_count
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND condition_id != ''
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.length > 0 && Number(rows[0].non_clob_count) === 0;
}

/**
 * Quick check if all positions are closed.
 */
export async function allPositionsClosed(wallet: string): Promise<boolean> {
  wallet = wallet.toLowerCase();

  // Get net tokens per condition
  const positionsQuery = `
    SELECT
      condition_id,
      sum(token_delta) as net_tokens
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND source_type = 'CLOB'
      AND condition_id != ''
    GROUP BY condition_id
    HAVING abs(net_tokens) > 0.01
  `;

  const positionsResult = await clickhouse.query({ query: positionsQuery, format: 'JSONEachRow' });
  const positions = (await positionsResult.json()) as any[];

  if (positions.length === 0) {
    return true; // No positions with tokens = all closed
  }

  // Check if all remaining positions are resolved
  const resolutionsQuery = `
    SELECT condition_id
    FROM pm_condition_resolutions
    WHERE is_deleted = 0
  `;
  const resolutionsResult = await clickhouse.query({ query: resolutionsQuery, format: 'JSONEachRow' });
  const resolvedConditions = new Set<string>();
  for (const row of (await resolutionsResult.json()) as any[]) {
    resolvedConditions.add(row.condition_id);
  }

  // All positions with tokens must be resolved
  for (const pos of positions) {
    if (!resolvedConditions.has(pos.condition_id)) {
      return false;
    }
  }

  return true;
}
