-- Migration 004: Create wallet_metrics_complete table
-- Purpose: Store all 102 metrics for each wallet across 4 time windows
-- Priority: CRITICAL (Phase 1)

CREATE TABLE IF NOT EXISTS wallet_metrics_complete (
  -- Primary key
  wallet_address String,
  window Enum8('30d' = 1, '90d' = 2, '180d' = 3, 'lifetime' = 4),

  -- Metadata
  calculated_at DateTime,
  trades_analyzed UInt32,
  resolved_trades UInt32,
  track_record_days UInt16,
  raw_data_hash String COMMENT 'For cache invalidation',

  -- ============================================================
  -- BASE SCREENERS (#1-24) - TIER 1
  -- ============================================================

  -- Omega & Risk-Adjusted Returns (#1-8)
  metric_1_omega_gross Decimal(12, 4) COMMENT 'Ω(τ=0): gains/losses before fees',
  metric_2_omega_net Decimal(12, 4) COMMENT 'Ω(τ=net fees): gains/losses after fees - TIER 1',
  metric_3_gain_to_pain Decimal(12, 4) COMMENT 'GPR: Same as omega_gross',
  metric_4_profit_factor Decimal(12, 4) COMMENT 'Same as omega_net',
  metric_5_sortino Decimal(12, 4) COMMENT 'Mean return / downside deviation',
  metric_6_sharpe Decimal(12, 4) COMMENT 'Mean return / total volatility',
  metric_7_martin Decimal(12, 4) COMMENT 'CAGR / Ulcer Index',
  metric_8_calmar Decimal(12, 4) COMMENT 'CAGR / Max Drawdown',

  -- P&L & Returns (#9-14)
  metric_9_net_pnl_usd Decimal(18, 2) COMMENT 'Total net P&L in USD',
  metric_10_net_pnl_pct Decimal(10, 4) COMMENT 'Net P&L as % of starting bankroll',
  metric_11_cagr Decimal(10, 4) COMMENT 'Compound annual growth rate',
  metric_12_hit_rate Decimal(5, 4) COMMENT 'Win rate (wins / total resolved)',
  metric_13_avg_win_usd Decimal(18, 2) COMMENT 'Average $ profit on wins',
  metric_14_avg_loss_usd Decimal(18, 2) COMMENT 'Average $ loss on losses (negative)',

  -- Expected Value (#15-16)
  metric_15_ev_per_bet_mean Decimal(18, 4) COMMENT 'Mean EV per bet using p_hat',
  metric_16_ev_per_bet_median Decimal(18, 4) COMMENT 'Median EV per bet',

  -- Drawdown Metrics (#17-21)
  metric_17_max_drawdown Decimal(10, 4) COMMENT 'Max % decline from peak (negative)',
  metric_18_avg_drawdown Decimal(10, 4) COMMENT 'Average % drawdown when underwater',
  metric_19_time_in_drawdown_pct Decimal(5, 4) COMMENT '% of time below peak equity',
  metric_20_ulcer_index Decimal(12, 6) COMMENT 'Sqrt(mean(drawdown²))',
  metric_21_drawdown_recovery_days Decimal(10, 2) COMMENT 'Avg days to recover from DD',

  -- Activity & Track Record (#22-24) - TIER 1
  metric_22_resolved_bets UInt32 COMMENT 'Count of resolved trades - TIER 1',
  metric_23_track_record_days UInt16 COMMENT 'Days from first to last trade - TIER 1',
  metric_24_bets_per_week Decimal(10, 2) COMMENT 'Average bets per week - TIER 1',

  -- ============================================================
  -- ADVANCED SCREENERS (#25-47) - PHASE 2-3
  -- ============================================================

  -- Forecasting Skill (#25-29) - TIER 2
  metric_25_brier_score Decimal(10, 6) COMMENT 'Mean((p_hat - outcome)²) - TIER 2',
  metric_26_log_score Decimal(12, 6) COMMENT 'Mean(log(p_hat)) for correct outcomes',
  metric_27_calibration_slope Decimal(10, 6) COMMENT 'Regression: outcome ~ p_hat (ideal=1)',
  metric_28_calibration_intercept Decimal(10, 6) COMMENT 'Intercept (ideal=0)',
  metric_29_calibration_error Decimal(10, 6) COMMENT 'MAE between predicted and actual freq',

  -- Closing Line Value (#30-32) - TIER 2
  metric_30_clv_mean Decimal(10, 6) COMMENT 'Avg(entry_price - close_price) * side - TIER 2',
  metric_31_clv_median Decimal(10, 6) COMMENT 'Median CLV',
  metric_32_clv_positive_pct Decimal(5, 4) COMMENT '% of bets that beat closing line',

  -- Market Making (#33-34)
  metric_33_orderbook_participation_pct Decimal(5, 4) COMMENT '% bets via limit orders',
  metric_34_maker_taker_ratio Decimal(10, 4) COMMENT 'maker_volume / taker_volume - TIER 3',

  -- Risk Metrics (#35-38)
  metric_35_var_95 Decimal(18, 2) COMMENT 'Value at Risk (95th percentile loss)',
  metric_36_downside_deviation Decimal(12, 6) COMMENT 'Stddev of negative returns only',
  metric_37_cvar_95 Decimal(18, 2) COMMENT 'Conditional VaR (avg of worst 5%)',
  metric_38_max_single_trade_loss_pct Decimal(10, 4) COMMENT 'Worst loss as % of bankroll',

  -- Timing & Holding (#39-40)
  metric_39_avg_holding_period_hours Decimal(12, 2) COMMENT 'Mean hours from entry to exit',
  metric_40_median_holding_period_hours Decimal(12, 2) COMMENT 'Median hours held',

  -- Diversification (#41-43)
  metric_41_category_mix_json String COMMENT 'JSON: {"Politics": 0.45, "Crypto": 0.30}',
  metric_42_category_hhi Decimal(10, 6) COMMENT 'Sum(category_share²) - lower = diversified',
  metric_43_concentration_hhi Decimal(10, 6) COMMENT 'HHI across markets (not categories)',

  -- Position Sizing (#44-47)
  metric_44_stake_sizing_volatility Decimal(12, 6) COMMENT 'Stddev(stake % of bankroll)',
  metric_45_avg_stake_pct Decimal(10, 4) COMMENT 'Mean(stake / bankroll)',
  metric_46_max_stake_pct Decimal(10, 4) COMMENT 'Max single stake % of bankroll',
  metric_47_min_stake_pct Decimal(10, 4) COMMENT 'Min stake % (excludes zero)',

  -- ============================================================
  -- LATENCY-ADJUSTED METRICS (#48-55) - TIER 1 CRITICAL
  -- ============================================================

  -- Copyability Analysis (#48-53) - TIER 1
  metric_48_omega_lag_30s Decimal(12, 4) COMMENT 'Omega if copied with 30s delay - TIER 1',
  metric_49_omega_lag_2min Decimal(12, 4) COMMENT 'Omega if copied with 2min delay - TIER 1',
  metric_50_omega_lag_5min Decimal(12, 4) COMMENT 'Omega if copied with 5min delay - TIER 1',
  metric_51_clv_lag_30s Decimal(10, 6) COMMENT 'CLV using price 30s after entry',
  metric_52_clv_lag_2min Decimal(10, 6) COMMENT 'CLV using price 2min after entry',
  metric_53_clv_lag_5min Decimal(10, 6) COMMENT 'CLV using price 5min after entry',

  -- Edge Durability (#54-55) - TIER 2
  metric_54_edge_half_life_hours Decimal(12, 2) COMMENT 'Hours until edge decays 50% - TIER 2',
  metric_55_latency_penalty_index Decimal(10, 6) COMMENT '1 - (omega_lag_5min / omega_net) - TIER 2',

  -- ============================================================
  -- MOMENTUM & TRENDS (#56-88) - TIER 1 CRITICAL
  -- ============================================================

  -- Performance Trends (#56-59) - TIER 1
  metric_56_omega_momentum_30d Decimal(12, 6) COMMENT 'Theil-Sen slope of omega over 30d - TIER 1',
  metric_57_omega_momentum_90d Decimal(12, 6) COMMENT 'Theil-Sen slope of omega over 90d',
  metric_58_pnl_trend_30d Decimal(18, 6) COMMENT 'Slope of cumulative P&L ($/day)',
  metric_59_pnl_acceleration Decimal(18, 6) COMMENT 'Second derivative of P&L trend',

  -- Return Distribution Shape (#60-62) - TIER 1 (#60 CRITICAL)
  metric_60_tail_ratio Decimal(10, 4) COMMENT 'Avg(top 10% wins) / Avg(bottom 10% losses) - TIER 1',
  metric_61_skewness Decimal(12, 6) COMMENT 'Distribution skewness (>0 = right tail)',
  metric_62_kurtosis Decimal(12, 6) COMMENT 'Distribution kurtosis (>3 = fat tails)',

  -- Kelly Criterion & Sizing (#63-64)
  metric_63_kelly_utilization_pct Decimal(10, 4) COMMENT 'Actual bet size / optimal Kelly size',
  metric_64_risk_of_ruin_approx Decimal(10, 6) COMMENT 'Approx probability of bankrupt',

  -- Capital Efficiency (#65-69) - TIER 1 (#69 CRITICAL)
  metric_65_return_on_capital Decimal(10, 4) COMMENT 'Net P&L / avg capital deployed',
  metric_66_capital_turnover Decimal(10, 4) COMMENT 'Total volume / avg bankroll',
  metric_67_news_shock_ev_5min Decimal(18, 4) COMMENT 'EV from bets within 5min of news',
  metric_68_crowd_orthogonality Decimal(10, 6) COMMENT 'Correlation with aggregate volume - TIER 3',
  metric_69_ev_per_hour_capital Decimal(18, 6) COMMENT 'EV / (hours_held * capital) - TIER 1 CRITICAL',

  -- Cost Analysis (#70-73)
  metric_70_gross_to_net_ratio Decimal(10, 4) COMMENT 'pnl_net / pnl_gross',
  metric_71_fee_per_bet Decimal(18, 4) COMMENT 'Avg fee paid per trade',
  metric_72_fee_burden_pct Decimal(10, 4) COMMENT 'Total fees / gross wins - TIER 3',
  metric_73_slippage_per_bet Decimal(18, 6) COMMENT 'Avg slippage per trade',

  -- Streaks & Consistency (#74-77)
  metric_74_longest_win_streak UInt16 COMMENT 'Max consecutive wins',
  metric_75_longest_loss_streak UInt16 COMMENT 'Max consecutive losses',
  metric_76_current_streak_length Int16 COMMENT 'Current streak (+ or -)',
  metric_77_streak_consistency Decimal(10, 6) COMMENT 'Stddev of streak lengths',

  -- Time-Based Patterns (#78-79)
  metric_78_weekday_vs_weekend_roi Decimal(10, 6) COMMENT 'Ratio of weekday vs weekend ROI',
  metric_79_integrity_deposit_pnl Decimal(5, 4) COMMENT 'P&L from deposits vs trading',

  -- Bet Timing Quality (#80-81)
  metric_80_avg_time_to_resolution_days Decimal(12, 2) COMMENT 'Avg days from bet to resolution',
  metric_81_early_vs_late_roi Decimal(10, 6) COMMENT 'ROI on early bets vs late bets',

  -- Recent Momentum Indicators (#82-86) - TIER 1
  metric_82_clv_momentum_30d Decimal(12, 6) COMMENT 'Slope of CLV over last 30 days',
  metric_83_ev_hr_momentum_30d Decimal(18, 8) COMMENT 'Slope of EV/hr metric',
  metric_84_drawdown_trend_60d Decimal(12, 6) COMMENT 'Slope of drawdown depth',
  metric_85_performance_trend_flag Enum8('improving'=1, 'declining'=2, 'stable'=3) COMMENT 'Composite trend - TIER 1',
  metric_86_hot_hand_z_score Decimal(10, 4) COMMENT 'Z-score of recent win streak',

  -- Discipline Metrics (#87-88) - TIER 1
  metric_87_bet_frequency_variance Decimal(12, 6) COMMENT 'Variance in bets per week',
  metric_88_sizing_discipline_trend Decimal(12, 6) COMMENT 'Trend in sizing volatility - TIER 1',

  -- ============================================================
  -- PER-CATEGORY METRICS (#89-92) - JSON
  -- ============================================================

  metric_89_clv_by_category_json String COMMENT 'JSON: {"AI": 0.08} - TIER 2',
  metric_90_omega_lag_by_category_json String COMMENT 'JSON: {"AI": {"2min": 4.5}}',
  metric_91_calibration_by_category_json String COMMENT 'JSON: {"AI": 0.05} - TIER 2',
  metric_92_ev_hr_by_category_json String COMMENT 'JSON: {"AI": 125.50}',

  -- ============================================================
  -- MARKET MICROSTRUCTURE (#93-102) - PHASE 3-4
  -- ============================================================

  -- Event-Driven Edge (#93-94)
  metric_93_news_reaction_time_median_sec Decimal(12, 2) COMMENT 'Median time from news to bet',
  metric_94_event_archetype_edge_json String COMMENT 'JSON: {"court_rulings": 0.15}',

  -- Execution Quality (#95-97)
  metric_95_spread_capture_ratio Decimal(10, 6) COMMENT 'How much of bid-ask spread captured',
  metric_96_adverse_selection_cost Decimal(18, 6) COMMENT 'Cost from being picked off',
  metric_97_price_impact_per_k Decimal(12, 6) COMMENT 'Market impact per $1k traded',

  -- Behavioral Bias (#98-100)
  metric_98_yes_no_bias_pct Decimal(10, 4) COMMENT '%YES trades - %NO trades',
  metric_99_liquidity_access_skill Decimal(10, 6) COMMENT 'How well they source liquidity - TIER 3',
  metric_100_news_latency_distribution_json String COMMENT 'JSON: percentiles of reaction time',

  -- Alpha Source Decomposition (#101-102) - TIER 3
  metric_101_alpha_source_timing_pct Decimal(10, 4) COMMENT '% of alpha from entry timing',
  metric_102_edge_source_decomp_json String COMMENT 'JSON: breakdown of edge sources - TIER 3'
)
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY (window)
ORDER BY (wallet_address, window)
SETTINGS index_granularity = 8192;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_omega_net ON wallet_metrics_complete(metric_2_omega_net)
  TYPE minmax GRANULARITY 4;

CREATE INDEX IF NOT EXISTS idx_ev_per_hour ON wallet_metrics_complete(metric_69_ev_per_hour_capital)
  TYPE minmax GRANULARITY 4;

CREATE INDEX IF NOT EXISTS idx_performance_trend ON wallet_metrics_complete(metric_85_performance_trend_flag)
  TYPE set(0) GRANULARITY 1;

CREATE INDEX IF NOT EXISTS idx_resolved_bets ON wallet_metrics_complete(metric_22_resolved_bets)
  TYPE minmax GRANULARITY 4;

-- Comments
COMMENT ON TABLE wallet_metrics_complete IS 'All 102 metrics for each wallet across 4 time windows (30d/90d/180d/lifetime)';
