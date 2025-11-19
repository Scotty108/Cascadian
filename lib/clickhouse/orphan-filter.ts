/**
 * Orphan Trade Filter for ClickHouse Queries
 *
 * Provides SQL fragments to filter out trades with empty/invalid condition_ids
 * (orphans) from all query results.
 *
 * Usage:
 *   import { getOrphanFilter, isOrphan } from '@/lib/clickhouse/orphan-filter';
 *
 *   // In SQL queries:
 *   const query = `
 *     SELECT * FROM pm_trades_canonical_v3
 *     WHERE ${getOrphanFilter('condition_id_norm_v3')}
 *   `;
 *
 *   // Or client-side filtering:
 *   const cleanTrades = trades.filter(t => !isOrphan(t.condition_id_norm_v3));
 */

/**
 * Get SQL WHERE clause fragment to filter out orphan trades
 *
 * @param conditionIdColumn - Column name containing condition_id (e.g., 'condition_id_norm_v3', 'canonical_condition_id')
 * @returns SQL fragment for WHERE clause
 */
export function getOrphanFilter(conditionIdColumn: string = 'condition_id_norm_v3'): string {
  return `(
    ${conditionIdColumn} IS NOT NULL
    AND ${conditionIdColumn} != ''
    AND length(${conditionIdColumn}) = 64
  )`;
}

/**
 * Get inverted filter (only orphans)
 *
 * Useful for creating "orphan trades" view
 */
export function getOrphanOnlyFilter(conditionIdColumn: string = 'condition_id_norm_v3'): string {
  return `(
    ${conditionIdColumn} IS NULL
    OR ${conditionIdColumn} = ''
    OR length(${conditionIdColumn}) != 64
  )`;
}

/**
 * Client-side check if a condition_id is orphaned
 *
 * @param conditionId - Condition ID to check
 * @returns true if orphan, false if valid
 */
export function isOrphan(conditionId: string | null | undefined): boolean {
  if (!conditionId) return true;
  if (conditionId === '') return true;
  if (conditionId.length !== 64) return true;
  return false;
}

/**
 * Filter orphans from an array of trades (client-side)
 *
 * @param trades - Array of trades with condition_id field
 * @param conditionIdField - Name of field containing condition_id (default: 'canonical_condition_id')
 * @returns Filtered array with orphans removed
 */
export function filterOrphans<T extends Record<string, any>>(
  trades: T[],
  conditionIdField: string = 'canonical_condition_id'
): T[] {
  return trades.filter(trade => !isOrphan(trade[conditionIdField]));
}

/**
 * Separate orphans from valid trades
 *
 * @param trades - Array of trades
 * @param conditionIdField - Name of field containing condition_id
 * @returns Object with { valid, orphans } arrays
 */
export function separateOrphans<T extends Record<string, any>>(
  trades: T[],
  conditionIdField: string = 'canonical_condition_id'
): { valid: T[]; orphans: T[] } {
  const valid: T[] = [];
  const orphans: T[] = [];

  for (const trade of trades) {
    if (isOrphan(trade[conditionIdField])) {
      orphans.push(trade);
    } else {
      valid.push(trade);
    }
  }

  return { valid, orphans };
}

/**
 * Get orphan statistics from query result
 *
 * @param trades - Array of trades
 * @param conditionIdField - Name of field containing condition_id
 * @returns Stats object
 */
export function getOrphanStats<T extends Record<string, any>>(
  trades: T[],
  conditionIdField: string = 'canonical_condition_id'
): {
  total: number;
  valid: number;
  orphans: number;
  orphanPct: number;
} {
  const { valid, orphans } = separateOrphans(trades, conditionIdField);

  return {
    total: trades.length,
    valid: valid.length,
    orphans: orphans.length,
    orphanPct: trades.length > 0 ? (orphans.length / trades.length) * 100 : 0
  };
}

/**
 * SQL fragment for adding orphan flag column
 *
 * Use in SELECT queries to add is_orphan boolean column
 */
export function getOrphanFlagColumn(conditionIdColumn: string = 'condition_id_norm_v3'): string {
  return `CASE
    WHEN ${conditionIdColumn} IS NULL OR ${conditionIdColumn} = '' OR length(${conditionIdColumn}) != 64
    THEN 1
    ELSE 0
  END AS is_orphan`;
}

/**
 * Complete WHERE clause with optional orphan filtering
 *
 * @param existingWhere - Existing WHERE conditions (without 'WHERE' keyword)
 * @param excludeOrphans - If true, add orphan filter
 * @param conditionIdColumn - Column name for condition_id
 * @returns Complete WHERE clause with proper AND/OR logic
 */
export function buildWhereClause(
  existingWhere: string = '',
  excludeOrphans: boolean = true,
  conditionIdColumn: string = 'condition_id_norm_v3'
): string {
  const orphanFilter = excludeOrphans ? getOrphanFilter(conditionIdColumn) : '';

  if (!existingWhere && !orphanFilter) {
    return '';
  }

  if (!existingWhere) {
    return `WHERE ${orphanFilter}`;
  }

  if (!orphanFilter) {
    return `WHERE ${existingWhere}`;
  }

  return `WHERE ${existingWhere} AND ${orphanFilter}`;
}
