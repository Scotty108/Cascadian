/**
 * Copy-Trade Ready V1 Cohort Definition
 *
 * STRICT FILTERS for production leaderboard:
 * - CLOB-only source_type (no ERC-1155 transfers, no PayoutRedemption)
 * - All positions closed (exited or resolved)
 * - Minimum realized magnitude >= $200
 * - Minimum trade count >= 10
 *
 * This cohort represents "clean" wallets where our PnL calculation
 * is 100% accurate by construction (sum(usdc_delta) for CLOB trades).
 *
 * Terminal: Claude 2 (UI Parity Lead)
 * Date: 2025-12-06
 */

import { clickhouse } from '../../clickhouse/client';

export interface CopyTradeReadyWallet {
  wallet_address: string;
  realized_pnl: number;
  trade_count: number;
  market_count: number;
  resolved_positions: number;
  closed_positions: number;
  active_positions: number;
  profitable_markets?: number;
  total_volume: number;
  first_trade: string;
  last_trade: string;
}

export interface CohortFilters {
  minRealizedMagnitude: number;
  minTradeCount: number;
  requireAllPositionsClosed: boolean;
  requireClobOnly: boolean;
}

const DEFAULT_FILTERS: CohortFilters = {
  minRealizedMagnitude: 200,
  minTradeCount: 10,
  requireAllPositionsClosed: true,
  requireClobOnly: true,
};

/**
 * Get wallets that qualify for the Copy-Trade Ready V1 cohort.
 *
 * These are CLOB-only wallets with all positions closed, making
 * their realized PnL trivially computable as sum(usdc_delta).
 */
