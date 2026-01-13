# Wallet Intelligence Ontology (WIO v1.0) Implementation Plan

> **Status:** Phase 1 Complete
> **Created:** 2026-01-12
> **Last Updated:** 2026-01-12
> **Scope:** Complete wallet metrics system for superforecaster detection and smart money signals

---

## Phase 1 Completion Summary (2026-01-12)

### Tables Created
| Table | Status | Rows |
|-------|--------|------|
| `wio_topic_bundles` | ✅ Created | 20 bundles |
| `wio_market_bundle_map` | ✅ Created | 190,062 markets mapped |
| `wio_events` | ✅ Created | Ready for population |
| `wio_market_price_history` | ✅ Created | Ready for backfill |

### Bundle Coverage
- **20 topic bundles** defined (elections, crypto, sports, etc.)
- **190,062 markets** auto-mapped (42.9% of all markets)
- **High-value markets covered**: fed-rates, elections, trump, bitcoin, etc.

### Price History Strategy
For CLV anchor prices, we will:
1. **Going forward**: Hourly cron captures current prices via Polymarket API
2. **Historical backfill**: Derive from last trade price per hour (batch job)
3. **Fallback for CLV**: If no price at exact anchor time, use nearest trade price

### Next: Phase 2 (Positions Layer)
- Create `wio_positions_v1` table
- Build position derivation from canonical fills
- Implement anchor price capture job

---

## Executive Summary

This document maps the WIO v1.0 specification to Cascadian's existing infrastructure and defines the implementation strategy for calculating 50+ metrics across 1.85M wallets × 4 scopes × 6 time windows at scale.

**Key Numbers:**
- 1.85M wallets to score
- 318K resolved markets
- 943M canonical fills (precomputed)
- ~50 metrics × 4 scopes × 6 windows = 1,200 metric observations per wallet
- Total observations: ~2.2B rows in metrics table

---

## Part 1: Data Model Mapping

### 1.1 Entity Mapping to Existing Tables

| WIO Entity | Cascadian Table | Status | Notes |
|------------|-----------------|--------|-------|
| CATEGORY | `pm_market_metadata.category` | ✅ Exists | Sports, Politics, Crypto, Other |
| TOPIC_BUNDLE | **NEW: `wio_topic_bundles`** | ❌ Create | Curated bundles like "fed-monetary-policy" |
| EVENT | **NEW: `wio_events`** | ❌ Create | Groups markets (e.g., "FOMC March Meeting") |
| MARKET | `pm_condition_resolutions` + `pm_market_metadata` | ✅ Exists | condition_id is market_id |
| WALLET | `pm_trader_events_v3.trader_wallet` | ✅ Exists | 1.85M unique |

### 1.2 Fact/Derived Object Mapping

| WIO Object | Cascadian Table | Status | Notes |
|------------|-----------------|--------|-------|
| FILL | `pm_canonical_fills_v4` | ✅ Exists | 943M rows, self-fill deduped |
| POSITION | **NEW: `wio_positions_v1`** | ❌ Create | Derived from fills, FIFO cost basis |
| OPEN_EXPOSURE_SNAPSHOT | **NEW: `wio_open_snapshots_v1`** | ❌ Create | Hourly snapshots per wallet×market |

### 1.3 New Reference Tables Required

```sql
-- 1. Topic Bundles (curated mapping)
CREATE TABLE wio_topic_bundles (
    bundle_id String,           -- 'fed-monetary-policy', 'trump-cabinet', etc.
    bundle_name String,
    category String,
    keywords Array(String),     -- For auto-matching
    created_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree()
ORDER BY bundle_id;

-- 2. Market → Bundle Mapping
CREATE TABLE wio_market_bundle_map (
    condition_id String,        -- market_id
    primary_bundle_id String,   -- Required: main bundle
    secondary_bundle_ids Array(String),  -- Optional: discovery
    event_id Nullable(String),  -- If part of an event
    mapped_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree()
ORDER BY condition_id;

-- 3. Events (market groupings)
CREATE TABLE wio_events (
    event_id String,
    event_name String,
    bundle_id String,           -- Primary bundle
    start_date Date,
    end_date Nullable(Date),
    created_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree()
ORDER BY event_id;
```

---

## Part 2: Position Derivation Strategy

### 2.1 Position Definition

A **position** is the canonical unit for P&L, ROI, and forecasting metrics. We define it as:

```
Position = (wallet_id, market_id, side) aggregated from fills
```

**Critical Fields to Compute:**

| Field | Formula | Source |
|-------|---------|--------|
| `ts_open` | MIN(ts_fill) for first entry | fills |
| `ts_close` | MAX(ts_fill) if fully exited, else NULL | fills |
| `ts_resolve` | resolution timestamp | pm_condition_resolutions |
| `end_ts` | COALESCE(ts_close, ts_resolve) | derived |
| `qty_shares_opened` | SUM(qty) for BUY fills | fills |
| `cost_usd` | SUM(notional) for BUY fills | fills |
| `proceeds_usd` | SUM(notional) for SELL fills | fills |
| `fees_usd` | SUM(fees) all fills | fills |
| `p_entry_side` | cost_usd / qty_shares_opened | derived |
| `outcome_side` | 1 if side won, 0 if lost | pm_condition_resolutions |
| `pnl_usd` | proceeds + (remaining_shares × outcome) - cost | derived |
| `roi` | pnl_usd / cost_usd | derived |
| `hold_minutes` | (end_ts - ts_open) / 60 | derived |

### 2.2 Anchor Price Capture

**Critical for CLV calculation.** At position open time, we must capture market prices at future anchors:

