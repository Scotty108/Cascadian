/**
 * ClickHouse Connector for Wallet Metrics
 *
 * High-performance query builder optimized for sub-200ms queries on 10K+ wallets
 *
 * Performance Optimizations:
 * 1. PREWHERE for high-cardinality filters (pushed to storage layer)
 * 2. Column pruning (SELECT only needed fields)
 * 3. Partition pruning (leverage time_window partitioning)
 * 4. Index hints for range queries on indexed columns
 * 5. Batch query support for multiple filter sets
 *
 * @module lib/strategy-builder/clickhouse-connector
 */

import { clickhouse } from '@/lib/clickhouse/client';
import type {
  FilterOperator,
  QueryFilter,
  QueryOptions,
  DataSourceResult,
  WalletMetricsComplete,
  WalletMetricsByCategory,
} from './types';
import { TS_TO_CH_MAP } from './metric-field-mapping';

// Re-export for backward compatibility
export const METRIC_FIELD_MAP = TS_TO_CH_MAP;

/**
 * Columns that have minmax indexes for efficient range queries
 */
const INDEXED_COLUMNS = new Set([
  'metric_2_omega_net',
  'metric_69_ev_per_hour_capital',
  'metric_22_resolved_bets',
  'metric_48_omega_lag_30s',
  'metric_60_tail_ratio',
]);

/**
 * High-cardinality columns that benefit from PREWHERE
 */
const PREWHERE_CANDIDATES = new Set([
  'wallet_address',
  'metric_2_omega_net',
  'metric_69_ev_per_hour_capital',
  'metric_22_resolved_bets',
]);

// ============================================================================
// Query Builder
// ============================================================================

export interface WalletMetricsQueryBuilder {
  table: 'wallet_metrics_complete' | 'wallet_metrics_by_category';
  filters: QueryFilter[];
  timeWindow?: '7d' | '30d' | '90d' | 'lifetime';
  category?: string;
  selectFields?: string[];
  orderBy?: { field: string; direction: 'ASC' | 'DESC' };
  limit?: number;
  offset?: number;
  usePrewhere?: boolean;
}

/**
 * Convert FilterOperator to ClickHouse SQL operator
 */
function operatorToSQL(operator: FilterOperator, value: any): string {
  switch (operator) {
    case 'EQUALS':
      return '=';
    case 'NOT_EQUALS':
      return '!=';
    case 'GREATER_THAN':
      return '>';
    case 'GREATER_THAN_OR_EQUAL':
      return '>=';
    case 'LESS_THAN':
      return '<';
    case 'LESS_THAN_OR_EQUAL':
      return '<=';
    case 'IN':
      return 'IN';
    case 'NOT_IN':
      return 'NOT IN';
    case 'CONTAINS':
      return 'LIKE';
    case 'BETWEEN':
      return 'BETWEEN';
    case 'IS_NULL':
      return 'IS NULL';
    case 'IS_NOT_NULL':
      return 'IS NOT NULL';
    case 'IN_PERCENTILE':
      // Custom: field >= quantile(0.X)(field)
      return 'IN_PERCENTILE'; // Special handling needed
    case 'NOT_IN_PERCENTILE':
      return 'NOT_IN_PERCENTILE';
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}

/**
 * Format value for SQL query (escape and quote as needed)
 */
function formatValue(value: any, operator: FilterOperator): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (operator === 'IN' || operator === 'NOT_IN') {
    if (!Array.isArray(value)) {
      throw new Error(`IN/NOT_IN operator requires array value`);
    }
    const formatted = value.map((v) => {
      if (typeof v === 'string') {
        return `'${v.replace(/'/g, "''")}'`; // Escape single quotes
      }
      return String(v);
    });
    return `(${formatted.join(', ')})`;
  }

  if (operator === 'BETWEEN') {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(`BETWEEN operator requires array of 2 values`);
    }
    return `${formatValue(value[0], 'EQUALS')} AND ${formatValue(value[1], 'EQUALS')}`;
  }

  if (operator === 'CONTAINS') {
    if (typeof value !== 'string') {
      throw new Error(`CONTAINS operator requires string value`);
    }
    return `'%${value.replace(/'/g, "''")}%'`;
  }

  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  return String(value);
}

/**
 * Build WHERE clause from filters
 */