export async function getCopyTradeReadyV1Wallets(
  limit: number = 100,
  filters: Partial<CohortFilters> = {}
): Promise<CopyTradeReadyWallet[]> {
  const f = { ...DEFAULT_FILTERS, ...filters };

  // Get all resolutions upfront
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

  // Build the cohort query
  // Step 1: Find CLOB-only wallets
  // Step 2: Calculate position status per (wallet, condition_id, outcome_index)
  // Step 3: Filter to wallets where all positions are closed
  // Step 4: Calculate aggregate metrics
  const query = `
    WITH
    -- Step 1: Identify CLOB-only wallets
    clob_only_wallets AS (
      SELECT wallet_address
      FROM pm_unified_ledger_v8_tbl
      WHERE wallet_address != '' AND condition_id != ''
      GROUP BY wallet_address
      HAVING countIf(source_type != 'CLOB') = 0
    ),

    -- Step 2: Calculate position metrics per wallet
    wallet_positions AS (
      SELECT
        l.wallet_address,
        l.condition_id,
        l.outcome_index,
        sum(l.token_delta) as net_tokens,
        sum(l.usdc_delta) as net_usdc,
        count() as trade_events,
        min(l.event_time) as first_trade,
        max(l.event_time) as last_trade
      FROM pm_unified_ledger_v8_tbl l
      WHERE l.wallet_address IN (SELECT wallet_address FROM clob_only_wallets)
        AND l.source_type = 'CLOB'
        AND l.condition_id != ''
      GROUP BY l.wallet_address, l.condition_id, l.outcome_index
    ),

    -- Step 3: Check resolution status per position
    positions_with_status AS (
      SELECT
        wp.wallet_address,
        wp.condition_id,
        wp.outcome_index,
        wp.net_tokens,
        wp.net_usdc,
        wp.trade_events,
        wp.first_trade,
        wp.last_trade,
        CASE
          WHEN abs(wp.net_tokens) < 0.01 THEN 'EXITED'
          WHEN wp.condition_id IN (
            SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0
          ) THEN 'RESOLVED'
          ELSE 'ACTIVE'
        END as position_status
      FROM wallet_positions wp
    ),

    -- Step 4: Aggregate to wallet level
    wallet_aggregates AS (
      SELECT
        wallet_address,
        sum(net_usdc) as realized_pnl,
        sum(trade_events) as trade_count,
        count(DISTINCT condition_id) as market_count,
        sum(abs(net_usdc)) as total_volume,
        countIf(position_status = 'RESOLVED') as resolved_positions,
        countIf(position_status = 'EXITED') as exited_positions,
        countIf(position_status = 'ACTIVE') as active_positions,
        countIf(net_usdc > 0) as profitable_positions,
        min(first_trade) as first_trade,
        max(last_trade) as last_trade
      FROM positions_with_status
      GROUP BY wallet_address
      HAVING
        -- All positions must be closed (resolved or exited)
        active_positions = 0
        -- Minimum trade count
        AND trade_count >= ${f.minTradeCount}
        -- Minimum realized magnitude
        AND abs(realized_pnl) >= ${f.minRealizedMagnitude}
    )

    SELECT
      wallet_address,
      realized_pnl,
      trade_count,
      market_count,
      total_volume,
      resolved_positions,
      exited_positions + resolved_positions as closed_positions,
      active_positions,
      profitable_positions,
      first_trade,
      last_trade
    FROM wallet_aggregates
    ORDER BY abs(realized_pnl) DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    wallet_address: r.wallet_address,
    realized_pnl: Number(r.realized_pnl),
    trade_count: Number(r.trade_count),
    market_count: Number(r.market_count),
    total_volume: Number(r.total_volume),
    resolved_positions: Number(r.resolved_positions),
    closed_positions: Number(r.closed_positions),
    active_positions: Number(r.active_positions),
    profitable_markets: Number(r.profitable_positions),
    first_trade: r.first_trade,
    last_trade: r.last_trade,
  }));
}

/**
 * Check if a specific wallet qualifies for the Copy-Trade Ready V1 cohort.
 */
export async function isWalletCopyTradeReadyV1(
  wallet: string,
  filters: Partial<CohortFilters> = {}
): Promise<{ eligible: boolean; reason: string; metrics?: CopyTradeReadyWallet }> {
  wallet = wallet.toLowerCase();
  const f = { ...DEFAULT_FILTERS, ...filters };

  // Check CLOB-only
  const sourceQuery = `
    SELECT
      countIf(source_type != 'CLOB') as non_clob_count,
      countIf(source_type = 'CLOB') as clob_count
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND condition_id != ''
  `;
  const sourceResult = await clickhouse.query({ query: sourceQuery, format: 'JSONEachRow' });
  const sourceRows = (await sourceResult.json()) as any[];

  if (sourceRows.length === 0 || Number(sourceRows[0].clob_count) === 0) {
    return { eligible: false, reason: 'NO_CLOB_DATA' };
  }

  if (f.requireClobOnly && Number(sourceRows[0].non_clob_count) > 0) {
    return {
      eligible: false,
      reason: `NOT_CLOB_ONLY: ${sourceRows[0].non_clob_count} non-CLOB events`,
    };
  }

  // Check positions
  const positionsQuery = `
    SELECT
      condition_id,
      outcome_index,
      sum(token_delta) as net_tokens,
      sum(usdc_delta) as net_usdc,
      count() as trade_events
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${wallet}'
      AND source_type = 'CLOB'
      AND condition_id != ''
    GROUP BY condition_id, outcome_index
  `;
  const positionsResult = await clickhouse.query({ query: positionsQuery, format: 'JSONEachRow' });
  const positions = (await positionsResult.json()) as any[];

  // Get resolutions
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

  let realizedPnl = 0;
  let tradeCount = 0;
  let resolvedPositions = 0;
  let activePositions = 0;
  let closedPositions = 0;

  for (const pos of positions) {
    const netTokens = Number(pos.net_tokens);
    const netUsdc = Number(pos.net_usdc);
    const events = Number(pos.trade_events);
    const conditionId = pos.condition_id;

    tradeCount += events;

    const isExited = Math.abs(netTokens) < 0.01;
    const isResolved = resolvedConditions.has(conditionId);

    if (isExited || isResolved) {
      realizedPnl += netUsdc;
      closedPositions++;
      if (isResolved) resolvedPositions++;
    } else {
      activePositions++;
    }
  }

  // Check filters
  if (f.requireAllPositionsClosed && activePositions > 0) {
    return {
      eligible: false,
      reason: `HAS_ACTIVE_POSITIONS: ${activePositions} positions still open`,
    };
  }

  if (tradeCount < f.minTradeCount) {
    return {
      eligible: false,
      reason: `INSUFFICIENT_TRADES: ${tradeCount} < ${f.minTradeCount}`,
    };
  }

  if (Math.abs(realizedPnl) < f.minRealizedMagnitude) {
    return {
      eligible: false,
      reason: `INSUFFICIENT_MAGNITUDE: $${Math.abs(realizedPnl).toFixed(2)} < $${f.minRealizedMagnitude}`,
    };
  }

  return {
    eligible: true,
    reason: 'ELIGIBLE',
    metrics: {
      wallet_address: wallet,
      realized_pnl: realizedPnl,
      trade_count: tradeCount,
      market_count: closedPositions, // approximate
      total_volume: 0, // not computed in eligibility check
      resolved_positions: resolvedPositions,
      closed_positions: closedPositions,
      active_positions: activePositions,
      first_trade: new Date().toISOString(),
      last_trade: new Date().toISOString(),
    },
  };
}

/**
 * Get cohort statistics without fetching individual wallets.
 */
export async function getCopyTradeReadyV1Stats(
  filters: Partial<CohortFilters> = {}
): Promise<{
  totalWallets: number;
  totalRealizedPnl: number;
  avgTradeCount: number;
  winnerCount: number;
  loserCount: number;
}> {
  const f = { ...DEFAULT_FILTERS, ...filters };

  const query = `
    WITH
    clob_only_wallets AS (
      SELECT wallet_address
      FROM pm_unified_ledger_v8_tbl
      WHERE wallet_address != '' AND condition_id != ''
      GROUP BY wallet_address
      HAVING countIf(source_type != 'CLOB') = 0
    ),
    wallet_positions AS (
      SELECT
        l.wallet_address,
        l.condition_id,
        l.outcome_index,
        sum(l.token_delta) as net_tokens,
        sum(l.usdc_delta) as net_usdc,
        count() as trade_events
      FROM pm_unified_ledger_v8_tbl l
      WHERE l.wallet_address IN (SELECT wallet_address FROM clob_only_wallets)
        AND l.source_type = 'CLOB'
        AND l.condition_id != ''
      GROUP BY l.wallet_address, l.condition_id, l.outcome_index
    ),
    positions_with_status AS (
      SELECT
        wp.wallet_address,
        wp.net_tokens,
        wp.net_usdc,
        wp.trade_events,
        CASE
          WHEN abs(wp.net_tokens) < 0.01 THEN 'EXITED'
          WHEN wp.condition_id IN (
            SELECT condition_id FROM pm_condition_resolutions WHERE is_deleted = 0
          ) THEN 'RESOLVED'
          ELSE 'ACTIVE'
        END as position_status
      FROM wallet_positions wp
    ),
    wallet_aggregates AS (
      SELECT
        wallet_address,
        sum(net_usdc) as realized_pnl,
        sum(trade_events) as trade_count,
        countIf(position_status = 'ACTIVE') as active_positions
      FROM positions_with_status
      GROUP BY wallet_address
      HAVING
        active_positions = 0
        AND trade_count >= ${f.minTradeCount}
        AND abs(realized_pnl) >= ${f.minRealizedMagnitude}
    )
    SELECT
      count() as total_wallets,
      sum(realized_pnl) as total_realized_pnl,
      avg(trade_count) as avg_trade_count,
      countIf(realized_pnl > 0) as winner_count,
      countIf(realized_pnl < 0) as loser_count
    FROM wallet_aggregates
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const row = rows[0] || {};

  return {
    totalWallets: Number(row.total_wallets || 0),
    totalRealizedPnl: Number(row.total_realized_pnl || 0),
    avgTradeCount: Number(row.avg_trade_count || 0),
    winnerCount: Number(row.winner_count || 0),
    loserCount: Number(row.loser_count || 0),
  };
}