```sql
-- Anchor prices (captured at ts_open + offset)
p_anchor_4h_side   -- Market mid-price 4 hours after ts_open
p_anchor_24h_side  -- Market mid-price 24 hours after ts_open
p_anchor_72h_side  -- Market mid-price 72 hours after ts_open
```

**Implementation Options:**

| Option | Pros | Cons |
|--------|------|------|
| A. Real-time capture | Accurate | Requires scheduled jobs per position |
| B. Historical price table | Can backfill | Need `pm_market_price_history` table |
| C. Snapshot interpolation | Uses existing snapshots | Less precise |

**Recommendation:** Option B - Create `pm_market_price_history` with hourly granularity, then JOIN to get anchor prices.

### 2.3 Position Table Schema

```sql
CREATE TABLE wio_positions_v1 (
    -- Identity
    position_id String,         -- hash(wallet_id, market_id, side, ts_open)
    wallet_id String,
    market_id String,           -- condition_id
    side String,                -- 'YES' or 'NO'

    -- Taxonomy
    category String,
    primary_bundle_id String,
    event_id Nullable(String),

    -- Timestamps
    ts_open DateTime,
    ts_close Nullable(DateTime),
    ts_resolve Nullable(DateTime),
    end_ts DateTime,            -- COALESCE(ts_close, ts_resolve, now())

    -- Quantities
    qty_shares_opened Float64,
    qty_shares_closed Float64,
    qty_shares_remaining Float64,

    -- Financials (USD)
    cost_usd Float64,
    proceeds_usd Float64,
    fees_usd Float64,

    -- Entry price (side-space: 0-1)
    p_entry_side Float64,

    -- Anchor prices (for CLV)
    p_anchor_4h_side Nullable(Float64),
    p_anchor_24h_side Nullable(Float64),
    p_anchor_72h_side Nullable(Float64),

    -- Resolution
    is_resolved UInt8,
    outcome_side Nullable(UInt8),  -- 1 if side won, 0 if lost

    -- Derived metrics
    pnl_usd Float64,
    roi Float64,
    hold_minutes Int64,

    -- CLV (computed)
    clv_4h Nullable(Float64),      -- p_anchor_4h_side - p_entry_side
    clv_24h Nullable(Float64),
    clv_72h Nullable(Float64),

    -- Brier (computed for resolved)
    brier_score Nullable(Float64), -- (p_entry_side - outcome_side)^2

    -- Metadata
    fills_count Int32,
    first_fill_id String,
    last_fill_id String,
    updated_at DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_id, market_id, side, ts_open)
PARTITION BY toYYYYMM(ts_open);
```

### 2.4 Position Build Query

```sql
-- Build positions from canonical fills
INSERT INTO wio_positions_v1
WITH
  fill_agg AS (
    SELECT
      wallet,
      condition_id as market_id,
      -- Determine side from net position
      IF(sum(tokens_delta) >= 0, 'YES', 'NO') as side,

      min(event_time) as ts_open,
      max(event_time) as ts_close_candidate,

      sumIf(abs(tokens_delta), tokens_delta > 0) as qty_bought,
      sumIf(abs(tokens_delta), tokens_delta < 0) as qty_sold,

      sumIf(abs(usdc_delta), usdc_delta < 0) as cost_usd,
      sumIf(abs(usdc_delta), usdc_delta > 0) as proceeds_usd,

      count() as fills_count,
      min(fill_id) as first_fill_id,
      max(fill_id) as last_fill_id

    FROM pm_canonical_fills_v4 FINAL
    WHERE source IN ('clob', 'ctf_token')
    GROUP BY wallet, condition_id
    HAVING qty_bought > 0  -- Must have opened a position
  ),

  with_resolution AS (
    SELECT
      f.*,
      r.resolved_at as ts_resolve,
      r.payout_numerators,
      m.category,
      b.primary_bundle_id,
      b.event_id
    FROM fill_agg f
    LEFT JOIN pm_condition_resolutions r ON f.market_id = r.condition_id
    LEFT JOIN pm_market_metadata m ON f.market_id = m.condition_id
    LEFT JOIN wio_market_bundle_map b ON f.market_id = b.condition_id
  )

SELECT
  -- Generate position_id
  cityHash64(concat(wallet, market_id, side, toString(ts_open))) as position_id,
  wallet as wallet_id,
  market_id,
  side,

  category,
  primary_bundle_id,
  event_id,

  ts_open,
  IF(qty_bought = qty_sold, ts_close_candidate, NULL) as ts_close,
  ts_resolve,
  COALESCE(
    IF(qty_bought = qty_sold, ts_close_candidate, NULL),
    ts_resolve,
    now()
  ) as end_ts,

  qty_bought as qty_shares_opened,
  qty_sold as qty_shares_closed,
  qty_bought - qty_sold as qty_shares_remaining,

  cost_usd,
  proceeds_usd,
  0 as fees_usd,  -- TODO: Add fee tracking

  -- Entry price in side-space
  IF(qty_bought > 0, cost_usd / qty_bought, 0) as p_entry_side,

  -- Anchor prices (filled by separate job)
  NULL as p_anchor_4h_side,
  NULL as p_anchor_24h_side,
  NULL as p_anchor_72h_side,

  -- Resolution
  IF(ts_resolve IS NOT NULL, 1, 0) as is_resolved,
  -- Outcome: 1 if side won
  IF(ts_resolve IS NOT NULL,
    IF(side = 'YES',
      toInt64OrNull(JSONExtractString(payout_numerators, 1)) = 1,
      toInt64OrNull(JSONExtractString(payout_numerators, 2)) = 1
    ),
    NULL
  ) as outcome_side,

  -- PnL calculation
  proceeds_usd
    + (qty_bought - qty_sold) * IF(outcome_side = 1, 1.0, 0.0)
    - cost_usd as pnl_usd,

  -- ROI
  IF(cost_usd > 0,
    (proceeds_usd + (qty_bought - qty_sold) * IF(outcome_side = 1, 1.0, 0.0) - cost_usd) / cost_usd,
    0
  ) as roi,

  -- Hold time
  dateDiff('minute', ts_open, COALESCE(ts_close, ts_resolve, now())) as hold_minutes,

  -- CLV (filled by separate job)
  NULL as clv_4h,
  NULL as clv_24h,
  NULL as clv_72h,

  -- Brier score (for resolved)
  IF(is_resolved = 1,
    pow(p_entry_side - outcome_side, 2),
    NULL
  ) as brier_score,

  fills_count,
  first_fill_id,
  last_fill_id,
  now() as updated_at

FROM with_resolution;
```

