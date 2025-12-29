/**
 * ============================================================================
 * RUNTIME ASSERTION FOR CANONICAL TABLE USAGE
 * ============================================================================
 *
 * Use this in production code paths to fail fast if a non-canonical table
 * is accidentally passed to a query builder.
 *
 * Usage:
 *   assertCanonicalTable(tableName, 'leaderboard_v1_clob');
 *   // Throws if tableName is not pm_unified_ledger_v9_clob_tbl
 */

import {
  CANONICAL_TABLES,
  DEPRECATED_TABLES,
  PnlSurface,
  getLedgerForSurface,
  isCanonicalTable,
  isDeprecatedTable,
} from './canonicalTables';

/**
 * Error thrown when a non-canonical table is used.
 */
export class NonCanonicalTableError extends Error {
  constructor(
    public readonly tableName: string,
    public readonly expectedSurface?: PnlSurface,
    public readonly suggestion?: string
  ) {
    const surfaceMsg = expectedSurface
      ? ` Expected table for surface '${expectedSurface}': ${getLedgerForSurface(expectedSurface)}`
      : '';
    const suggestionMsg = suggestion ? ` Suggestion: ${suggestion}` : '';

    super(
      `Non-canonical table used: '${tableName}'.${surfaceMsg}${suggestionMsg}`
    );
    this.name = 'NonCanonicalTableError';
  }
}

/**
 * Assert that a table name is canonical.
 * Throws NonCanonicalTableError if the table is deprecated or unknown.
 *
 * @param tableName - The table name to check
 * @param context - Optional context for error message
 */
export function assertCanonicalTable(
  tableName: string,
  context?: string
): void {
  if (isDeprecatedTable(tableName)) {
    throw new NonCanonicalTableError(
      tableName,
      undefined,
      `Table '${tableName}' is deprecated. Use canonical imports from lib/pnl/canonicalTables.ts`
    );
  }

  if (!isCanonicalTable(tableName)) {
    throw new NonCanonicalTableError(
      tableName,
      undefined,
      `Table '${tableName}' is not in the canonical registry. Check PERSISTED_OBJECTS_MANIFEST.md`
    );
  }
}

/**
 * Assert that a ledger table matches the expected product surface.
 * Use this when building surface-specific queries.
 *
 * @param tableName - The table name being used
 * @param surface - The product surface being built
 *
 * @example
 * // In V1 Leaderboard code:
 * assertLedgerMatchesSurface(ledgerTable, 'leaderboard_v1_clob');
 * // Throws if ledgerTable is not pm_unified_ledger_v9_clob_tbl
 */
export function assertLedgerMatchesSurface(
  tableName: string,
  surface: PnlSurface
): void {
  const expectedTable = getLedgerForSurface(surface);

  if (tableName !== expectedTable) {
    throw new NonCanonicalTableError(
      tableName,
      surface,
      `For surface '${surface}', use getLedgerForSurface('${surface}') which returns '${expectedTable}'`
    );
  }
}

/**
 * Get canonical table with runtime validation.
 * Use this instead of direct CANONICAL_TABLES access when you want
 * the assertion to happen at call time.
 *
 * @param key - Key from CANONICAL_TABLES
 * @returns The table name
 */
export function getCanonicalTable(
  key: keyof typeof CANONICAL_TABLES
): string {
  const table = CANONICAL_TABLES[key];
  if (!table) {
    throw new Error(`Unknown canonical table key: ${key}`);
  }
  return table;
}

// Re-export for convenience
export { CANONICAL_TABLES, getLedgerForSurface };
export type { PnlSurface };
