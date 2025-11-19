/**
 * Wallet Clustering - Standard Query Patterns
 *
 * Certified Pattern (XCN PnL Certified 2025-11-17):
 * - Use wallet_identity_overrides (12+ executor mappings)
 * - Join on executor_wallet field
 * - Apply sign correction: IF(trade_direction = 'BUY', shares, -shares)
 * - Use COALESCE(canonical_wallet, wallet_address) for attribution
 *
 * Why This Matters:
 * - Prevents 250x share inflation (sells stored as positive)
 * - Correctly clusters multi-executor wallets (e.g., xcnstrategy: 12 executors)
 * - Ensures consistent wallet metrics across all endpoints
 *
 * @see /tmp/XCN_FIX_DEPLOYMENT_COMPLETE.md for certification details
 * @see /tmp/CLUSTERING_ROLLOUT_STANDARDIZATION.md for rollout plan
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Sign correction for shares
 * - Buys: Keep positive
 * - Sells: Convert to negative
 * - Net position: SUM(sign-corrected shares) = buys - sells
 */
export const SIGN_CORRECTION = `IF(trade_direction = 'BUY', shares, -shares)` as const

/**
 * Buy cost aggregation (positive only)
 */
export const BUY_COST = `IF(trade_direction = 'BUY', usd_value, 0)` as const

/**
 * Sell cost aggregation (positive only)
 */
export const SELL_COST = `IF(trade_direction = 'SELL', usd_value, 0)` as const

/**
 * Buy shares aggregation (positive only)
 */
export const BUY_SHARES = `IF(trade_direction = 'BUY', shares, 0)` as const

/**
 * Sell shares aggregation (negative only, after sign correction)
 */
export const SELL_SHARES = `IF(trade_direction = 'SELL', shares, 0)` as const

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface WalletClusteringOptions {
  /** Filter by specific wallet address (canonical or executor) */
  walletAddress?: string
  /** Filter by condition ID (market) */
  conditionId?: string
  /** Filter by start timestamp */
  startDate?: string
  /** Filter by end timestamp */
  endDate?: string
  /** Additional WHERE conditions */
  whereConditions?: string[]
  /** Group by additional columns */
  groupBy?: string[]
  /** Include unrealized positions */
  includeUnrealized?: boolean
}

export interface WalletMetrics {
  wallet_canonical: string
  wallet_raw: string
  net_shares: number
  cost_buy: number
  cost_sell: number
  total_trades: number
  buy_count: number
  sell_count: number
}

// =============================================================================
// QUERY BUILDERS
// =============================================================================

/**
 * Standard wallet clustering query
 *
 * Features:
 * - Uses wallet_identity_overrides for clustering
 * - Applies sign correction for shares
 * - Returns canonical + raw wallet addresses
 *
 * @example
 * ```typescript
 * const query = buildWalletClusteringQuery({
 *   walletAddress: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
 *   conditionId: 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
 * })
 * const result = await ch.query({ query, format: 'JSONEachRow' })
 * ```
 */
export function buildWalletClusteringQuery(options: WalletClusteringOptions = {}): string {
  const {
    walletAddress,
    conditionId,
    startDate,
    endDate,
    whereConditions = [],
    groupBy = [],
  } = options

  // Build WHERE clause
  const conditions: string[] = ['1=1', ...whereConditions]

  if (walletAddress) {
    conditions.push(
      `(lower(t.wallet_address) = lower('${walletAddress}') OR lower(wim.canonical_wallet) = lower('${walletAddress}'))`
    )
  }

  if (conditionId) {
    conditions.push(
      `lower(replaceRegexpAll(t.condition_id_norm_v3, '^0x', '')) = lower('${conditionId}')`
    )
  }

  if (startDate) {
    conditions.push(`t.timestamp >= '${startDate}'`)
  }

  if (endDate) {
    conditions.push(`t.timestamp <= '${endDate}'`)
  }

  // Build GROUP BY clause
  const groupByColumns = ['wallet_canonical', 'wallet_raw', ...groupBy]

  return `
    SELECT
      -- Wallet attribution (handle empty string from LEFT JOIN)
      if(wim.canonical_wallet != '', wim.canonical_wallet, t.wallet_address) AS wallet_canonical,
      t.wallet_address AS wallet_raw,

      -- Sign-corrected aggregations
      sum(${SIGN_CORRECTION}) AS net_shares,
      sum(${BUY_COST}) AS cost_buy,
      sum(${SELL_COST}) AS cost_sell,

      -- Trade counts
      countIf(trade_direction = 'BUY') AS buy_count,
      countIf(trade_direction = 'SELL') AS sell_count,
      count() AS total_trades

    FROM pm_trades_canonical_v3 AS t
    LEFT JOIN wallet_identity_overrides AS wim
      ON t.wallet_address = wim.executor_wallet

    WHERE ${conditions.join('\n      AND ')}

    GROUP BY ${groupByColumns.join(', ')}
  `.trim()
}

