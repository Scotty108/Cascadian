/**
 * Strategy Builder Type Definitions
 * Complete type system for 102 metrics + node graph
 */

// ============================================================================
// Wallet Metrics (102 metrics from DATABASE_ARCHITECT_SPEC.md)
// ============================================================================

export interface WalletMetricsComplete {
  // Identity
  wallet_address: string;
  time_window: '7d' | '30d' | '90d' | 'lifetime';
  calculated_at: Date;

  // Phase 1: Core Performance Metrics (8 metrics)
  omega_ratio: number | null;                    // #2
  sortino_ratio: number | null;                  // #5
  calmar_ratio: number | null;                   // #8
  net_pnl: number | null;                        // #9
  total_gains: number | null;                    // #10
  total_losses: number | null;                   // #11
  win_rate: number | null;                       // #12
  profit_factor: number | null;                  // #13

  // Phase 2: Risk Metrics
  max_drawdown: number | null;                   // #17
  avg_drawdown: number | null;                   // #18
  time_in_drawdown_pct: number | null;          // #19
  recovery_time_avg_days: number | null;        // #20
  cvar_95: number | null;                        // #37
  max_single_trade_loss_pct: number | null;     // #38

  // Phase 3: Activity & Significance
  resolved_bets: number | null;                  // #22
  track_record_days: number | null;              // #23
  bets_per_week: number | null;                  // #24
  brier_score: number | null;                    // #25
  log_score: number | null;                      // #26

  // Phase 4: Execution & Market Microstructure
  avg_gain: number | null;                       // #27
  avg_loss: number | null;                       // #28
  median_gain: number | null;                    // #29
  median_loss: number | null;                    // #30
  maker_taker_ratio: number | null;              // #34
  avg_trade_size_usd: number | null;             // #35

  // Phase 5: Asymmetry & Convexity
  tail_ratio: number | null;                     // #60 (convexity)
  skewness: number | null;                       // #61
  kurtosis: number | null;                       // #62

  // Phase 6: Position Sizing & Kelly
  kelly_utilization_pct: number | null;         // #63
  risk_of_ruin: number | null;                   // #64
  optimal_f: number | null;                      // #65

  // Phase 7: Capital Velocity & Information Edge
  ev_per_hour_capital: number | null;            // #69
  capital_turnover_rate: number | null;         // #70
  fee_burden_pct: number | null;                // #72
  avg_holding_period_hours: number | null;      // #73

  // Phase 8: Integrity & Behavioral
  deposit_driven_pnl: number | null;             // #79
  withdrawal_driven_pnl: number | null;         // #80

  // Phase 9: Momentum & Trend
  omega_momentum_30d: number | null;             // #56
  clv_momentum_30d: number | null;               // #82
  ev_per_hour_momentum_30d: number | null;       // #83
  performance_trend_flag: 'Improving' | 'Declining' | 'Stable' | 'Insufficient' | null;  // #85
  hot_hand_z_score: number | null;               // #86

  // Phase 10: Discipline & Risk Management
  sizing_discipline_trend: number | null;        // #88
  drawdown_trend_60d: number | null;            // #84

  // Phase 11: Lag-Adjusted Performance (TIER 1 - Critical)
  omega_lag_30s: number | null;                  // #48
  omega_lag_2min: number | null;                 // #49
  omega_lag_5min: number | null;                 // #50

  // Phase 12: Information Decay
  edge_half_life_hours: number | null;           // #54
  latency_penalty_index: number | null;          // #55

  // Phase 13: Directional Bias
  yes_no_direction_bias: number | null;          // #98

  // Phase 14: Advanced (Phase 3)
  calibration_error: number | null;              // #91 (global)
  crowd_orthogonality: number | null;            // #68
  edge_source_decomposition: string | null;      // #102 (JSON)
}

export interface WalletMetricsByCategory extends WalletMetricsComplete {
  category: string;
  is_primary_category: boolean;

  // Category-specific metrics
  calibration_error: number | null;              // #91
  clv_lag_0s: number | null;                     // #89
  omega_lag: number | null;                      // #90
  ev_per_hour_category: number | null;           // #92
}

// ============================================================================
// Node Type System
// ============================================================================