---

## Part 3: Metric Computation Strategy

### 3.1 Metric Categories by Computation Pattern

| Category | Basis | Computation | Update Frequency |
|----------|-------|-------------|------------------|
| A. Activity & Evidence | positions/fills | COUNT, COUNT DISTINCT | Per resolution |
| B. Return & Profitability | positions | SUM, weighted AVG | Per resolution |
| C. Win/Loss Economics | positions | Conditional aggregates | Per resolution |
| D. Risk & Survivability | positions (ordered) | Path-based (drawdown) | Daily batch |
| E. Time Horizon | positions | Percentiles, ratios | Per resolution |
| F. Edge via CLV | positions + prices | Weighted averages | After anchor capture |
| G. Forecasting Skill | resolved positions | Brier, calibration | Per resolution |
| H. Focus & Concentration | positions | HHI, top-N share | Per resolution |
| I. Sizing & Conviction | positions | Percentiles, top-decile | Per resolution |
| J. Mechanical/Bot | fills | Ratios, rates | Daily batch |
| K. Open/Unrealized | snapshots | Point-in-time | Hourly |
| L. Event-only | positions×event | Event aggregates | Per resolution |

### 3.2 Window Strategy

**The 6 Windows:** ALL, 90d, 30d, 14d, 7d, 1d

**Windowing Rule (from spec):**
- Position included in window W if `end_ts >= now() - W_days`
- Fill included in window W if `ts_fill >= now() - W_days`

**Efficient Computation Approach:**

```sql
-- Single-pass multi-window aggregation
SELECT
  wallet_id,
  scope_type,
  scope_id,

  -- ALL window
  count() as positions_n_ALL,
  sum(pnl_usd) as pnl_total_usd_ALL,

  -- 90d window
  countIf(end_ts >= now() - INTERVAL 90 DAY) as positions_n_90d,
  sumIf(pnl_usd, end_ts >= now() - INTERVAL 90 DAY) as pnl_total_usd_90d,

  -- 30d window
  countIf(end_ts >= now() - INTERVAL 30 DAY) as positions_n_30d,
  sumIf(pnl_usd, end_ts >= now() - INTERVAL 30 DAY) as pnl_total_usd_30d,

  -- ... etc for 14d, 7d, 1d

FROM wio_positions_v1 FINAL
GROUP BY wallet_id, scope_type, scope_id
```

### 3.3 Scope Strategy

**The 4 Scopes:**
1. `GLOBAL` - All positions for wallet
2. `BUNDLE` - Positions in specific topic bundle
3. `EVENT` - Positions in specific event
4. `MARKET` - Positions in specific market

**Efficient Computation via UNION ALL:**

```sql
-- Compute all scopes in single scan
WITH base_metrics AS (
  SELECT
    wallet_id,
    market_id,
    primary_bundle_id,
    event_id,
    pnl_usd,
    roi,
    cost_usd,
    end_ts,
    is_resolved,
    brier_score
  FROM wio_positions_v1 FINAL
)

-- GLOBAL scope
SELECT wallet_id, 'GLOBAL' as scope_type, NULL as scope_id, ...metrics...
FROM base_metrics
GROUP BY wallet_id

UNION ALL

-- BUNDLE scope
SELECT wallet_id, 'BUNDLE' as scope_type, primary_bundle_id as scope_id, ...metrics...
FROM base_metrics
WHERE primary_bundle_id IS NOT NULL
GROUP BY wallet_id, primary_bundle_id

UNION ALL

-- EVENT scope
SELECT wallet_id, 'EVENT' as scope_type, event_id as scope_id, ...metrics...
FROM base_metrics
WHERE event_id IS NOT NULL
GROUP BY wallet_id, event_id

UNION ALL

-- MARKET scope
SELECT wallet_id, 'MARKET' as scope_type, market_id as scope_id, ...metrics...
FROM base_metrics
GROUP BY wallet_id, market_id
```

---

## Part 4: Metrics Table Schema

### 4.1 Core Metrics Observation Table