function buildWhereClause(
  filters: QueryFilter[],
  usePrewhere: boolean = true
): { prewhere: string; where: string } {
  if (filters.length === 0) {
    return { prewhere: '', where: '' };
  }

  const prewhereFilters: string[] = [];
  const whereFilters: string[] = [];

  for (const filter of filters) {
    // Map TypeScript field name to ClickHouse column
    const columnName = METRIC_FIELD_MAP[filter.field] || filter.field;

    // Special handling for percentile operators
    if (filter.operator === 'IN_PERCENTILE') {
      const percentile = Array.isArray(filter.value) ? filter.value[0] : filter.value;
      const clause = `${columnName} >= quantile(${percentile})(${columnName})`;
      whereFilters.push(clause);
      continue;
    }

    if (filter.operator === 'NOT_IN_PERCENTILE') {
      const percentile = Array.isArray(filter.value) ? filter.value[0] : filter.value;
      const clause = `${columnName} < quantile(${percentile})(${columnName})`;
      whereFilters.push(clause);
      continue;
    }

    // Null checks don't need values
    if (filter.operator === 'IS_NULL') {
      const clause = `${columnName} IS NULL`;
      whereFilters.push(clause);
      continue;
    }

    if (filter.operator === 'IS_NOT_NULL') {
      const clause = `${columnName} IS NOT NULL`;
      whereFilters.push(clause);
      continue;
    }

    // Build standard filter clause
    const sqlOperator = operatorToSQL(filter.operator, filter.value);
    const formattedValue = formatValue(filter.value, filter.operator);

    const clause =
      filter.operator === 'BETWEEN'
        ? `${columnName} ${sqlOperator} ${formattedValue}`
        : `${columnName} ${sqlOperator} ${formattedValue}`;

    // Use PREWHERE for high-selectivity filters
    if (usePrewhere && PREWHERE_CANDIDATES.has(columnName)) {
      prewhereFilters.push(clause);
    } else {
      whereFilters.push(clause);
    }
  }

  return {
    prewhere: prewhereFilters.length > 0 ? prewhereFilters.join(' AND ') : '',
    where: whereFilters.length > 0 ? whereFilters.join(' AND ') : '',
  };
}

/**
 * Build SELECT clause with column pruning
 */
function buildSelectClause(
  table: string,
  selectFields?: string[]
): string {
  if (!selectFields || selectFields.length === 0) {
    return '*';
  }

  // Map TypeScript field names to ClickHouse columns
  const columns = selectFields.map((field) => {
    const columnName = METRIC_FIELD_MAP[field] || field;

    // If mapped, return with alias
    if (METRIC_FIELD_MAP[field]) {
      return `${columnName} AS ${field}`;
    }

    return columnName;
  });

  // Always include primary key fields
  if (!selectFields.includes('wallet_address')) {
    columns.unshift('wallet_address');
  }

  if (table === 'wallet_metrics_complete' && !selectFields.includes('time_window')) {
    columns.push('window AS time_window');
  }

  if (table === 'wallet_metrics_by_category' && !selectFields.includes('category')) {
    columns.push('category');
  }

  return columns.join(', ');
}

/**
 * Build complete SQL query from builder config
 */
export function buildQuery(config: WalletMetricsQueryBuilder): string {
  const {
    table,
    filters = [],
    timeWindow,
    category,
    selectFields,
    orderBy,
    limit,
    offset,
    usePrewhere = true,
  } = config;

  // Build clauses
  const selectClause = buildSelectClause(table, selectFields);
  const { prewhere, where } = buildWhereClause(filters, usePrewhere);

  // Additional WHERE conditions
  const additionalConditions: string[] = [];

  if (timeWindow) {
    additionalConditions.push(`window = '${timeWindow}'`);
  }

  if (category && table === 'wallet_metrics_by_category') {
    additionalConditions.push(`category = '${category.replace(/'/g, "''")}'`);
  }

  // Combine WHERE clauses
  const allWhereConditions = [
    where,
    ...additionalConditions,
  ].filter(Boolean);

  const whereClause = allWhereConditions.length > 0
    ? allWhereConditions.join(' AND ')
    : '';

  // Build final query
  let query = `SELECT ${selectClause}\nFROM ${table}`;

  if (prewhere) {
    query += `\nPREWHERE ${prewhere}`;
  }

  if (whereClause) {
    query += `\nWHERE ${whereClause}`;
  }

  if (orderBy) {
    const orderColumn = METRIC_FIELD_MAP[orderBy.field] || orderBy.field;
    query += `\nORDER BY ${orderColumn} ${orderBy.direction}`;
  }

  if (limit) {
    query += `\nLIMIT ${limit}`;
  }

  if (offset) {
    query += `\nOFFSET ${offset}`;
  }

  // Final optimization: add SETTINGS for performance
  query += `\nSETTINGS max_threads = 4`;

  return query;
}

// ============================================================================
// Query Executor
// ============================================================================

export class WalletMetricsConnector {
  private readonly retryAttempts = 3;
  private readonly retryDelayMs = 1000;

