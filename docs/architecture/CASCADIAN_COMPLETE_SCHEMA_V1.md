# CASCADIAN Complete Schema Specification v1.1
## Merged Architecture: Analytics + Real-Time Signals + TSI Momentum Strategy

**Date**: 2025-10-25
**Version**: 1.1 (Updated with Austin's TSI Momentum Strategy)
**Status**: Phase 0 Design Complete
**Merges**:
- DATABASE_ARCHITECT_SPEC.md (PRIORITY) - 102-metric analytics
- CASCADIAN_ARCHITECTURE_PLAN_V1.md - Watchlist/real-time approach
- CASCADIAN_MOMENTUM_STRATEGY_ADDENDUM.md - TSI momentum strategy

---

## Executive Summary

This document merges three complementary architectures into a single unified system:

1. **DATABASE_ARCHITECT_SPEC.md** (PRIORITY): Complete 102-metric analytics, Austin Methodology, insider detection
2. **CASCADIAN_ARCHITECTURE_PLAN_V1.md**: Validated watchlist/real-time approach, cost-conscious data sourcing
3. **CASCADIAN_MOMENTUM_STRATEGY_ADDENDUM.md**: True Strength Index (TSI) momentum strategy with directional conviction

### The Complete System

```
┌─────────────────────────────────────────────────────────────────┐
│  TIER 1: DISCOVERY PLATFORM (Analytics Foundation)              │
│  - 102 metrics for 50k+ wallets across 4 time windows           │
│  - Austin Methodology (top-down category analysis)               │
│  - 11 screening strategies with exact formulas                   │
│  - Insider detection & specialization tagging                    │
│  - Leaderboard with rank tracking ("Rising Stars")               │
├─────────────────────────────────────────────────────────────────┤
│  TIER 2: LIVE SIGNALS (Real-Time Intelligence)                  │
│  - TSI momentum strategy (9/21 crossover with RMA smoothing)    │
│  - Directional conviction (elite consensus + category experts)   │
│  - Elite wallet attribution (smart money vs crowd)               │
│  - Watchlist scoping (100 markets, not 20,000)                   │
│  - WebSocket price tracking (10-second snapshots)                │
│  - Configurable smoothing (SMA/EMA/RMA) for experimentation     │
│  - Capital velocity optimization (exit on bearish crossover)     │
└─────────────────────────────────────────────────────────────────┘
```

### Database Architecture

**12 ClickHouse Tables** (time-series analytics):
1. `wallet_metrics_complete` - All 102 metrics × 4 windows
2. `wallet_metrics_by_category` - 102 metrics per category
3. `category_analytics` - Austin Methodology foundation
4. `market_flow_metrics` - Smart money vs crowd divergence
5. `market_price_history` - High-frequency price snapshots
6. `market_price_momentum` - TSI indicators + velocity/acceleration
7. `momentum_trading_signals` - TSI-based ENTRY/EXIT/HOLD signals
8. `price_snapshots_10s` - Live Signals watchlist prices
9. `elite_trade_attributions` - Elite wallet activity tracking
10. `fired_signals` - Signal tracking/analytics
11. `trades_raw` - **Already exists** (raw trade data)
12. ~~`momentum_threshold_rules`~~ - **MOVED TO SUPABASE**

**8 Supabase Tables** (metadata & configuration):
1. `wallet_category_tags` - Insider detection & specialization
2. `wallet_leaderboard_history` - Rank tracking over time
3. `watchlist_markets` - User-selected markets for live tracking
4. `watchlist_wallets` - Elite wallets to monitor
5. `smoothing_configurations` - TSI smoothing config (SMA/EMA/RMA)
6. `user_signal_preferences` - Notification settings
7. `signal_delivery_log` - Tracking sent alerts
8. `momentum_threshold_rules` - User-defined trading rules (moved from ClickHouse)

**5 Materialized Views** (pre-computed queries):
1. `austin_methodology_results` - Top-down category winners
2. `category_winnability_leaderboard` - Best categories ranked
3. `active_divergence_signals` - Elite vs crowd signals
4. `rising_stars_today` - Wallets jumping in rank
5. `latest_market_momentum` - Current velocity/acceleration

---

## Table of Contents

1. [Austin's TSI Momentum Strategy](#austins-tsi-momentum-strategy)
2. [ClickHouse Tables](#clickhouse-tables)
3. [Supabase Tables](#supabase-tables)
4. [Materialized Views](#materialized-views)
5. [102 Metrics Complete Definitions](#102-metrics-definitions)
6. [11 Screening Strategies](#11-screening-strategies)
7. [TSI Implementation Services](#tsi-implementation-services)
8. [Data Pipelines](#data-pipelines)
9. [API Endpoints](#api-endpoints)
10. [Implementation Phases](#implementation-phases)

---

## Austin's TSI Momentum Strategy

### Overview

Austin's momentum trading strategy replaces simple velocity-based signals with a sophisticated True Strength Index (TSI) approach combined with directional conviction scoring.

**Key Components**:
1. **TSI (True Strength Index)**: 9-period fast line crossed with 21-period slow line
2. **Configurable Smoothing**: SMA, EMA, or RMA (Wilder's) - runtime switchable, NOT hardcoded
3. **Directional Conviction**: Elite wallet consensus + category specialists + omega weighting
4. **Exit on Crossover**: Bearish crossover triggers exit (capital velocity optimization)

### Why TSI Over Simple Velocity?

**Problem with Simple Velocity**:
- Low liquidity: Single $1k bet can spike price 5%
- Choppy markets: Price oscillates without trend
- False signals: "One wallet could screw our whole position"

**TSI Solution**:
- Double smoothing filters noise
- Crossover detection confirms trend
- Configurable periods (9/21 default, tunable)
- Works better in low-liquidity prediction markets

### TSI Formula

```
Price Change = Close - Previous Close
Double Smoothed PC = Smooth(Smooth(Price Change, slow_periods), fast_periods)
Double Smoothed Abs PC = Smooth(Smooth(Abs(Price Change), slow_periods), fast_periods)
TSI = 100 * (Double Smoothed PC / Double Smoothed Abs PC)
```

Where `Smooth()` is configurable: SMA, EMA, or RMA.

### Smoothing Methods (All Configurable)

**1. Simple Moving Average (SMA)**
```
SMA(n) = (P1 + P2 + ... + Pn) / n
```
- Equal weight to all periods
- Easy to understand
- More lag than EMA/RMA

**2. Exponential Moving Average (EMA)**
```
EMA(t) = α * P(t) + (1 - α) * EMA(t-1)
where α = 2 / (n + 1)
```
- More responsive to recent prices
- Industry standard for most indicators

**3. Running Moving Average (RMA) - Austin's Preference**
```
RMA(t) = (RMA(t-1) * (n - 1) + P(t)) / n
```
- Smoothest option (Wilder's smoothing)
- Best for low-liquidity markets
- Reduces false signals in choppy conditions

**CRITICAL**: All three are runtime-configurable via `smoothing_configurations` table. No hardcoding.

### Directional Conviction Score

**Formula**:
```typescript
directional_conviction = (
  elite_consensus_pct * 0.5 +        // 50%: % of elite wallets aligned
  category_specialist_pct * 0.3 +     // 30%: Category experts aligned
  omega_weighted_consensus * 0.2      // 20%: Omega-weighted agreement
)
```

**Entry Threshold**: `conviction >= 0.9` (Austin's "90% confident")

**Components**:
1. **Elite Consensus**: Of elite wallets (Omega>2.0) in this market, what % are on YES vs NO?
2. **Category Specialist**: Are the top omega traders in this category aligned?
3. **Omega-Weighted**: Higher omega wallets get more weight in consensus

### Signal Types

**ENTRY Signal**:
- Condition: `tsi_fast crosses above tsi_slow` AND `conviction >= 0.9`
- Direction: Follow elite consensus (YES or NO)
- Strength: Based on conviction score (0.9-0.95 = STRONG, >0.95 = VERY_STRONG)

**EXIT Signal**:
- Condition: `tsi_fast crosses below tsi_slow` (bearish crossover)
- Reason: Momentum reversal detected
- Timing: Exit BEFORE elite wallets (capital velocity optimization)
- **NOT**: Following elite wallet exits (they hold until resolution)

**HOLD Signal**:
- No crossover detected, or conviction below threshold
- Monitor but don't act

### Capital Velocity Advantage

**Elite Wallet Strategy**:
- Enter early, hold until resolution
- Locks capital for days/weeks
- Lower capital velocity

**Our Strategy (Austin's Insight)**:
- Exit on TSI bearish crossover
- Free up capital for next trade
- Higher capital velocity = more trades/month
- **Key**: Exit BEFORE elite wallets, not following them

### Open Questions for Austin

Before finalization, need clarity on:

1. **TSI Periods**: Confirm 9/21 periods optimal for Polymarket?
   - Traditional stock TSI: 25/13
   - Crypto: Often 20/8
   - Low liquidity prediction markets may need different tuning

2. **Exit Strategy**:
   - Exit ONLY on TSI bearish crossover?
   - Or also time-based (e.g., exit after 48h)?
   - Or also profit-target based (e.g., exit at 20% gain)?

3. **Conviction Threshold**:
   - 0.9 threshold for overall `directional_conviction` score?
   - Or 0.9 threshold for `elite_consensus_pct` alone?

4. **Multi-Market Signals**:
   - Phase 2: Include "basket" signals (e.g., "5 AI markets all bullish")?
   - Or focus on single-market signals first?

5. **Snapshot Frequency**:
   - 10-second snapshots adequate for 21-period slow line (3.5 min history)?
   - Or need faster snapshots (5-second)?

---

## ClickHouse Tables

### 1. wallet_metrics_complete

**Purpose**: Store all 102 metrics for each wallet across 4 time windows

**Priority**: CRITICAL (Phase 0 - Week 1)

**Schema**:

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
  raw_data_hash String COMMENT 'For cache invalidation',

  -- ============================================================
  -- BASE SCREENERS (#1-24) - 30 IMPLEMENTED IN PHASE 1
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
  metric_25_brier_score Decimal(10, 6) COMMENT 'Mean((p_hat - outcome)²) - lower better - TIER 2',
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
  -- LATENCY-ADJUSTED METRICS (#48-55) - CRITICAL FOR COPYABILITY
  -- ============================================================

  -- Copyability Analysis (#48-53) - TIER 1
  metric_48_omega_lag_30s Decimal(12, 4) COMMENT 'Omega if copied with 30s delay - TIER 1 CRITICAL',
  metric_49_omega_lag_2min Decimal(12, 4) COMMENT 'Omega if copied with 2min delay - TIER 1',
  metric_50_omega_lag_5min Decimal(12, 4) COMMENT 'Omega if copied with 5min delay - TIER 1',
  metric_51_clv_lag_30s Decimal(10, 6) COMMENT 'CLV using price 30s after entry',
  metric_52_clv_lag_2min Decimal(10, 6) COMMENT 'CLV using price 2min after entry',
  metric_53_clv_lag_5min Decimal(10, 6) COMMENT 'CLV using price 5min after entry',

  -- Edge Durability (#54-55) - TIER 2
  metric_54_edge_half_life_hours Decimal(12, 2) COMMENT 'Hours until edge decays 50% - TIER 2',
  metric_55_latency_penalty_index Decimal(10, 6) COMMENT '1 - (omega_lag_5min / omega_net) - TIER 2',

  -- ============================================================
  -- MOMENTUM & TRENDS (#56-88) - PHASE 2-3
  -- ============================================================

  -- Performance Trends (#56-59) - TIER 1
  metric_56_omega_momentum_30d Decimal(12, 6) COMMENT 'Theil-Sen slope of omega over 30d - TIER 1',
  metric_57_omega_momentum_90d Decimal(12, 6) COMMENT 'Theil-Sen slope of omega over 90d',
  metric_58_pnl_trend_30d Decimal(18, 6) COMMENT 'Slope of cumulative P&L ($/day)',
  metric_59_pnl_acceleration Decimal(18, 6) COMMENT 'Second derivative of P&L trend',

  -- Return Distribution Shape (#60-62) - TIER 1 (#60 CRITICAL)
  metric_60_tail_ratio Decimal(10, 4) COMMENT 'Avg(top 10% wins) / Avg(bottom 10% losses) - TIER 1 CRITICAL',
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

  -- Recent Momentum Indicators (#82-86) - TIER 1 (#85, #86 CRITICAL)
  metric_82_clv_momentum_30d Decimal(12, 6) COMMENT 'Slope of CLV over last 30 days',
  metric_83_ev_hr_momentum_30d Decimal(18, 8) COMMENT 'Slope of EV/hr metric',
  metric_84_drawdown_trend_60d Decimal(12, 6) COMMENT 'Slope of drawdown depth',
  metric_85_performance_trend_flag Enum8('improving'=1, 'declining'=2, 'stable'=3) COMMENT 'Composite trend - TIER 1 CRITICAL',
  metric_86_hot_hand_z_score Decimal(10, 4) COMMENT 'Z-score of recent win streak',

  -- Discipline Metrics (#87-88) - TIER 1 (#88 CRITICAL)
  metric_87_bet_frequency_variance Decimal(12, 6) COMMENT 'Variance in bets per week',
  metric_88_sizing_discipline_trend Decimal(12, 6) COMMENT 'Trend in sizing volatility - TIER 1 CRITICAL',

  -- ============================================================
  -- PER-CATEGORY METRICS (#89-92) - STORED AS JSON
  -- ============================================================

  metric_89_clv_by_category_json String COMMENT 'JSON: {"AI": 0.08, "Sports": -0.01} - TIER 2',
  metric_90_omega_lag_by_category_json String COMMENT 'JSON: {"AI": {"2min": 4.5}}',
  metric_91_calibration_by_category_json String COMMENT 'JSON: {"AI": 0.05, "Sports": 0.22} - TIER 2',
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
  metric_102_edge_source_decomp_json String COMMENT 'JSON: breakdown of where edge comes from - TIER 3'
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

CREATE INDEX idx_resolved_bets ON wallet_metrics_complete(metric_22_resolved_bets)
  TYPE minmax GRANULARITY 4;
```

**Estimated Size**: 6,605 wallets × 4 windows × 102 metrics = ~2.7M cells
**Storage**: ~500 MB (with compression)
**Query Performance**: <100ms for single wallet lookup, <500ms for complex filters

---

### 2. wallet_metrics_by_category

**Purpose**: Store all 102 metrics broken down by category for each wallet

**Priority**: HIGH (Phase 1)

**Schema**:

```sql
CREATE TABLE wallet_metrics_by_category (
  wallet_address String,
  category String,
  window Enum8('30d' = 1, '90d' = 2, '180d' = 3, 'lifetime' = 4),

  calculated_at DateTime,

  -- All 102 metrics (same schema as wallet_metrics_complete)
  -- ... (repeat all metric columns from above)

  metric_1_omega_gross Decimal(12, 4),
  metric_2_omega_net Decimal(12, 4),
  -- ... (all 102 metrics)

  -- Additional category context
  trades_in_category UInt32,
  pct_of_total_trades Decimal(5, 4) COMMENT 'What % of wallet trades are in this category',
  pct_of_total_volume Decimal(5, 4) COMMENT 'What % of wallet volume is in this category',
  is_primary_category Boolean COMMENT 'TRUE if most trades are in this category',
  category_rank UInt16 COMMENT 'Rank within this category (1=best)',

  raw_data_hash String
)
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY (category, window)
ORDER BY (wallet_address, category, window)
SETTINGS index_granularity = 8192;

-- Indexes
CREATE INDEX idx_category_omega ON wallet_metrics_by_category(category, metric_2_omega_net)
  TYPE minmax GRANULARITY 4;

CREATE INDEX idx_primary_category ON wallet_metrics_by_category(is_primary_category)
  TYPE set(0) GRANULARITY 1
  WHERE is_primary_category = TRUE;
```

**Use Cases**:
- Find specialists: "Who are the top 10 AI traders?"
- Austin Methodology: "What's the median Omega for elite AI traders?"
- Strategy 3 ("Eggman Hunter"): Category-specific screening

---

### 3. category_analytics

**Purpose**: Aggregate metrics at the category level to identify "winnable games"

**Priority**: CRITICAL (Phase 1)

**Schema**:

```sql
CREATE TABLE category_analytics (
  category String,
  window Enum8('24h' = 1, '7d' = 2, '30d' = 3, 'lifetime' = 4),

  -- WINNABILITY METRICS (Austin Methodology Core)
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

-- Index for quick category lookups
CREATE INDEX idx_winnability ON category_analytics(median_omega_of_elites)
  TYPE minmax GRANULARITY 4;
```

**Use Cases**:
- Austin Methodology: "Find the most winnable categories"
- Strategy comparison: "Is AI or Sports easier to beat?"
- Portfolio allocation: "Where should I focus my attention?"

---

### 4. market_flow_metrics

**Purpose**: Track "smart money" vs "crowd money" divergence for real-time signals

**Priority**: HIGH (Phase 2)

**Schema**:

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

-- Index for recent signals
CREATE INDEX idx_recent_signals ON market_flow_metrics(timestamp)
  TYPE minmax GRANULARITY 4;
```

**Update Frequency**: Every 5 minutes
**Retention**: 30 days rolling window
**Use Cases**:
- Real-time signals: "Elite wallets betting YES, crowd betting NO"
- Historical analysis: "How often was the divergence signal correct?"

---

### 5. market_price_history

**Purpose**: High-frequency price snapshots for lag simulation and momentum detection

**Priority**: MEDIUM (Phase 2)

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

-- Indexes
CREATE INDEX idx_recent_prices ON market_price_history(timestamp)
  TYPE minmax GRANULARITY 4;

CREATE INDEX idx_market_recent ON market_price_history(market_id, timestamp)
  TYPE minmax GRANULARITY 4;
```

**Data Collection Frequency**:
- Real-time markets (active trading): Every 10-30 seconds
- Moderate activity markets: Every 1 minute
- Low activity markets: Every 5 minutes

**Retention Policy**:
- Last 24 hours: 10-second granularity
- Last 7 days: 1-minute granularity
- Last 30 days: 5-minute granularity
- Last 90 days: 15-minute granularity
- Beyond 90 days: Hourly snapshots only

**Use Cases**:
- Lag simulation: "What would Omega be if I copied with 30s delay?"
- CLV calculation: "What was the closing price before resolution?"
- Momentum detection: "Is price accelerating?"

---

### 6. market_price_momentum

**Purpose**: Pre-calculate momentum derivatives (velocity and acceleration) for instant threshold detection

**Priority**: HIGH (Phase 2)

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

  -- Price Changes (Percentage)
  price_change_pct_10s Decimal(10, 4) COMMENT '% change in 10s',
  price_change_pct_1min Decimal(10, 4),
  price_change_pct_5min Decimal(10, 4),

  -- MOMENTUM METRICS (Velocity)
  velocity_10s Decimal(12, 8) COMMENT 'Price change per second (10s window)',
  velocity_1min Decimal(12, 8) COMMENT 'Price change per second (1min window)',
  velocity_5min Decimal(12, 8) COMMENT 'Price change per second (5min window)',

  -- MOMENTUM METRICS (Acceleration)
  acceleration_30s Decimal(12, 8) COMMENT 'Change in velocity (30s window)',
  acceleration_1min Decimal(12, 8) COMMENT 'Change in velocity (1min window)',

  -- Direction
  direction_1min Enum8('up'=1, 'down'=2, 'flat'=3),
  direction_5min Enum8('up'=1, 'down'=2, 'flat'=3),

  -- Trend Strength
  trend_strength_1min Decimal(10, 6) COMMENT 'Correlation coefficient of price over time',
  trend_strength_5min Decimal(10, 6),

  -- Volatility
  volatility_1min Decimal(10, 6) COMMENT 'Stddev of price changes in 1min',

  -- Context
  current_volume_1min Decimal(18, 2),
  volume_surge_ratio Decimal(10, 4) COMMENT 'current_volume / avg_volume',

  -- TSI INDICATORS (Austin's Momentum Strategy)
  tsi_fast Decimal(12, 8) DEFAULT NULL COMMENT 'Fast TSI line (9-period default)',
  tsi_fast_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) DEFAULT 'RMA' COMMENT 'Smoothing method for fast line',
  tsi_fast_periods UInt8 DEFAULT 9 COMMENT 'Periods for fast TSI line',

  tsi_slow Decimal(12, 8) DEFAULT NULL COMMENT 'Slow TSI line (21-period default)',
  tsi_slow_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) DEFAULT 'RMA' COMMENT 'Smoothing method for slow line',
  tsi_slow_periods UInt8 DEFAULT 21 COMMENT 'Periods for slow TSI line',

  -- Crossover Detection
  crossover_signal Enum8('BULLISH'=1, 'BEARISH'=2, 'NEUTRAL'=3) DEFAULT 'NEUTRAL' COMMENT 'Current crossover state',
  crossover_timestamp DateTime64(3) DEFAULT NULL COMMENT 'When crossover occurred',

  -- Price Smoothing (optional noise reduction)
  price_smoothed Decimal(10, 6) DEFAULT NULL COMMENT 'Smoothed mid price',
  price_smoothing_method Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) DEFAULT 'RMA' COMMENT 'Method used for price smoothing',
  price_smoothing_periods UInt8 DEFAULT 3 COMMENT 'Periods for price smoothing',

  -- Metadata
  momentum_calculation_version String DEFAULT 'v1_tsi' COMMENT 'Algorithm version (for A/B testing)',

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

-- Indexes for TSI queries
CREATE INDEX idx_crossover ON market_price_momentum(market_id, crossover_signal, crossover_timestamp)
  TYPE minmax GRANULARITY 1;
```

**Calculation Formulas**:
```sql
-- Velocity (price change per second)
velocity_1min = (current_price - price_60s_ago) / 60

-- Acceleration (change in velocity per second)
acceleration_1min = (velocity_now - velocity_60s_ago) / 60

-- Trend Strength (R² of linear regression)
trend_strength_1min = correlation(price, time)²

-- Volume Surge Ratio
volume_surge_ratio = volume_1min / avg(volume_1min over last 1 hour)
```

**Update Frequency**: Every 30 seconds
**Use Cases**:
- Threshold alerts: "Alert me when velocity > 0.001"
- Momentum trading: "BUY when accelerating, SELL when decelerating"

---

### 7. momentum_trading_signals

**Purpose**: Store TSI-based trading signals (ENTRY/EXIT/HOLD) with directional conviction

**Priority**: HIGH (Phase 2 - Austin's Strategy)

**Schema**:

```sql
CREATE TABLE momentum_trading_signals (
  -- Identity
  signal_id String DEFAULT generateUUIDv4() COMMENT 'Unique signal identifier',
  market_id String NOT NULL COMMENT 'Market this signal is for',
  signal_timestamp DateTime64(3) DEFAULT now64() COMMENT 'When signal was generated',

  -- Signal Type (Austin's Strategy: ENTRY/EXIT/HOLD)
  signal_type Enum8('ENTRY'=1, 'EXIT'=2, 'HOLD'=3) NOT NULL COMMENT 'Entry, exit, or hold',
  signal_direction Enum8('YES'=1, 'NO'=2) DEFAULT NULL COMMENT 'Direction for entry signals',

  -- TSI Context
  tsi_fast Decimal(12, 8) NOT NULL COMMENT 'TSI fast line value at signal',
  tsi_slow Decimal(12, 8) NOT NULL COMMENT 'TSI slow line value at signal',
  crossover_type Enum8('BULLISH'=1, 'BEARISH'=2) DEFAULT NULL COMMENT 'Type of crossover that triggered',
  tsi_fast_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) NOT NULL COMMENT 'Smoothing method used',
  tsi_slow_smoothing Enum8('SMA'=1, 'EMA'=2, 'RMA'=3) NOT NULL COMMENT 'Smoothing method used',

  -- Directional Conviction (Austin's "90% confident")
  directional_conviction Decimal(5, 4) NOT NULL COMMENT 'Conviction score (0-1)',
  elite_consensus_pct Decimal(5, 4) NOT NULL COMMENT 'Elite wallet agreement %',
  category_specialist_pct Decimal(5, 4) DEFAULT NULL COMMENT 'Category specialist agreement %',
  omega_weighted_consensus Decimal(5, 4) DEFAULT NULL COMMENT 'Omega-weighted agreement',

  -- Elite Attribution
  elite_wallets_yes UInt16 DEFAULT 0 COMMENT 'Count of elite wallets on YES',
  elite_wallets_no UInt16 DEFAULT 0 COMMENT 'Count of elite wallets on NO',
  elite_wallets_total UInt16 DEFAULT 0 COMMENT 'Total elite wallets in market',

  -- Market Context
  mid_price Decimal(10, 6) NOT NULL COMMENT 'Mid price at signal time',
  volume_24h Decimal(18, 2) DEFAULT NULL COMMENT '24h volume at signal',
  liquidity_depth Decimal(18, 2) DEFAULT NULL COMMENT 'Total order book depth',

  -- Signal Metadata
  signal_strength Enum8('WEAK'=1, 'MODERATE'=2, 'STRONG'=3, 'VERY_STRONG'=4) NOT NULL COMMENT 'Signal quality',
  confidence_score Decimal(5, 4) NOT NULL COMMENT 'Overall confidence (0-1)',
  meets_entry_threshold Boolean DEFAULT 0 COMMENT 'conviction >= 0.9',

  -- Version Tracking (for A/B testing different smoothing methods)
  calculation_version String DEFAULT 'v1_tsi_austin' COMMENT 'Algorithm version',
  created_at DateTime64(3) DEFAULT now64() COMMENT 'Record creation time'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(signal_timestamp)
ORDER BY (market_id, signal_timestamp, signal_type)
SETTINGS index_granularity = 8192;

-- Indexes
CREATE INDEX idx_entry_signals ON momentum_trading_signals(signal_type, meets_entry_threshold, signal_timestamp)
  TYPE minmax GRANULARITY 1;

CREATE INDEX idx_market_signals ON momentum_trading_signals(market_id, signal_timestamp)
  TYPE minmax GRANULARITY 1;
```

**Use Cases**:
- TSI-based trading: "ENTRY when bullish crossover + 90% conviction"
- Exit optimization: "EXIT on bearish crossover (capital velocity)"
- Backtesting: "Compare RMA vs EMA smoothing performance"
- Signal quality: "What % of STRONG signals were profitable?"

---

### 8. price_snapshots_10s

**Purpose**: Real-time price snapshots for watchlist markets (Live Signals tier)

**Priority**: HIGH (Phase 2)

**Schema**:

```sql
CREATE TABLE price_snapshots_10s (
  market_id String,
  timestamp DateTime64(3),
  side Enum8('YES'=1, 'NO'=2),

  mid_price Decimal(10, 6),
  best_bid Decimal(10, 6),
  best_ask Decimal(10, 6),
  spread_bps UInt16,
  bid_volume Decimal(18, 2),
  ask_volume Decimal(18, 2),

  snapshot_source Enum8('websocket'=1, 'api'=2, 'mirror'=3) DEFAULT 'websocket',
  created_at DateTime64(3) DEFAULT now64()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, side, timestamp)
SETTINGS index_granularity = 8192;

-- Index for fast time-range queries
CREATE INDEX idx_market_time ON price_snapshots_10s(market_id, timestamp)
  TYPE minmax GRANULARITY 4;
```

**Scope**: Watchlist markets only (~100 markets)
**Storage**: 100 markets × 8,640 snapshots/day = 864k rows/day ≈ 2 GB/month
**Data Source**: Polymarket WebSocket (FREE)
**Retention**: 30 days

---

### 9. elite_trade_attributions

**Purpose**: Track elite wallet activity in watchlist markets

**Priority**: HIGH (Phase 2)

**Schema**:

```sql
CREATE TABLE elite_trade_attributions (
  trade_id String,
  market_id String,
  wallet_address String,
  side Enum8('BUY'=1, 'SELL'=2),
  size_usd Decimal(18, 2),

  is_elite Boolean,
  elite_omega_score Nullable(Decimal(10, 4)),

  timestamp DateTime,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (market_id, timestamp, wallet_address)
SETTINGS index_granularity = 8192;

-- Index for elite wallet lookups
CREATE INDEX idx_elite_wallets ON elite_trade_attributions(wallet_address, timestamp)
  TYPE minmax GRANULARITY 4
  WHERE is_elite = TRUE;
```

**Data Source**: Goldsky API polling (60s) or Mirror (3-5s)
**Use Cases**:
- Attribution: "Which elite wallet just triggered this momentum?"
- Copytrading: "Follow trades from wallets with Omega > 3.0"

---

### 10. fired_signals

**Purpose**: Track all signals fired for analytics and optimization

**Priority**: MEDIUM (Phase 2)

**Schema**:

```sql
CREATE TABLE fired_signals (
  signal_id UUID DEFAULT generateUUIDv4(),
  market_id String,
  market_slug String,
  signal_type Enum8('ELITE_MOMENTUM'=1, 'MOMENTUM_ONLY'=2),

  momentum_velocity Decimal(12, 8),
  momentum_acceleration Decimal(12, 8),

  elite_wallet_address Nullable(String),
  elite_omega_score Nullable(Decimal(10, 4)),
  elite_side Nullable(Enum8('BUY'=1, 'SELL'=2)),

  confidence Enum8('LOW'=1, 'MEDIUM'=2, 'HIGH'=3),
  entry_window String,
  price_at_signal Decimal(10, 6),
  timestamp DateTime DEFAULT now(),

  -- Track outcomes
  user_action Nullable(Enum8('IGNORED'=1, 'VIEWED'=2, 'TRADED'=3)),
  user_entry_price Nullable(Decimal(10, 6)),
  user_entry_time Nullable(DateTime),
  signal_pnl Nullable(Decimal(18, 2))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, market_id)
SETTINGS index_granularity = 8192;
```

**Use Cases**:
- Signal quality analysis: "What % of HIGH confidence signals were profitable?"
- Optimization: "Should we adjust thresholds?"

---

### 11. trades_raw

**Status**: Already exists
**Purpose**: Raw trade data from Goldsky
**No changes needed**

---

## Supabase Tables

### 1. wallet_category_tags

**Purpose**: Tag wallets with specializations and detect insider patterns

**Priority**: HIGH (Phase 1)

**Schema**:

```sql
CREATE TABLE wallet_category_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  category TEXT NOT NULL,

  -- Specialization Metrics
  category_omega DECIMAL(12, 4),
  category_win_rate DECIMAL(5, 4),
  trades_in_category INT,
  pct_of_wallet_trades DECIMAL(5, 4),
  pct_of_wallet_volume DECIMAL(5, 4),

  -- Percentile Rankings
  omega_percentile DECIMAL(5, 4) CHECK (omega_percentile >= 0 AND omega_percentile <= 1),
  clv_percentile DECIMAL(5, 4),
  ev_per_hour_percentile DECIMAL(5, 4),
  overall_rank_in_category INT,

  -- Pattern Detection
  is_likely_specialist BOOLEAN DEFAULT FALSE,
  is_likely_insider BOOLEAN DEFAULT FALSE,
  insider_confidence_score DECIMAL(5, 4) DEFAULT 0 CHECK (insider_confidence_score >= 0 AND insider_confidence_score <= 1),

  -- Sub-Category Drilling
  subcategory_win_rates JSONB COMMENT 'e.g., {"openai_releases": 0.95, "anthropic": 0.20}',
  subcategory_bet_counts JSONB,
  consecutive_wins_in_subcategory INT,
  win_rate_vs_category_avg DECIMAL(10, 4),
  timing_pattern_score DECIMAL(10, 6),

  -- Tags
  primary_tag TEXT,
  secondary_tags TEXT[],

  -- Metadata
  first_trade_in_category TIMESTAMPTZ,
  last_trade_in_category TIMESTAMPTZ,
  last_analyzed TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(wallet_address, category)
);

-- Indexes
CREATE INDEX idx_wallet_category_tags_insider ON wallet_category_tags(category, insider_confidence_score DESC)
  WHERE is_likely_insider = TRUE;

CREATE INDEX idx_wallet_category_tags_specialist ON wallet_category_tags(wallet_address)
  WHERE is_likely_specialist = TRUE;

CREATE INDEX idx_wallet_category_tags_category ON wallet_category_tags(category, category_omega DESC);

-- Updated trigger
CREATE OR REPLACE FUNCTION update_wallet_category_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_wallet_category_tags_updated_at
  BEFORE UPDATE ON wallet_category_tags
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_category_tags_updated_at();

-- Comments
COMMENT ON TABLE wallet_category_tags IS 'Wallet specialization and insider detection';
COMMENT ON COLUMN wallet_category_tags.insider_confidence_score IS '0-1 confidence that wallet has inside information';
COMMENT ON COLUMN wallet_category_tags.subcategory_win_rates IS 'Win rates broken down by subcategory (for insider detection)';
```

**Use Cases**:
- Insider detection: "Find wallets with >90% win rate in specific subcategories"
- Specialization: "Who are the AI specialists?"
- Following: "Alert me when an AI insider makes a trade"

---

### 2. wallet_leaderboard_history

**Purpose**: Track wallet rank changes over time (relative strength indicator)

**Priority**: HIGH (Phase 1)

**Schema**:

```sql
CREATE TABLE wallet_leaderboard_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  snapshot_date DATE NOT NULL,

  -- Overall Rankings
  overall_rank INT,
  overall_rank_prev_day INT,
  overall_rank_7d_ago INT,
  overall_rank_30d_ago INT,

  -- Rank Changes (CRITICAL for "Rising Star" strategy)
  rank_change_1d INT,
  rank_change_7d INT COMMENT 'Jumped 15 spots = hot wallet',
  rank_change_30d INT,

  -- Context
  omega_ratio DECIMAL(12, 4),
  omega_ratio_prev_day DECIMAL(12, 4),
  total_pnl DECIMAL(18, 2),
  resolved_bets INT,

  -- Category-Specific Rankings
  category_ranks JSONB COMMENT '{"AI": 5, "Tech": 12, "Sports": 450}',
  category_rank_changes_7d JSONB COMMENT '{"AI": 3, "Tech": -2}',

  -- Movement Classification
  movement_type TEXT CHECK (movement_type IN ('rocketing', 'rising', 'stable', 'declining', 'falling')),
  momentum_score DECIMAL(10, 6),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(wallet_address, snapshot_date)
);

-- Indexes
CREATE INDEX idx_wallet_leaderboard_history_date ON wallet_leaderboard_history(snapshot_date DESC);
CREATE INDEX idx_wallet_leaderboard_history_wallet ON wallet_leaderboard_history(wallet_address, snapshot_date DESC);
CREATE INDEX idx_wallet_leaderboard_history_rank_change ON wallet_leaderboard_history(rank_change_7d DESC)
  WHERE rank_change_7d > 10;

-- Partition by month for performance
CREATE INDEX idx_wallet_leaderboard_history_partition ON wallet_leaderboard_history(snapshot_date);

COMMENT ON TABLE wallet_leaderboard_history IS 'Daily snapshots of wallet rankings for tracking momentum';
COMMENT ON COLUMN wallet_leaderboard_history.rank_change_7d IS 'KEY: Positive = moved up in rankings';
```

**Use Cases**:
- Rising Stars strategy: "Find wallets that jumped >10 spots in 7 days"
- Performance tracking: "Is my followed wallet improving or declining?"

---

### 3. watchlist_markets

**Purpose**: User-selected markets for live tracking (Phase 2)

**Priority**: MEDIUM (Phase 2)

**Schema**:

```sql
CREATE TABLE watchlist_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL,
  market_slug TEXT,
  condition_id TEXT,
  category TEXT,
  question TEXT,

  -- How it was added
  added_by_user_id UUID REFERENCES auth.users(id),
  auto_added BOOLEAN DEFAULT FALSE,
  auto_added_reason TEXT,

  -- Priority
  priority INT DEFAULT 0 COMMENT 'Higher = more important',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(market_id)
);

CREATE INDEX idx_watchlist_markets_priority ON watchlist_markets(priority DESC, created_at DESC);
CREATE INDEX idx_watchlist_markets_category ON watchlist_markets(category) WHERE category IS NOT NULL;

-- Updated trigger
CREATE OR REPLACE FUNCTION update_watchlist_markets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_watchlist_markets_updated_at
  BEFORE UPDATE ON watchlist_markets
  FOR EACH ROW
  EXECUTE FUNCTION update_watchlist_markets_updated_at();
```

---

### 4. watchlist_wallets

**Purpose**: Elite wallets to monitor for Live Signals

**Priority**: MEDIUM (Phase 2)

**Schema**:

```sql
CREATE TABLE watchlist_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,

  -- Cached metrics
  omega_score DECIMAL(10, 4),
  win_rate DECIMAL(5, 4),
  closed_positions INT,
  category TEXT,
  grade TEXT,

  -- How added
  added_by_user_id UUID REFERENCES auth.users(id),
  auto_added BOOLEAN DEFAULT FALSE,
  auto_added_reason TEXT,

  -- Tracking
  last_trade_detected_at TIMESTAMPTZ,
  total_signals_generated INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(wallet_address)
);

CREATE INDEX idx_watchlist_wallets_score ON watchlist_wallets(omega_score DESC NULLS LAST);
CREATE INDEX idx_watchlist_wallets_category ON watchlist_wallets(category) WHERE category IS NOT NULL;

-- Updated trigger
CREATE OR REPLACE FUNCTION update_watchlist_wallets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_watchlist_wallets_updated_at
  BEFORE UPDATE ON watchlist_wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_watchlist_wallets_updated_at();
```

---

### 5. smoothing_configurations

**Purpose**: Runtime configuration for TSI smoothing methods (SMA/EMA/RMA)

**Priority**: HIGH (Phase 2 - Austin's Strategy)

**Schema**:

```sql
CREATE TABLE smoothing_configurations (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_name TEXT NOT NULL UNIQUE,

  -- TSI Settings
  tsi_fast_periods INTEGER DEFAULT 9 CHECK (tsi_fast_periods >= 2),
  tsi_fast_smoothing TEXT DEFAULT 'RMA' CHECK (tsi_fast_smoothing IN ('SMA', 'EMA', 'RMA')),

  tsi_slow_periods INTEGER DEFAULT 21 CHECK (tsi_slow_periods >= 2),
  tsi_slow_smoothing TEXT DEFAULT 'RMA' CHECK (tsi_slow_smoothing IN ('SMA', 'EMA', 'RMA')),

  -- Price Smoothing (optional noise reduction)
  price_smoothing_enabled BOOLEAN DEFAULT TRUE,
  price_smoothing_method TEXT DEFAULT 'RMA' CHECK (price_smoothing_method IN ('SMA', 'EMA', 'RMA')),
  price_smoothing_periods INTEGER DEFAULT 3 CHECK (price_smoothing_periods >= 1),

  -- Conviction Thresholds
  entry_conviction_threshold DECIMAL(5, 4) DEFAULT 0.90 CHECK (entry_conviction_threshold BETWEEN 0 AND 1),
  exit_on_crossover BOOLEAN DEFAULT TRUE,

  -- Metadata
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Only one active config at a time
CREATE UNIQUE INDEX idx_active_config ON smoothing_configurations(is_active) WHERE is_active = TRUE;

-- Updated trigger
CREATE OR REPLACE FUNCTION update_smoothing_configurations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_smoothing_configurations_updated_at
  BEFORE UPDATE ON smoothing_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_smoothing_configurations_updated_at();

-- Default configuration (Austin's RMA preference)
INSERT INTO smoothing_configurations (config_name, is_active)
VALUES ('austin_default', TRUE)
ON CONFLICT (config_name) DO NOTHING;

COMMENT ON TABLE smoothing_configurations IS 'Runtime configuration for TSI smoothing - allows switching SMA/EMA/RMA without code changes';
COMMENT ON COLUMN smoothing_configurations.tsi_fast_smoothing IS 'Smoothing method for fast line (9-period default)';
COMMENT ON COLUMN smoothing_configurations.tsi_slow_smoothing IS 'Smoothing method for slow line (21-period default)';
COMMENT ON COLUMN smoothing_configurations.entry_conviction_threshold IS 'Austin''s "90% confident" threshold';
```

**Use Cases**:
- **Experimentation**: Switch from RMA to EMA via UI without code changes
- **A/B Testing**: Create multiple configs, compare performance
- **Backtesting**: "Did SMA outperform RMA for this market category?"
- **User Customization**: Different users can have different smoothing preferences

---

### 6. momentum_threshold_rules

**Purpose**: User-defined threshold rules for momentum trading

**Priority**: MEDIUM (Phase 2)

**Schema**:

```sql
CREATE TABLE momentum_threshold_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  rule_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,

  -- Market Filters
  category_filter TEXT[],
  market_ids TEXT[],
  min_liquidity DECIMAL(18, 2),

  -- BUY Signal Conditions
  buy_velocity_threshold DECIMAL(12, 8),
  buy_acceleration_threshold DECIMAL(12, 8),
  buy_price_change_pct_threshold DECIMAL(10, 4),
  buy_volume_surge_threshold DECIMAL(10, 4),
  buy_trend_strength_min DECIMAL(10, 6),

  -- SELL Signal Conditions
  sell_velocity_threshold DECIMAL(12, 8),
  sell_acceleration_threshold DECIMAL(12, 8),
  sell_price_drop_threshold DECIMAL(10, 4),
  sell_time_limit_seconds INT,

  -- Logic
  require_all_buy_conditions BOOLEAN DEFAULT FALSE,
  require_all_sell_conditions BOOLEAN DEFAULT FALSE,

  -- Risk Management
  max_position_size_usd DECIMAL(18, 2),
  max_concurrent_positions INT,
  min_expected_profit_pct DECIMAL(10, 4),

  -- Timing
  signal_expiry_seconds INT DEFAULT 60,
  cooldown_after_trade_seconds INT DEFAULT 300,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_momentum_threshold_rules_user ON momentum_threshold_rules(user_id, is_active);

-- Updated trigger
CREATE OR REPLACE FUNCTION update_momentum_threshold_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_momentum_threshold_rules_updated_at
  BEFORE UPDATE ON momentum_threshold_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_momentum_threshold_rules_updated_at();
```

---

### 7. user_signal_preferences

**Purpose**: Notification settings for Live Signals

**Priority**: MEDIUM (Phase 2)

**Schema**:

```sql
CREATE TABLE user_signal_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),

  -- Filters
  min_confidence TEXT DEFAULT 'MEDIUM' CHECK (min_confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  require_elite_confirmation BOOLEAN DEFAULT TRUE,
  min_elite_omega_score DECIMAL(10, 4) DEFAULT 2.0,

  -- Categories
  watched_categories TEXT[],

  -- Notifications
  enable_push_notifications BOOLEAN DEFAULT TRUE,
  enable_email_notifications BOOLEAN DEFAULT FALSE,
  enable_webhook BOOLEAN DEFAULT FALSE,
  webhook_url TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Updated trigger
CREATE OR REPLACE FUNCTION update_user_signal_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_user_signal_preferences_updated_at
  BEFORE UPDATE ON user_signal_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_signal_preferences_updated_at();
```

---

### 8. signal_delivery_log

**Purpose**: Track delivered signals and user actions

**Priority**: LOW (Phase 3)

**Schema**:

```sql
CREATE TABLE signal_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id),

  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('push', 'email', 'webhook')),
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  delivery_status TEXT DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  error_message TEXT,

  -- User actions
  viewed_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  traded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signal_delivery_log_user ON signal_delivery_log(user_id, delivered_at DESC);
CREATE INDEX idx_signal_delivery_log_status ON signal_delivery_log(delivery_status, delivered_at)
  WHERE delivery_status = 'pending';
```

---

## Materialized Views

### 1. austin_methodology_results

**Purpose**: Pre-compute Austin's top-down methodology for instant results

**Priority**: CRITICAL (Phase 1)

**Schema**:

```sql
CREATE MATERIALIZED VIEW austin_methodology_results
ENGINE = AggregatingMergeTree()
PARTITION BY analysis_date
ORDER BY (category, median_category_omega)
AS
WITH elite_wallets AS (
  -- Step 1: Get top 100 wallets by overall Omega
  SELECT
    wallet_address,
    metric_2_omega_net as overall_omega
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
    AND wmc.metric_2_omega_net > 2.0
    AND wmc.metric_22_resolved_bets >= 10
),
category_aggregation AS (
  -- Step 3: Aggregate by category
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
  HAVING specialist_count >= 5
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

  -- Winnability Score
  median_category_omega * log(specialist_count + 1) as winnability_score,

  -- Game Classification
  CASE
    WHEN specialist_count < 10 THEN 'locals_game'
    WHEN specialist_count BETWEEN 10 AND 30 THEN 'emerging_pro'
    ELSE 'pro_circuit'
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

**Refresh**: Daily
**Use Case**: "Find the most winnable categories FAST"

---

### 2. category_winnability_leaderboard

**Purpose**: Quick category ranking

**Schema**:

```sql
CREATE MATERIALIZED VIEW category_winnability_leaderboard AS
SELECT
  category,
  median_omega_of_elites as winnability_score,
  elite_wallet_count as competition_level,
  mean_clv_of_elites as edge_depth,
  CASE
    WHEN elite_wallet_count < 10 THEN 'locals_game'
    WHEN elite_wallet_count BETWEEN 10 AND 50 THEN 'emerging_pro'
    ELSE 'pro_circuit'
  END as game_type
FROM category_analytics
WHERE window = 'lifetime'
ORDER BY winnability_score DESC;
```

---

### 3. active_divergence_signals

**Purpose**: Real-time smart money signals

**Schema**:

```sql
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

---

### 4. rising_stars_today

**Purpose**: Wallets jumping in rank

**Schema**:

```sql
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
  AND rank_change_7d > 10
  AND movement_type IN ('rocketing', 'rising')
ORDER BY rank_change_7d DESC
LIMIT 100;
```

---

### 5. latest_market_momentum

**Purpose**: Current velocity/acceleration for all markets

**Schema**:

```sql
CREATE MATERIALIZED VIEW latest_market_momentum AS
WITH price_windows AS (
  SELECT
    market_id,
    argMax(yes_price, timestamp) as current_yes_price,
    argMax(timestamp, timestamp) as latest_timestamp,
    argMax(yes_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 1 MINUTE) as yes_1min_ago,
    argMax(yes_price, timestamp) FILTER (WHERE timestamp >= now() - INTERVAL 5 MINUTE) as yes_5min_ago
  FROM market_price_history
  WHERE timestamp >= now() - INTERVAL 15 MINUTE
  GROUP BY market_id
)
SELECT
  market_id,
  current_yes_price,
  current_yes_price - yes_1min_ago as yes_change_1min,
  (current_yes_price - yes_1min_ago) / NULLIF(yes_1min_ago, 0) * 100 as yes_change_pct_1min,
  (current_yes_price - yes_1min_ago) / 60 as yes_velocity_1min,
  latest_timestamp
FROM price_windows;
```

---

## 102 Metrics Definitions

See **DATABASE_ARCHITECT_SPEC.md** for complete formulas.

**Tier 1 (CRITICAL)** - Needed for top 5 strategies:
- #2: Omega (net fees)
- #22-24: Activity metrics
- #48-50: Omega with lag (copyability)
- #56: Omega momentum (Theil-Sen)
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

---

## 11 Screening Strategies

### Strategy 1: "Aggressive Growth"

**Filters**:
- `metric_24_bets_per_week > 3`
- `metric_22_resolved_bets > 25`
- `metric_79_integrity_deposit_pnl < 0.2`
- `metric_2_omega_net > 3.0`
- `metric_48_omega_lag_30s > 2.0`
- `metric_60_tail_ratio > 3.0`

**Sort**: `metric_69_ev_per_hour_capital DESC`

### Strategy 2: "Balanced Hybrid"

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

### Strategy 4: "Safe & Steady"

**Filters**:
- `metric_24_bets_per_week > 5`
- `metric_22_resolved_bets > 100`
- `metric_17_max_drawdown > -20%`
- `metric_19_time_in_drawdown_pct < 30%`

**Sort**: `metric_5_sortino DESC`

### Strategy 5: "Momentum Rider"

**Filters**:
- `metric_24_bets_per_week > 5`
- `metric_22_resolved_bets > 100`
- `metric_56_omega_momentum_30d > 0`
- `metric_82_clv_momentum_30d > 0`

**Sort**: `metric_86_hot_hand_z_score DESC`

### Strategy 6: "Rising Star"

**Filters**:
- `metric_23_track_record_days BETWEEN 90 AND 365`
- `metric_22_resolved_bets > 75`
- `metric_85_performance_trend_flag == 'improving'`
- `metric_88_sizing_discipline_trend < 0`
- `metric_84_drawdown_trend_60d < 0`

**Sort**: `metric_83_ev_hr_momentum_30d DESC`

### Strategy 7: "Alpha Decay Detector"

**Filters**:
- `metric_2_omega_net (lifetime) > 5.0`
- `metric_22_resolved_bets > 200`
- `metric_85_performance_trend_flag == 'declining'`

**Sort**: `metric_55_latency_penalty_index DESC`

### Strategy 8: "Fortress"

**Filters**:
- `metric_38_max_single_trade_loss_pct < 5%`
- `metric_63_kelly_utilization_pct BETWEEN 0.2 AND 0.7`
- `metric_37_cvar_95 > -10%`

**Sort**: `metric_64_risk_of_ruin ASC`

### Strategy 9: "News Shark"

**Filters**:
- `metric_94_event_archetype_edge (filtered by event type)`
- `metric_100_news_latency_median < 60 seconds`
- `metric_54_edge_half_life < 1 hour`

**Sort**: `metric_67_news_shock_ev_5min DESC`

### Strategy 10: "Liquidity Provider"

**Filters**:
- `metric_34_maker_taker_ratio > 2.0`
- `metric_72_fee_burden_pct < 5%`
- `metric_99_liquidity_access_skill > 75th percentile`

**Sort**: `metric_34_maker_taker_ratio DESC`

### Strategy 11: "Contrarian"

**Filters**:
- `metric_25_brier_score < 80th percentile`
- `metric_98_yes_no_bias_pct (absolute) > 30%`
- `metric_102_edge_source (post_close_drift) > 50%`

**Sort**: `metric_68_crowd_orthogonality ASC`

---

## Data Pipelines

### 1. Bulk Wallet Sync (One-Time)

**Script**: `scripts/sync-all-wallets-bulk.ts`
**Status**: Already exists
**Purpose**: Populate ClickHouse with all historical trades

**Process**:
1. Get all wallets from Supabase (`discovered_wallets` or `wallet_scores`)
2. For each wallet, fetch trades from Goldsky API
3. Resolve tokenId → condition_id → category
4. Insert to ClickHouse `trades_raw`
5. Track progress with checkpoints

**Estimated Time**: 24-48 hours for 6,605 wallets

---

### 2. Incremental Daily Updates

**Frequency**: Daily at 00:00 UTC

**Process**:
1. Identify active wallets (traded in last 24h)
2. Fetch only new trades since last sync
3. Update `trades_raw`
4. Trigger metric recalculation for affected wallets
5. Update leaderboard snapshot
6. Refresh materialized views

---

### 3. Metrics Calculation

**Frequency**: Daily (full), Hourly (active wallets)

**Process**:
```sql
FOR each wallet IN wallet_scores:
  FOR each window IN ['30d', '90d', '180d', 'lifetime']:
    trades = SELECT * FROM trades_raw WHERE wallet_address = wallet AND timestamp IN window

    -- Calculate Tier 1 metrics
    omega_net = calculate_omega(trades)
    omega_lag_30s = calculate_omega_with_lag(trades, 30)
    tail_ratio = calculate_tail_ratio(trades)
    ev_per_hour = calculate_ev_per_hour(trades)

    -- Insert/Update
    INSERT INTO wallet_metrics_complete (...)
    ON CONFLICT (wallet_address, window) DO UPDATE
```

---

### 4. Category Analytics Aggregation

**Frequency**: Daily

**Process**:
```sql
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

---

### 5. Market Flow Updates

**Frequency**: Every 5 minutes

**Process**:
1. Get all trades in last 24h by market
2. Classify wallets as "elite" (Omega>2.0) or "crowd"
3. Calculate flow ratios
4. Calculate divergence
5. Insert to `market_flow_metrics`

---

### 6. Insider Detection

**Frequency**: Weekly

**Process**:
1. For each wallet with >50 trades
2. Group trades by category and subcategory
3. Calculate win rates by subcategory
4. Detect anomalous patterns
5. Calculate confidence score
6. Update `wallet_category_tags`

---

### 7. Leaderboard Snapshots

**Frequency**: Daily at 00:00 UTC

**Process**:
```sql
INSERT INTO wallet_leaderboard_history
SELECT
  wallet_address,
  today() as snapshot_date,
  ROW_NUMBER() OVER (ORDER BY metric_2_omega_net DESC) as overall_rank,
  ...
FROM wallet_metrics_complete
WHERE window = 'lifetime';

-- Calculate rank changes
UPDATE wallet_leaderboard_history
SET rank_change_7d = overall_rank - (SELECT overall_rank FROM ... WHERE snapshot_date = today() - 7)
WHERE snapshot_date = today();
```

---

## API Endpoints

### 1. Formula Evaluation

```
POST /api/wallets/evaluate-formula

Request:
{
  "conditions": FilterNode[],
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
      "metrics": { ... }
    }
  ],
  "execution_time_ms": 234
}
```

---

### 2. Category Analytics

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

---

### 3. Austin Methodology

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
  ]
}
```

---

### 4. Market Flow Signals

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
      "signal_strength": "extreme"
    }
  ]
}
```

---

### 5. Wallet Intelligence

```
GET /api/wallets/{address}/intelligence

Response:
{
  "wallet_address": "0x...",
  "specializations": [
    {
      "category": "AI",
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

---

### 6. Leaderboard

```
GET /api/wallets/leaderboard?sort=rank_change_7d&limit=100

Response:
{
  "rising_stars": [
    {
      "wallet_address": "0x...",
      "overall_rank": 42,
      "rank_change_7d": +35,
      "omega_ratio": 3.8
    }
  ]
}
```

---

### 7. Momentum Signals

```
GET /api/momentum/signals/active?min_strength=moderate

Response:
{
  "active_signals": [
    {
      "signal_id": "uuid",
      "market_id": "0x...",
      "signal_type": "BUY",
      "signal_strength": "strong",
      "current_price": 0.6234,
      "recommended_entry_price": 0.6240
    }
  ]
}
```

---

## Implementation Phases

### Phase 0: Schema Design (This Week)

**Status**: ✅ COMPLETE (this document)

**Deliverables**:
- ✅ All 11 ClickHouse tables defined
- ✅ All 7 Supabase tables defined
- ✅ All 5 materialized views specified
- ✅ 102 metric columns mapped
- ✅ 11 screening strategies documented

---

### Phase 1: Foundation (Week 1)

**Goal**: Core infrastructure + top 5 strategies

**Tasks**:
1. **Create ClickHouse tables**:
   - `wallet_metrics_complete` (with all 102 metric columns)
   - `wallet_metrics_by_category`
   - `category_analytics`

2. **Create Supabase tables**:
   - `wallet_category_tags`
   - `wallet_leaderboard_history`

3. **Implement Tier 1 metrics** (8 critical):
   - #2: Omega (net fees)
   - #22-24: Activity metrics
   - #48-50: Omega with lag
   - #56: Omega momentum
   - #60: Tail Ratio
   - #69: EV per Hour
   - #85: Performance Trend Flag
   - #88: Sizing Discipline Trend

4. **Build pipelines**:
   - Enhanced wallet discovery (no 50k cap)
   - Bulk wallet sync to ClickHouse
   - Metrics calculation (Tier 1 only)

5. **Create materialized views**:
   - `austin_methodology_results`
   - `category_winnability_leaderboard`

**Success**: Can run Strategies 1, 2, and 6

---

### Phase 2: Live Signals (Weeks 2-3)

**Goal**: Real-time momentum + elite attribution

**Tasks**:
1. **Create ClickHouse tables**:
   - `market_price_history`
   - `market_price_momentum`
   - `price_snapshots_10s`
   - `elite_trade_attributions`
   - `fired_signals`
   - `market_flow_metrics`

2. **Create Supabase tables**:
   - `watchlist_markets`
   - `watchlist_wallets`
   - `momentum_threshold_rules`
   - `user_signal_preferences`

3. **Build services**:
   - WebSocket snapshotter
   - Momentum detector
   - Watchlist poller
   - Signal generator

4. **Implement Tier 2 metrics**:
   - #25, 91: Calibration
   - #30, 89: CLV
   - #54-55: Edge durability

**Success**: Live Signals working with 70-second latency

---

### Phase 3: Complete Analytics (Week 4)

**Goal**: All 102 metrics + advanced strategies

**Tasks**:
1. **Implement Tier 3 metrics**:
   - #34, 72, 99: Market making
   - #68: Crowd Orthogonality
   - #102: Edge Source Decomposition

2. **Implement Tier 4 metrics**:
   - Remaining 30+ metrics

3. **Build remaining pipelines**:
   - Insider detection (weekly)
   - Market flow updates (5 min)

4. **Create all materialized views**:
   - `active_divergence_signals`
   - `rising_stars_today`
   - `latest_market_momentum`

**Success**: All 11 strategies working, all 102 metrics calculated

---

### Phase 4: Optimization & Mirror (Week 5+)

**Goal**: Performance tuning + optional Mirror upgrade

**Tasks**:
1. **Performance optimization**:
   - Query tuning
   - Index optimization
   - Caching layer

2. **Mirror integration** (IF tripwires fire):
   - Set up Goldsky Mirror
   - Reduce attribution latency to <15s

3. **Monitoring**:
   - Tripwire tracking
   - Data quality checks
   - Alert system

**Success**: System running in production with all features

---

## Summary

This schema combines:
- **102 metrics** from DATABASE_ARCHITECT_SPEC.md (PRIORITY)
- **Watchlist architecture** from CASCADIAN_ARCHITECTURE_PLAN_V1.md
- **11 screening strategies** with exact formulas
- **Austin Methodology** (top-down category analysis)
- **Live Signals** (momentum + elite attribution)
- **Insider detection** and wallet intelligence
- **4-week implementation roadmap**

**Total Schema**:
- 11 ClickHouse tables
- 7 Supabase tables
- 5 Materialized views
- 102 metrics × 4 windows
- 11 screening strategies
- 7 data pipelines
- 7 API endpoints

**Next Step**: Begin Phase 1 implementation (create tables, calculate Tier 1 metrics)