export type NodeType =
  | 'DATA_SOURCE'
  | 'FILTER'
  | 'LOGIC'
  | 'AGGREGATION'
  | 'SIGNAL'
  | 'ACTION'
  | 'orchestrator';

export type DataSource =
  | 'WALLETS'
  | 'MARKETS'
  | 'TRADES'
  | 'SIGNALS'
  | 'CATEGORIES';

export type FilterOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL'
  | 'IN'
  | 'NOT_IN'
  | 'CONTAINS'
  | 'DOES_NOT_CONTAIN'
  | 'STARTS_WITH'
  | 'ENDS_WITH'
  | 'BETWEEN'
  | 'IS_NULL'
  | 'IS_NOT_NULL'
  | 'IN_PERCENTILE'
  | 'NOT_IN_PERCENTILE';

export type LogicOperator = 'AND' | 'OR' | 'NOT' | 'XOR';

export type AggregationFunction =
  | 'COUNT'
  | 'SUM'
  | 'AVG'
  | 'MIN'
  | 'MAX'
  | 'PERCENTILE'
  | 'STDEV';

export type SignalType = 'ENTRY' | 'EXIT' | 'HOLD';
export type SignalDirection = 'YES' | 'NO';
export type SignalStrength = 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG';

export type ActionType =
  | 'ADD_TO_WATCHLIST'
  | 'REMOVE_FROM_WATCHLIST'
  | 'SEND_ALERT'
  | 'LOG_RESULT'
  | 'WEBHOOK';

// ============================================================================
// Node Configurations
// ============================================================================

export interface DataSourceConfig {
  source: DataSource;
  prefilters?: {
    table: string;
    where?: string;
    limit?: number;
  };
  mode: 'REALTIME' | 'BATCH';
  refreshMs?: number;
}

export interface FilterConfig {
  field: string;
  operator: FilterOperator;
  value: any;
  categorySpecific?: {
    enabled: boolean;
    category: string;
  };
}

// ============================================================================
// Enhanced Filter Types (Task Group 1)
// ============================================================================

export type FilterLogic = 'AND' | 'OR';

export type FieldType = 'number' | 'string' | 'array' | 'date' | 'boolean' | 'object' | 'unknown';

export type FieldCategory = 'Market Data' | 'Analytics' | 'Metadata';

export interface FieldDefinition {
  path: string;              // Full path like 'analytics.roi' or 'volume'
  name: string;              // Display name (last part of path)
  type: FieldType;           // Detected field type
  category: FieldCategory;   // Grouped category for UI
  sampleValue: string;       // Formatted sample value for display
}

export interface FilterCondition {
  id: string;
  field: string;
  operator: FilterOperator;
  value: any;
  fieldType?: FieldType;
  caseSensitive?: boolean; // For text search operators (CONTAINS, STARTS_WITH, etc.)
}

export interface EnhancedFilterConfig {
  conditions: FilterCondition[];
  logic: FilterLogic;
  version: 2; // Differentiate from legacy FilterConfig
}

export interface LogicConfig {
  operator: LogicOperator;
  inputs: string[];  // Node IDs
}

export interface AggregationConfig {
  function: AggregationFunction;
  field?: string;
  percentile?: number;
  groupBy?: string[];
}

export interface SignalConfig {
  signalType: SignalType;
  condition: string;  // Logic node ID
  direction?: SignalDirection;
  strength?: SignalStrength;
  positionSize?: {
    method: 'FIXED' | 'KELLY' | 'OMEGA_WEIGHTED';
    baseAmount?: number;
  };
}

export interface ActionConfig {
  action: ActionType;
  params?: Record<string, any>;
}

// ============================================================================
// Node Definitions
// ============================================================================

export interface BaseNode {
  type: NodeType;
  id: string;
}

export interface DataSourceNode extends BaseNode {
  type: 'DATA_SOURCE';
  config: DataSourceConfig;
}

export interface FilterNode extends BaseNode {
  type: 'FILTER';
  config: FilterConfig;
}

export interface LogicNode extends BaseNode {
  type: 'LOGIC';
  config: LogicConfig;
}

export interface AggregationNode extends BaseNode {
  type: 'AGGREGATION';
  config: AggregationConfig;
}