  /**
   * Query wallet_metrics_complete table
   */
  async queryWalletMetrics(
    config: Omit<WalletMetricsQueryBuilder, 'table'>
  ): Promise<DataSourceResult> {
    const startTime = Date.now();

    try {
      const query = buildQuery({
        ...config,
        table: 'wallet_metrics_complete',
      });

      console.log('[ClickHouse] Executing query:', query);

      const result = await this.executeWithRetry(query);
      const data = await result.json() as WalletMetricsComplete[];

      // Get total count (if not using limit)
      let totalCount = data.length;
      if (config.limit) {
        const countQuery = buildQuery({
          ...config,
          table: 'wallet_metrics_complete',
          selectFields: ['wallet_address'],
          limit: undefined,
          offset: undefined,
          orderBy: undefined,
        }).replace(/SELECT.*FROM/, 'SELECT count() as count FROM');

        const countResult = await this.executeWithRetry(countQuery);
        const countData = await countResult.json() as { count: string }[];
        totalCount = parseInt(countData[0]?.count || '0', 10);
      }

      const executionTimeMs = Date.now() - startTime;

      console.log(`[ClickHouse] Query executed in ${executionTimeMs}ms, returned ${data.length} rows`);

      return {
        data: this.transformResults(data),
        totalCount,
        executionTimeMs,
        source: 'clickhouse',
      };
    } catch (error) {
      console.error('[ClickHouse] Query failed:', error);
      throw new Error(
        `ClickHouse query failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Query wallet_metrics_by_category table
   */
  async queryWalletMetricsByCategory(
    config: Omit<WalletMetricsQueryBuilder, 'table'>
  ): Promise<DataSourceResult> {
    const startTime = Date.now();

    try {
      const query = buildQuery({
        ...config,
        table: 'wallet_metrics_by_category',
      });

      console.log('[ClickHouse] Executing query:', query);

      const result = await this.executeWithRetry(query);
      const data = await result.json() as WalletMetricsByCategory[];

      let totalCount = data.length;
      if (config.limit) {
        const countQuery = buildQuery({
          ...config,
          table: 'wallet_metrics_by_category',
          selectFields: ['wallet_address'],
          limit: undefined,
          offset: undefined,
          orderBy: undefined,
        }).replace(/SELECT.*FROM/, 'SELECT count() as count FROM');

        const countResult = await this.executeWithRetry(countQuery);
        const countData = await countResult.json() as { count: string }[];
        totalCount = parseInt(countData[0]?.count || '0', 10);
      }

      const executionTimeMs = Date.now() - startTime;

      console.log(`[ClickHouse] Query executed in ${executionTimeMs}ms, returned ${data.length} rows`);

      return {
        data: this.transformResults(data),
        totalCount,
        executionTimeMs,
        source: 'clickhouse',
      };
    } catch (error) {
      console.error('[ClickHouse] Query failed:', error);
      throw new Error(
        `ClickHouse query failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Execute query with retry logic
   */
  private async executeWithRetry(query: string, attempt = 1): Promise<any> {
    try {
      return await clickhouse.query({
        query,
        format: 'JSONEachRow',
      });
    } catch (error) {
      if (attempt < this.retryAttempts) {
        console.warn(
          `[ClickHouse] Query failed (attempt ${attempt}/${this.retryAttempts}), retrying...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelayMs * attempt)
        );
        return this.executeWithRetry(query, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Transform ClickHouse results to match TypeScript types
   */
  private transformResults(data: any[]): WalletMetricsComplete[] {
    return data.map((row) => {
      // Map ClickHouse column names back to TypeScript field names
      const transformed: any = {
        wallet_address: row.wallet_address,
        time_window: row.window || row.time_window,
        calculated_at: new Date(row.calculated_at),
      };

      // Map all metric fields
      for (const [tsField, chColumn] of Object.entries(METRIC_FIELD_MAP)) {
        if (row[chColumn] !== undefined) {
          transformed[tsField] = row[chColumn];
        } else if (row[tsField] !== undefined) {
          // Already mapped in SELECT with alias
          transformed[tsField] = row[tsField];
        }
      }

      return transformed as WalletMetricsComplete;
    });
  }

  /**
   * Batch query multiple filter sets (for testing multiple strategies)
   */
  async batchQuery(
    configs: Array<Omit<WalletMetricsQueryBuilder, 'table'>>
  ): Promise<DataSourceResult[]> {
    return Promise.all(configs.map((config) => this.queryWalletMetrics(config)));
  }

  /**
   * Get performance statistics for a query
   */
  async explainQuery(
    config: Omit<WalletMetricsQueryBuilder, 'table'>
  ): Promise<string> {
    const query = buildQuery({
      ...config,
      table: 'wallet_metrics_complete',
    });

    const explainQuery = `EXPLAIN ${query}`;

    try {
      const result = await clickhouse.query({
        query: explainQuery,
        format: 'TSV',
      } as any);

      const plan = await result.text();
      return plan;
    } catch (error) {
      throw new Error(
        `EXPLAIN query failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const walletMetricsConnector = new WalletMetricsConnector();
