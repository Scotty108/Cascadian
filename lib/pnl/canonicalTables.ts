/**
 * ============================================================================
 * CANONICAL TABLE EXPORTS FOR PNL SYSTEM
 * ============================================================================
 *
 * This file is the SINGLE IMPORT POINT for all PnL table references.
 * DO NOT hardcode table names in scripts - import from here.
 *
 * Reference: docs/systems/pnl/PERSISTED_OBJECTS_MANIFEST.md
 * Reference: docs/systems/pnl/PRODUCT_SURFACE_CANONICALS.md
 *
 * Version History:
 * - 2025-12-09: Created with V8/V9 split for product surfaces
 */

import {
  TOKEN_MAP_TABLE,
  UNIFIED_LEDGER_TABLE,
  CLOB_ONLY_LEDGER_TABLE,
  RESOLUTIONS_TABLE,
  TRADER_EVENTS_TABLE,
  DOME_BENCHMARKS_TABLE,
  getLedgerTable,
  LedgerSource,
} from './dataSourceConstants';

// ============================================================================
// RE-EXPORTS FROM dataSourceConstants.ts
// ============================================================================

export {
  TOKEN_MAP_TABLE,
  UNIFIED_LEDGER_TABLE,
  CLOB_ONLY_LEDGER_TABLE,
  RESOLUTIONS_TABLE,
  TRADER_EVENTS_TABLE,
  DOME_BENCHMARKS_TABLE,
  getLedgerTable,
};
export type { LedgerSource };

// ============================================================================
// CANONICAL TABLE REGISTRY (All tables that are safe to use)
// ============================================================================

/**
 * Canonical tables - ONLY these should appear in production code.
 * Everything else is DEPRECATED or ARCHIVE_CANDIDATE.
 */
export const CANONICAL_TABLES = {
  // === Event Sources ===
  /** Deduplicated CLOB trade events (V3). No dedup pattern needed. */
  TRADER_EVENTS: 'pm_trader_events_v3',

  // === Ledgers (Two Canonical Tables for Two Surfaces) ===
  /** Full ledger with CTF events. Use for full accounting. */
  UNIFIED_LEDGER_FULL: 'pm_unified_ledger_v8_tbl',
  /** CLOB-only ledger. Use for V1 Leaderboard. */
  UNIFIED_LEDGER_CLOB: 'pm_unified_ledger_v9_clob_tbl',

  // === Mapping & Resolution ===
  /** Token to condition mapping. V5 has 400K+ tokens. */
  TOKEN_MAP: 'pm_token_to_condition_map_v5',
  /** Condition resolution data (payout_numerators) */
  RESOLUTIONS: 'pm_condition_resolutions',

  // === Supporting ===
  /** Market metadata (question, slug, outcomes) */
  MARKET_METADATA: 'pm_market_metadata',
  /** UI PnL benchmark snapshots for validation */
  UI_BENCHMARKS: 'pm_ui_pnl_benchmarks_v2',
  /** Wallet volume classification */
  VOLUME_CLASSIFICATION: 'pm_wallet_volume_classification_v1',
  /** Dome realized benchmarks */
  DOME_BENCHMARKS: 'pm_dome_realized_benchmarks_v1',
} as const;

export type CanonicalTableKey = keyof typeof CANONICAL_TABLES;
export type CanonicalTableName = (typeof CANONICAL_TABLES)[CanonicalTableKey];

// ============================================================================
// DEPRECATED TABLES (DO NOT USE)
// ============================================================================

/**
 * These table names should NEVER appear in new code.
 * Used by audit-canonical-usage.ts to flag violations.
 */
export const DEPRECATED_TABLES = [
  // Old ledger versions
  'pm_unified_ledger_v4',
  'pm_unified_ledger_v5',
  'pm_unified_ledger_v6',
  'pm_unified_ledger_v7',
  'pm_unified_ledger_v8', // Use _tbl suffix
  'pm_unified_ledger_v9', // Use _clob_tbl suffix

  // Old PnL tables
  'pm_cascadian_pnl_v1_old',
  'pm_cascadian_pnl_v1_new',
  'pm_cascadian_pnl_v2',

  // Old token maps
  'pm_token_to_condition_map_v3',
  'pm_token_to_condition_map_v4',

  // Old benchmarks
  'pm_ui_pnl_benchmarks_v1',

  // V9 experimental variants (use v9_clob_tbl only)
  'pm_unified_ledger_v9_clob_clean_tbl',
  'pm_unified_ledger_v9_clob_from_v2_tbl',
  'pm_unified_ledger_v9_clob_nodrop_tbl',
] as const;

export type DeprecatedTableName = (typeof DEPRECATED_TABLES)[number];

// ============================================================================
// PRODUCT SURFACE HELPERS
// ============================================================================

/**
 * Product surface types for ledger selection.
 *
 * - leaderboard_v1_clob: V1 Copy-Trade Leaderboard (CLOB-only wallets)
 * - full_pnl: Full accounting with CTF events (splits, merges, redemptions)
 */
export type PnlSurface = 'leaderboard_v1_clob' | 'full_pnl';

/**
 * Get the correct ledger table for a product surface.
 *
 * @param surface - The product surface being built
 * @returns The canonical ledger table name
 *
 * @example
 * // V1 Leaderboard code:
 * const ledger = getLedgerForSurface('leaderboard_v1_clob');
 * // Returns: 'pm_unified_ledger_v9_clob_tbl'
 *
 * @example
 * // Full accounting code:
 * const ledger = getLedgerForSurface('full_pnl');
 * // Returns: 'pm_unified_ledger_v8_tbl'
 */
export function getLedgerForSurface(surface: PnlSurface): string {
  switch (surface) {
    case 'leaderboard_v1_clob':
      return CANONICAL_TABLES.UNIFIED_LEDGER_CLOB;
    case 'full_pnl':
      return CANONICAL_TABLES.UNIFIED_LEDGER_FULL;
    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = surface;
      throw new Error(`Unknown surface: ${_exhaustive}`);
  }
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Check if a table name is canonical (safe to use).
 */
export function isCanonicalTable(tableName: string): boolean {
  return Object.values(CANONICAL_TABLES).includes(tableName as any);
}

/**
 * Check if a table name is deprecated (should not be used).
 */
export function isDeprecatedTable(tableName: string): boolean {
  return DEPRECATED_TABLES.includes(tableName as any);
}

/**
 * Get the canonical replacement for a deprecated table.
 */
export function getCanonicalReplacement(
  deprecatedTable: string
): string | null {
  // Ledger version upgrades
  if (deprecatedTable.startsWith('pm_unified_ledger_v')) {
    if (deprecatedTable.includes('v9_clob')) {
      return CANONICAL_TABLES.UNIFIED_LEDGER_CLOB;
    }
    return CANONICAL_TABLES.UNIFIED_LEDGER_FULL;
  }

  // Old PnL tables
  if (deprecatedTable.startsWith('pm_cascadian_pnl')) {
    return CANONICAL_TABLES.UNIFIED_LEDGER_FULL;
  }

  // Old token maps
  if (deprecatedTable.startsWith('pm_token_to_condition_map_v')) {
    return CANONICAL_TABLES.TOKEN_MAP;
  }

  // Old benchmarks
  if (deprecatedTable === 'pm_ui_pnl_benchmarks_v1') {
    return CANONICAL_TABLES.UI_BENCHMARKS;
  }

  return null;
}