```sql
CREATE TABLE wio_metric_observations_v1 (
    -- Key
    wallet_id String,
    scope_type Enum8('GLOBAL' = 1, 'BUNDLE' = 2, 'EVENT' = 3, 'MARKET' = 4),
    scope_id Nullable(String),  -- NULL for GLOBAL
    window_id Enum8('ALL' = 1, '90d' = 2, '30d' = 3, '14d' = 4, '7d' = 5, '1d' = 6),

    -- Sample sizes (always include)
    positions_n Int32,
    resolved_positions_n Int32,
    fills_n Int32,

    -- A. Activity & Evidence
    active_days_n Int32,
    wallet_age_days Nullable(Int32),        -- GLOBAL/ALL only
    days_since_last_trade Nullable(Int32),  -- GLOBAL/ALL only

    -- B. Return & Profitability
    roi_cost_weighted Float64,
    pnl_total_usd Float64,
    roi_p50 Float64,
    roi_p05 Float64,
    roi_p95 Float64,

    -- C. Win/Loss Economics
    win_rate Float64,
    avg_win_roi Float64,
    avg_loss_roi Float64,
    profit_factor Float64,

    -- D. Risk & Survivability
    max_drawdown_usd Float64,
    cvar_95_roi Float64,
    max_loss_roi Float64,
    loss_streak_max Int32,

    -- E. Time Horizon
    hold_minutes_p50 Float64,
    pct_held_to_resolve Float64,
    time_to_resolve_hours_p50 Float64,

    -- F. Edge via CLV
    clv_4h_cost_weighted Float64,
    clv_24h_cost_weighted Float64,
    clv_72h_cost_weighted Float64,
    clv_24h_win_rate Float64,

    -- G. Forecasting Skill
    brier_mean Float64,
    brier_vs_crowd Float64,
    sharpness Float64,
    calibration_gap Float64,

    -- H. Focus & Concentration
    unique_bundles_n Nullable(Int32),       -- GLOBAL only
    bundle_hhi_cost Nullable(Float64),      -- GLOBAL only
    top_bundle_share_cost Nullable(Float64),-- GLOBAL only
    market_hhi_cost Float64,
    top_market_share_cost Float64,

    -- I. Sizing & Conviction
    position_cost_p50 Float64,
    position_cost_p90 Float64,
    conviction_top_decile_cost_share Float64,
    roi_cost_weighted_top_decile Float64,

    -- J. Mechanical/Bot Diagnostics
    fills_per_day Float64,
    both_sides_same_market_rate Float64,
    maker_ratio Nullable(Float64),
    same_block_trade_rate Nullable(Float64),

    -- Metadata
    computed_at DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(computed_at)
ORDER BY (wallet_id, scope_type, scope_id, window_id)
PARTITION BY scope_type;
```

### 4.2 Open Exposure Snapshot Table

```sql
CREATE TABLE wio_open_snapshots_v1 (
    -- Key
    wallet_id String,
    market_id String,
    as_of_ts DateTime,

    -- Position state
    side String,                    -- 'YES' or 'NO' (net direction)
    open_shares_net Float64,        -- Signed net position
    open_cost_usd Float64,
    avg_entry_price_side Float64,

    -- Mark-to-market
    mark_price_side Float64,
    unrealized_pnl_usd Float64,
    unrealized_roi Float64,

    -- Metadata
    bundle_id Nullable(String),
    event_id Nullable(String)

) ENGINE = ReplacingMergeTree()
ORDER BY (wallet_id, market_id, as_of_ts)
PARTITION BY toYYYYMMDD(as_of_ts)
TTL as_of_ts + INTERVAL 180 DAY;  -- Keep 6 months of snapshots
```

### 4.3 Market Snapshot Table (for Smart/Dumb Money)

```sql
CREATE TABLE wio_market_snapshots_v1 (
    -- Key
    market_id String,
    as_of_ts DateTime,

    -- Crowd metrics
    crowd_odds Float64,             -- Market mid YES
    total_open_interest_usd Float64,

    -- Smart money metrics
    smart_money_odds Float64,
    smart_holdings_shares Float64,
    smart_holdings_usd Float64,
    smart_unrealized_roi Float64,
    smart_wallet_count Int32,

    -- Dumb money metrics
    dumb_money_odds Float64,
    dumb_holdings_shares Float64,
    dumb_holdings_usd Float64,
    dumb_unrealized_roi Float64,
    dumb_wallet_count Int32,

    -- Divergence signals
    smart_vs_crowd_delta Float64,   -- smart_money_odds - crowd_odds
    smart_vs_dumb_delta Float64,    -- smart_money_odds - dumb_money_odds

    -- Metadata
    computed_at DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(computed_at)
ORDER BY (market_id, as_of_ts)
PARTITION BY toYYYYMM(as_of_ts);
```

---

## Part 5: Score Computation

### 5.1 Credibility Score

```sql
-- Credibility(wallet, scope, window) → 0..1
-- Higher = more trustworthy forecaster

WITH base AS (
  SELECT
    brier_vs_crowd,
    calibration_gap,
    sharpness,
    clv_24h_cost_weighted,
    clv_72h_cost_weighted,
    max_drawdown_usd,
    loss_streak_max,
    resolved_positions_n,
    fills_per_day,
    both_sides_same_market_rate
  FROM wio_metric_observations_v1
  WHERE wallet_id = {wallet}
    AND scope_type = {scope_type}
    AND scope_id = {scope_id}
    AND window_id = {window}
)

SELECT
  -- Base score from forecasting skill (0-0.4)
  0.4 * (1 - LEAST(brier_vs_crowd / 0.25, 1)) as skill_component,

  -- CLV bonus (0-0.2)
  0.2 * GREATEST(0, LEAST((clv_72h_cost_weighted + 0.1) / 0.2, 1)) as edge_component,

  -- Calibration bonus (0-0.15)
  0.15 * (1 - LEAST(calibration_gap / 0.15, 1)) as calibration_component,

  -- Risk penalty (0-0.15)
  0.15 * GREATEST(0, 1 - max_drawdown_usd / 10000) as risk_component,

  -- Bot penalty (reduces score if bot-like)
  GREATEST(0, 1 -
    IF(fills_per_day > 50, 0.3, 0) -
    IF(both_sides_same_market_rate > 0.3, 0.2, 0)
  ) as bot_multiplier,

  -- Sample size shrinkage (Bayesian)
  resolved_positions_n / (resolved_positions_n + 20) as shrinkage_factor

FROM base;

-- Final: (skill + edge + calibration + risk) × bot_multiplier × shrinkage
```

