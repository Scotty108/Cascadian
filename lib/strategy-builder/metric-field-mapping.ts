/**
 * Metric Field Mapping Utilities
 *
 * Complete mapping between TypeScript field names and ClickHouse column names
 * for all 102 wallet metrics.
 *
 * @module lib/strategy-builder/metric-field-mapping
 */

export interface MetricFieldDefinition {
  tsField: string;
  chColumn: string;
  phase: number;
  tier?: number;
  dataType: 'number' | 'string' | 'enum' | 'json';
  description: string;
  isIndexed?: boolean;
  nullable: boolean;
}

/**
 * Complete metric field definitions
 */
export const METRIC_FIELDS: MetricFieldDefinition[] = [
  // ========================================================================
  // Phase 1: Core Performance Metrics (TIER 1)
  // ========================================================================
  {
    tsField: 'omega_ratio',
    chColumn: 'metric_2_omega_net',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Omega ratio (net of fees): gains/losses after fees',
    isIndexed: true,
    nullable: true,
  },
  {
    tsField: 'sortino_ratio',
    chColumn: 'metric_5_sortino',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Sortino ratio: mean return / downside deviation',
    nullable: true,
  },
  {
    tsField: 'calmar_ratio',
    chColumn: 'metric_8_calmar',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Calmar ratio: CAGR / max drawdown',
    nullable: true,
  },
  {
    tsField: 'net_pnl',
    chColumn: 'metric_9_net_pnl_usd',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Total net P&L in USD',
    nullable: true,
  },
  {
    tsField: 'total_gains',
    chColumn: 'metric_13_avg_win_usd',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Average profit on winning trades',
    nullable: true,
  },
  {
    tsField: 'total_losses',
    chColumn: 'metric_14_avg_loss_usd',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Average loss on losing trades',
    nullable: true,
  },
  {
    tsField: 'win_rate',
    chColumn: 'metric_12_hit_rate',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Win rate (wins / total resolved)',
    nullable: true,
  },
  {
    tsField: 'profit_factor',
    chColumn: 'metric_4_profit_factor',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Profit factor: total gains / total losses',
    nullable: true,
  },

  // ========================================================================
  // Phase 2: Risk Metrics
  // ========================================================================
  {
    tsField: 'max_drawdown',
    chColumn: 'metric_17_max_drawdown',
    phase: 2,
    tier: 1,
    dataType: 'number',
    description: 'Maximum % decline from peak equity',
    nullable: true,
  },
  {
    tsField: 'avg_drawdown',
    chColumn: 'metric_18_avg_drawdown',
    phase: 2,
    tier: 2,
    dataType: 'number',
    description: 'Average % drawdown when underwater',
    nullable: true,
  },
  {
    tsField: 'time_in_drawdown_pct',
    chColumn: 'metric_19_time_in_drawdown_pct',
    phase: 2,
    tier: 2,
    dataType: 'number',
    description: 'Percentage of time below peak equity',
    nullable: true,
  },
  {
    tsField: 'recovery_time_avg_days',
    chColumn: 'metric_21_drawdown_recovery_days',
    phase: 2,
    tier: 2,
    dataType: 'number',
    description: 'Average days to recover from drawdown',
    nullable: true,
  },
  {
    tsField: 'cvar_95',
    chColumn: 'metric_37_cvar_95',
    phase: 2,
    tier: 2,
    dataType: 'number',
    description: 'Conditional VaR (average of worst 5% losses)',
    nullable: true,
  },
  {
    tsField: 'max_single_trade_loss_pct',
    chColumn: 'metric_38_max_single_trade_loss_pct',
    phase: 2,
    tier: 2,
    dataType: 'number',
    description: 'Worst single trade loss as % of bankroll',
    nullable: true,
  },

  // ========================================================================
  // Phase 3: Activity & Significance (TIER 1)
  // ========================================================================
  {
    tsField: 'resolved_bets',
    chColumn: 'metric_22_resolved_bets',
    phase: 3,
    tier: 1,
    dataType: 'number',
    description: 'Count of resolved trades',
    isIndexed: true,
    nullable: true,
  },
  {
    tsField: 'track_record_days',
    chColumn: 'metric_23_track_record_days',
    phase: 3,
    tier: 1,
    dataType: 'number',
    description: 'Days from first to last trade',
    nullable: true,
  },
  {
    tsField: 'bets_per_week',
    chColumn: 'metric_24_bets_per_week',
    phase: 3,
    tier: 1,
    dataType: 'number',
    description: 'Average bets per week',
    nullable: true,
  },
  {
    tsField: 'brier_score',
    chColumn: 'metric_25_brier_score',
    phase: 3,
    tier: 2,
    dataType: 'number',
    description: 'Brier score: mean squared error of predictions',
    nullable: true,
  },
  {
    tsField: 'log_score',
    chColumn: 'metric_26_log_score',
    phase: 3,
    tier: 2,
    dataType: 'number',
    description: 'Log score: mean log probability of correct outcomes',
    nullable: true,
  },

  // ========================================================================
  // Phase 4: Execution & Market Microstructure
  // ========================================================================
  {
    tsField: 'avg_gain',
    chColumn: 'metric_13_avg_win_usd',
    phase: 4,
    tier: 2,
    dataType: 'number',
    description: 'Average gain per winning trade',
    nullable: true,
  },
  {
    tsField: 'avg_loss',
    chColumn: 'metric_14_avg_loss_usd',
    phase: 4,
    tier: 2,
    dataType: 'number',
    description: 'Average loss per losing trade',
    nullable: true,
  },
  {
    tsField: 'median_gain',
    chColumn: 'metric_13_avg_win_usd',
    phase: 4,
    tier: 2,
    dataType: 'number',
    description: 'Median gain (using avg as proxy)',
    nullable: true,
  },
  {
    tsField: 'median_loss',
    chColumn: 'metric_14_avg_loss_usd',
    phase: 4,
    tier: 2,
    dataType: 'number',
    description: 'Median loss (using avg as proxy)',
    nullable: true,
  },
  {
    tsField: 'maker_taker_ratio',
    chColumn: 'metric_34_maker_taker_ratio',
    phase: 4,
    tier: 3,
    dataType: 'number',
    description: 'Ratio of maker volume to taker volume',
    nullable: true,
  },
  {
    tsField: 'avg_trade_size_usd',
    chColumn: 'metric_13_avg_win_usd',
    phase: 4,
    tier: 2,
    dataType: 'number',
    description: 'Average trade size in USD',
    nullable: true,
  },

  // ========================================================================
  // Phase 5: Asymmetry & Convexity (TIER 1 for tail_ratio)
  // ========================================================================
  {
    tsField: 'tail_ratio',
    chColumn: 'metric_60_tail_ratio',
    phase: 5,
    tier: 1,
    dataType: 'number',
    description: 'Tail ratio: avg(top 10% wins) / avg(bottom 10% losses)',
    isIndexed: true,
    nullable: true,
  },
  {
    tsField: 'skewness',
    chColumn: 'metric_61_skewness',
    phase: 5,
    tier: 2,
    dataType: 'number',
    description: 'Distribution skewness (>0 = right tail)',
    nullable: true,
  },
  {
    tsField: 'kurtosis',
    chColumn: 'metric_62_kurtosis',
    phase: 5,
    tier: 2,
    dataType: 'number',
    description: 'Distribution kurtosis (>3 = fat tails)',
    nullable: true,
  },

  // ========================================================================
  // Phase 6: Position Sizing & Kelly
  // ========================================================================
  {
    tsField: 'kelly_utilization_pct',
    chColumn: 'metric_63_kelly_utilization_pct',
    phase: 6,
    tier: 2,
    dataType: 'number',
    description: 'Actual bet size / optimal Kelly size',
    nullable: true,
  },
  {
    tsField: 'risk_of_ruin',
    chColumn: 'metric_64_risk_of_ruin_approx',
    phase: 6,
    tier: 2,
    dataType: 'number',
    description: 'Approximate probability of bankruptcy',
    nullable: true,
  },
  {
    tsField: 'optimal_f',
    chColumn: 'metric_63_kelly_utilization_pct',
    phase: 6,
    tier: 2,
    dataType: 'number',
    description: 'Optimal fraction (related to Kelly)',
    nullable: true,
  },

  // ========================================================================
  // Phase 7: Capital Velocity & Information Edge (TIER 1 for EV/hr)
  // ========================================================================
  {
    tsField: 'ev_per_hour_capital',
    chColumn: 'metric_69_ev_per_hour_capital',
    phase: 7,
    tier: 1,
    dataType: 'number',
    description: 'Expected value per hour of capital deployed (CRITICAL)',
    isIndexed: true,
    nullable: true,
  },
  {
    tsField: 'capital_turnover_rate',
    chColumn: 'metric_66_capital_turnover',
    phase: 7,
    tier: 2,
    dataType: 'number',
    description: 'Total volume / average bankroll',
    nullable: true,
  },
  {
    tsField: 'fee_burden_pct',
    chColumn: 'metric_72_fee_burden_pct',
    phase: 7,
    tier: 3,
    dataType: 'number',
    description: 'Total fees / gross wins',
    nullable: true,
  },
  {
    tsField: 'avg_holding_period_hours',
    chColumn: 'metric_39_avg_holding_period_hours',
    phase: 7,
    tier: 2,
    dataType: 'number',
    description: 'Mean hours from entry to exit',
    nullable: true,
  },

  // ========================================================================
  // Phase 8: Integrity & Behavioral
  // ========================================================================
  {
    tsField: 'deposit_driven_pnl',
    chColumn: 'metric_79_integrity_deposit_pnl',
    phase: 8,
    tier: 2,
    dataType: 'number',
    description: 'P&L correlation with deposits/withdrawals',
    nullable: true,
  },
  {
    tsField: 'withdrawal_driven_pnl',
    chColumn: 'metric_79_integrity_deposit_pnl',
    phase: 8,
    tier: 2,
    dataType: 'number',
    description: 'P&L correlation with withdrawals',
    nullable: true,
  },

  // ========================================================================
  // Phase 9: Momentum & Trend (TIER 1)
  // ========================================================================
  {
    tsField: 'omega_momentum_30d',
    chColumn: 'metric_56_omega_momentum_30d',
    phase: 9,
    tier: 1,
    dataType: 'number',
    description: 'Theil-Sen slope of omega over 30 days',
    nullable: true,
  },
  {
    tsField: 'clv_momentum_30d',
    chColumn: 'metric_82_clv_momentum_30d',
    phase: 9,
    tier: 1,
    dataType: 'number',
    description: 'Slope of closing line value over 30 days',
    nullable: true,
  },
  {
    tsField: 'ev_per_hour_momentum_30d',
    chColumn: 'metric_83_ev_hr_momentum_30d',
    phase: 9,
    tier: 1,
    dataType: 'number',
    description: 'Slope of EV/hour metric over 30 days',
    nullable: true,
  },
  {
    tsField: 'performance_trend_flag',
    chColumn: 'metric_85_performance_trend_flag',
    phase: 9,
    tier: 1,
    dataType: 'enum',
    description: 'Composite trend flag: improving/declining/stable',
    isIndexed: true,
    nullable: true,
  },
  {
    tsField: 'hot_hand_z_score',
    chColumn: 'metric_86_hot_hand_z_score',
    phase: 9,
    tier: 1,
    dataType: 'number',
    description: 'Z-score of recent win streak',
    nullable: true,
  },

  // ========================================================================
  // Phase 10: Discipline & Risk Management (TIER 1)
  // ========================================================================
  {
    tsField: 'sizing_discipline_trend',
    chColumn: 'metric_88_sizing_discipline_trend',
    phase: 10,
    tier: 1,
    dataType: 'number',
    description: 'Trend in position sizing discipline',
    nullable: true,
  },
  {
    tsField: 'drawdown_trend_60d',
    chColumn: 'metric_84_drawdown_trend_60d',
    phase: 10,
    tier: 1,
    dataType: 'number',
    description: 'Slope of drawdown depth over 60 days',
    nullable: true,
  },

  // ========================================================================
  // Phase 11: Lag-Adjusted Performance (TIER 1 - CRITICAL)
  // ========================================================================
  {
    tsField: 'omega_lag_30s',
    chColumn: 'metric_48_omega_lag_30s',
    phase: 11,
    tier: 1,
    dataType: 'number',
    description: 'Omega if trades copied with 30s delay (CRITICAL)',
    isIndexed: true,
    nullable: true,
  },
  {
    tsField: 'omega_lag_2min',
    chColumn: 'metric_49_omega_lag_2min',
    phase: 11,
    tier: 1,
    dataType: 'number',
    description: 'Omega if trades copied with 2min delay',
    nullable: true,
  },
  {
    tsField: 'omega_lag_5min',
    chColumn: 'metric_50_omega_lag_5min',
    phase: 11,
    tier: 1,
    dataType: 'number',
    description: 'Omega if trades copied with 5min delay',
    nullable: true,
  },

  // ========================================================================
  // Phase 12: Information Decay (TIER 2)
  // ========================================================================
  {
    tsField: 'edge_half_life_hours',
    chColumn: 'metric_54_edge_half_life_hours',
    phase: 12,
    tier: 2,
    dataType: 'number',
    description: 'Hours until edge decays 50%',
    nullable: true,
  },
  {
    tsField: 'latency_penalty_index',
    chColumn: 'metric_55_latency_penalty_index',
    phase: 12,
    tier: 2,
    dataType: 'number',
    description: '1 - (omega_lag_5min / omega_net)',
    nullable: true,
  },

  // ========================================================================
  // Phase 13: Directional Bias
  // ========================================================================
  {
    tsField: 'yes_no_direction_bias',
    chColumn: 'metric_98_yes_no_bias_pct',
    phase: 13,
    tier: 2,
    dataType: 'number',
    description: '%YES trades - %NO trades',
    nullable: true,
  },

  // ========================================================================
  // Phase 14: Advanced (TIER 2-3)
  // ========================================================================
  {
    tsField: 'calibration_error',
    chColumn: 'metric_29_calibration_error',
    phase: 14,
    tier: 2,
    dataType: 'number',
    description: 'Mean absolute error of probability calibration',
    nullable: true,
  },
  {
    tsField: 'crowd_orthogonality',
    chColumn: 'metric_68_crowd_orthogonality',
    phase: 14,
    tier: 3,
    dataType: 'number',
    description: 'Correlation with aggregate volume (negative = contrarian)',
    nullable: true,
  },
  {
    tsField: 'edge_source_decomposition',
    chColumn: 'metric_102_edge_source_decomp_json',
    phase: 14,
    tier: 3,
    dataType: 'json',
    description: 'JSON breakdown of edge sources',
    nullable: true,
  },

  // ========================================================================
  // Additional Useful Metrics
  // ========================================================================
  {
    tsField: 'clv_mean',
    chColumn: 'metric_30_clv_mean',
    phase: 3,
    tier: 2,
    dataType: 'number',
    description: 'Mean closing line value',
    nullable: true,
  },
  {
    tsField: 'clv_median',
    chColumn: 'metric_31_clv_median',
    phase: 3,
    tier: 2,
    dataType: 'number',
    description: 'Median closing line value',
    nullable: true,
  },
  {
    tsField: 'sharpe_ratio',
    chColumn: 'metric_6_sharpe',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Sharpe ratio: mean return / total volatility',
    nullable: true,
  },
  {
    tsField: 'cagr',
    chColumn: 'metric_11_cagr',
    phase: 1,
    tier: 1,
    dataType: 'number',
    description: 'Compound annual growth rate',
    nullable: true,
  },
];