export interface SignalNode extends BaseNode {
  type: 'SIGNAL';
  config: SignalConfig;
}

export interface ActionNode extends BaseNode {
  type: 'ACTION';
  config: ActionConfig;
}

export type Node =
  | DataSourceNode
  | FilterNode
  | LogicNode
  | AggregationNode
  | SignalNode
  | ActionNode;

export interface Edge {
  from: string;
  to: string;
}

export interface NodeGraph {
  nodes: Node[];
  edges: Edge[];
}

// ============================================================================
// Strategy Definition
// ============================================================================

export interface StrategyDefinition {
  strategyId: string;
  strategyName: string;
  strategyDescription?: string;
  strategyType: 'SCREENING' | 'MOMENTUM' | 'ARBITRAGE' | 'CUSTOM';
  isPredefined: boolean;
  isArchived?: boolean;
  nodeGraph: NodeGraph;
  executionMode: 'MANUAL' | 'AUTO' | 'SCHEDULED';
  scheduleCron?: string;
  isActive: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Execution Context & Results
// ============================================================================

export interface ExecutionContext {
  strategyId: string;
  executionId: string;
  userId?: string;
  mode: 'MANUAL' | 'AUTO' | 'SCHEDULED';
  startTime: Date;
}

export interface NodeResult {
  nodeId: string;
  data: any;
  timestamp: Date;
  executionTimeMs: number;
  cached: boolean;
  error?: string;
}

export interface StrategyResult {
  executionId: string;
  strategyId: string;
  results: Record<string, NodeResult>;
  aggregations?: Record<string, any>;
  signalsGenerated?: any[];
  actionsExecuted?: any[];
  totalExecutionTimeMs: number;
  nodesEvaluated: number;
  dataPointsProcessed: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  errorMessage?: string;
}

// ============================================================================
// Metric Availability
// ============================================================================

export type MetricStatus = 'READY' | 'PENDING' | 'PLANNED' | 'UNKNOWN';

export interface MetricMetadata {
  table: string;
  column: string;
  status: MetricStatus;
  eta?: string;
  phase: number;
  tier?: number;
  description?: string;
}

export interface MetricAvailability {
  [metric: string]: MetricMetadata;
}

// ============================================================================
// Query Builders
// ============================================================================

export interface QueryFilter {
  field: string;
  operator: FilterOperator;
  value: any;
}

export interface QueryOptions {
  filters?: QueryFilter[];
  orderBy?: {
    field: string;
    direction: 'ASC' | 'DESC';
  };
  limit?: number;
  offset?: number;
}

export interface DataSourceResult {
  data: any[];
  totalCount: number;
  executionTimeMs: number;
  source: 'clickhouse' | 'supabase';
}

// ============================================================================
// Orchestrator Configuration (Task Group 14)
// ============================================================================

export interface OrchestratorConfig {
  version: 1;
  mode: 'autonomous' | 'approval';
  portfolio_size_usd: number;
  risk_tolerance: number;  // 1-10, maps to Kelly lambda
  position_sizing_rules: {
    fractional_kelly_lambda: number;      // Auto-calculated from risk_tolerance
    max_per_position: number;             // 0.01 - 0.20 (1% - 20%)
    min_bet: number;                      // USD, e.g., 5
    max_bet: number;                      // USD, e.g., 500
    portfolio_heat_limit: number;         // 0.10 - 1.0 (10% - 100%)
    risk_reward_threshold: number;        // 1.0 - 10.0
    drawdown_protection: {
      enabled: boolean;
      drawdown_threshold: number;         // e.g., 0.10 (10%)
      size_reduction: number;             // e.g., 0.50 (50% reduction)
    };
    volatility_adjustment: {
      enabled: boolean;
    };
  };
  // NEW: Copy Trading Configuration
  copy_trading?: {
    enabled: boolean;
    poll_interval_seconds: number;        // 30, 60, 120
    owrr_thresholds: {
      min_yes: number;                    // e.g., 0.65
      min_no: number;                     // e.g., 0.60
      min_confidence: 'high' | 'medium' | 'low';
    };
    max_latency_seconds: number;          // e.g., 120
    tracked_categories?: string[];        // Optional: filter by categories
  };
}