### 5.2 Bot Likelihood Score

```sql
-- BotLikelihood(wallet, window) → 0..1
-- Higher = more likely automated/MM

SELECT
  -- High fill rate signal (0-0.3)
  0.3 * LEAST(fills_per_day / 100, 1) as fill_rate_signal,

  -- Maker ratio signal (0-0.25)
  0.25 * COALESCE(maker_ratio, 0) as maker_signal,

  -- Same block trades (0-0.25)
  0.25 * COALESCE(same_block_trade_rate, 0) as mev_signal,

  -- Very short holds (0-0.2)
  0.2 * IF(hold_minutes_p50 < 60, 1 - hold_minutes_p50/60, 0) as scalper_signal

FROM wio_metric_observations_v1
WHERE wallet_id = {wallet} AND scope_type = 'GLOBAL' AND window_id = {window};
```

### 5.3 Insider Likelihood Score

```sql
-- InsiderLikelihood(wallet, bundle, window) → 0..1
-- Higher = more likely has non-public information

WITH bundle_metrics AS (
  SELECT * FROM wio_metric_observations_v1
  WHERE wallet_id = {wallet}
    AND scope_type = 'BUNDLE'
    AND scope_id = {bundle_id}
    AND window_id = {window}
),
global_metrics AS (
  SELECT * FROM wio_metric_observations_v1
  WHERE wallet_id = {wallet}
    AND scope_type = 'GLOBAL'
    AND window_id = {window}
)

SELECT
  -- Long-horizon CLV dominance (strongest signal)
  0.35 * GREATEST(0, LEAST(b.clv_72h_cost_weighted / 0.15, 1)) as long_clv_signal,

  -- Topic concentration (specialists more likely insiders)
  0.20 * COALESCE(g.top_bundle_share_cost, 0) as concentration_signal,

  -- Anomalous sizing (big bets relative to norm)
  0.15 * IF(b.position_cost_p50 > 2 * g.position_cost_p50,
    LEAST((b.position_cost_p50 / g.position_cost_p50 - 2) / 3, 1),
    0
  ) as sizing_signal,

  -- New wallet with immediate success
  0.15 * IF(g.wallet_age_days < 30 AND b.win_rate > 0.8 AND b.resolved_positions_n >= 5,
    1.0, 0
  ) as new_wallet_signal,

  -- Perfect or near-perfect record
  0.15 * IF(b.win_rate >= 0.95 AND b.resolved_positions_n >= 5,
    1.0,
    IF(b.win_rate >= 0.85, (b.win_rate - 0.85) / 0.10, 0)
  ) as perfection_signal,

  -- Hard bot gate (must pass)
  IF(g.fills_per_day > 50 OR g.both_sides_same_market_rate > 0.3, 0, 1) as bot_gate

FROM bundle_metrics b
CROSS JOIN global_metrics g;

-- Final: (signals sum) × bot_gate
```

### 5.4 Copyability Score

```sql
-- Copyability(wallet, scope, window) → 0..1
-- Higher = easier to follow/copy

SELECT
  -- Reasonable hold time (not too fast)
  0.25 * IF(hold_minutes_p50 >= 60, 1, hold_minutes_p50 / 60) as horizon_component,

  -- Low risk (survivable drawdowns)
  0.25 * GREATEST(0, 1 - max_drawdown_usd / 5000) as risk_component,

  -- Not a bot
  0.20 * (1 - bot_likelihood) as human_component,

  -- Reasonable turnover (not churning)
  0.15 * IF(turnover_window < 5, 1, GREATEST(0, 1 - (turnover_window - 5) / 10)) as turnover_component,

  -- Consistent (not lottery)
  0.15 * IF(roi_p50 > -0.5, 1, 0) as consistency_component

FROM wio_metric_observations_v1
WHERE wallet_id = {wallet}
  AND scope_type = {scope_type}
  AND scope_id = {scope_id}
  AND window_id = {window};
```

---

## Part 6: Dot Event System

### 6.1 Dot Event Table

```sql
CREATE TABLE wio_dot_events_v1 (
    -- Key
    dot_id String,
    ts DateTime,

    -- Context
    wallet_id String,
    market_id String,
    event_id Nullable(String),
    bundle_id Nullable(String),

    -- Action
    action Enum8('ENTER' = 1, 'EXIT' = 2, 'ADD' = 3, 'REDUCE' = 4, 'FLIP' = 5),
    side String,
    size_usd Float64,

    -- Classification
    dot_type Enum8('SUPERFORECASTER' = 1, 'INSIDER' = 2, 'SMART_MONEY' = 3),
    confidence Float64,  -- 0..1

    -- Reason vector (which metrics triggered)
    reason_metrics Array(String),  -- e.g., ['clv_72h_high', 'bundle_concentration', 'new_wallet']

    -- Wallet scores at time of dot
    credibility_score Float64,
    insider_likelihood Float64,
    bot_likelihood Float64,

    -- Market context at time of dot
    crowd_odds Float64,
    entry_price Float64,

    created_at DateTime DEFAULT now()

) ENGINE = MergeTree()
ORDER BY (market_id, ts, wallet_id)
PARTITION BY toYYYYMM(ts);
```

