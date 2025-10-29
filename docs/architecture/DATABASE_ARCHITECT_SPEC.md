# Database Architecture Specification
## Polymarket Wallet Analytics & Strategy Builder System

**Date**: 2025-10-25
**Version**: 1.0
**For**: Database Architect (Claude Session)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture Overview](#system-architecture-overview)
3. [Data Model Requirements](#data-model-requirements)
4. [Metric Calculation Specifications](#metric-calculation-specifications)
5. [Query Performance Requirements](#query-performance-requirements)
6. [API Endpoint Specifications](#api-endpoint-specifications)
7. [Data Pipeline Requirements](#data-pipeline-requirements)
8. [Implementation Priorities](#implementation-priorities)

---

## Executive Summary

### Mission
Build a comprehensive wallet analytics system that enables users to:
1. **Identify elite traders** using 102 quantitative metrics
2. **Find "winnable games"** via top-down category analysis
3. **Detect insider patterns** through behavioral analysis
4. **Build custom strategies** using a flexible node-based interface

### Core Philosophy (from Austin)
> "Let's not play that stupid game. Let's play the games we can win and then follow the wallets that are also playing the games that we can win."

This drives a **dual approach**:
- **Bottom-Up**: Find the best wallets (11 screening strategies)
- **Top-Down**: Find the best categories first, THEN find specialists in those categories (Austin Methodology)

### Current State
- ✅ ClickHouse `trades_raw` table exists with all raw trade data
- ✅ Supabase `markets` table with 20,219 markets + categories
- ✅ 30 of 102 metrics implemented in `WalletMetricsCalculator`
- ✅ Bulk sync infrastructure ready (`sync-all-wallets-bulk.ts`)
- ❌ Missing: 72 advanced metrics, category aggregations, market flow tracking

### Success Criteria
1. Calculate all 102 metrics for 6,605+ wallets across 4 time windows (30d/90d/180d/lifetime)
2. Support arbitrary filter formulas via node-based strategy builder
3. Provide real-time "smart money" signals via market flow divergence
4. Automatically detect insider patterns and wallet specialization
5. Query performance: <500ms for complex strategies, <100ms for category analytics

---

## System Architecture Overview

### Three-Layer Data Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Raw Data (ClickHouse)                              │
│ - trades_raw: All wallet trades (millions of rows)          │
│ - market_price_history: Price snapshots for lag simulation  │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: Aggregated Metrics (Hybrid: ClickHouse + Supabase) │
│ - wallet_metrics_complete: 102 metrics × 6,605 wallets      │
│ - wallet_metrics_by_category: 102 metrics × category        │
│ - category_analytics: Top-down winnability metrics          │
│ - market_flow_metrics: Elite vs crowd divergence            │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: Intelligence (Supabase)                            │
│ - wallet_category_tags: Specialization + insider detection  │
│ - wallet_leaderboard_history: Rank tracking over time       │
│ - strategy_templates: Saved filter formulas                 │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Goldsky API → ClickHouse trades_raw → Daily ETL → Metrics Tables
                      ↓
                Supabase markets (category JOIN)
                      ↓
            Materialized Views (performance)
                      ↓
            Strategy Builder API (formula evaluation)
```

---

## Data Model Requirements

### 1. Core Metrics Storage

#### 1.1 Comprehensive Wallet Metrics Table

**Purpose**: Store all 102 metrics for each wallet across multiple time windows

**Schema** (Supabase or ClickHouse - recommend ClickHouse for performance):

```sql
CREATE TABLE wallet_metrics_complete (
  -- Primary key
  wallet_address String,
  window Enum8('30d' = 1, '90d' = 2, '180d' = 3, 'lifetime' = 4),

  -- Metadata
  calculated_at DateTime,
  trades_analyzed UInt32,
  resolved_trades UInt32,
  track_record_days UInt16,

  -- BASE SCREENERS (#1-24)
  -- Omega & Risk-Adjusted Returns
  metric_1_omega_gross Decimal(12, 4) COMMENT 'Ω(τ=0): gains/losses before fees',
  metric_2_omega_net Decimal(12, 4) COMMENT 'Ω(τ=net fees): gains/losses after fees',
  metric_3_gain_to_pain Decimal(12, 4) COMMENT 'GPR: Same as omega_gross',
  metric_4_profit_factor Decimal(12, 4) COMMENT 'Same as omega_net',
  metric_5_sortino Decimal(12, 4) COMMENT 'Mean return / downside deviation',
  metric_6_sharpe Decimal(12, 4) COMMENT 'Mean return / total volatility',
  metric_7_martin Decimal(12, 4) COMMENT 'CAGR / Ulcer Index',
  metric_8_calmar Decimal(12, 4) COMMENT 'CAGR / Max Drawdown',

  -- P&L & Returns
  metric_9_net_pnl_usd Decimal(18, 2) COMMENT 'Total net P&L in USD',
  metric_10_net_pnl_pct Decimal(10, 4) COMMENT 'Net P&L as % of starting bankroll',
  metric_11_cagr Decimal(10, 4) COMMENT 'Compound annual growth rate',

  -- Win/Loss Stats
  metric_12_hit_rate Decimal(5, 4) COMMENT 'Win rate (wins / total resolved)',
  metric_13_avg_win_usd Decimal(18, 2) COMMENT 'Average $ profit on wins',
  metric_14_avg_loss_usd Decimal(18, 2) COMMENT 'Average $ loss on losses (negative)',

  -- Expected Value
  metric_15_ev_per_bet_mean Decimal(18, 4) COMMENT 'Mean EV per bet using p_hat',
  metric_16_ev_per_bet_median Decimal(18, 4) COMMENT 'Median EV per bet',

  -- Drawdown Metrics
  metric_17_max_drawdown Decimal(10, 4) COMMENT 'Max % decline from peak (negative)',
  metric_18_avg_drawdown Decimal(10, 4) COMMENT 'Average % drawdown when underwater',
  metric_19_time_in_drawdown_pct Decimal(5, 4) COMMENT '% of time below peak equity',
  metric_20_ulcer_index Decimal(12, 6) COMMENT 'Sqrt(mean(drawdown²))',
  metric_21_drawdown_recovery_days Decimal(10, 2) COMMENT 'Avg days to recover from DD',

  -- Activity & Track Record
  metric_22_resolved_bets UInt32 COMMENT 'Count of resolved trades',
  metric_23_track_record_days UInt16 COMMENT 'Days from first to last trade',
  metric_24_bets_per_week Decimal(10, 2) COMMENT 'Average bets per week',

  -- ADVANCED SCREENERS (#25-47)
  -- Forecasting Skill
  metric_25_brier_score Decimal(10, 6) COMMENT 'Mean((p_hat - outcome)²) - lower better',
  metric_26_log_score Decimal(12, 6) COMMENT 'Mean(log(p_hat)) for correct outcomes',
  metric_27_calibration_slope Decimal(10, 6) COMMENT 'Regression: outcome ~ p_hat (ideal=1)',
  metric_28_calibration_intercept Decimal(10, 6) COMMENT 'Intercept (ideal=0)',
  metric_29_calibration_error Decimal(10, 6) COMMENT 'MAE between predicted and actual freq',

  -- Closing Line Value (CLV)
  metric_30_clv_mean Decimal(10, 6) COMMENT 'Avg(entry_price - close_price) * side',
  metric_31_clv_median Decimal(10, 6) COMMENT 'Median CLV',
  metric_32_clv_positive_pct Decimal(5, 4) COMMENT '% of bets that beat closing line',

  -- Market Making
  metric_33_orderbook_participation_pct Decimal(5, 4) COMMENT '% bets via limit orders',
  metric_34_maker_taker_ratio Decimal(10, 4) COMMENT 'maker_volume / taker_volume',

  -- Risk Metrics
  metric_35_var_95 Decimal(18, 2) COMMENT 'Value at Risk (95th percentile loss)',
  metric_36_downside_deviation Decimal(12, 6) COMMENT 'Stddev of negative returns only',
  metric_37_cvar_95 Decimal(18, 2) COMMENT 'Conditional VaR (avg of worst 5%)',
  metric_38_max_single_trade_loss_pct Decimal(10, 4) COMMENT 'Worst loss as % of bankroll',

  -- Timing & Holding
  metric_39_avg_holding_period_hours Decimal(12, 2) COMMENT 'Mean hours from entry to exit',
  metric_40_median_holding_period_hours Decimal(12, 2) COMMENT 'Median hours held',

  -- Diversification
  metric_41_category_mix_json String COMMENT 'JSON: {"Politics": 0.45, "Crypto": 0.30}',
  metric_42_category_hhi Decimal(10, 6) COMMENT 'Sum(category_share²) - lower = diversified',
  metric_43_concentration_hhi Decimal(10, 6) COMMENT 'HHI across markets (not categories)',

  -- Position Sizing
  metric_44_stake_sizing_volatility Decimal(12, 6) COMMENT 'Stddev(stake % of bankroll)',
  metric_45_avg_stake_pct Decimal(10, 4) COMMENT 'Mean(stake / bankroll)',
  metric_46_max_stake_pct Decimal(10, 4) COMMENT 'Max single stake % of bankroll',
  metric_47_min_stake_pct Decimal(10, 4) COMMENT 'Min stake % (excludes zero)',

  -- LATENCY-ADJUSTED METRICS (#48-55)
  -- Copyability Analysis
  metric_48_omega_lag_30s Decimal(12, 4) COMMENT 'Omega if copied with 30s delay',
  metric_49_omega_lag_2min Decimal(12, 4) COMMENT 'Omega if copied with 2min delay',
  metric_50_omega_lag_5min Decimal(12, 4) COMMENT 'Omega if copied with 5min delay',
  metric_51_clv_lag_30s Decimal(10, 6) COMMENT 'CLV using price 30s after entry',
  metric_52_clv_lag_2min Decimal(10, 6) COMMENT 'CLV using price 2min after entry',
  metric_53_clv_lag_5min Decimal(10, 6) COMMENT 'CLV using price 5min after entry',
  metric_54_edge_half_life_hours Decimal(12, 2) COMMENT 'Hours until edge decays 50%',
  metric_55_latency_penalty_index Decimal(10, 6) COMMENT '1 - (omega_lag_5min / omega_net)',

  -- MOMENTUM & TRENDS (#56-88)
  -- Performance Trends
  metric_56_omega_momentum_30d Decimal(12, 6) COMMENT 'Theil-Sen slope of omega over 30d',
  metric_57_omega_momentum_90d Decimal(12, 6) COMMENT 'Theil-Sen slope of omega over 90d',
  metric_58_pnl_trend_30d Decimal(18, 6) COMMENT 'Slope of cumulative P&L ($/day)',
  metric_59_pnl_acceleration Decimal(18, 6) COMMENT 'Second derivative of P&L trend',

  -- Return Distribution Shape
  metric_60_tail_ratio Decimal(10, 4) COMMENT 'Avg(top 10% wins) / Avg(bottom 10% losses)',
  metric_61_skewness Decimal(12, 6) COMMENT 'Distribution skewness (>0 = right tail)',
  metric_62_kurtosis Decimal(12, 6) COMMENT 'Distribution kurtosis (>3 = fat tails)',

  -- Kelly Criterion & Sizing
  metric_63_kelly_utilization_pct Decimal(10, 4) COMMENT 'Actual bet size / optimal Kelly size',
  metric_64_risk_of_ruin_approx Decimal(10, 6) COMMENT 'Approx probability of bankrupt',

  -- Capital Efficiency
  metric_65_return_on_capital Decimal(10, 4) COMMENT 'Net P&L / avg capital deployed',
  metric_66_capital_turnover Decimal(10, 4) COMMENT 'Total volume / avg bankroll',
  metric_67_news_shock_ev_5min Decimal(18, 4) COMMENT 'EV from bets within 5min of news',
  metric_68_crowd_orthogonality Decimal(10, 6) COMMENT 'Correlation with aggregate volume',
  metric_69_ev_per_hour_capital Decimal(18, 6) COMMENT 'EV / (hours_held * capital) - KEY',

  -- Cost Analysis
  metric_70_gross_to_net_ratio Decimal(10, 4) COMMENT 'pnl_net / pnl_gross',
  metric_71_fee_per_bet Decimal(18, 4) COMMENT 'Avg fee paid per trade',
  metric_72_fee_burden_pct Decimal(10, 4) COMMENT 'Total fees / gross wins',
  metric_73_slippage_per_bet Decimal(18, 6) COMMENT 'Avg slippage per trade',

  -- Streaks & Consistency
  metric_74_longest_win_streak UInt16 COMMENT 'Max consecutive wins',
  metric_75_longest_loss_streak UInt16 COMMENT 'Max consecutive losses',
  metric_76_current_streak_length Int16 COMMENT 'Current streak (+ or -)',
  metric_77_streak_consistency Decimal(10, 6) COMMENT 'Stddev of streak lengths',

  -- Time-Based Patterns
  metric_78_weekday_vs_weekend_roi Decimal(10, 6) COMMENT 'Ratio of weekday vs weekend ROI',
  metric_79_integrity_deposit_pnl Decimal(5, 4) COMMENT 'P&L from deposits vs trading',

  -- Bet Timing Quality
  metric_80_avg_time_to_resolution_days Decimal(12, 2) COMMENT 'Avg days from bet to resolution',
  metric_81_early_vs_late_roi Decimal(10, 6) COMMENT 'ROI on early bets vs late bets',

  -- Recent Momentum Indicators
  metric_82_clv_momentum_30d Decimal(12, 6) COMMENT 'Slope of CLV over last 30 days',
  metric_83_ev_hr_momentum_30d Decimal(18, 8) COMMENT 'Slope of EV/hr metric',
  metric_84_drawdown_trend_60d Decimal(12, 6) COMMENT 'Slope of drawdown depth',
  metric_85_performance_trend_flag Enum8('improving'=1, 'declining'=2, 'stable'=3) COMMENT 'Composite trend',
  metric_86_hot_hand_z_score Decimal(10, 4) COMMENT 'Z-score of recent win streak',

  -- Discipline Metrics
  metric_87_bet_frequency_variance Decimal(12, 6) COMMENT 'Variance in bets per week',
  metric_88_sizing_discipline_trend Decimal(12, 6) COMMENT 'Trend in sizing volatility',

  -- PER-CATEGORY METRICS (#89-92)
  -- These are aggregated separately in wallet_metrics_by_category table
  -- Stored here as JSON for convenience
  metric_89_clv_by_category_json String COMMENT 'JSON: {"AI": 0.08, "Sports": -0.01}',
  metric_90_omega_lag_by_category_json String COMMENT 'JSON: {"AI": {"2min": 4.5}}',
  metric_91_calibration_by_category_json String COMMENT 'JSON: {"AI": 0.05, "Sports": 0.22}',
  metric_92_ev_hr_by_category_json String COMMENT 'JSON: {"AI": 125.50}',

  -- MARKET MICROSTRUCTURE (#93-102)
  -- Event-Driven Edge
  metric_93_news_reaction_time_median_sec Decimal(12, 2) COMMENT 'Median time from news to bet',
  metric_94_event_archetype_edge_json String COMMENT 'JSON: {"court_rulings": 0.15}',

  -- Execution Quality
  metric_95_spread_capture_ratio Decimal(10, 6) COMMENT 'How much of bid-ask spread captured',
  metric_96_adverse_selection_cost Decimal(18, 6) COMMENT 'Cost from being picked off',
  metric_97_price_impact_per_k Decimal(12, 6) COMMENT 'Market impact per $1k traded',

  -- Behavioral Bias
  metric_98_yes_no_bias_pct Decimal(10, 4) COMMENT '%YES trades - %NO trades',
  metric_99_liquidity_access_skill Decimal(10, 6) COMMENT 'How well they source liquidity',
  metric_100_news_latency_distribution_json String COMMENT 'JSON: percentiles of reaction time',

  -- Alpha Source Decomposition
  metric_101_alpha_source_timing_pct Decimal(10, 4) COMMENT '% of alpha from entry timing',
  metric_102_edge_source_decomp_json String COMMENT 'JSON: breakdown of where edge comes from',

  -- Hash for cache invalidation
  raw_data_hash String COMMENT 'Hash of underlying trades for cache invalidation'
)
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY (window)
ORDER BY (wallet_address, window)
SETTINGS index_granularity = 8192;

-- Indexes for common queries
CREATE INDEX idx_omega_net ON wallet_metrics_complete(metric_2_omega_net)
  TYPE minmax GRANULARITY 4;
CREATE INDEX idx_ev_per_hour ON wallet_metrics_complete(metric_69_ev_per_hour_capital)
  TYPE minmax GRANULARITY 4;
CREATE INDEX idx_performance_trend ON wallet_metrics_complete(metric_85_performance_trend_flag)
  TYPE set(0) GRANULARITY 1;
```

#### 1.2 Category-Specific Metrics

**Purpose**: Store all 102 metrics broken down by category for each wallet

```sql
CREATE TABLE wallet_metrics_by_category (
  wallet_address String,
  category String,
  window Enum8('30d' = 1, '90d' = 2, '180d' = 3, 'lifetime' = 4),

  -- All 102 metrics (same schema as above, but scoped to category)
  -- ... (repeat all metric columns)

  -- Additional category context
  trades_in_category UInt32,
  pct_of_total_trades Decimal(5, 4),
  is_primary_category Boolean COMMENT 'TRUE if most trades are in this category',
  category_rank UInt16 COMMENT 'Rank within this category (1=best)',

  PRIMARY KEY (wallet_address, category, window)
)
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY (category, window)
ORDER BY (wallet_address, category, window);
```

### 2. Top-Down Analysis Tables

#### 2.1 Category Analytics

**Purpose**: Aggregate metrics at the category level to identify "winnable games"

```sql
CREATE TABLE category_analytics (
  category String,
  window Enum8('24h' = 1, '7d' = 2, '30d' = 3, 'lifetime' = 4),

  -- Winnability Metrics
  elite_wallet_count UInt32 COMMENT 'Count wallets with Omega>2.0, n>50',
  median_omega_of_elites Decimal(12, 4) COMMENT 'CRITICAL: How winnable is this game?',
  mean_clv_of_elites Decimal(10, 6) COMMENT '"Sucker Index" - dumb money available',
  percentile_75_omega Decimal(12, 4) COMMENT '75th percentile Omega in category',
  percentile_25_omega Decimal(12, 4) COMMENT '25th percentile Omega',

  -- Market Stats
  total_markets UInt32,
  active_markets_24h UInt32,
  resolved_markets_7d UInt32,
  avg_time_to_resolution_days Decimal(10, 2),

  -- Volume Stats
  total_volume_usd Decimal(18, 2),
  elite_volume_usd Decimal(18, 2) COMMENT 'Volume from elite wallets only',
  crowd_volume_usd Decimal(18, 2) COMMENT 'Volume from non-elite wallets',
  volume_24h Decimal(18, 2),

  -- Competition Metrics
  avg_wallets_per_market Decimal(10, 2),
  specialist_concentration Decimal(5, 4) COMMENT 'HHI of elite wallet market share',
  barrier_to_entry_score Decimal(10, 6) COMMENT 'Composite: specialist_count + median_omega',

  -- Edge Durability
  avg_edge_half_life_hours Decimal(12, 2) COMMENT 'How long edges last in this category',
  avg_latency_penalty_index Decimal(10, 6) COMMENT 'How copy-able is this category',

  -- Behavioral Patterns
  avg_holding_period_hours Decimal(12, 2),
  news_driven_pct Decimal(5, 4) COMMENT '% of volume within 1hr of news',

  calculated_at DateTime,

  PRIMARY KEY (category, window)
)
ENGINE = ReplacingMergeTree(calculated_at)
ORDER BY (category, window);

-- Materialized view for quick "best categories" query
CREATE MATERIALIZED VIEW category_winnability_leaderboard AS
SELECT
  category,
  median_omega_of_elites as winnability_score,
  elite_wallet_count as competition_level,
  mean_clv_of_elites as edge_depth,
  CASE
    WHEN elite_wallet_count < 10 THEN 'locals_game'
    WHEN elite_wallet_count BETWEEN 10 AND 50 THEN 'emerging_pro'
    WHEN elite_wallet_count > 50 THEN 'pro_circuit'
  END as game_type
FROM category_analytics
WHERE window = 'lifetime'
ORDER BY winnability_score DESC;
```

#### 2.2 Market Flow Metrics

**Purpose**: Track "smart money" vs "crowd money" divergence for real-time signals

```sql
CREATE TABLE market_flow_metrics (
  market_id String,
  timestamp DateTime,

  -- Price Momentum
  current_yes_price Decimal(10, 6),
  price_change_1h Decimal(10, 6),
  price_change_24h Decimal(10, 6),
  price_momentum_7d Decimal(10, 4) COMMENT '% change over 7 days',

  -- Volume Distribution (Last 24h)
  total_volume_24h Decimal(18, 2),
  yes_volume_24h Decimal(18, 2),
  no_volume_24h Decimal(18, 2),

  -- Crowd Flow (ALL wallets)
  crowd_yes_volume Decimal(18, 2) COMMENT 'Non-elite wallet $ on YES',
  crowd_no_volume Decimal(18, 2) COMMENT 'Non-elite wallet $ on NO',
  crowd_flow_ratio Decimal(10, 4) COMMENT 'crowd_yes / crowd_no',
  crowd_yes_pct Decimal(5, 4) COMMENT '% of crowd $ on YES',

  -- Elite Flow (Omega>2.0 wallets only)
  elite_yes_volume Decimal(18, 2) COMMENT 'Elite wallet $ on YES',
  elite_no_volume Decimal(18, 2) COMMENT 'Elite wallet $ on NO',
  elite_flow_ratio Decimal(10, 4) COMMENT 'elite_yes / elite_no - KEY METRIC',
  elite_yes_pct Decimal(5, 4) COMMENT '% of elite $ on YES',

  -- THE GOLDEN SIGNAL
  crowd_elite_divergence Decimal(10, 4) COMMENT 'elite_flow_ratio - crowd_flow_ratio',
  divergence_z_score Decimal(10, 4) COMMENT 'Z-score of divergence (normalized)',
  signal_strength Enum8('weak'=1, 'moderate'=2, 'strong'=3, 'extreme'=4),

  -- Context
  elite_wallet_count UInt16 COMMENT 'How many elite wallets are betting',
  crowd_wallet_count UInt32 COMMENT 'How many crowd wallets',

  -- Metadata
  category String,
  market_close_time DateTime,
  calculated_at DateTime
)
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, timestamp)
SETTINGS index_granularity = 8192;

-- Index for real-time signal queries
CREATE INDEX idx_high_divergence ON market_flow_metrics(divergence_z_score)
  TYPE minmax GRANULARITY 4;

-- Materialized view for active signals
CREATE MATERIALIZED VIEW active_divergence_signals AS
SELECT
  market_id,
  category,
  crowd_elite_divergence,
  divergence_z_score,
  elite_flow_ratio,
  crowd_flow_ratio,
  elite_wallet_count,
  CASE
    WHEN elite_flow_ratio > 2.0 THEN 'YES'
    WHEN elite_flow_ratio < 0.5 THEN 'NO'
    ELSE 'NEUTRAL'
  END as elite_direction,
  timestamp
FROM market_flow_metrics
WHERE ABS(crowd_elite_divergence) > 1.5
  AND elite_wallet_count >= 5
  AND timestamp >= now() - INTERVAL 1 HOUR
ORDER BY divergence_z_score DESC;
```

### 3. Wallet Intelligence Tables

#### 3.1 Wallet Category Specialization & Insider Detection

**Purpose**: Tag wallets with their specializations and detect insider patterns

```sql
CREATE TABLE wallet_category_tags (
  wallet_address String,
  category String,

  -- Specialization Metrics
  category_omega Decimal(12, 4),
  category_win_rate Decimal(5, 4),
  trades_in_category UInt32,
  pct_of_wallet_trades Decimal(5, 4) COMMENT '% of wallet total trades in this cat',
  pct_of_wallet_volume Decimal(5, 4) COMMENT '% of wallet total $ in this cat',

  -- Percentile Rankings (within category)
  omega_percentile Decimal(5, 4) COMMENT '0.95 = top 5% in this category',
  clv_percentile Decimal(5, 4),
  ev_per_hour_percentile Decimal(5, 4),
  overall_rank_in_category UInt32,

  -- Pattern Detection
  is_likely_specialist Boolean COMMENT 'TRUE if 60%+ of wins in this category',
  is_likely_insider Boolean COMMENT 'TRUE if pattern suggests inside info',
  insider_confidence_score Decimal(5, 4) COMMENT '0-1 confidence level',

  -- Sub-Category Drilling (for insider detection)
  subcategory_win_rates String COMMENT 'JSON: {"openai_releases": 0.95, "anthropic": 0.20}',
  subcategory_bet_counts String COMMENT 'JSON: {"openai_releases": 15, "anthropic": 5}',

  -- Pattern Features
  consecutive_wins_in_subcategory UInt16 COMMENT 'Max win streak in tight subcategory',
  win_rate_vs_category_avg Decimal(10, 4) COMMENT 'Their WR - category avg WR',
  timing_pattern_score Decimal(10, 6) COMMENT 'Do they bet right before news?',

  -- Human-Readable Tags
  primary_tag LowCardinality(String) COMMENT 'e.g., "ai_specialist", "openai_insider"',
  secondary_tags Array(String) COMMENT 'Additional tags',

  -- Metadata
  first_trade_in_category DateTime,
  last_trade_in_category DateTime,
  last_analyzed DateTime,

  PRIMARY KEY (wallet_address, category)
)
ENGINE = ReplacingMergeTree(last_analyzed)
ORDER BY (wallet_address, category);

-- Index for finding insiders by category
CREATE INDEX idx_likely_insiders ON wallet_category_tags(category, insider_confidence_score)
  TYPE minmax GRANULARITY 4
  WHERE is_likely_insider = 1;

-- Materialized view: High-confidence insiders
CREATE MATERIALIZED VIEW detected_insiders AS
SELECT
  wallet_address,
  category,
  primary_tag,
  insider_confidence_score,
  category_omega,
  omega_percentile,
  trades_in_category,
  subcategory_win_rates
FROM wallet_category_tags
WHERE is_likely_insider = 1
  AND insider_confidence_score > 0.75
ORDER BY insider_confidence_score DESC;
```

#### 3.2 Wallet Leaderboard with Movement Tracking

**Purpose**: Track wallet rank changes over time (relative strength indicator)

```sql
CREATE TABLE wallet_leaderboard_history (
  wallet_address String,
  snapshot_date Date,

  -- Overall Rankings
  overall_rank UInt32 COMMENT 'Rank by Omega (all wallets)',
  overall_rank_prev_day UInt32,
  overall_rank_7d_ago UInt32,
  overall_rank_30d_ago UInt32,

  -- Rank Changes (CRITICAL for "Rising Star" strategy)
  rank_change_1d Int32 COMMENT 'Positive = moved up',
  rank_change_7d Int32 COMMENT 'KEY: jumped 15 spots = hot wallet',
  rank_change_30d Int32,

  -- Context
  omega_ratio Decimal(12, 4),
  omega_ratio_prev_day Decimal(12, 4),
  total_pnl Decimal(18, 2),
  resolved_bets UInt32,

  -- Category-Specific Rankings
  category_ranks String COMMENT 'JSON: {"AI": 5, "Tech": 12, "Sports": 450}',
  category_rank_changes_7d String COMMENT 'JSON: {"AI": +3, "Tech": -2}',

  -- Movement Classification
  movement_type Enum8('rocketing'=1, 'rising'=2, 'stable'=3, 'declining'=4, 'falling'=5),
  momentum_score Decimal(10, 6) COMMENT 'Composite of rank changes + omega trend',

  PRIMARY KEY (wallet_address, snapshot_date)
)
ENGINE = ReplacingMergeTree(snapshot_date)
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (wallet_address, snapshot_date);

-- Materialized view for current rising stars
CREATE MATERIALIZED VIEW rising_stars_today AS
SELECT
  wallet_address,
  overall_rank,
  rank_change_7d,
  rank_change_30d,
  omega_ratio,
  movement_type,
  momentum_score,
  category_ranks
FROM wallet_leaderboard_history
WHERE snapshot_date = today()
  AND rank_change_7d > 10  -- Jumped at least 10 spots
  AND movement_type IN ('rocketing', 'rising')
ORDER BY rank_change_7d DESC
LIMIT 100;
```

### 4. Austin Methodology Materialized View

**Purpose**: Pre-compute the Austin top-down methodology for instant results

```sql
CREATE MATERIALIZED VIEW austin_methodology_results
ENGINE = AggregatingMergeTree()
PARTITION BY analysis_date
ORDER BY (category, median_category_omega)
AS
WITH elite_wallets AS (
  -- Step 1: Get top 100 wallets by overall Omega
  SELECT wallet_address, metric_2_omega_net as overall_omega
  FROM wallet_metrics_complete
  WHERE window = 'lifetime'
    AND metric_2_omega_net > 2.0
    AND metric_22_resolved_bets > 50
  ORDER BY metric_2_omega_net DESC
  LIMIT 100
),
wallet_category_performance AS (
  -- Step 2: Get each elite wallet's performance by category
  SELECT
    e.wallet_address,
    e.overall_omega,
    wmc.category,
    wmc.metric_2_omega_net as category_omega,
    wmc.metric_22_resolved_bets as category_trades,
    wct.omega_percentile
  FROM elite_wallets e
  JOIN wallet_metrics_by_category wmc
    ON e.wallet_address = wmc.wallet_address
  LEFT JOIN wallet_category_tags wct
    ON e.wallet_address = wct.wallet_address
    AND wmc.category = wct.category
  WHERE wmc.window = 'lifetime'
    AND wmc.metric_2_omega_net > 2.0  -- Must be elite in that category too
    AND wmc.metric_22_resolved_bets >= 10  -- Minimum category trades
),
category_aggregation AS (
  -- Step 3: Aggregate by category to find "winnable games"
  SELECT
    category,
    COUNT(DISTINCT wallet_address) as specialist_count,
    median(category_omega) as median_category_omega,
    quantile(0.75)(category_omega) as p75_omega,
    quantile(0.25)(category_omega) as p25_omega,
    avg(category_omega) as mean_category_omega,
    sum(category_trades) as total_specialist_trades,
    groupArray(wallet_address) as specialist_wallets,
    groupArray(category_omega) as specialist_omegas
  FROM wallet_category_performance
  GROUP BY category
  HAVING specialist_count >= 5  -- At least 5 elite specialists
)
SELECT
  today() as analysis_date,
  category,
  specialist_count,
  median_category_omega,
  p75_omega,
  p25_omega,
  mean_category_omega,
  total_specialist_trades,
  specialist_wallets,
  specialist_omegas,
  -- Winnability Score (composite)
  median_category_omega * log(specialist_count + 1) as winnability_score,
  -- Game Classification
  CASE
    WHEN specialist_count < 10 THEN 'locals_game'
    WHEN specialist_count BETWEEN 10 AND 30 THEN 'emerging_pro'
    WHEN specialist_count > 30 THEN 'pro_circuit'
  END as game_type,
  -- Recommendation
  CASE
    WHEN median_category_omega > 4.0 AND specialist_count < 50 THEN 'HIGH_PRIORITY'
    WHEN median_category_omega > 3.0 THEN 'RECOMMENDED'
    WHEN median_category_omega > 2.0 THEN 'VIABLE'
    ELSE 'PASS'
  END as recommendation
FROM category_aggregation
ORDER BY median_category_omega DESC;
```

---

## Metric Calculation Specifications

### Priority Tiers

**Tier 1 (CRITICAL)** - Needed for top 5 strategies:
- #2: Omega (net fees)
- #22-24: Activity metrics
- #48-50: Omega with lag (copyability)
- #56, 82-86: Momentum/trend metrics
- #60: Tail Ratio (convexity)
- #69: EV per Hour - Capital Employed
- #85: Performance Trend Flag
- #88: Sizing Discipline Trend

**Tier 2 (HIGH)** - Rounds out top 7 strategies:
- #25, 91: Calibration (forecasting skill)
- #30, 89: CLV and CLV by category
- #55: Latency Penalty Index
- #54: Edge Half-Life

**Tier 3 (MEDIUM)** - Specialized strategies:
- #34, 72, 99: Market making metrics
- #68: Crowd Orthogonality
- #102: Edge Source Decomposition

**Tier 4 (NICE-TO-HAVE)** - Complete the 102:
- All remaining metrics

### Key Formula Specifications

#### Omega Ratio (#1, #2)
```
Omega_gross = Σ(gains) / Σ(|losses|)
  where gains = pnl_gross > 0
        losses = pnl_gross <= 0

Omega_net = Σ(gains_net) / Σ(|losses_net|)
  where gains_net = pnl_net > 0
        losses_net = pnl_net <= 0
```

#### Omega with Lag (#48-50) - CRITICAL
```sql
-- Simulate what Omega would be if copied with X-second delay
WITH lagged_prices AS (
  SELECT
    t.trade_id,
    t.market_id,
    t.timestamp as entry_time,
    t.entry_price,
    t.side,
    t.shares,
    t.outcome,
    mph.yes_price as price_at_lag
  FROM trades_raw t
  JOIN market_price_history mph
    ON t.market_id = mph.market_id
    AND mph.timestamp BETWEEN t.timestamp AND t.timestamp + INTERVAL X SECONDS
  ORDER BY mph.timestamp ASC
  LIMIT 1 BY t.trade_id  -- Get first price after lag
),
simulated_pnl AS (
  SELECT
    trade_id,
    shares * CASE
      WHEN side = 'YES' THEN outcome - price_at_lag
      WHEN side = 'NO' THEN (1 - outcome) - (1 - price_at_lag)
    END as pnl_with_lag
  FROM lagged_prices
)
SELECT
  SUM(CASE WHEN pnl_with_lag > 0 THEN pnl_with_lag ELSE 0 END) /
  SUM(CASE WHEN pnl_with_lag <= 0 THEN ABS(pnl_with_lag) ELSE 0 END) as omega_lag_30s
FROM simulated_pnl;
```

#### Tail Ratio (#60) - CRITICAL
```sql
-- Measures asymmetry: are wins much bigger than losses?
SELECT
  AVG(pnl_net) FILTER (WHERE pnl_net >= quantile(0.90)(pnl_net)) /
  ABS(AVG(pnl_net) FILTER (WHERE pnl_net <= quantile(0.10)(pnl_net))) as tail_ratio
FROM trades_raw
WHERE outcome IS NOT NULL;
```

#### EV per Hour - Capital Employed (#69) - CRITICAL
```
EV_per_hour_capital = Total_Net_PnL / (Σ(hours_held_i * capital_deployed_i))

where capital_deployed_i = shares_i * entry_price_i

This is THE metric for "Aggressive Growth" strategy.
Answers: "Who makes the most money per dollar-hour of capital?"
```

#### Omega Momentum (#56) - Theil-Sen Slope
```sql
-- Calculate non-parametric trend of Omega over time
-- More robust to outliers than linear regression
WITH daily_omega AS (
  SELECT
    date,
    SUM(CASE WHEN pnl_net > 0 THEN pnl_net ELSE 0 END) /
    SUM(CASE WHEN pnl_net <= 0 THEN ABS(pnl_net) ELSE 0 END) as omega
  FROM trades_raw
  WHERE timestamp >= today() - INTERVAL 30 DAY
  GROUP BY toDate(timestamp) as date
)
SELECT
  median(
    (omega_j - omega_i) / (date_j - date_i)
  ) as theil_sen_slope
FROM daily_omega i, daily_omega j
WHERE j.date > i.date;
```

#### Performance Trend Flag (#85)
```
IF omega_momentum_30d > 0.05 AND clv_momentum_30d > 0 AND pnl_trend_30d > 0:
  → 'improving'
ELSE IF omega_momentum_30d < -0.05 AND (clv_momentum_30d < 0 OR pnl_trend_30d < 0):
  → 'declining'
ELSE:
  → 'stable'
```

#### Sizing Discipline Trend (#88) - CRITICAL for "Rising Star"
```
sizing_discipline_trend = slope(stddev(stake_pct) over 30-day windows)

Negative trend = volatility decreasing = becoming more disciplined
This is the key signal that a "gambler" is turning into a "professional"
```

#### Calibration Error (#29, #91)
```
calibration_error = Mean(|predicted_freq - actual_freq|)

For each bin of p_hat (e.g., 0.3-0.4):
  predicted_freq = mean(p_hat in bin)
  actual_freq = mean(outcome in bin)

Lower is better. <0.1 = skilled forecaster
```

#### Closing Line Value (#30)
```
CLV = (entry_price - close_price) * side

where close_price = YES price immediately before resolution
      side = +1 for YES, -1 for NO

Positive CLV = you got better odds than the final "smart" price
```

#### Latency Penalty Index (#55)
```
latency_penalty_index = 1 - (omega_lag_5min / omega_net)

Measures how much edge is lost to latency.
High value (>0.5) = NOT copyable (edge vanishes quickly)
Low value (<0.2) = Very copyable (deep, durable edge)
```

#### Hot-Hand z-Score (#86)
```
z_score = (current_streak_length - mean_streak_length) / stddev_streak_length

Tests if current win streak is statistically significant.
z > 2.0 = genuinely hot (not just luck)
```

#### Crowd Orthogonality (#68)
```
crowd_orthogonality = -1 * correlation(wallet_volume_vector, aggregate_volume_vector)

Low correlation = contrarian (bets opposite to crowd)
Used for portfolio diversification (Strategy 11)
```

---

## Query Performance Requirements

### Real-Time Queries (<100ms)
- Category analytics dashboard
- Market flow metrics (current signals)
- Wallet lookup by address
- Leaderboard top 100

### Interactive Queries (<500ms)
- Strategy evaluation (arbitrary filter formulas)
- Austin Methodology results
- Insider detection by category
- Rising stars (rank change > 10)

### Background Queries (<5 minutes)
- Calculate all 102 metrics for single wallet
- Recalculate wallet leaderboard (all 6,605)
- Update category analytics (all categories)

### Batch Processing (Daily)
- Full metrics recalculation (6,605 wallets × 4 windows)
- Market flow history aggregation
- Insider pattern detection
- Leaderboard history snapshot

---

## API Endpoint Specifications

### 1. Formula Evaluation API
```
POST /api/wallets/evaluate-formula

Request:
{
  "conditions": FilterNode[],  // Nested filter tree
  "sortBy": SortExpression,
  "limit": number,
  "window": "30d" | "90d" | "180d" | "lifetime"
}

Response:
{
  "success": true,
  "count": 47,
  "wallets": [
    {
      "wallet_address": "0x...",
      "metrics": {
        "metric_2_omega_net": 4.5,
        "metric_69_ev_per_hour_capital": 125.50,
        ...
      }
    }
  ],
  "execution_time_ms": 234
}
```

### 2. Category Analytics API
```
GET /api/categories/analytics?window=lifetime

Response:
{
  "categories": [
    {
      "category": "AI",
      "winnability_score": 5.2,
      "elite_wallet_count": 47,
      "game_type": "emerging_pro",
      "recommendation": "HIGH_PRIORITY"
    }
  ]
}
```

### 3. Austin Methodology API
```
GET /api/austin-methodology

Response:
{
  "analysis_date": "2025-10-25",
  "recommended_categories": [
    {
      "category": "AI",
      "median_omega": 5.2,
      "specialist_count": 47,
      "top_specialists": ["0x...", "0x..."]
    }
  ],
  "summary": "Focus on AI (47 specialists, Ω=5.2) and Tech (38 specialists, Ω=4.8)"
}
```

### 4. Market Flow Signals API
```
GET /api/markets/flow/signals?min_divergence=1.5

Response:
{
  "active_signals": [
    {
      "market_id": "0x...",
      "category": "AI",
      "divergence_z_score": 3.2,
      "elite_direction": "YES",
      "crowd_direction": "NO",
      "elite_flow_ratio": 3.5,
      "crowd_flow_ratio": 0.4,
      "signal_strength": "extreme"
    }
  ]
}
```

### 5. Wallet Intelligence API
```
GET /api/wallets/{address}/intelligence

Response:
{
  "wallet_address": "0x...",
  "specializations": [
    {
      "category": "AI",
      "subcategory": "OpenAI Releases",
      "is_likely_insider": true,
      "confidence_score": 0.92,
      "tags": ["potential_openai_employee", "ai_specialist"]
    }
  ],
  "leaderboard": {
    "overall_rank": 15,
    "rank_change_7d": +23,
    "movement_type": "rocketing"
  }
}
```

### 6. Leaderboard API
```
GET /api/wallets/leaderboard?sort=rank_change_7d&limit=100

Response:
{
  "rising_stars": [
    {
      "wallet_address": "0x...",
      "overall_rank": 42,
      "rank_change_7d": +35,
      "omega_ratio": 3.8,
      "category_specializations": ["AI", "Tech"]
    }
  ]
}
```

---

## Data Pipeline Requirements

### 1. Bulk Wallet Sync (One-Time Setup)
**Purpose**: Populate ClickHouse with all historical trades

**Implementation**: Already built in `scripts/sync-all-wallets-bulk.ts`

**Requirements**:
- Sync 6,605 wallets from `wallet_scores` table
- Fetch trades from Goldsky API
- Resolve tokenId → condition_id → category (via Supabase join)
- Insert to ClickHouse `trades_raw`
- Track progress with checkpoints (resume capability)
- **Estimated time**: 24-48 hours for initial run

### 2. Incremental Daily Updates
**Purpose**: Keep data fresh without full resync

**Process**:
```
1. Identify active wallets (traded in last 24h)
2. Fetch only new trades since last sync
3. Update trades_raw
4. Trigger metric recalculation for affected wallets
5. Update leaderboard snapshot
6. Refresh materialized views
```

**Frequency**: Daily at 00:00 UTC

### 3. Metrics Calculation Pipeline
**Purpose**: Calculate all 102 metrics across 4 time windows

**Process**:
```sql
-- Pseudocode for metric calculation
FOR each wallet IN wallet_scores:
  FOR each window IN ['30d', '90d', '180d', 'lifetime']:
    trades = SELECT * FROM trades_raw WHERE wallet_address = wallet AND timestamp IN window

    -- Calculate Tier 1 metrics (critical)
    omega_net = calculate_omega(trades)
    omega_lag_30s = calculate_omega_with_lag(trades, 30)
    tail_ratio = calculate_tail_ratio(trades)
    ev_per_hour = calculate_ev_per_hour(trades)
    ...

    -- Calculate Tier 2-4 metrics
    ...

    -- Insert/Update
    INSERT INTO wallet_metrics_complete (wallet_address, window, metric_2_omega_net, ...)
    VALUES (wallet, window, omega_net, ...)
    ON CONFLICT (wallet_address, window) DO UPDATE;
```

**Frequency**:
- Full recalc: Daily
- Incremental (active wallets): Hourly

### 4. Category Analytics Aggregation
**Purpose**: Generate category-level metrics

**Process**:
```sql
-- Aggregate from wallet_metrics_by_category
INSERT INTO category_analytics
SELECT
  category,
  'lifetime' as window,
  COUNT(*) FILTER (WHERE metric_2_omega_net > 2.0 AND metric_22_resolved_bets > 50) as elite_wallet_count,
  median(metric_2_omega_net) FILTER (WHERE elite) as median_omega_of_elites,
  ...
FROM wallet_metrics_by_category
WHERE window = 'lifetime'
GROUP BY category;
```

**Frequency**: Daily

### 5. Market Flow Metrics Updates
**Purpose**: Track real-time smart money vs crowd money

**Process**:
```
1. Every 5 minutes:
   - Get all trades in last 24h by market
   - Classify wallets as "elite" (Omega>2.0) or "crowd"
   - Calculate flow ratios
   - Calculate divergence
   - Insert to market_flow_metrics

2. Maintain 30-day rolling window (delete old rows)
```

**Frequency**: Every 5 minutes (real-time signal)

### 6. Insider Detection
**Purpose**: Identify wallet specialization patterns

**Process**:
```
1. For each wallet with >50 trades:
   - Group trades by category and subcategory
   - Calculate win rates by subcategory
   - Detect anomalous patterns (e.g., 15/15 on "OpenAI releases")
   - Calculate confidence score
   - Generate tags

2. Update wallet_category_tags
```

**Frequency**: Weekly (computationally expensive)

### 7. Leaderboard Snapshots
**Purpose**: Track rank changes over time

**Process**:
```sql
-- Daily at 00:00 UTC
INSERT INTO wallet_leaderboard_history
SELECT
  wallet_address,
  today() as snapshot_date,
  ROW_NUMBER() OVER (ORDER BY metric_2_omega_net DESC) as overall_rank,
  metric_2_omega_net as omega_ratio,
  metric_9_net_pnl_usd as total_pnl,
  ...
FROM wallet_metrics_complete
WHERE window = 'lifetime'
  AND metric_22_resolved_bets >= 10;

-- Calculate rank changes by joining with previous snapshots
UPDATE wallet_leaderboard_history
SET
  rank_change_1d = overall_rank - (SELECT overall_rank FROM ... WHERE snapshot_date = today() - 1),
  rank_change_7d = overall_rank - (SELECT overall_rank FROM ... WHERE snapshot_date = today() - 7),
  ...
WHERE snapshot_date = today();
```

**Frequency**: Daily

---

## Implementation Priorities

### Phase 1: Foundation (Week 1)
**Goal**: Core infrastructure + top 5 strategies

1. **Database Schema**:
   - Create `wallet_metrics_complete` table with all 102 metric columns
   - Create `wallet_metrics_by_category` table
   - Set up indexes

2. **Tier 1 Metric Calculations** (implement these first):
   - #2: Omega (net fees)
   - #22-24: Activity metrics
   - #48-50: Omega with lag
   - #56: Omega momentum (Theil-Sen)
   - #60: Tail Ratio
   - #69: EV per Hour - Capital Employed
   - #85: Performance Trend Flag
   - #88: Sizing Discipline Trend

3. **Basic APIs**:
   - `/api/wallets/evaluate-formula` (simple filters only)
   - `/api/wallets/{address}/metrics`

**Success**: Can run Strategies 1, 2, and 6 ("Aggressive Growth", "Balanced Hybrid", "Rising Star")

### Phase 2: Top-Down Analysis (Week 2)
**Goal**: Austin Methodology + category intelligence

1. **Database Schema**:
   - Create `category_analytics` table
   - Create `austin_methodology_results` materialized view
   - Create `wallet_category_tags` table (basic version)

2. **Tier 2 Metric Calculations**:
   - #25, 91: Calibration
   - #30, 89: CLV and CLV by category
   - #55: Latency Penalty Index
   - #54: Edge Half-Life

3. **APIs**:
   - `/api/categories/analytics`
   - `/api/austin-methodology`

**Success**: Can identify "winnable categories" and find specialists (Strategy 3 "Eggman Hunter")

### Phase 3: Smart Money Signals (Week 3)
**Goal**: Real-time market flow tracking

1. **Database Schema**:
   - Create `market_flow_metrics` table
   - Create `active_divergence_signals` materialized view
   - Create `market_price_history` table (for lag simulation)

2. **Real-Time Pipeline**:
   - 5-minute flow metrics calculation
   - Divergence signal detection

3. **APIs**:
   - `/api/markets/flow/signals`
   - `/api/markets/{id}/flow`

**Success**: Can detect "elite vs crowd" divergence in real-time

### Phase 4: Wallet Intelligence (Week 4)
**Goal**: Insider detection + leaderboard tracking

1. **Database Schema**:
   - Enhance `wallet_category_tags` with insider detection
   - Create `wallet_leaderboard_history` table
   - Create `rising_stars_today` materialized view

2. **Tier 3 Metrics**:
   - #34, 72, 99: Market making
   - #68: Crowd Orthogonality
   - #102: Edge Source Decomposition

3. **Pipelines**:
   - Weekly insider detection run
   - Daily leaderboard snapshots

4. **APIs**:
   - `/api/wallets/{address}/intelligence`
   - `/api/wallets/leaderboard`

**Success**: Can identify likely insiders and track "rising stars"

### Phase 5: Complete System (Week 5+)
**Goal**: All 102 metrics + advanced strategies

1. **Tier 4 Metrics**: Implement remaining 30+ metrics
2. **Advanced Formula Evaluation**: Support complex nested conditions
3. **Optimization**: Query performance tuning, caching
4. **Monitoring**: Data quality checks, alert system

---

## Critical Technical Decisions

### 1. ClickHouse vs Supabase for Metrics Storage

**Recommendation**: Hybrid approach
- **ClickHouse**: `wallet_metrics_complete` (102 metrics × 6,605 wallets × 4 windows = ~2.6M cells)
  - Pros: Columnar storage, blazing fast aggregations
  - Cons: No transactions, harder to update
- **Supabase**: Intelligence tables (`wallet_category_tags`, `leaderboard_history`)
  - Pros: Relational integrity, easy updates, Auth integration
  - Cons: Slower for massive aggregations

### 2. Materialized Views vs On-Demand Calculation

**Recommendation**: Materialized views for:
- Austin Methodology results (complex multi-level aggregation)
- Category winnability leaderboard (frequently accessed)
- Active divergence signals (real-time dashboard)
- Rising stars today (leaderboard movement)

**On-demand** for:
- Custom formula evaluation (infinite combinations)
- Single wallet detail lookups
- Ad-hoc analysis queries

### 3. Real-Time Update Frequency

**Recommendation**:
- Market flow metrics: **Every 5 minutes** (real-time signals)
- Wallet metrics: **Every 1 hour** for active wallets, **Daily** for all
- Category analytics: **Daily**
- Leaderboard: **Daily snapshot**
- Insider detection: **Weekly** (expensive computation)

### 4. Data Retention

- `trades_raw`: **Forever** (source of truth)
- `market_flow_metrics`: **30 days rolling** (storage cost vs utility)
- `wallet_leaderboard_history`: **Forever** (small table, valuable for analysis)
- `market_price_history`: **90 days** (for lag simulation)

---

## Appendix: The 11 Screening Strategies

### Strategy 1: "Aggressive Growth" (Austin's "Make Money Now")

**Filters**:
- `metric_24_bets_per_week > 3`
- `metric_22_resolved_bets > 25`
- `metric_79_integrity_deposit_pnl < 0.2`
- `metric_2_omega_net > 3.0`
- `metric_48_omega_lag_30s > 2.0`
- `metric_60_tail_ratio > 3.0`

**Sort**: `metric_69_ev_per_hour_capital DESC`

### Strategy 2: "Balanced Hybrid" (Core Dilemma Solution)

**Filters**:
- `metric_24_bets_per_week > 1`
- `metric_22_resolved_bets > 50`
- `metric_2_omega_net > 2.0`
- `metric_8_calmar > 1.0`

**Sort**: `metric_9_net_pnl_usd DESC`

### Strategy 3: "Eggman Hunter" (Specialist Finder)

**Filters** (per-category):
- `category_mix == "AI"` (or chosen category)
- `metric_22_resolved_bets (in category) > 10`
- `metric_91_calibration_error (category) < 0.1`
- `metric_90_omega_lag_2min (category) > 3.0`
- `metric_89_clv_lag_0s (category) > 0`

**Sort**: `metric_92_ev_hr (category) DESC`

### Strategy 4: "Safe & Steady" (Sharpe Replacement)

**Filters**:
- `metric_24_bets_per_week > 5`
- `metric_22_resolved_bets > 100`
- `metric_17_max_drawdown > -20%`
- `metric_19_time_in_drawdown_pct < 30%`

**Sort**: `metric_5_sortino DESC`

### Strategy 5: "Momentum Rider" (Hot Hand)

**Filters**:
- `metric_24_bets_per_week > 5`
- `metric_22_resolved_bets > 100`
- `metric_56_omega_momentum_30d > 0`
- `metric_82_clv_momentum_30d > 0`

**Sort**: `metric_86_hot_hand_z_score DESC`

### Strategy 6: "Rising Star" (Next Elite Trader)

**Filters**:
- `metric_23_track_record_days BETWEEN 90 AND 365`
- `metric_22_resolved_bets > 75`
- `metric_85_performance_trend_flag == 'improving'`
- `metric_88_sizing_discipline_trend < 0`
- `metric_84_drawdown_trend_60d < 0`

**Sort**: `metric_83_ev_hr_momentum_30d DESC`

### Strategy 7: "Alpha Decay Detector" (Who to Stop Copying)

**Filters**:
- `metric_2_omega_net (lifetime) > 5.0`
- `metric_22_resolved_bets > 200`
- `metric_85_performance_trend_flag == 'declining'`

**Sort**: `metric_55_latency_penalty_index DESC`

### Strategy 8: "Fortress" (Survival-First)

**Filters**:
- `metric_38_max_single_trade_loss_pct < 5%`
- `metric_63_kelly_utilization_pct BETWEEN 0.2 AND 0.7`
- `metric_37_cvar_95 > -10%`

**Sort**: `metric_64_risk_of_ruin ASC`

### Strategy 9: "News Shark" (Event-Driven)

**Filters**:
- `metric_94_event_archetype_edge (filtered by event type)`
- `metric_100_news_latency_median < 60 seconds`
- `metric_54_edge_half_life < 1 hour`

**Sort**: `metric_67_news_shock_ev_5min DESC`

### Strategy 10: "Liquidity Provider" (Microstructure)

**Filters**:
- `metric_34_maker_taker_ratio > 2.0`
- `metric_72_fee_burden_pct < 5%`
- `metric_99_liquidity_access_skill > 75th percentile`

**Sort**: `metric_34_maker_taker_ratio DESC`

### Strategy 11: "Contrarian" (Orthogonal Alpha)

**Filters**:
- `metric_25_brier_score < 80th percentile` (top 20%)
- `metric_98_yes_no_bias_pct (absolute) > 30%`
- `metric_102_edge_source (post_close_drift) > 50%`

**Sort**: `metric_68_crowd_orthogonality ASC` (lowest correlation)

---

## Market Price Momentum & Algorithmic Trading Signals

### Overview

**CRITICAL REQUIREMENT**: In addition to wallet-based copy-trading, the system must support **momentum-based algorithmic trading** that executes trades based on rapid price movements.

**Use Case**:
- Monitor YES/NO price changes across all active markets
- Detect when momentum "ticks up" rapidly (e.g., 5% move in 2 minutes)
- **BUY Signal**: Execute trade when momentum crosses threshold
- **SELL Signal**: Exit position when momentum flattens (velocity approaches zero)

This requires:
1. High-frequency price history storage (sub-minute granularity)
2. Real-time momentum calculations (velocity + acceleration)
3. Threshold-based signal detection
4. API endpoints for automated trade execution

---

### 1. Enhanced Price History Storage

#### 1.1 High-Frequency Price Snapshots

**Purpose**: Capture price changes at sufficient granularity to detect rapid momentum shifts

**Schema**:

```sql
CREATE TABLE market_price_history (
  market_id String,
  timestamp DateTime64(3) COMMENT 'Millisecond precision',

  -- Current Prices
  yes_price Decimal(10, 6) COMMENT 'Current YES token price (0-1)',
  no_price Decimal(10, 6) COMMENT 'Current NO token price (0-1)',

  -- Bid/Ask Spread
  yes_best_bid Decimal(10, 6),
  yes_best_ask Decimal(10, 6),
  no_best_bid Decimal(10, 6),
  no_best_ask Decimal(10, 6),

  -- Spread Metrics
  yes_spread_bps UInt16 COMMENT 'YES spread in basis points',
  no_spread_bps UInt16 COMMENT 'NO spread in basis points',

  -- Volume
  volume_1min Decimal(18, 2) COMMENT 'Volume in last 1 minute',
  volume_5min Decimal(18, 2) COMMENT 'Volume in last 5 minutes',
  volume_15min Decimal(18, 2) COMMENT 'Volume in last 15 minutes',

  -- Trade Count
  trade_count_1min UInt32,
  trade_count_5min UInt32,

  -- Metadata
  snapshot_source Enum8('polymarket_api'=1, 'websocket'=2, 'computed'=3),
  data_quality_score Decimal(3, 2) COMMENT '0-1 quality indicator'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (market_id, timestamp)
SETTINGS index_granularity = 8192;

-- Indexes for fast time-range queries
CREATE INDEX idx_recent_prices ON market_price_history(timestamp)
  TYPE minmax GRANULARITY 4;

CREATE INDEX idx_market_recent ON market_price_history(market_id, timestamp)
  TYPE minmax GRANULARITY 4;
```

**Data Collection Frequency**:
- **Real-time markets** (active trading): Every 10-30 seconds
- **Moderate activity markets**: Every 1 minute
- **Low activity markets**: Every 5 minutes
- **Inactive markets**: Every 15 minutes

**Retention Policy**:
- Last 24 hours: 10-second granularity (for high-frequency analysis)
- Last 7 days: 1-minute granularity
- Last 30 days: 5-minute granularity
- Last 90 days: 15-minute granularity
- Beyond 90 days: Hourly snapshots only

---

### 2. Real-Time Momentum Calculation

#### 2.1 Price Momentum Metrics Table

**Purpose**: Pre-calculate momentum derivatives (velocity and acceleration) for instant threshold detection

**Schema**:

```sql
CREATE TABLE market_price_momentum (
  market_id String,
  timestamp DateTime64(3),
  side Enum8('YES'=1, 'NO'=2),

  -- Current State
  current_price Decimal(10, 6),

  -- Price Changes (Absolute)
  price_change_10s Decimal(10, 6) COMMENT 'Price change in last 10 seconds',
  price_change_30s Decimal(10, 6),
  price_change_1min Decimal(10, 6),
  price_change_2min Decimal(10, 6),
  price_change_5min Decimal(10, 6),
  price_change_15min Decimal(10, 6),

  -- Price Changes (Percentage)
  price_change_pct_10s Decimal(10, 4) COMMENT '% change in 10s',
  price_change_pct_30s Decimal(10, 4),
  price_change_pct_1min Decimal(10, 4),
  price_change_pct_2min Decimal(10, 4),
  price_change_pct_5min Decimal(10, 4),
  price_change_pct_15min Decimal(10, 4),

  -- MOMENTUM METRICS (Velocity)
  velocity_10s Decimal(12, 8) COMMENT 'Price change per second (10s window)',
  velocity_30s Decimal(12, 8) COMMENT 'Price change per second (30s window)',
  velocity_1min Decimal(12, 8) COMMENT 'Price change per second (1min window)',
  velocity_5min Decimal(12, 8) COMMENT 'Price change per second (5min window)',

  -- MOMENTUM METRICS (Acceleration)
  acceleration_30s Decimal(12, 8) COMMENT 'Change in velocity (30s window)',
  acceleration_1min Decimal(12, 8) COMMENT 'Change in velocity (1min window)',
  acceleration_5min Decimal(12, 8) COMMENT 'Change in velocity (5min window)',

  -- Direction
  direction_10s Enum8('up'=1, 'down'=2, 'flat'=3),
  direction_1min Enum8('up'=1, 'down'=2, 'flat'=3),
  direction_5min Enum8('up'=1, 'down'=2, 'flat'=3),

  -- Trend Strength
  trend_strength_1min Decimal(10, 6) COMMENT 'Correlation coefficient of price over time',
  trend_strength_5min Decimal(10, 6),

  -- Volatility
  volatility_1min Decimal(10, 6) COMMENT 'Stddev of price changes in 1min',
  volatility_5min Decimal(10, 6),

  -- Context
  current_volume_1min Decimal(18, 2),
  volume_surge_ratio Decimal(10, 4) COMMENT 'current_volume / avg_volume',

  calculated_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (market_id, side, timestamp)
SETTINGS index_granularity = 4096;

-- Indexes for momentum queries
CREATE INDEX idx_high_velocity ON market_price_momentum(velocity_1min)
  TYPE minmax GRANULARITY 2;

CREATE INDEX idx_acceleration ON market_price_momentum(acceleration_1min)
  TYPE minmax GRANULARITY 2;
```

**Calculation Formulas**:

```sql
-- Velocity (price change per second)
velocity_1min = (current_price - price_60s_ago) / 60

-- Acceleration (change in velocity per second)
acceleration_1min = (velocity_now - velocity_60s_ago) / 60

-- Trend Strength (R² of linear regression)
trend_strength_1min = correlation(price, time)²
  -- Over last 60 price snapshots

-- Volume Surge Ratio
volume_surge_ratio = volume_1min / avg(volume_1min over last 1 hour)
```

---

### 3. Threshold-Based Trading Signals

#### 3.1 Momentum Signal Detection Table

**Purpose**: Automatically detect when momentum crosses user-defined thresholds

**Schema**:

```sql
CREATE TABLE momentum_trading_signals (
  signal_id UUID,
  market_id String,
  side Enum8('YES'=1, 'NO'=2),
  signal_type Enum8('BUY'=1, 'SELL'=2, 'ALERT'=3),

  -- Trigger Conditions (what caused this signal)
  trigger_condition String COMMENT 'e.g., "velocity_1min > 0.05"',
  trigger_metric String COMMENT 'e.g., "velocity_1min"',
  trigger_threshold Decimal(12, 8),
  actual_value Decimal(12, 8) COMMENT 'Actual value that crossed threshold',

  -- Signal Strength
  signal_strength Enum8('weak'=1, 'moderate'=2, 'strong'=3, 'extreme'=4),
  confidence_score Decimal(5, 4) COMMENT '0-1 confidence in signal',

  -- Market Context
  current_price Decimal(10, 6),
  price_change_pct_1min Decimal(10, 4),
  velocity_1min Decimal(12, 8),
  acceleration_1min Decimal(12, 8),
  volume_surge_ratio Decimal(10, 4),
  trend_strength Decimal(10, 6),

  -- Trade Recommendation
  recommended_action Enum8('BUY'=1, 'SELL'=2, 'HOLD'=3, 'CLOSE'=4),
  recommended_entry_price Decimal(10, 6),
  recommended_stop_loss Decimal(10, 6),
  recommended_take_profit Decimal(10, 6),

  -- Signal Timing
  detected_at DateTime64(3),
  valid_until DateTime64(3) COMMENT 'Signal expires after N seconds',

  -- Status
  signal_status Enum8('active'=1, 'executed'=2, 'expired'=3, 'cancelled'=4),
  executed_at Nullable(DateTime64(3)),
  execution_price Nullable(Decimal(10, 6))
)
ENGINE = ReplacingMergeTree(detected_at)
PARTITION BY toYYYYMMDD(detected_at)
ORDER BY (market_id, side, detected_at)
SETTINGS index_granularity = 4096;

-- Indexes for active signal queries
CREATE INDEX idx_active_signals ON momentum_trading_signals(signal_status)
  TYPE set(0) GRANULARITY 1
  WHERE signal_status = 'active';

CREATE INDEX idx_signal_strength ON momentum_trading_signals(signal_strength)
  TYPE set(0) GRANULARITY 1;
```

#### 3.2 User-Defined Threshold Rules

**Schema**:

```sql
CREATE TABLE momentum_threshold_rules (
  rule_id UUID,
  user_id UUID COMMENT 'NULL for system-wide rules',
  rule_name String,
  is_active Boolean DEFAULT TRUE,

  -- Market Filters
  category_filter Array(String) COMMENT 'Filter to specific categories',
  market_ids Array(String) COMMENT 'Specific markets (empty = all)',
  min_liquidity Decimal(18, 2) COMMENT 'Only markets with liquidity >= this',

  -- BUY Signal Conditions
  buy_velocity_threshold Decimal(12, 8) COMMENT 'Trigger BUY if velocity_1min > this',
  buy_acceleration_threshold Decimal(12, 8) COMMENT 'Trigger BUY if acceleration > this',
  buy_price_change_pct_threshold Decimal(10, 4) COMMENT 'Trigger BUY if % change > this',
  buy_volume_surge_threshold Decimal(10, 4) COMMENT 'Require volume surge > this',
  buy_trend_strength_min Decimal(10, 6) COMMENT 'Require trend strength > this',

  -- SELL Signal Conditions (Momentum Flattening)
  sell_velocity_threshold Decimal(12, 8) COMMENT 'Trigger SELL if velocity < this (near zero)',
  sell_acceleration_threshold Decimal(12, 8) COMMENT 'Trigger SELL if deceleration detected',
  sell_price_drop_threshold Decimal(10, 4) COMMENT 'Stop loss: exit if price drops % from peak',
  sell_time_limit_seconds UInt32 COMMENT 'Auto-exit after N seconds regardless',

  -- Combination Logic
  require_all_buy_conditions Boolean DEFAULT FALSE COMMENT 'TRUE=AND, FALSE=OR',
  require_all_sell_conditions Boolean DEFAULT FALSE,

  -- Risk Management
  max_position_size_usd Decimal(18, 2),
  max_concurrent_positions UInt16,
  min_expected_profit_pct Decimal(10, 4),

  -- Timing
  signal_expiry_seconds UInt32 DEFAULT 60 COMMENT 'Signal valid for N seconds',
  cooldown_after_trade_seconds UInt32 DEFAULT 300 COMMENT 'Wait N seconds before same market',

  created_at DateTime,
  updated_at DateTime
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (rule_id);
```

**Example Rules**:

```sql
-- Rule 1: "Rapid Momentum Spike"
INSERT INTO momentum_threshold_rules VALUES (
  uuid(),
  NULL,  -- System-wide
  'Rapid Momentum Spike',
  TRUE,
  [],  -- All categories
  [],  -- All markets
  1000.00,  -- Min liquidity $1k

  -- BUY conditions
  0.001,    -- velocity_1min > 0.001 (0.1% per second = 6% per minute)
  0.0001,   -- acceleration > 0.0001 (accelerating)
  3.0,      -- price_change_pct_1min > 3%
  2.0,      -- volume_surge > 2x average
  0.7,      -- trend_strength > 0.7 (strong uptrend)

  -- SELL conditions
  0.0001,   -- velocity < 0.0001 (nearly flat)
  -0.00005, -- acceleration < -0.00005 (decelerating)
  -2.0,     -- Stop loss at -2% from entry
  300,      -- Auto-exit after 5 minutes

  TRUE,     -- Require ALL buy conditions
  FALSE,    -- Any sell condition triggers

  -- Risk
  500.00,   -- Max $500 per position
  3,        -- Max 3 concurrent positions
  1.0,      -- Min 1% expected profit

  60,       -- Signal expires in 60s
  300,      -- 5min cooldown

  now(),
  now()
);

-- Rule 2: "Momentum Flattening Exit"
INSERT INTO momentum_threshold_rules VALUES (
  uuid(),
  NULL,
  'Momentum Flattening - Take Profit',
  TRUE,
  [],
  [],
  500.00,

  -- No BUY conditions (exit-only rule)
  NULL, NULL, NULL, NULL, NULL,

  -- SELL conditions: Exit when momentum flattens
  0.00005,  -- velocity approaching zero
  -0.00001, -- negative acceleration (slowing down)
  NULL,     -- No stop loss (profit-taking only)
  600,      -- Max hold time 10 minutes

  FALSE,
  FALSE,

  NULL, NULL, NULL,

  30,
  180,

  now(),
  now()
);
```

---

### 4. Real-Time Monitoring Pipeline

#### 4.1 Data Collection Pipeline

**Process Flow**:

```
1. Price Collection (Every 10-30 seconds):
   ├─ WebSocket: Polymarket real-time feed
   ├─ REST API: Polymarket HTTP endpoint (fallback)
   └─ Insert → market_price_history

2. Momentum Calculation (Every 30 seconds):
   ├─ Query: Last 15 minutes of price_history
   ├─ Calculate: Velocity, acceleration, trend strength
   └─ Insert → market_price_momentum

3. Signal Detection (Every 30 seconds):
   ├─ Query: market_price_momentum (latest)
   ├─ Join: momentum_threshold_rules (active rules)
   ├─ Evaluate: Check if any thresholds crossed
   └─ Insert → momentum_trading_signals (if triggered)

4. Signal Notification (Immediate):
   ├─ WebSocket push to connected clients
   ├─ Webhook POST to registered endpoints
   └─ SMS/Email alerts (for extreme signals)
```

**Implementation**:

```typescript
// Real-time momentum monitor (runs every 30 seconds)
async function monitorMomentumSignals() {
  // Get active markets
  const markets = await getActiveMarkets();

  for (const market of markets) {
    // Calculate current momentum
    const momentum = await calculateMomentum(market.market_id);

    // Insert to momentum table
    await insertMomentum(momentum);

    // Check against all active rules
    const rules = await getActiveRules();

    for (const rule of rules) {
      const signal = evaluateRule(momentum, rule);

      if (signal.triggered) {
        // Create signal
        await createSignal({
          market_id: market.market_id,
          signal_type: signal.type,  // BUY or SELL
          trigger_condition: signal.condition,
          actual_value: signal.value,
          signal_strength: signal.strength,
          detected_at: new Date(),
          valid_until: new Date(Date.now() + rule.signal_expiry_seconds * 1000)
        });

        // Notify
        await notifySignal(signal);
      }
    }
  }
}
```

#### 4.2 Momentum Calculation Function

**SQL Implementation**:

```sql
-- Materialized view for latest momentum (refreshed every 30s)
CREATE MATERIALIZED VIEW latest_market_momentum AS
WITH price_windows AS (
  SELECT
    market_id,
    argMax(yes_price, timestamp) as current_yes_price,
    argMax(no_price, timestamp) as current_no_price,
    argMax(timestamp, timestamp) as latest_timestamp,

    -- Price N seconds ago
    argMax(yes_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 10 SECOND) as yes_10s_ago,
    argMax(yes_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 30 SECOND) as yes_30s_ago,
    argMax(yes_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 1 MINUTE) as yes_1min_ago,
    argMax(yes_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 2 MINUTE) as yes_2min_ago,
    argMax(yes_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 5 MINUTE) as yes_5min_ago,

    -- Same for NO prices
    argMax(no_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 10 SECOND) as no_10s_ago,
    argMax(no_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 1 MINUTE) as no_1min_ago,
    argMax(no_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 5 MINUTE) as no_5min_ago

  FROM market_price_history
  WHERE timestamp >= now() - INTERVAL 15 MINUTE
  GROUP BY market_id
)
SELECT
  market_id,

  -- YES momentum
  current_yes_price,
  current_yes_price - yes_1min_ago as yes_change_1min,
  (current_yes_price - yes_1min_ago) / NULLIF(yes_1min_ago, 0) * 100 as yes_change_pct_1min,
  (current_yes_price - yes_1min_ago) / 60 as yes_velocity_1min,  -- Per second

  -- YES acceleration
  ((current_yes_price - yes_30s_ago) / 30) - ((yes_30s_ago - yes_1min_ago) / 30) as yes_acceleration_30s,

  -- NO momentum
  current_no_price,
  current_no_price - no_1min_ago as no_change_1min,
  (current_no_price - no_1min_ago) / NULLIF(no_1min_ago, 0) * 100 as no_change_pct_1min,
  (current_no_price - no_1min_ago) / 60 as no_velocity_1min,

  latest_timestamp

FROM price_windows;
```

---

### 5. API Endpoints for Momentum Trading

#### 5.1 Get Current Market Momentum

```
GET /api/markets/{market_id}/momentum

Response:
{
  "market_id": "0x...",
  "timestamp": "2025-10-25T14:32:15.234Z",
  "yes": {
    "current_price": 0.6234,
    "price_change_1min": 0.0315,
    "price_change_pct_1min": 5.32,
    "velocity_1min": 0.000525,
    "acceleration_1min": 0.000012,
    "direction": "up",
    "trend_strength": 0.87
  },
  "no": {
    "current_price": 0.3766,
    "price_change_1min": -0.0315,
    "price_change_pct_1min": -7.72,
    "velocity_1min": -0.000525,
    "acceleration_1min": -0.000012,
    "direction": "down",
    "trend_strength": -0.87
  }
}
```

#### 5.2 Get Active Momentum Signals

```
GET /api/momentum/signals/active?min_strength=moderate

Response:
{
  "active_signals": [
    {
      "signal_id": "uuid",
      "market_id": "0x...",
      "side": "YES",
      "signal_type": "BUY",
      "signal_strength": "strong",
      "confidence_score": 0.89,
      "trigger_condition": "velocity_1min > 0.001 AND volume_surge > 2.0",
      "current_price": 0.6234,
      "recommended_action": "BUY",
      "recommended_entry_price": 0.6240,
      "recommended_stop_loss": 0.6115,
      "recommended_take_profit": 0.6500,
      "detected_at": "2025-10-25T14:32:15.234Z",
      "valid_until": "2025-10-25T14:33:15.234Z",
      "time_remaining_seconds": 52
    }
  ]
}
```

#### 5.3 Subscribe to Momentum Signals (WebSocket)

```
WebSocket: ws://api/momentum/signals/stream

Subscribe Message:
{
  "type": "subscribe",
  "filters": {
    "categories": ["AI", "Tech"],
    "min_signal_strength": "moderate",
    "signal_types": ["BUY", "SELL"]
  }
}

Signal Message (pushed when detected):
{
  "type": "signal",
  "signal": {
    "signal_id": "uuid",
    "market_id": "0x...",
    "signal_type": "BUY",
    "current_price": 0.6234,
    "velocity_1min": 0.000525,
    "acceleration_1min": 0.000012,
    "recommended_action": "BUY",
    "expires_in_seconds": 60
  }
}
```

#### 5.4 Create Custom Threshold Rule

```
POST /api/momentum/rules

Request:
{
  "rule_name": "My Rapid Spike Strategy",
  "category_filter": ["AI"],
  "buy_conditions": {
    "velocity_1min_threshold": 0.001,
    "price_change_pct_1min_threshold": 3.0,
    "volume_surge_threshold": 2.0,
    "require_all": true
  },
  "sell_conditions": {
    "velocity_threshold": 0.0001,
    "acceleration_threshold": -0.00005,
    "time_limit_seconds": 300,
    "require_all": false
  },
  "risk_management": {
    "max_position_size_usd": 500,
    "max_concurrent_positions": 3,
    "min_expected_profit_pct": 1.0
  }
}

Response:
{
  "rule_id": "uuid",
  "status": "active",
  "message": "Rule created and monitoring started"
}
```

#### 5.5 Monitor Markets by Momentum

```
GET /api/markets/momentum/leaders?window=1min&limit=20

Response:
{
  "top_movers_yes": [
    {
      "market_id": "0x...",
      "market_title": "Will OpenAI release GPT-5 in Q1 2025?",
      "category": "AI",
      "yes_price": 0.6234,
      "yes_change_pct_1min": 8.32,
      "yes_velocity_1min": 0.00138,
      "volume_surge_ratio": 4.2,
      "signal_strength": "extreme"
    }
  ],
  "top_movers_no": [...]
}
```

---

### 6. Performance Requirements for Momentum System

**Data Collection**:
- Price snapshots: **<100ms latency** from Polymarket API/WebSocket
- Database insert: **<50ms** for batch insert (all active markets)

**Momentum Calculation**:
- Calculate momentum for single market: **<20ms**
- Calculate momentum for all active markets: **<2 seconds**
- Refresh `latest_market_momentum` view: **Every 30 seconds**

**Signal Detection**:
- Evaluate all rules against all markets: **<1 second**
- Signal notification (WebSocket push): **<100ms**

**API Response Times**:
- `GET /api/markets/{id}/momentum`: **<50ms**
- `GET /api/momentum/signals/active`: **<100ms**
- `GET /api/markets/momentum/leaders`: **<200ms**

**Real-Time Requirements**:
- End-to-end latency (price change → signal notification): **<60 seconds**
- Ideal target: **<30 seconds**

---

### 7. Integration with Strategy Builder

**Momentum nodes** should be available in the strategy builder:

```
[Market Price Stream]
  ↓
[Calculate Momentum]  (velocity, acceleration)
  ↓
[Threshold Filter]  (user-defined: velocity > 0.001)
  ↓
[Signal Generator]  (BUY/SELL signals)
  ↓
[Execute Trade]  (API call to Polymarket)
```

**Example Node Configuration**:

```json
{
  "node_type": "momentum_threshold",
  "config": {
    "input": "market_price_stream",
    "metric": "velocity_1min",
    "operator": ">",
    "threshold": 0.001,
    "window": "1min",
    "action": "BUY"
  }
}
```

---

### 8. Example Momentum Trading Workflow

**Scenario**: Trade on rapid YES price spikes

```
1. System monitors market: "Will OpenAI release GPT-5 in Q1?"
   - Current YES price: 0.58
   - Velocity: 0.0001 (flat)

2. News breaks: "OpenAI CEO hints at Q1 release"
   - Price jumps: 0.58 → 0.62 in 90 seconds
   - Velocity: 0.00044 (rapid increase)
   - Acceleration: 0.00003 (accelerating)
   - Volume surge: 3.2x average

3. Signal Detection:
   ✅ velocity_1min (0.00044) > threshold (0.001)? NO
   ✅ price_change_pct_1min (6.9%) > threshold (3%)? YES
   ✅ volume_surge (3.2) > threshold (2.0)? YES
   ✅ acceleration (0.00003) > threshold (0.0001)? NO
   → Rule: "require ANY condition" → TRIGGERED

4. Signal Generated:
   {
     "signal_type": "BUY",
     "side": "YES",
     "current_price": 0.62,
     "recommended_entry": 0.621,
     "confidence": 0.87,
     "expires_in": 60s
   }

5. Trade Execution (if auto-enabled):
   - Buy YES at 0.621
   - Set stop loss: 0.609 (-2%)
   - Set take profit: 0.650 (+5%)

6. Momentum Flattens (3 minutes later):
   - Price: 0.645
   - Velocity: 0.00005 (nearly flat)
   - Acceleration: -0.00002 (decelerating)

7. Exit Signal Generated:
   ✅ velocity (0.00005) < threshold (0.0001)? YES
   ✅ acceleration (-0.00002) < threshold (0)? YES
   → SELL signal triggered

8. Trade Closed:
   - Sell YES at 0.644
   - Profit: +3.7% in 3 minutes
```

---

## Critical System Components: Production Trading Requirements

**CRITICAL CONTEXT**: The previous sections cover **signal generation** (finding opportunities). The following sections cover **signal execution** (actually making money). Without these, the system is incomplete.

---

## 1. Backtesting & Strategy Validation System

### Overview

**CRITICAL REQUIREMENT**: Users cannot deploy strategies with real money without knowing historical performance.

**Use Cases**:
- "Would Strategy 1 have made money last year?"
- "How does my custom momentum rule compare to copy-trading?"
- "What's the worst drawdown I would have experienced?"
- "Can I trust this signal before risking $1,000?"

---

### 1.1 Backtest Results Storage

**Schema**:

```sql
CREATE TABLE strategy_backtests (
  backtest_id UUID PRIMARY KEY,
  user_id UUID COMMENT 'NULL for system backtests',
  strategy_id UUID COMMENT 'Links to saved strategy config',
  strategy_name String,

  -- Test Configuration
  start_date Date,
  end_date Date,
  initial_capital Decimal(18, 2) DEFAULT 10000.00,
  position_sizing_mode Enum8('fixed_usd'=1, 'fixed_pct'=2, 'kelly'=3, 'custom'=4),
  position_size_config String COMMENT 'JSON config for sizing',
  slippage_model Enum8('none'=1, 'fixed_bps'=2, 'market_impact'=3, 'historical'=4),
  slippage_bps UInt16 DEFAULT 10 COMMENT 'Basis points slippage assumed',

  -- Trade Filters Applied
  min_liquidity Decimal(18, 2) COMMENT 'Skip signals if liquidity < this',
  max_concurrent_positions UInt8,
  categories_filter Array(String),

  -- Results Summary
  total_trades UInt32,
  winning_trades UInt32,
  losing_trades UInt32,
  win_rate Decimal(5, 4),

  -- P&L Metrics
  final_capital Decimal(18, 2),
  total_pnl Decimal(18, 2),
  total_pnl_pct Decimal(10, 4),
  gross_profit Decimal(18, 2),
  gross_loss Decimal(18, 2),

  -- Risk-Adjusted Returns
  sharpe_ratio Decimal(10, 4),
  sortino_ratio Decimal(10, 4),
  calmar_ratio Decimal(10, 4),
  omega_ratio Decimal(10, 4),

  -- Drawdown Analysis
  max_drawdown_pct Decimal(10, 4),
  max_drawdown_usd Decimal(18, 2),
  avg_drawdown_pct Decimal(10, 4),
  longest_drawdown_days UInt16,
  time_in_drawdown_pct Decimal(5, 4),

  -- Trade Statistics
  avg_win_usd Decimal(18, 2),
  avg_loss_usd Decimal(18, 2),
  largest_win_usd Decimal(18, 2),
  largest_loss_usd Decimal(18, 2),
  profit_factor Decimal(10, 4),

  -- Holding Period
  avg_holding_hours Decimal(10, 2),
  median_holding_hours Decimal(10, 2),

  -- Signal Analysis
  signals_generated UInt32 COMMENT 'Total BUY/SELL signals detected',
  signals_executed UInt32 COMMENT 'How many were actually executed',
  signals_skipped_liquidity UInt32 COMMENT 'Skipped due to low liquidity',
  signals_skipped_position_limit UInt32 COMMENT 'Already at max positions',
  execution_rate Decimal(5, 4) COMMENT 'signals_executed / signals_generated',

  -- Performance Over Time
  equity_curve_json String COMMENT 'JSON: daily equity values',
  monthly_returns_json String COMMENT 'JSON: {YYYY-MM: return_pct}',
  trades_by_category_json String COMMENT 'JSON: breakdown by category',

  -- Comparison to Baseline
  buy_and_hold_return_pct Decimal(10, 4) COMMENT 'Benchmark return',
  alpha Decimal(10, 4) COMMENT 'Excess return vs benchmark',

  -- Execution Details
  execution_time_seconds UInt32,
  markets_tested UInt32,
  data_quality_score Decimal(3, 2) COMMENT '0-1 score for data completeness',

  -- Status
  status Enum8('queued'=1, 'running'=2, 'completed'=3, 'failed'=4),
  error_message Nullable(String),

  created_at DateTime,
  completed_at Nullable(DateTime)
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(start_date)
ORDER BY (backtest_id);

-- Index for user lookups
CREATE INDEX idx_user_backtests ON strategy_backtests(user_id, created_at)
  TYPE minmax GRANULARITY 4;

-- Index for strategy performance comparison
CREATE INDEX idx_strategy_performance ON strategy_backtests(strategy_id, sharpe_ratio)
  TYPE minmax GRANULARITY 4;
```

---

### 1.2 Individual Backtest Trades

**Schema**:

```sql
CREATE TABLE backtest_trades (
  trade_id UUID,
  backtest_id UUID,

  -- Trade Details
  market_id String,
  market_title String,
  category String,

  -- Entry
  entry_signal_id UUID COMMENT 'Which signal triggered this',
  entry_timestamp DateTime,
  entry_side Enum8('YES'=1, 'NO'=2),
  entry_price Decimal(10, 6),
  shares Decimal(18, 8),
  entry_value_usd Decimal(18, 2),

  -- Position Sizing Decision
  sizing_method Enum8('fixed'=1, 'kelly'=2, 'custom'=3),
  kelly_pct Nullable(Decimal(10, 4)) COMMENT 'If Kelly used',
  bankroll_at_entry Decimal(18, 2),
  position_pct_of_bankroll Decimal(10, 4),

  -- Exit
  exit_signal_id Nullable(UUID) COMMENT 'Which signal triggered exit',
  exit_timestamp DateTime,
  exit_reason Enum8('signal'=1, 'stop_loss'=2, 'take_profit'=3, 'time_limit'=4, 'market_resolved'=5),
  exit_price Decimal(10, 6),

  -- Outcome
  pnl_gross Decimal(18, 2),
  pnl_net Decimal(18, 2) COMMENT 'After fees and slippage',
  pnl_pct Decimal(10, 4),
  fees_paid Decimal(18, 2),
  slippage_cost Decimal(18, 2),

  -- Holding Period
  hours_held Decimal(10, 2),

  -- Market Conditions at Entry
  market_liquidity_score Decimal(3, 2),
  market_volume_24h Decimal(18, 2),
  spread_bps_at_entry UInt16,

  -- Signal Quality
  signal_confidence Decimal(5, 4),
  signal_strength Enum8('weak'=1, 'moderate'=2, 'strong'=3, 'extreme'=4),

  PRIMARY KEY (trade_id)
)
ENGINE = MergeTree()
PARTITION BY backtest_id
ORDER BY (backtest_id, entry_timestamp);
```

---

### 1.3 Backtest Equity Curve (Time Series)

**Schema**:

```sql
CREATE TABLE backtest_equity_curve (
  backtest_id UUID,
  timestamp DateTime,

  -- Equity Values
  equity_value Decimal(18, 2),
  cash_balance Decimal(18, 2),
  positions_value Decimal(18, 2),

  -- Cumulative P&L
  cumulative_pnl Decimal(18, 2),
  cumulative_pnl_pct Decimal(10, 4),

  -- Drawdown
  peak_equity Decimal(18, 2),
  drawdown_usd Decimal(18, 2),
  drawdown_pct Decimal(10, 4),

  -- Open Positions
  open_positions_count UInt8,

  PRIMARY KEY (backtest_id, timestamp)
)
ENGINE = MergeTree()
PARTITION BY backtest_id
ORDER BY (backtest_id, timestamp);
```

---

### 1.4 Backtesting Engine Implementation

**Pseudocode**:

```typescript
async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  // Initialize
  let equity = config.initial_capital;
  let cash = config.initial_capital;
  const openPositions: Position[] = [];
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  // Get historical price data for the period
  const priceHistory = await getHistoricalPrices(
    config.start_date,
    config.end_date
  );

  // Get all signals that would have been generated
  const historicalSignals = await generateHistoricalSignals(
    config.strategy,
    config.start_date,
    config.end_date
  );

  // Sort signals chronologically
  historicalSignals.sort((a, b) => a.timestamp - b.timestamp);

  // Simulate day by day
  for (const signal of historicalSignals) {
    // Update equity based on current prices
    equity = cash + calculatePositionsValue(openPositions, priceHistory, signal.timestamp);

    // Record equity curve
    equityCurve.push({
      timestamp: signal.timestamp,
      equity,
      cash,
      positions_value: equity - cash
    });

    // Check for exit signals on open positions
    for (const position of openPositions) {
      const exitSignal = checkExitConditions(
        position,
        signal.timestamp,
        priceHistory,
        config.strategy
      );

      if (exitSignal) {
        const trade = closePosition(position, exitSignal, priceHistory);
        trades.push(trade);
        cash += trade.pnl_net + trade.entry_value;
        openPositions.remove(position);
      }
    }

    // Process new entry signal
    if (signal.type === 'BUY' || signal.type === 'SELL') {
      // Check if we can execute
      const liquidity = await getHistoricalLiquidity(signal.market_id, signal.timestamp);

      if (liquidity.score < config.min_liquidity) {
        signal.skipped_reason = 'low_liquidity';
        continue;
      }

      if (openPositions.length >= config.max_concurrent_positions) {
        signal.skipped_reason = 'position_limit';
        continue;
      }

      // Calculate position size
      const positionSize = calculatePositionSize(
        equity,
        signal,
        config.position_sizing_mode,
        config.position_size_config
      );

      if (cash < positionSize) {
        signal.skipped_reason = 'insufficient_capital';
        continue;
      }

      // Execute trade (with slippage)
      const executionPrice = applySlippage(
        signal.recommended_price,
        positionSize,
        liquidity,
        config.slippage_model
      );

      const position = {
        market_id: signal.market_id,
        entry_timestamp: signal.timestamp,
        entry_price: executionPrice,
        shares: positionSize / executionPrice,
        entry_value: positionSize,
        side: signal.side
      };

      openPositions.push(position);
      cash -= positionSize;
      signal.executed = true;
    }
  }

  // Close all remaining positions at end date
  for (const position of openPositions) {
    const finalPrice = priceHistory.get(position.market_id, config.end_date);
    const trade = closePosition(position, { price: finalPrice, reason: 'backtest_end' });
    trades.push(trade);
  }

  // Calculate performance metrics
  const results = calculatePerformanceMetrics(trades, equityCurve, config);

  // Save to database
  await saveBacktestResults(results, trades, equityCurve);

  return results;
}
```

---

### 1.5 Backtest APIs

```
POST /api/backtests/run
Request:
{
  "strategy_id": "uuid",
  "start_date": "2024-01-01",
  "end_date": "2025-01-01",
  "initial_capital": 10000,
  "position_sizing": {
    "mode": "kelly",
    "kelly_fraction": 0.25,
    "max_position_pct": 0.10
  },
  "slippage_model": "historical",
  "max_concurrent_positions": 5
}

Response:
{
  "backtest_id": "uuid",
  "status": "queued",
  "estimated_time_seconds": 120
}

---

GET /api/backtests/{id}
Response:
{
  "backtest_id": "uuid",
  "status": "completed",
  "summary": {
    "total_pnl": 2350.00,
    "total_pnl_pct": 23.5,
    "sharpe_ratio": 1.85,
    "max_drawdown_pct": -12.3,
    "win_rate": 0.64,
    "total_trades": 47
  },
  "equity_curve": [...],
  "trades": [...]
}

---

GET /api/backtests/compare?ids=uuid1,uuid2,uuid3
→ Returns side-by-side comparison of multiple backtests

---

POST /api/backtests/{id}/optimize
Request:
{
  "optimize_parameters": ["velocity_threshold", "stop_loss_pct"],
  "parameter_ranges": {
    "velocity_threshold": [0.0001, 0.001, 0.01],
    "stop_loss_pct": [0.01, 0.02, 0.05]
  }
}
→ Runs grid search to find optimal parameters
```

---

## 2. User Portfolio Management System

### Overview

**CRITICAL REQUIREMENT**: Track the USER's actual positions and P&L (not just other wallets).

---

### 2.1 User Positions Table

**Schema**:

```sql
CREATE TABLE user_positions (
  position_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  wallet_address String COMMENT 'User wallet on Polymarket',
  market_id String NOT NULL,

  -- Market Info
  market_title String,
  market_url String,
  category String,
  closes_at DateTime,

  -- Position Details
  side Enum8('YES'=1, 'NO'=2),
  shares Decimal(18, 8),
  entry_price Decimal(10, 6),
  entry_timestamp DateTime,
  entry_value_usd Decimal(18, 2),

  -- What triggered this position
  entry_source Enum8('manual'=1, 'strategy_signal'=2, 'copy_trade'=3, 'momentum_signal'=4),
  entry_strategy_id Nullable(UUID),
  entry_signal_id Nullable(UUID),
  copied_wallet_address Nullable(String) COMMENT 'If copy trade',

  -- Risk Management Parameters
  stop_loss_price Decimal(10, 6),
  take_profit_price Decimal(10, 6),
  trailing_stop_pct Nullable(Decimal(10, 4)),
  trailing_stop_high_price Nullable(Decimal(10, 6)),
  auto_exit_enabled Boolean DEFAULT TRUE,

  -- Current State (updated frequently)
  current_price Decimal(10, 6),
  current_value_usd Decimal(18, 2),
  unrealized_pnl Decimal(18, 2),
  unrealized_pnl_pct Decimal(10, 4),
  last_price_update DateTime,

  -- Exit Details (if closed)
  exit_timestamp Nullable(DateTime),
  exit_price Nullable(Decimal(10, 6)),
  exit_reason Nullable(Enum8('manual'=1, 'stop_loss'=2, 'take_profit'=3, 'signal'=4, 'market_resolved'=5, 'trailing_stop'=6)),
  realized_pnl Nullable(Decimal(18, 2)),
  realized_pnl_pct Nullable(Decimal(10, 4)),

  -- Fees & Costs
  entry_fee Decimal(18, 2),
  exit_fee Nullable(Decimal(18, 2)),
  total_fees Decimal(18, 2),

  -- Status
  is_open Boolean DEFAULT TRUE,

  -- Metadata
  notes String COMMENT 'User notes about this position',
  tags Array(String),

  created_at DateTime,
  updated_at DateTime
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY (user_id, toYYYYMM(created_at))
ORDER BY (user_id, is_open, created_at);

-- Indexes
CREATE INDEX idx_open_positions ON user_positions(user_id, is_open)
  TYPE set(0) GRANULARITY 1
  WHERE is_open = TRUE;

CREATE INDEX idx_market_positions ON user_positions(market_id, is_open)
  TYPE minmax GRANULARITY 4;
```

---

### 2.2 Portfolio Summary (Real-Time)

**Schema**:

```sql
-- Real-time portfolio summary (refreshed on every position update)
CREATE MATERIALIZED VIEW user_portfolio_summary_live AS
SELECT
  user_id,
  now() as snapshot_timestamp,

  -- Position Counts
  countIf(is_open = TRUE) as open_positions_count,
  count() as total_positions_lifetime,

  -- Capital Allocation
  sumIf(current_value_usd, is_open = TRUE) as deployed_capital,
  sumIf(unrealized_pnl, is_open = TRUE) as total_unrealized_pnl,

  -- Realized P&L (closed positions)
  sumIf(realized_pnl, is_open = FALSE) as total_realized_pnl,
  countIf(is_open = FALSE AND realized_pnl > 0) as winning_trades,
  countIf(is_open = FALSE AND realized_pnl <= 0) as losing_trades,

  -- Win Rate
  countIf(is_open = FALSE AND realized_pnl > 0) / NULLIF(countIf(is_open = FALSE), 0) as win_rate,

  -- Total P&L
  sumIf(realized_pnl, is_open = FALSE) + sumIf(unrealized_pnl, is_open = TRUE) as net_pnl,

  -- Risk Metrics
  maxIf(current_value_usd / NULLIF(sumIf(current_value_usd, is_open = TRUE), 0), is_open = TRUE) as largest_position_pct,

  -- Category Breakdown
  groupArray((category, current_value_usd)) as positions_by_category

FROM user_positions
GROUP BY user_id;
```

---

### 2.3 Portfolio History (Daily Snapshots)

**Schema**:

```sql
CREATE TABLE user_portfolio_snapshots (
  user_id UUID,
  snapshot_date Date,

  -- Equity
  total_equity Decimal(18, 2) COMMENT 'Cash + positions value',
  cash_balance Decimal(18, 2),
  positions_value Decimal(18, 2),

  -- P&L
  total_realized_pnl Decimal(18, 2),
  total_unrealized_pnl Decimal(18, 2),
  net_pnl Decimal(18, 2),
  net_pnl_pct Decimal(10, 4) COMMENT 'Since inception',

  -- Daily Change
  daily_pnl Decimal(18, 2),
  daily_pnl_pct Decimal(10, 4),

  -- Positions
  open_positions_count UInt16,
  deployed_capital Decimal(18, 2),
  available_capital Decimal(18, 2),
  capital_utilization_pct Decimal(5, 4),

  -- Risk Metrics
  largest_position_pct Decimal(10, 4),
  portfolio_concentration_hhi Decimal(10, 6),
  total_exposure_pct Decimal(10, 4) COMMENT 'deployed / total equity',

  -- Performance Metrics (rolling)
  sharpe_ratio_30d Decimal(10, 4),
  max_drawdown_30d Decimal(10, 4),
  win_rate_30d Decimal(5, 4),

  -- Trade Activity
  trades_opened_today UInt16,
  trades_closed_today UInt16,

  PRIMARY KEY (user_id, snapshot_date)
)
ENGINE = ReplacingMergeTree(snapshot_date)
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (user_id, snapshot_date);
```

---

### 2.4 Portfolio APIs

```
GET /api/user/portfolio
Response:
{
  "summary": {
    "total_equity": 12350.00,
    "deployed_capital": 4500.00,
    "available_capital": 7850.00,
    "net_pnl": 2350.00,
    "net_pnl_pct": 23.5,
    "open_positions": 5,
    "win_rate": 0.68
  },
  "open_positions": [
    {
      "position_id": "uuid",
      "market_title": "Will OpenAI release GPT-5 in Q1 2025?",
      "side": "YES",
      "entry_price": 0.58,
      "current_price": 0.64,
      "shares": 500,
      "current_value": 320.00,
      "unrealized_pnl": 30.00,
      "unrealized_pnl_pct": 10.3,
      "stop_loss": 0.55,
      "take_profit": 0.75
    }
  ]
}

---

GET /api/user/portfolio/history?period=30d
Response:
{
  "equity_curve": [
    {
      "date": "2025-01-01",
      "equity": 10000.00,
      "pnl": 0.00
    },
    {
      "date": "2025-01-02",
      "equity": 10150.00,
      "pnl": 150.00
    }
  ],
  "performance": {
    "sharpe_ratio": 1.85,
    "max_drawdown": -8.5,
    "win_rate": 0.68
  }
}

---

POST /api/user/positions/{id}/update
Request:
{
  "stop_loss_price": 0.55,
  "take_profit_price": 0.75,
  "trailing_stop_pct": 0.02
}
→ Update risk parameters on existing position

---

POST /api/user/positions/{id}/close
Request:
{
  "close_reason": "manual",
  "limit_price": 0.65  // Optional: wait for this price
}
→ Manually close a position
```

---

## 3. Liquidity & Executability Analysis

### Overview

**CRITICAL REQUIREMENT**: A signal is useless if you can't execute it profitably due to low liquidity.

---

### 3.1 Market Liquidity Snapshots

**Schema**:

```sql
CREATE TABLE market_liquidity_snapshots (
  market_id String,
  timestamp DateTime64(3),
  side Enum8('YES'=1, 'NO'=2),

  -- Order Book Depth (cumulative USD at each level)
  depth_at_best Decimal(18, 2) COMMENT 'Liquidity at best bid/ask',
  depth_within_1pct Decimal(18, 2) COMMENT 'Cumulative within 1% of mid',
  depth_within_2pct Decimal(18, 2),
  depth_within_5pct Decimal(18, 2),
  depth_within_10pct Decimal(18, 2),

  -- Bid/Ask Levels
  best_bid Decimal(10, 6),
  best_ask Decimal(10, 6),
  mid_price Decimal(10, 6),
  spread_bps UInt16 COMMENT 'Bid-ask spread in basis points',

  -- Volume Metrics
  volume_1h Decimal(18, 2),
  volume_24h Decimal(18, 2),
  trade_count_1h UInt32,
  trade_count_24h UInt32,

  -- Liquidity Score (0-1, composite metric)
  liquidity_score Decimal(5, 4) COMMENT '1=very liquid, 0=illiquid',

  -- Order Book Imbalance
  buy_pressure_ratio Decimal(5, 4) COMMENT 'bid_depth / (bid_depth + ask_depth)',

  PRIMARY KEY (market_id, side, timestamp)
)
ENGINE = ReplacingMergeTree(timestamp)
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (market_id, side, timestamp)
SETTINGS index_granularity = 4096;

-- Index for latest liquidity queries
CREATE INDEX idx_recent_liquidity ON market_liquidity_snapshots(timestamp)
  TYPE minmax GRANULARITY 2;
```

**Liquidity Score Formula**:

```typescript
function calculateLiquidityScore(snapshot: LiquiditySnapshot): number {
  // Factors:
  // 1. Depth within 1% (40% weight)
  // 2. 24h volume (30% weight)
  // 3. Spread (20% weight)
  // 4. Trade frequency (10% weight)

  const depthScore = Math.min(snapshot.depth_within_1pct / 10000, 1); // $10k = perfect
  const volumeScore = Math.min(snapshot.volume_24h / 100000, 1);      // $100k = perfect
  const spreadScore = Math.max(1 - (snapshot.spread_bps / 100), 0);   // 0 bps = perfect
  const frequencyScore = Math.min(snapshot.trade_count_24h / 1000, 1); // 1000 trades = perfect

  return (
    depthScore * 0.4 +
    volumeScore * 0.3 +
    spreadScore * 0.2 +
    frequencyScore * 0.1
  );
}
```

---

### 3.2 Slippage Estimation

**Schema**:

```sql
CREATE TABLE market_slippage_estimates (
  market_id String,
  side Enum8('YES'=1, 'NO'=2),
  timestamp DateTime,

  -- Estimated slippage for different order sizes
  slippage_100_usd Decimal(10, 6) COMMENT 'Expected % slippage for $100 order',
  slippage_500_usd Decimal(10, 6),
  slippage_1000_usd Decimal(10, 6),
  slippage_2500_usd Decimal(10, 6),
  slippage_5000_usd Decimal(10, 6),

  -- Max sizes without excessive slippage
  max_size_1pct_slippage Decimal(18, 2) COMMENT 'Max order size for <1% slippage',
  max_size_2pct_slippage Decimal(18, 2),
  max_size_5pct_slippage Decimal(18, 2),

  -- Market Impact Model Parameters
  market_impact_coefficient Decimal(12, 8),
  price_impact_per_1k Decimal(10, 6) COMMENT 'Price impact per $1k traded',

  -- Recent Historical Slippage (actual observed)
  avg_slippage_observed_30d Decimal(10, 6),

  PRIMARY KEY (market_id, side, timestamp)
)
ENGINE = ReplacingMergeTree(timestamp)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, side, timestamp);
```

**Slippage Estimation Formula**:

```typescript
function estimateSlippage(
  market_id: string,
  side: 'YES' | 'NO',
  orderSize: number,
  liquidity: LiquiditySnapshot
): number {
  // Square root market impact model
  // slippage = k * sqrt(orderSize / depth)

  const relevantDepth = liquidity.depth_within_2pct;
  const impactCoefficient = 0.5; // Calibrated from historical data

  if (relevantDepth === 0) {
    return 999; // Infinite slippage (no liquidity)
  }

  const slippagePct = impactCoefficient * Math.sqrt(orderSize / relevantDepth);

  // Add bid-ask spread cost
  const spreadCost = liquidity.spread_bps / 10000; // Convert bps to decimal

  return slippagePct + spreadCost;
}
```

---

### 3.3 Signal Liquidity Filter

**Implementation**:

```typescript
async function shouldExecuteSignal(
  signal: TradingSignal,
  userConfig: UserConfig
): Promise<{ execute: boolean; reason?: string; adjustedSize?: number }> {

  // Get current liquidity
  const liquidity = await getCurrentLiquidity(signal.market_id, signal.side);

  // Check 1: Minimum liquidity score
  if (liquidity.liquidity_score < userConfig.min_liquidity_score) {
    return {
      execute: false,
      reason: `Low liquidity (score: ${liquidity.liquidity_score}, required: ${userConfig.min_liquidity_score})`
    };
  }

  // Check 2: Estimate slippage for desired position size
  const desiredSize = signal.recommended_size_usd;
  const estimatedSlippage = estimateSlippage(
    signal.market_id,
    signal.side,
    desiredSize,
    liquidity
  );

  if (estimatedSlippage > userConfig.max_slippage_pct) {
    // Try to find a smaller size that fits within slippage tolerance
    const maxExecutableSize = liquidity.max_size_2pct_slippage;

    if (maxExecutableSize < userConfig.min_position_size_usd) {
      return {
        execute: false,
        reason: `Excessive slippage (${(estimatedSlippage * 100).toFixed(2)}%)`
      };
    }

    return {
      execute: true,
      adjustedSize: Math.min(maxExecutableSize, desiredSize),
      reason: `Reduced size to avoid slippage (from $${desiredSize} to $${maxExecutableSize})`
    };
  }

  // Check 3: Minimum depth requirement
  if (liquidity.depth_within_1pct < desiredSize * 2) {
    return {
      execute: false,
      reason: `Insufficient depth (need $${desiredSize * 2}, available $${liquidity.depth_within_1pct})`
    };
  }

  return {
    execute: true
  };
}
```

---

### 3.4 Liquidity APIs

```
GET /api/markets/{id}/liquidity?side=YES
Response:
{
  "market_id": "0x...",
  "side": "YES",
  "timestamp": "2025-10-25T14:32:15Z",
  "liquidity_score": 0.78,
  "depth": {
    "at_best": 1250.00,
    "within_1pct": 5600.00,
    "within_2pct": 12000.00
  },
  "spread_bps": 15,
  "volume_24h": 45000.00,
  "max_executable_sizes": {
    "1pct_slippage": 2800.00,
    "2pct_slippage": 6500.00,
    "5pct_slippage": 15000.00
  }
}

---

POST /api/markets/{id}/estimate-slippage
Request:
{
  "side": "YES",
  "order_size_usd": 1000
}

Response:
{
  "estimated_slippage_pct": 0.85,
  "estimated_execution_price": 0.6234,
  "mid_price": 0.6180,
  "price_impact": 0.0054,
  "recommendation": "EXECUTABLE"
}

---

GET /api/markets/liquid?min_score=0.5&category=AI
→ Returns list of liquid markets meeting criteria
```

---

## 4. Position Sizing & Kelly Criterion

### Overview

**CRITICAL REQUIREMENT**: Knowing WHAT to trade is useless without knowing HOW MUCH to bet.

---

### 4.1 Position Sizing Recommendations

**Schema**:

```sql
CREATE TABLE position_sizing_recommendations (
  recommendation_id UUID PRIMARY KEY,
  user_id UUID,
  signal_id UUID,
  market_id String,

  -- User Context
  current_bankroll Decimal(18, 2),
  available_capital Decimal(18, 2),
  open_positions_count UInt8,

  -- Signal Inputs
  signal_confidence Decimal(5, 4) COMMENT '0-1 confidence score',
  estimated_edge Decimal(10, 6) COMMENT 'Expected edge (e.g., 0.05 = 5%)',
  estimated_win_rate Decimal(5, 4) COMMENT 'Estimated probability of winning',
  estimated_payoff_ratio Decimal(10, 4) COMMENT 'Avg win / avg loss',

  -- Kelly Calculations
  kelly_full_pct Decimal(10, 6) COMMENT 'Full Kelly % of bankroll',
  kelly_half_pct Decimal(10, 6) COMMENT 'Half Kelly (recommended)',
  kelly_quarter_pct Decimal(10, 6) COMMENT 'Quarter Kelly (conservative)',

  kelly_full_usd Decimal(18, 2),
  kelly_half_usd Decimal(18, 2),
  kelly_quarter_usd Decimal(18, 2),

  -- Risk-Adjusted Recommendation
  recommended_pct Decimal(10, 6) COMMENT 'Our final recommendation',
  recommended_usd Decimal(18, 2),
  sizing_rationale String COMMENT 'Why this size was chosen',

  -- Risk Metrics
  risk_of_ruin Decimal(10, 6) COMMENT 'Probability of losing 50% of bankroll',
  expected_return Decimal(10, 4),
  expected_roi_pct Decimal(10, 4),
  max_loss_scenario_usd Decimal(18, 2),

  -- Constraints Applied
  constraints_hit String COMMENT 'JSON: which limits were applied',
  max_position_limit_applied Boolean,
  max_concurrent_limit_applied Boolean,
  min_size_filter_applied Boolean,

  created_at DateTime
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (recommendation_id);
```

---

### 4.2 Kelly Criterion Implementation

**Formula**:

```typescript
interface KellyInputs {
  winRate: number;        // Probability of winning (e.g., 0.60)
  edgeEstimate: number;   // Expected edge (e.g., 0.05 = 5%)
  payoffRatio: number;    // Avg win / avg loss (e.g., 1.5)
  bankroll: number;       // Total capital
}

interface PositionSizingConstraints {
  max_position_pct: number;     // Max % per position (e.g., 0.10 = 10%)
  max_concurrent_positions: number;
  kelly_fraction: number;        // Fraction of Kelly to use (e.g., 0.5 = half)
  min_position_usd: number;
  max_position_usd: number;
}

function calculateKellySize(
  inputs: KellyInputs,
  constraints: PositionSizingConstraints
): PositionSizingRecommendation {

  // Classic Kelly formula for binary outcomes:
  // f* = (p * b - q) / b
  // where:
  //   p = probability of winning
  //   q = probability of losing = 1 - p
  //   b = odds received on the bet = payoffRatio

  const p = inputs.winRate;
  const q = 1 - p;
  const b = inputs.payoffRatio;

  // Full Kelly percentage
  const kellyFull = (p * b - q) / b;

  // If Kelly is negative or zero, don't bet
  if (kellyFull <= 0) {
    return {
      recommended_pct: 0,
      recommended_usd: 0,
      rationale: "Negative expected value - do not bet"
    };
  }

  // Apply Kelly fraction (typically 0.25 to 0.5)
  let kellyAdjusted = kellyFull * constraints.kelly_fraction;

  // Apply maximum position constraint
  kellyAdjusted = Math.min(kellyAdjusted, constraints.max_position_pct);

  // Convert to USD
  let sizeUsd = inputs.bankroll * kellyAdjusted;

  // Apply min/max USD constraints
  if (sizeUsd < constraints.min_position_usd) {
    return {
      recommended_pct: 0,
      recommended_usd: 0,
      rationale: `Position too small (${sizeUsd} < min ${constraints.min_position_usd})`
    };
  }

  sizeUsd = Math.min(sizeUsd, constraints.max_position_usd);

  // Check concurrent position limit
  const openPositions = await getOpenPositionsCount(user_id);
  if (openPositions >= constraints.max_concurrent_positions) {
    return {
      recommended_pct: 0,
      recommended_usd: 0,
      rationale: `At max concurrent positions (${openPositions}/${constraints.max_concurrent_positions})`
    };
  }

  // Calculate risk metrics
  const riskOfRuin = calculateRiskOfRuin(inputs, kellyAdjusted);
  const expectedReturn = inputs.bankroll * kellyAdjusted * inputs.edgeEstimate;

  return {
    kelly_full_pct: kellyFull,
    kelly_half_pct: kellyFull * 0.5,
    kelly_quarter_pct: kellyFull * 0.25,
    recommended_pct: kellyAdjusted,
    recommended_usd: sizeUsd,
    rationale: `Kelly (${(constraints.kelly_fraction * 100)}%): ${(kellyAdjusted * 100).toFixed(2)}% of bankroll`,
    risk_of_ruin: riskOfRuin,
    expected_return: expectedReturn,
    expected_roi_pct: inputs.edgeEstimate * 100
  };
}

// Simplified risk of ruin calculation
function calculateRiskOfRuin(
  inputs: KellyInputs,
  fractionBet: number
): number {
  // Approximation based on gambler's ruin formula
  const edge = inputs.edgeEstimate;
  const volatility = Math.sqrt(inputs.winRate * (1 - inputs.winRate));

  // Risk of losing 50% of bankroll
  const ruinThreshold = 0.5;

  if (edge <= 0) return 1.0; // Certain ruin

  // Simplified: higher edge and lower fraction = lower risk
  const riskFactor = (volatility * fractionBet) / edge;
  return Math.min(Math.exp(-ruinThreshold / riskFactor), 1.0);
}
```

---

### 4.3 Dynamic Edge Estimation

**How to estimate edge for a signal**:

```typescript
async function estimateSignalEdge(signal: TradingSignal): Promise<EdgeEstimate> {
  // Method 1: Historical performance of this strategy
  const strategyHistory = await getStrategyPerformance(signal.strategy_id);
  const historicalEdge = strategyHistory.avg_roi_per_bet;

  // Method 2: Wallet performance (if copy-trading)
  if (signal.source_wallet) {
    const walletMetrics = await getWalletMetrics(signal.source_wallet);
    const walletEdge = walletMetrics.metric_2_omega_net / (walletMetrics.metric_2_omega_net + 1);
  }

  // Method 3: Signal strength adjustment
  const strengthMultiplier = {
    'weak': 0.5,
    'moderate': 0.75,
    'strong': 1.0,
    'extreme': 1.25
  }[signal.signal_strength];

  // Method 4: Elite vs crowd divergence (if available)
  const flowMetrics = await getMarketFlowMetrics(signal.market_id);
  const divergenceEdge = flowMetrics.crowd_elite_divergence * 0.02; // 2% per point

  // Combine estimates (weighted average)
  const estimatedEdge = (
    historicalEdge * 0.4 +
    (walletEdge || historicalEdge) * 0.3 +
    divergenceEdge * 0.2 +
    (signal.confidence - 0.5) * 0.1 // Confidence adjustment
  ) * strengthMultiplier;

  // Estimate win rate based on historical data
  const estimatedWinRate = strategyHistory.win_rate;

  return {
    edge: Math.max(0, estimatedEdge), // Never negative
    win_rate: estimatedWinRate,
    confidence: signal.confidence
  };
}
```

---

### 4.4 Position Sizing APIs

```
POST /api/position-sizing/calculate
Request:
{
  "signal_id": "uuid",
  "current_bankroll": 10000.00,
  "constraints": {
    "kelly_fraction": 0.5,
    "max_position_pct": 0.10,
    "max_concurrent_positions": 5
  }
}

Response:
{
  "kelly_full_pct": 8.5,
  "kelly_half_pct": 4.25,
  "kelly_quarter_pct": 2.125,
  "recommended_pct": 4.25,
  "recommended_usd": 425.00,
  "rationale": "Half Kelly: 4.25% of bankroll",
  "risk_metrics": {
    "risk_of_ruin": 0.02,
    "expected_return": 21.25,
    "expected_roi_pct": 5.0
  },
  "constraints_applied": {
    "kelly_fraction_applied": true,
    "max_position_limit": false
  }
}

---

GET /api/user/sizing-settings
→ Get user's default position sizing preferences

POST /api/user/sizing-settings
→ Update position sizing preferences
```

---

## 5. Trade Execution Integration

### Overview

**CRITICAL REQUIREMENT**: Close the loop from signal → execution → position tracking.

---

### 5.1 Trade Execution Queue

**Schema**:

```sql
CREATE TABLE trade_execution_queue (
  execution_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  signal_id Nullable(UUID),

  -- Order Details
  market_id String NOT NULL,
  market_title String,
  side Enum8('YES'=1, 'NO'=2),
  order_type Enum8('market'=1, 'limit'=2, 'stop'=3, 'stop_limit'=4),

  -- Size
  shares Nullable(Decimal(18, 8)),
  usd_value Decimal(18, 2),

  -- Pricing
  target_price Nullable(Decimal(10, 6)),
  limit_price Nullable(Decimal(10, 6)),
  stop_price Nullable(Decimal(10, 6)),

  -- Execution Strategy
  execution_strategy Enum8(
    'immediate'=1,      -- Execute now at market
    'twap'=2,           -- Time-weighted average price
    'vwap'=3,           -- Volume-weighted average price
    'iceberg'=4,        -- Hidden size
    'patient'=5         -- Wait for better price
  ),
  max_slippage_pct Decimal(10, 4),
  time_limit_seconds Nullable(UInt32),

  -- Risk Management
  stop_loss_price Nullable(Decimal(10, 6)),
  take_profit_price Nullable(Decimal(10, 6)),
  trailing_stop_pct Nullable(Decimal(10, 4)),

  -- Status
  status Enum8(
    'queued'=1,
    'executing'=2,
    'partially_filled'=3,
    'completed'=4,
    'failed'=5,
    'cancelled'=6,
    'expired'=7
  ),

  -- Execution Results
  filled_shares Decimal(18, 8) DEFAULT 0,
  average_fill_price Nullable(Decimal(10, 6)),
  total_filled_usd Decimal(18, 2) DEFAULT 0,
  total_fees Decimal(18, 2) DEFAULT 0,
  actual_slippage_pct Nullable(Decimal(10, 4)),

  -- Error Handling
  error_message Nullable(String),
  retry_count UInt8 DEFAULT 0,
  max_retries UInt8 DEFAULT 3,

  -- Polymarket Integration
  polymarket_order_id Nullable(String),
  polymarket_transaction_hash Nullable(String),

  -- Timestamps
  queued_at DateTime DEFAULT now(),
  started_at Nullable(DateTime),
  completed_at Nullable(DateTime),
  expires_at Nullable(DateTime),

  -- Metadata
  notes String,

  created_at DateTime DEFAULT now(),
  updated_at DateTime
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(queued_at)
ORDER BY (user_id, status, queued_at);

-- Indexes
CREATE INDEX idx_active_executions ON trade_execution_queue(status)
  TYPE set(0) GRANULARITY 1
  WHERE status IN ('queued', 'executing', 'partially_filled');

CREATE INDEX idx_user_executions ON trade_execution_queue(user_id, queued_at)
  TYPE minmax GRANULARITY 4;
```

---

### 5.2 Execution Engine

**Implementation**:

```typescript
class TradeExecutionEngine {

  async executeOrder(execution: TradeExecution): Promise<ExecutionResult> {
    try {
      // Update status to executing
      await updateExecutionStatus(execution.execution_id, 'executing');

      // Get current market state
      const marketState = await getMarketState(execution.market_id);

      // Check liquidity one more time
      const liquidityCheck = await shouldExecuteSignal(
        { market_id: execution.market_id, side: execution.side },
        { max_slippage_pct: execution.max_slippage_pct }
      );

      if (!liquidityCheck.execute) {
        throw new Error(`Liquidity check failed: ${liquidityCheck.reason}`);
      }

      // Route to appropriate execution strategy
      let result: ExecutionResult;

      switch (execution.execution_strategy) {
        case 'immediate':
          result = await this.executeImmediate(execution, marketState);
          break;
        case 'twap':
          result = await this.executeTWAP(execution, marketState);
          break;
        case 'patient':
          result = await this.executePatient(execution, marketState);
          break;
        default:
          result = await this.executeImmediate(execution, marketState);
      }

      // Create position record
      if (result.filled_shares > 0) {
        await createUserPosition({
          user_id: execution.user_id,
          market_id: execution.market_id,
          side: execution.side,
          shares: result.filled_shares,
          entry_price: result.average_fill_price,
          entry_value_usd: result.total_filled_usd,
          entry_source: 'strategy_signal',
          entry_signal_id: execution.signal_id,
          stop_loss_price: execution.stop_loss_price,
          take_profit_price: execution.take_profit_price
        });
      }

      return result;

    } catch (error) {
      await handleExecutionError(execution, error);
      throw error;
    }
  }

  async executeImmediate(
    execution: TradeExecution,
    marketState: MarketState
  ): Promise<ExecutionResult> {
    // Place market order via Polymarket API
    const order = await polymarketAPI.createMarketOrder({
      market_id: execution.market_id,
      side: execution.side,
      size_usd: execution.usd_value
    });

    // Wait for confirmation
    const fill = await polymarketAPI.waitForFill(order.order_id, {
      timeout_seconds: 30
    });

    return {
      filled_shares: fill.shares,
      average_fill_price: fill.price,
      total_filled_usd: fill.total_cost,
      total_fees: fill.fees,
      actual_slippage_pct: calculateSlippage(
        marketState.mid_price,
        fill.price
      ),
      polymarket_order_id: order.order_id,
      polymarket_transaction_hash: fill.tx_hash
    };
  }

  async executeTWAP(
    execution: TradeExecution,
    marketState: MarketState
  ): Promise<ExecutionResult> {
    // Time-Weighted Average Price
    // Split order into smaller chunks over time

    const chunks = 5; // Split into 5 pieces
    const intervalSeconds = execution.time_limit_seconds / chunks;
    const chunkSize = execution.usd_value / chunks;

    const fills: Fill[] = [];

    for (let i = 0; i < chunks; i++) {
      const chunkResult = await this.executeImmediate(
        { ...execution, usd_value: chunkSize },
        marketState
      );

      fills.push(chunkResult);

      if (i < chunks - 1) {
        await sleep(intervalSeconds * 1000);
      }
    }

    // Aggregate results
    return aggregateFills(fills);
  }

  async executePatient(
    execution: TradeExecution,
    marketState: MarketState
  ): Promise<ExecutionResult> {
    // Wait for better price using limit order

    const targetPrice = execution.target_price || marketState.mid_price * 0.99; // 1% better

    const order = await polymarketAPI.createLimitOrder({
      market_id: execution.market_id,
      side: execution.side,
      size_usd: execution.usd_value,
      limit_price: targetPrice
    });

    // Monitor until filled or timeout
    const startTime = Date.now();
    const timeoutMs = (execution.time_limit_seconds || 300) * 1000;

    while (Date.now() - startTime < timeoutMs) {
      const orderStatus = await polymarketAPI.getOrderStatus(order.order_id);

      if (orderStatus.status === 'filled') {
        return {
          filled_shares: orderStatus.filled_shares,
          average_fill_price: orderStatus.average_price,
          total_filled_usd: orderStatus.total_cost,
          total_fees: orderStatus.fees,
          polymarket_order_id: order.order_id
        };
      }

      await sleep(5000); // Check every 5 seconds
    }

    // Timeout - cancel and execute at market
    await polymarketAPI.cancelOrder(order.order_id);
    return this.executeImmediate(execution, marketState);
  }
}
```

---

### 5.3 Execution Modes

**1. Manual Approval Mode** (Safest):

```typescript
// User receives notification
const signal = await detectMomentumSignal(market_id);

// Send to user for approval
await sendNotification(user_id, {
  type: 'SIGNAL_DETECTED',
  signal_id: signal.id,
  market_title: signal.market_title,
  recommended_action: 'BUY YES',
  recommended_size: 500,
  expires_in_seconds: 60,
  approve_url: `/api/signals/${signal.id}/approve`
});

// User clicks "Approve" in UI
// Then execution proceeds
```

**2. Semi-Automatic Mode** (Recommended):

```typescript
// User enables auto-execution for specific strategies
await updateStrategySettings(strategy_id, {
  auto_execute: true,
  max_position_size_usd: 500,
  max_daily_trades: 10,
  require_confirmation_if_size_exceeds: 1000
});

// Signals auto-execute within limits
// User gets notified after execution
```

**3. Fully Automatic Mode** (Advanced):

```typescript
// Complete automation with safety limits
const autoExecutionConfig = {
  auto_execute: true,

  // Position limits
  max_position_size_usd: 1000,
  max_portfolio_exposure_pct: 0.30, // Max 30% deployed at once
  max_concurrent_positions: 5,

  // Daily limits
  daily_loss_limit_usd: 500,        // Stop trading if lose $500 in a day
  daily_trade_limit: 20,

  // Quality filters
  min_signal_strength: 'moderate',
  min_liquidity_score: 0.5,
  max_slippage_pct: 0.02,

  // Category filters
  allowed_categories: ['AI', 'Tech'],
  blocked_markets: []
};
```

---

### 5.4 Execution APIs

```
POST /api/trades/execute
Request:
{
  "signal_id": "uuid",
  "execution_mode": "immediate",
  "position_size_usd": 500,
  "stop_loss_price": 0.55,
  "take_profit_price": 0.75,
  "max_slippage_pct": 0.02
}

Response:
{
  "execution_id": "uuid",
  "status": "queued",
  "estimated_execution_time_seconds": 30
}

---

GET /api/trades/queue
Response:
{
  "queued": [
    {
      "execution_id": "uuid",
      "market_title": "Will GPT-5 release in Q1?",
      "side": "YES",
      "usd_value": 500,
      "status": "queued",
      "queued_at": "2025-10-25T14:30:00Z"
    }
  ],
  "executing": [...],
  "completed_recently": [...]
}

---

GET /api/trades/execution/{id}
Response:
{
  "execution_id": "uuid",
  "status": "completed",
  "filled_shares": 500,
  "average_fill_price": 0.6234,
  "total_cost": 311.70,
  "total_fees": 3.12,
  "actual_slippage_pct": 0.87,
  "polymarket_tx_hash": "0x..."
}

---

POST /api/trades/{id}/cancel
→ Cancel a queued or partially filled order

---

POST /api/user/auto-execution/settings
Request:
{
  "auto_execute_enabled": true,
  "max_position_size": 500,
  "daily_limits": {
    "max_trades": 10,
    "max_loss": 500
  }
}
→ Configure auto-execution settings
```

---

## 6. Additional System Components

### 6.1 Market Discovery & Monitoring

**Schema**:

```sql
CREATE TABLE new_markets_feed (
  market_id String PRIMARY KEY,
  created_at DateTime,

  -- Market Details
  title String,
  description String,
  category String,
  closes_at DateTime,

  -- Initial State
  initial_yes_price Decimal(10, 6),
  initial_liquidity Decimal(18, 2),

  -- Discovery Metadata
  discovered_at DateTime,
  time_since_creation_seconds UInt32,

  -- Opportunity Score
  opportunity_score Decimal(10, 6) COMMENT 'Early entry opportunity (0-1)',

  -- Notifications Sent
  user_notifications_sent Array(UUID)
)
ENGINE = MergeTree()
ORDER BY (discovered_at);

-- Expiring markets alert
CREATE MATERIALIZED VIEW expiring_markets_soon AS
SELECT
  market_id,
  title,
  category,
  closes_at,
  now() as check_time,
  dateDiff('hour', now(), closes_at) as hours_until_close
FROM markets
WHERE closes_at > now()
  AND closes_at < now() + INTERVAL 24 HOUR
ORDER BY closes_at ASC;
```

---

### 6.2 Event & News Integration

**Schema**:

```sql
CREATE TABLE news_events (
  event_id UUID PRIMARY KEY,
  event_timestamp DateTime,

  -- Event Details
  event_type Enum8(
    'news_article'=1,
    'announcement'=2,
    'court_ruling'=3,
    'economic_data'=4,
    'earnings'=5,
    'tweet'=6,
    'other'=7
  ),
  headline String,
  summary String,
  source String,
  url String,

  -- Classification
  categories Array(String),
  entities_mentioned Array(String) COMMENT 'OpenAI, Fed, etc.',
  sentiment Enum8('positive'=1, 'negative'=2, 'neutral'=3),
  importance_score Decimal(5, 4),

  -- Market Impact
  related_markets Array(String),
  price_impact_detected Boolean DEFAULT FALSE,

  ingested_at DateTime
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_timestamp)
ORDER BY (event_timestamp);

-- Correlation between news and price movements
CREATE TABLE news_market_correlations (
  market_id String,
  event_id UUID,

  -- Timing
  event_timestamp DateTime,
  price_before Decimal(10, 6),
  price_after_5min Decimal(10, 6),
  price_after_1h Decimal(10, 6),

  -- Impact
  price_change_5min_pct Decimal(10, 4),
  volume_surge_ratio Decimal(10, 4),

  -- Analysis
  correlation_strength Decimal(5, 4),

  PRIMARY KEY (market_id, event_id)
);
```

---

### 6.3 Strategy Sharing & Marketplace

**Schema**:

```sql
CREATE TABLE shared_strategies (
  strategy_id UUID PRIMARY KEY,
  creator_user_id UUID,

  -- Strategy Details
  strategy_name String,
  description String,
  strategy_type Enum8('wallet_copy'=1, 'momentum'=2, 'custom'=3, 'hybrid'=4),

  -- Configuration (JSON)
  strategy_config String COMMENT 'Full strategy definition',

  -- Performance
  backtest_results_id UUID,
  live_performance_30d Decimal(10, 4),
  sharpe_ratio Decimal(10, 4),
  total_subscribers UInt32,

  -- Sharing Settings
  is_public Boolean DEFAULT FALSE,
  requires_subscription Boolean DEFAULT FALSE,
  subscription_price_monthly Nullable(Decimal(18, 2)),

  -- Stats
  total_trades_generated UInt32,
  total_pnl_subscribers Decimal(18, 2),

  created_at DateTime,
  updated_at DateTime
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (strategy_id);

CREATE TABLE strategy_subscriptions (
  subscription_id UUID PRIMARY KEY,
  user_id UUID,
  strategy_id UUID,

  subscribed_at DateTime,
  expires_at Nullable(DateTime),
  is_active Boolean DEFAULT TRUE,

  -- Performance for this user
  trades_executed UInt32,
  total_pnl Decimal(18, 2)
);
```

---

### 6.4 Compliance & Tax Reporting

**Schema**:

```sql
CREATE TABLE tax_lots (
  lot_id UUID PRIMARY KEY,
  user_id UUID,

  -- Purchase
  market_id String,
  purchase_date Date,
  purchase_price Decimal(10, 6),
  shares Decimal(18, 8),
  cost_basis Decimal(18, 2),

  -- Sale (if sold)
  sale_date Nullable(Date),
  sale_price Nullable(Decimal(10, 6)),
  proceeds Nullable(Decimal(18, 2)),

  -- Gain/Loss
  realized_gain_loss Nullable(Decimal(18, 2)),
  holding_period_days Nullable(UInt16),
  is_long_term Nullable(Boolean) COMMENT 'Held > 365 days',

  -- Tax Year
  tax_year UInt16,

  is_closed Boolean DEFAULT FALSE
)
ENGINE = MergeTree()
PARTITION BY (user_id, tax_year)
ORDER BY (user_id, purchase_date);

-- Annual tax summary
CREATE VIEW annual_tax_summary AS
SELECT
  user_id,
  tax_year,

  -- Short-term gains/losses
  sumIf(realized_gain_loss, is_long_term = FALSE) as short_term_gain_loss,
  countIf(is_long_term = FALSE) as short_term_trades,

  -- Long-term gains/losses
  sumIf(realized_gain_loss, is_long_term = TRUE) as long_term_gain_loss,
  countIf(is_long_term = TRUE) as long_term_trades,

  -- Total
  sum(realized_gain_loss) as total_gain_loss,

  -- Wash sales detected (simplified)
  countIf(is_wash_sale = TRUE) as potential_wash_sales

FROM tax_lots
WHERE is_closed = TRUE
GROUP BY user_id, tax_year;
```

---

### 6.5 Multi-Wallet Management

**Schema**:

```sql
CREATE TABLE user_wallets (
  wallet_id UUID PRIMARY KEY,
  user_id UUID,
  wallet_address String UNIQUE,

  -- Wallet Details
  wallet_name String COMMENT 'User-defined name',
  wallet_type Enum8('primary'=1, 'secondary'=2, 'trading'=3, 'test'=4),

  -- Integration
  is_connected Boolean DEFAULT TRUE,
  last_sync_at DateTime,

  -- Balance
  current_balance_usd Decimal(18, 2),

  created_at DateTime
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (user_id, wallet_id);

-- Aggregated multi-wallet portfolio
CREATE VIEW user_aggregated_portfolio AS
SELECT
  user_id,

  -- Total across all wallets
  sum(current_balance_usd) as total_balance,
  count() as wallet_count,

  -- Open positions across wallets
  sumIf(positions_value, is_open = TRUE) as total_positions_value,

  -- P&L across wallets
  sum(total_realized_pnl) as combined_realized_pnl,
  sum(total_unrealized_pnl) as combined_unrealized_pnl

FROM user_wallets w
LEFT JOIN user_portfolio_summary p ON w.wallet_address = p.wallet_address
GROUP BY user_id;
```

---

## Updated Summary

This comprehensive specification now provides:

### Core Analytics (Signal Generation)
1. ✅ Complete schema for all 102 metrics across 4 time windows
2. ✅ Top-down analysis tables (category analytics, Austin Methodology)
3. ✅ Market intelligence (flow metrics, divergence signals)
4. ✅ Wallet intelligence (insider detection, leaderboard tracking)
5. ✅ Market price momentum system (velocity, acceleration, threshold signals)

### Production Trading System (Signal Execution)
6. ✅ **Backtesting & Strategy Validation**
   - Historical simulation engine
   - Trade-by-trade analysis
   - Equity curve tracking
   - Performance comparison
   - Parameter optimization

7. ✅ **User Portfolio Management**
   - Position tracking (open & closed)
   - Real-time P&L monitoring
   - Daily equity snapshots
   - Risk metrics & concentration analysis
   - Portfolio history & performance

8. ✅ **Liquidity & Executability Analysis**
   - Order book depth snapshots
   - Liquidity scoring (0-1 composite)
   - Slippage estimation (market impact model)
   - Signal filtering (skip low liquidity)
   - Max executable size recommendations

9. ✅ **Position Sizing & Kelly Criterion**
   - Kelly formula implementation
   - Risk-adjusted sizing
   - Edge estimation (multiple methods)
   - Risk of ruin calculation
   - Constraint enforcement

10. ✅ **Trade Execution Integration**
    - Execution queue (market/limit/stop orders)
    - Multiple execution strategies (TWAP, patient, immediate)
    - Polymarket API integration
    - Manual/semi-auto/full-auto modes
    - Error handling & retry logic

### Supporting Systems
11. ✅ **Market Discovery & Monitoring**
    - New market feed
    - Expiring markets alerts
    - Opportunity scoring

12. ✅ **Event & News Integration**
    - News ingestion pipeline
    - Price impact correlation
    - Event-driven signals

13. ✅ **Strategy Sharing & Marketplace**
    - Public/private strategy sharing
    - Performance tracking
    - Subscription management

14. ✅ **Compliance & Tax Reporting**
    - Tax lot tracking
    - Short/long-term gain classification
    - Annual tax summaries
    - Wash sale detection

15. ✅ **Multi-Wallet Management**
    - Multiple wallet support
    - Aggregated portfolio views
    - Cross-wallet analytics
2. ✅ Top-down analysis tables (category analytics, Austin Methodology)
3. ✅ Market intelligence (flow metrics, divergence signals)
4. ✅ Wallet intelligence (insider detection, leaderboard tracking)
5. ✅ All formulas for critical metrics (Tier 1-2)
6. ✅ API endpoint specifications for strategy builder
7. ✅ Data pipeline requirements (bulk sync, incremental updates)
8. ✅ Clear implementation priorities (5-week roadmap)
9. ✅ Performance targets (<500ms for complex queries)
10. ✅ All 11 strategy definitions ready to implement
11. ✅ **Market price momentum system** (NEW)
    - High-frequency price history (10-30 second snapshots)
    - Real-time momentum calculations (velocity + acceleration)
    - Threshold-based trading signals (BUY/SELL)
    - WebSocket streaming for live signals
    - User-configurable momentum rules

**Next Steps for Database Architect**:
1. Review and confirm schema design decisions
2. Begin Phase 1 implementation (Tier 1 metrics + core tables)
3. Set up bulk sync pipeline to populate trades_raw
4. **Set up price history collection** (high-frequency snapshots every 10-30 seconds)
5. **Implement momentum calculation pipeline** (velocity, acceleration, signals)
6. Implement metric calculation functions
7. Create materialized views for common queries
8. Build initial API endpoints

**Questions for Claude Code session**:
- Any schema modifications needed?
- Preference for ClickHouse vs Supabase for metrics storage?
- Additional indexes or optimizations?
- Clarification on any metric calculations?

---

**End of Specification**