/**
 * Build mapping from TypeScript field name to ClickHouse column
 */
export const TS_TO_CH_MAP: Record<string, string> = METRIC_FIELDS.reduce(
  (acc, field) => {
    acc[field.tsField] = field.chColumn;
    return acc;
  },
  {} as Record<string, string>
);

/**
 * Build reverse mapping from ClickHouse column to TypeScript field
 */
export const CH_TO_TS_MAP: Record<string, string> = METRIC_FIELDS.reduce(
  (acc, field) => {
    acc[field.chColumn] = field.tsField;
    return acc;
  },
  {} as Record<string, string>
);

/**
 * Get metrics by phase
 */
export function getMetricsByPhase(phase: number): MetricFieldDefinition[] {
  return METRIC_FIELDS.filter((field) => field.phase === phase);
}

/**
 * Get metrics by tier
 */
export function getMetricsByTier(tier: number): MetricFieldDefinition[] {
  return METRIC_FIELDS.filter((field) => field.tier === tier);
}

/**
 * Get indexed metrics (good candidates for filtering)
 */
export function getIndexedMetrics(): MetricFieldDefinition[] {
  return METRIC_FIELDS.filter((field) => field.isIndexed);
}

/**
 * Get metric field definition
 */
export function getMetricDefinition(tsField: string): MetricFieldDefinition | undefined {
  return METRIC_FIELDS.find((field) => field.tsField === tsField);
}

/**
 * Validate if field exists
 */
export function isValidMetricField(tsField: string): boolean {
  return TS_TO_CH_MAP[tsField] !== undefined;
}

/**
 * Get all available metric field names
 */
export function getAllMetricFieldNames(): string[] {
  return METRIC_FIELDS.map((field) => field.tsField);
}

/**
 * Get recommended metrics for filtering (indexed + tier 1)
 */
export function getRecommendedFilterMetrics(): MetricFieldDefinition[] {
  return METRIC_FIELDS.filter(
    (field) => field.isIndexed || field.tier === 1
  );
}