### 6.2 Dot Emission Logic

```python
# Pseudocode for dot emission

def check_dot_emission(wallet_id, market_id, fill):
    """Called after each fill to check if dot should be emitted"""

    # Get previous and current exposure
    prev_exposure = get_exposure(wallet_id, market_id, before=fill.ts)
    curr_exposure = get_exposure(wallet_id, market_id, at=fill.ts)

    # Determine action
    action = classify_action(prev_exposure, curr_exposure)
    if action is None:
        return None  # No significant change

    # Check size threshold
    size_usd = abs(curr_exposure.cost - prev_exposure.cost)
    if size_usd < MIN_DOT_SIZE_USD:
        return None

    # Get wallet scores
    bundle_id = get_bundle(market_id)
    scores = get_wallet_scores(wallet_id, bundle_id)

    # Check if qualifies for dot
    if scores.bot_likelihood > 0.5:
        return None  # Bot gate

    dot_type = None
    reasons = []

    # Superforecaster dot
    if scores.credibility >= 0.7:
        dot_type = 'SUPERFORECASTER'
        reasons.append('high_credibility')

    # Insider dot
    if scores.insider_likelihood >= 0.6:
        dot_type = 'INSIDER'
        if scores.clv_72h > 0.1:
            reasons.append('clv_72h_high')
        if scores.bundle_concentration > 0.5:
            reasons.append('bundle_concentration')
        if scores.wallet_age_days < 30:
            reasons.append('new_wallet')

    if dot_type is None:
        return None

    return DotEvent(
        wallet_id=wallet_id,
        market_id=market_id,
        action=action,
        dot_type=dot_type,
        confidence=max(scores.credibility, scores.insider_likelihood),
        reason_metrics=reasons,
        ...
    )
```

---

## Part 7: Implementation Phases

### Phase 1: Foundation (Week 1-2)

| Task | Priority | Dependencies |
|------|----------|--------------|
| Create `wio_topic_bundles` table | P0 | None |
| Create `wio_market_bundle_map` table | P0 | topic_bundles |
| Create `wio_events` table | P0 | None |
| Build initial bundle mappings (top 20 bundles) | P0 | tables |
| Create `pm_market_price_history` table | P1 | None |
| Backfill price history (hourly, 1 year) | P1 | price table |

### Phase 2: Position Layer (Week 2-3)

| Task | Priority | Dependencies |
|------|----------|--------------|
| Create `wio_positions_v1` table | P0 | Phase 1 |
| Build position derivation job | P0 | positions table |
| Backfill all positions (from canonical fills) | P0 | derivation job |
| Add anchor price capture job | P1 | price history |
| Backfill anchor prices | P1 | anchor job |

### Phase 3: Metrics Computation (Week 3-4)

| Task | Priority | Dependencies |
|------|----------|--------------|
| Create `wio_metric_observations_v1` table | P0 | Phase 2 |
| Implement Category A-C metrics (activity, returns, win/loss) | P0 | positions |
| Implement Category D-E metrics (risk, time) | P0 | positions |
| Implement Category F-G metrics (CLV, Brier) | P1 | anchor prices |
| Implement Category H-I metrics (concentration, sizing) | P1 | positions |
| Implement Category J metrics (bot detection) | P1 | fills |
| Build incremental metric update job | P0 | all metrics |

### Phase 4: Snapshots & Smart Money (Week 4-5)

| Task | Priority | Dependencies |
|------|----------|--------------|
| Create `wio_open_snapshots_v1` table | P0 | Phase 2 |
| Build hourly snapshot job | P0 | snapshots table |
| Create `wio_market_snapshots_v1` table | P0 | Phase 3 |
| Implement smart/dumb money classification | P0 | metrics + snapshots |
| Build market snapshot aggregation job | P0 | classification |

### Phase 5: Scores & Dots (Week 5-6)

| Task | Priority | Dependencies |
|------|----------|--------------|
| Implement Credibility score | P0 | metrics |
| Implement BotLikelihood score | P0 | metrics |
| Implement InsiderLikelihood score | P0 | metrics |
| Implement Copyability score | P1 | metrics + scores |
| Create `wio_dot_events_v1` table | P0 | scores |
| Build dot emission system | P0 | all scores |
| Create style tag derivation | P2 | scores |

### Phase 6: API & UI Integration (Week 6-7)

| Task | Priority | Dependencies |
|------|----------|--------------|
| Wallet profile API endpoint | P0 | all metrics |
| Market snapshot API endpoint | P0 | market snapshots |
| Dot events API endpoint | P0 | dots |
| Leaderboard API (filterable) | P0 | metrics |
| Smart money odds widget | P1 | market snapshots |

---

## Part 8: Incremental Update Strategy

### 8.1 Event-Driven Updates

```
Trigger: Market Resolution
Actions:
  1. Update all positions for that market (set outcome, pnl, roi)
  2. Recompute metrics for affected wallets at MARKET scope
  3. Recompute metrics for affected wallets at EVENT scope (if event)
  4. Recompute metrics for affected wallets at BUNDLE scope
  5. Recompute metrics for affected wallets at GLOBAL scope
  6. Update market snapshot (final)
```

### 8.2 Scheduled Updates

| Job | Frequency | Scope |
|-----|-----------|-------|
| Open snapshot capture | Hourly | All open positions |
| Market snapshot update | Hourly | All active markets |
| Anchor price backfill | Every 4 hours | Positions needing anchors |
| Full metric recompute | Daily (3 AM) | All wallets, all scopes |
| Price history capture | Hourly | All active markets |

