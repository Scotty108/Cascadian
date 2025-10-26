/**
 * Strategy Builder - ClickHouse Connector
 *
 * High-performance connector for querying wallet metrics with sub-200ms performance.
 *
 * @module lib/strategy-builder
 */

// Main connector
export {
  walletMetricsConnector,
  buildQuery,
  METRIC_FIELD_MAP,
  WalletMetricsConnector,
  type WalletMetricsQueryBuilder,
} from './clickhouse-connector';

// Type definitions
export type {
  FilterOperator,
  QueryFilter,
  QueryOptions,
  DataSourceResult,
  WalletMetricsComplete,
  WalletMetricsByCategory,
  Node,
  NodeGraph,
  StrategyDefinition,
  ExecutionContext,
  StrategyResult,
} from './types';

// Metric field mapping utilities
export {
  TS_TO_CH_MAP,
  CH_TO_TS_MAP,
  METRIC_FIELDS,
  getMetricsByPhase,
  getMetricsByTier,
  getIndexedMetrics,
  getMetricDefinition,
  isValidMetricField,
  getAllMetricFieldNames,
  getRecommendedFilterMetrics,
  type MetricFieldDefinition,
} from './metric-field-mapping';

// Examples (optional - for development)
export { examples, runAllExamples } from './examples';

// Execution Engine
export { StrategyExecutionEngine, strategyEngine } from './execution-engine';

// Supabase Connector
export { supabaseConnector, SupabaseConnector } from './supabase-connector';