/**
 * Standard wallet attribution JOIN clause
 *
 * Use this in custom queries to ensure consistent clustering
 *
 * @example
 * ```sql
 * SELECT ...
 * FROM pm_trades_canonical_v3 AS t
 * ${WALLET_CLUSTERING_JOIN}
 * WHERE ...
 * ```
 */
export const WALLET_CLUSTERING_JOIN = `
LEFT JOIN wallet_identity_overrides AS wim
  ON t.wallet_address = wim.executor_wallet
`.trim()

/**
 * Standard wallet canonical field
 *
 * Use this in SELECT clauses for consistent wallet attribution
 *
 * NOTE: ClickHouse LEFT JOIN returns empty string '' (not NULL) for unmatched rows,
 * so we use if() instead of COALESCE to handle both NULL and empty string.
 */
export const WALLET_CANONICAL_FIELD = `if(wim.canonical_wallet != '', wim.canonical_wallet, t.wallet_address) AS wallet_canonical`

/**
 * Build aggregations for wallet metrics
 *
 * Returns SQL fragments for common wallet aggregations with sign correction
 *
 * @example
 * ```typescript
 * const aggs = buildWalletAggregations()
 * const query = `
 *   SELECT
 *     ${WALLET_CANONICAL_FIELD},
 *     ${aggs.net_shares},
 *     ${aggs.cost_buy},
 *     ${aggs.cost_sell}
 *   FROM pm_trades_canonical_v3 AS t
 *   ${WALLET_CLUSTERING_JOIN}
 *   GROUP BY wallet_canonical
 * `
 * ```
 */
export function buildWalletAggregations() {
  return {
    net_shares: `sum(${SIGN_CORRECTION}) AS net_shares`,
    cost_buy: `sum(${BUY_COST}) AS cost_buy`,
    cost_sell: `sum(${SELL_COST}) AS cost_sell`,
    buy_shares: `sum(${BUY_SHARES}) AS buy_shares`,
    sell_shares: `sum(${SELL_SHARES}) AS sell_shares`,
    buy_count: `countIf(trade_direction = 'BUY') AS buy_count`,
    sell_count: `countIf(trade_direction = 'SELL') AS sell_count`,
    total_trades: `count() AS total_trades`,
    realized_pnl: `sum(${SELL_COST}) - sum(${BUY_COST}) AS realized_pnl`,
  }
}

// =============================================================================
// VERIFICATION HELPERS
// =============================================================================

/**
 * Verification query for XCN wallet (control test)
 *
 * Expected results for Xi market (f2ce8d38...):
 * - net_shares: ~-1,110,224 (negative)
 * - buy_shares: ~+496,735 (positive)
 * - sell_shares: ~-1,606,959 (negative)
 *
 * @returns Query to verify XCN wallet clustering
 */
export function buildXCNVerificationQuery(): string {
  return buildWalletClusteringQuery({
    walletAddress: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    conditionId: 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  })
}

/**
 * Check if a query result matches expected XCN values
 *
 * @param result Query result from XCN verification
 * @returns true if values match expected (within tolerance)
 */