### 8.3 Watermark Pattern

```sql
-- Track last processed for incremental updates
CREATE TABLE wio_update_watermarks (
    job_name String,
    scope_type String,
    last_processed_ts DateTime,
    last_processed_id String,
    updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (job_name, scope_type);
```

---

## Part 9: Query Patterns for Common Use Cases

### 9.1 Wallet Profile (All Metrics)

```sql
SELECT *
FROM wio_metric_observations_v1 FINAL
WHERE wallet_id = '0x...'
  AND scope_type = 'GLOBAL'
ORDER BY window_id;
```

### 9.2 Topic Leaderboard (Credibility)

```sql
WITH scores AS (
  SELECT
    wallet_id,
    -- Compute credibility inline
    (0.4 * (1 - LEAST(brier_vs_crowd / 0.25, 1)) +
     0.2 * GREATEST(0, LEAST((clv_72h_cost_weighted + 0.1) / 0.2, 1)) +
     0.15 * (1 - LEAST(calibration_gap / 0.15, 1))) *
    (resolved_positions_n / (resolved_positions_n + 20)) as credibility
  FROM wio_metric_observations_v1 FINAL
  WHERE scope_type = 'BUNDLE'
    AND scope_id = 'fed-monetary-policy'
    AND window_id = '90d'
    AND resolved_positions_n >= 5
)
SELECT wallet_id, credibility
FROM scores
ORDER BY credibility DESC
LIMIT 100;
```

### 9.3 Smart Money Divergence Alert

```sql
SELECT
  market_id,
  crowd_odds,
  smart_money_odds,
  smart_vs_crowd_delta,
  smart_wallet_count
FROM wio_market_snapshots_v1 FINAL
WHERE as_of_ts = (SELECT max(as_of_ts) FROM wio_market_snapshots_v1)
  AND abs(smart_vs_crowd_delta) > 0.15  -- 15%+ divergence
  AND smart_wallet_count >= 3
ORDER BY abs(smart_vs_crowd_delta) DESC;
```

### 9.4 Recent Insider Dots

```sql
SELECT
  ts,
  wallet_id,
  market_id,
  action,
  side,
  size_usd,
  confidence,
  reason_metrics,
  crowd_odds,
  entry_price
FROM wio_dot_events_v1
WHERE dot_type = 'INSIDER'
  AND ts >= now() - INTERVAL 24 HOUR
ORDER BY confidence DESC, size_usd DESC
LIMIT 50;
```

---

## Part 10: Storage & Performance Estimates

### 10.1 Table Size Estimates

| Table | Rows | Avg Row Size | Total Size |
|-------|------|--------------|------------|
| `wio_positions_v1` | 70M | 500 bytes | ~35 GB |
| `wio_metric_observations_v1` | 2.2B | 400 bytes | ~880 GB |
| `wio_open_snapshots_v1` | 500M (6mo) | 150 bytes | ~75 GB |
| `wio_market_snapshots_v1` | 50M (6mo) | 200 bytes | ~10 GB |
| `wio_dot_events_v1` | 10M | 300 bytes | ~3 GB |
| **Total** | - | - | **~1 TB** |

### 10.2 Query Performance Targets

| Query Type | Target | Strategy |
|------------|--------|----------|
| Single wallet profile | <100ms | Primary key lookup |
| Leaderboard (top 100) | <500ms | Pre-aggregated + index |
| Market snapshot lookup | <50ms | Primary key + latest |
| Dot events (24h) | <200ms | Time-partitioned |
| Full metric recompute (1 wallet) | <5s | Batch aggregation |
| Full metric recompute (all wallets) | <2h | Parallel batch |

### 10.3 Partitioning Strategy

```sql
-- Positions: by month of ts_open (for time-range queries)
PARTITION BY toYYYYMM(ts_open)

-- Metrics: by scope_type (for scope-filtered queries)
PARTITION BY scope_type

-- Snapshots: by day (for TTL and time-range)
PARTITION BY toYYYYMMDD(as_of_ts)

-- Dots: by month (for historical queries)
PARTITION BY toYYYYMM(ts)
```

---

## Appendix A: Full Metric Formula Reference

### A.1 Activity Metrics

```sql
-- positions_n
COUNT(*) WHERE end_ts IN window

-- resolved_positions_n
COUNT(*) WHERE is_resolved = 1 AND end_ts IN window

-- fills_n
COUNT(*) FROM fills WHERE ts_fill IN window

-- active_days_n
COUNT(DISTINCT toDate(ts_fill)) FROM fills WHERE ts_fill IN window

-- wallet_age_days (GLOBAL/ALL only)
dateDiff('day', MIN(ts_fill), now())

-- days_since_last_trade (GLOBAL/ALL only)
dateDiff('day', MAX(ts_fill), now())
```

### A.2 Return Metrics

```sql
-- roi_cost_weighted
SUM(pnl_usd) / SUM(cost_usd)

-- pnl_total_usd
SUM(pnl_usd)

-- roi_p50
quantile(0.5)(roi)

-- roi_p05
quantile(0.05)(roi)

-- roi_p95
quantile(0.95)(roi)
```

### A.3 Win/Loss Metrics

```sql
-- win_rate
countIf(pnl_usd > 0) / count()

-- avg_win_roi
avgIf(roi, pnl_usd > 0)

-- avg_loss_roi
avgIf(roi, pnl_usd < 0)

-- profit_factor
sumIf(pnl_usd, pnl_usd > 0) / abs(sumIf(pnl_usd, pnl_usd < 0))
```

### A.4 Risk Metrics

```sql
-- max_drawdown_usd (path-based, requires ordered computation)
-- Computed via running max - current value over ordered PnL series

-- cvar_95_roi
avgIf(roi, roi <= quantile(0.05)(roi))

-- max_loss_roi
MIN(roi)

-- loss_streak_max
-- Requires ordered computation of consecutive losses
```

### A.5 Time Metrics

```sql
-- hold_minutes_p50
quantile(0.5)(hold_minutes)

-- pct_held_to_resolve
countIf(ts_close IS NULL AND ts_resolve IS NOT NULL) / countIf(ts_resolve IS NOT NULL)

-- time_to_resolve_hours_p50
quantile(0.5)(dateDiff('hour', ts_open, ts_resolve))
```

### A.6 CLV Metrics

```sql
-- CLV in side-space: price improvement vs later anchor
-- clv_h = p_anchor_h_side - p_entry_side
-- Positive CLV = entered at better price than later consensus

-- clv_4h_cost_weighted
SUM(clv_4h * cost_usd) / SUM(cost_usd)

-- clv_24h_cost_weighted
SUM(clv_24h * cost_usd) / SUM(cost_usd)

-- clv_72h_cost_weighted
SUM(clv_72h * cost_usd) / SUM(cost_usd)

-- clv_24h_win_rate
countIf(clv_24h > 0) / count()
```

### A.7 Forecasting Metrics

```sql
-- brier_mean (lower is better)
AVG(brier_score) WHERE is_resolved = 1
-- where brier_score = (p_entry_side - outcome_side)^2

-- brier_vs_crowd (requires crowd_odds at entry)
AVG(brier_score - crowd_brier_score)
-- where crowd_brier_score = (crowd_odds_at_entry - outcome_side)^2

-- sharpness
AVG(abs(p_entry_side - 0.5))
-- How confident/extreme their entries are

-- calibration_gap
-- Binned: for each decile of p_entry_side, compare predicted vs actual
-- Gap = AVG(abs(bin_mean_prediction - bin_actual_outcome))
```

### A.8 Concentration Metrics

```sql
-- unique_bundles_n (GLOBAL only)
COUNT(DISTINCT primary_bundle_id)

-- bundle_hhi_cost (GLOBAL only)
SUM(pow(bundle_cost / total_cost, 2))
-- where bundle_cost = SUM(cost_usd) per bundle

-- top_bundle_share_cost (GLOBAL only)
MAX(bundle_cost) / SUM(cost_usd)

-- market_hhi_cost
SUM(pow(market_cost / total_cost, 2))

-- top_market_share_cost
MAX(market_cost) / SUM(cost_usd)
```

### A.9 Sizing Metrics

```sql
-- position_cost_p50
quantile(0.5)(cost_usd)

-- position_cost_p90
quantile(0.9)(cost_usd)

-- conviction_top_decile_cost_share
SUM(cost_usd WHERE cost_usd >= quantile(0.9)(cost_usd)) / SUM(cost_usd)

-- roi_cost_weighted_top_decile
SUM(pnl_usd WHERE cost_usd >= quantile(0.9)(cost_usd)) /
SUM(cost_usd WHERE cost_usd >= quantile(0.9)(cost_usd))
```

### A.10 Bot Detection Metrics

```sql
-- fills_per_day
COUNT(fills) / active_days_n

-- both_sides_same_market_rate
-- Count markets where wallet has both YES and NO positions
COUNT(DISTINCT market_id WHERE has_yes AND has_no) / COUNT(DISTINCT market_id)

-- maker_ratio
countIf(is_maker = 1) / count()

-- same_block_trade_rate
-- Count fills that share block_number with another fill by same wallet
countIf(block_has_multiple_fills) / count()
```

---

## Appendix B: Style Tag Derivation Rules

| Tag | Rule |
|-----|------|
| **Superforecaster** | Credibility ≥ 0.8, resolved_positions_n ≥ 20, bot_likelihood < 0.3 |
| **Domain Expert** | Credibility(bundle) ≥ 0.7, bundle concentration > 0.5 |
| **Generalist** | unique_bundles_n ≥ 5, bundle_hhi < 0.3 |
| **Consistent Trader** | win_rate ≥ 0.6, profit_factor ≥ 1.5, max_drawdown < 30% |
| **High-Conviction** | conviction_top_decile_cost_share ≥ 0.5, roi_top_decile > roi |
| **Insider** | InsiderLikelihood ≥ 0.7, bot_likelihood < 0.3 |
| **Market Maker** | maker_ratio ≥ 0.7, fills_per_day ≥ 50 |
| **Scalper/HFT** | hold_minutes_p50 < 60, fills_per_day ≥ 20 |
| **Hedger** | both_sides_same_market_rate ≥ 0.3 |
| **Whale** | position_cost_p50 ≥ $10,000 |
| **Diamond Hands** | pct_held_to_resolve ≥ 0.8 |
| **Swing Trader** | 1h ≤ hold_minutes_p50 ≤ 24h |
| **New Wallet** | wallet_age_days ≤ 30 |
| **Inactive** | days_since_last_trade ≥ 30 |
| **Bag Holder** | unrealized_roi < -30%, open_positions_n ≥ 3 |

---

## Next Steps

1. **Review this plan** and identify any missing metrics or edge cases
2. **Prioritize bundle/event mappings** - Need curated list for initial rollout
3. **Decide on price history source** - Build vs buy/API
4. **Prototype position derivation** - Test on 1000 wallets first
5. **Benchmark metric computation** - Ensure <2h full recompute is feasible

---

*Document Version: 1.0*
*Last Updated: 2026-01-12*