export function verifyXCNMetrics(result: WalletMetrics): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Expected values (from certification)
  const EXPECTED_NET_SHARES = -1_110_224
  const EXPECTED_BUY_SHARES = 496_735
  const TOLERANCE = 1000 // ±1,000 shares tolerance

  if (result.net_shares > 0) {
    errors.push(`Net shares should be negative, got ${result.net_shares}`)
  }

  if (Math.abs(result.net_shares - EXPECTED_NET_SHARES) > TOLERANCE) {
    errors.push(
      `Net shares mismatch: expected ~${EXPECTED_NET_SHARES}, got ${result.net_shares}`
    )
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// =============================================================================
// MIGRATION HELPERS
// =============================================================================

/**
 * Check if a table/view uses the old wallet_identity_map
 *
 * @param tableName Table or view to check
 * @returns true if uses old table (needs migration)
 */
export function needsClusteringMigration(viewDefinition: string): boolean {
  return (
    viewDefinition.includes('wallet_identity_map') &&
    !viewDefinition.includes('wallet_identity_overrides')
  )
}

/**
 * Check if a query uses sign correction
 *
 * @param query Query to check
 * @returns true if uses sign correction
 */
export function usesSignCorrection(query: string): boolean {
  return (
    query.includes("IF(trade_direction = 'BUY', shares, -shares)") ||
    query.includes('IF(trade_direction = "BUY", shares, -shares)')
  )
}

// =============================================================================
// DOCUMENTATION
// =============================================================================

/**
 * Standard Pattern Documentation
 *
 * Use this pattern for ALL wallet aggregations:
 *
 * ```sql
 * SELECT
 *   -- Wallet attribution
 *   COALESCE(wim.canonical_wallet, t.wallet_address) AS wallet_canonical,
 *   t.wallet_address AS wallet_raw,
 *
 *   -- Sign-corrected aggregations
 *   sum(IF(trade_direction = 'BUY', shares, -shares)) AS net_shares,
 *   sum(IF(trade_direction = 'BUY', usd_value, 0)) AS cost_buy,
 *   sum(IF(trade_direction = 'SELL', usd_value, 0)) AS cost_sell,
 *
 *   count() AS total_trades
 *
 * FROM pm_trades_canonical_v3 AS t
 * LEFT JOIN wallet_identity_overrides AS wim
 *   ON t.wallet_address = wim.executor_wallet
 *
 * GROUP BY wallet_canonical, wallet_raw
 * ```
 *
 * Key Requirements:
 * 1. ✅ Use wallet_identity_overrides (not wallet_identity_map)
 * 2. ✅ Join on executor_wallet field
 * 3. ✅ Apply sign correction: IF(trade_direction = 'BUY', shares, -shares)
 * 4. ✅ Use COALESCE for nullable canonical_wallet
 * 5. ✅ Return both canonical and raw wallet addresses
 */
export const STANDARD_PATTERN_DOCS = `
# Wallet Clustering - Standard Pattern

## Why This Pattern?

Without proper clustering:
- ❌ Sell shares stored as positive → 250x inflation
- ❌ Multi-executor wallets split → incomplete metrics
- ❌ Inconsistent wallet attribution → broken leaderboards

With proper clustering:
- ✅ Sell shares negative → correct net position
- ✅ All executors mapped → complete wallet view
- ✅ Consistent attribution → accurate metrics

## Certified Examples

### XCN Wallet (xcnstrategy)
- 12 executor wallets → 1 canonical wallet
- Xi market: -1.1M net shares (was +2.1M inflated)
- Certification: 2025-11-17

## Usage

\`\`\`typescript
import { buildWalletClusteringQuery, buildXCNVerificationQuery } from '@/lib/clickhouse/wallet-clustering'

// Standard query
const query = buildWalletClusteringQuery({
  walletAddress: '0x...',
  conditionId: '...',
})

// Verification query
const verifyQuery = buildXCNVerificationQuery()
\`\`\`
` as const
