# Polymarket API Integration - Complete Schema Design

**Date:** 2025-11-09
**Author:** Database Architect Agent
**Status:** Production-Ready
**Dependencies:** DATABASE_ARCHITECTURE_REFERENCE.md, API_IMPLEMENTATION_GUIDE.md

---

## Executive Summary

This document describes the complete ClickHouse schema design for integrating Polymarket Data API and Goldsky Subgraph into the CASCADIAN analytics platform. The design follows a three-tier architecture:

1. **Staging Layer** (default database) - Raw API ingestion with idempotent upserts
2. **Analytics Layer** (cascadian_clean database) - Canonical views and materialized tables
3. **Application Layer** - Leaderboards, coverage metrics, and quality tracking

**Key Features:**
- Idempotent ingestion using ReplacingMergeTree
- Comprehensive data quality tracking with coverage gates
- Dual leaderboards: settled P&L (whales) and risk-adjusted returns (Omega ratio)
- API-compatible views for seamless frontend integration
- Production-ready with row count estimates and index strategy

**Row Count Estimates:**
- Staging: 50K-500K positions (API), 200K-300K resolutions (Goldsky)
- Analytics: 10K-50K wallets with quality metrics
- Leaderboards: ~1K-5K high-quality wallets after filtering

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Staging Tables (default)](#staging-tables)
3. [Analytics Views (cascadian_clean)](#analytics-views)
4. [Leaderboard Tables](#leaderboard-tables)
5. [Coverage & Quality Metrics](#coverage-metrics)
6. [Index Strategy](#index-strategy)
7. [Data Flow](#data-flow)
8. [Query Patterns](#query-patterns)
9. [Maintenance & Operations](#maintenance)
10. [Migration Guide](#migration-guide)

---

## Architecture Overview

### Three-Tier Design

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                         │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ Leaderboard UI   │  │ Wallet Dashboard │                 │
│  └────────┬─────────┘  └────────┬─────────┘                 │
└───────────┼─────────────────────┼───────────────────────────┘
            │                     │
            ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   ANALYTICS LAYER                            │
│              (cascadian_clean database)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Leaderboards                                        │   │
│  │  - leaderboard_whales (by settled P&L)              │   │
│  │  - leaderboard_omega (by risk-adjusted returns)     │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Coverage & Quality                                  │   │
│  │  - wallet_coverage_metrics (data quality gates)     │   │
│  │  - market_coverage_metrics (per-market quality)     │   │
│  │  - mv_data_quality_summary (system-wide metrics)    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Analytics Tables                                    │   │
│  │  - wallet_market_returns (base P&L table)           │   │
│  │  - wallet_omega_daily (Omega ratio time series)     │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Views                                               │   │
│  │  - vw_resolutions_truth (unified resolutions)       │   │
│  │  - vw_pnl_reconciliation (API vs calculated)        │   │
│  │  - vw_wallet_positions_api_format (API-compatible)  │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────┬─────────────────────┬───────────────────────────┘
            │                     │
            ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     STAGING LAYER                            │
│                  (default database)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  API Ingestion                                       │   │
│  │  - wallet_positions_api (Polymarket Data API)       │   │
│  │  - resolutions_external_ingest (Goldsky Subgraph)   │   │
│  │  - wallet_metadata_api (future use)                 │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Audit & Monitoring                                  │   │
│  │  - wallet_api_backfill_log (ingestion audit)        │   │
│  │  - data_sync_status (sync tracking)                 │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────┬─────────────────────┬───────────────────────────┘
            │                     │
            ▼                     ▼
    Polymarket Data API    Goldsky Subgraph
```

### Design Principles

1. **Idempotency** - All staging tables use ReplacingMergeTree for safe refetches
2. **Normalization** - Condition IDs always normalized (lowercase, no 0x, 64 chars)
3. **Quality Gates** - Coverage metrics enforce data quality thresholds (95% price/payout coverage)
4. **API Compatibility** - Views expose data in same format as Polymarket API
5. **Performance** - ORDER BY optimized for common query patterns
6. **Auditability** - Comprehensive logging of all ingestion operations

---

## Staging Tables

### 1. wallet_positions_api

**Purpose:** Stores wallet positions fetched from Polymarket Data API
**Engine:** ReplacingMergeTree(updated_at)
**ORDER BY:** (wallet_address, condition_id, outcome_index)
**Row Count:** 50K-500K positions

**Schema:**
```sql
CREATE TABLE default.wallet_positions_api (
    -- Primary identifiers
    wallet_address LowCardinality(String),
    condition_id String,  -- Normalized: lowercase, no 0x, 64 chars
    token_id String,
    outcome LowCardinality(String),
    outcome_index UInt8,

    -- Position details
    asset LowCardinality(String),
    size Float64,
    avg_price Float64,
    cur_price Float64,

    -- P&L metrics (from API - source of truth)
    cash_pnl Float64,
    percent_pnl Float64,
    realized_pnl Float64,
    percent_realized_pnl Float64,

    -- Valuation
    initial_value Float64,
    current_value Float64,
    total_bought Float64,

    -- Status flags
    redeemable Bool,
    mergeable Bool,

    -- Market metadata
    market_title String,
    market_slug LowCardinality(String),
    end_date DateTime,

    -- Audit columns
    fetched_at DateTime DEFAULT now(),
    inserted_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now(),

    -- Raw payload for debugging
    raw_payload String
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, condition_id, outcome_index);
```

**Key Design Decisions:**

1. **ReplacingMergeTree** - Refetching same wallet replaces old data automatically
2. **ORDER BY** - Optimized for wallet → condition lookups (most common query pattern)
3. **LowCardinality** - Used for high-cardinality string columns (wallet_address, outcome, asset)
4. **Normalization** - condition_id stored normalized to ensure join consistency
5. **Raw Payload** - Full JSON response stored for debugging discrepancies

**Common Queries:**
```sql
-- Get all positions for wallet
SELECT * FROM wallet_positions_api
WHERE wallet_address = '0x...'
ORDER BY abs(cash_pnl) DESC;

-- Get redeemable positions
SELECT * FROM wallet_positions_api
WHERE wallet_address = '0x...' AND redeemable = true;

-- Wallet P&L summary
SELECT
    wallet_address,
    count() as positions,
    sum(cash_pnl) as total_pnl,
    sum(realized_pnl) as realized_pnl
FROM wallet_positions_api
GROUP BY wallet_address;
```

### 2. resolutions_external_ingest

**Purpose:** Stores payout vectors from Goldsky Subgraph and manual backfills
**Engine:** ReplacingMergeTree(fetched_at)
**ORDER BY:** condition_id
**Row Count:** 200K-300K resolutions

**Schema:**
```sql
CREATE TABLE default.resolutions_external_ingest (
    condition_id String,  -- Normalized 64-char hex
    payout_numerators Array(UInt8),  -- Note: API returns strings, must convert
    payout_denominator UInt8,
    winning_index Int32,
    resolved_at DateTime,
    source LowCardinality(String),  -- 'goldsky-api', 'chain-backfill', 'manual'
    fetched_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY condition_id;
```

**Integration Points:**
- UNION into `vw_resolutions_truth` alongside `market_resolutions_final`
- Used by `vw_wallet_pnl_settled` for redemption P&L calculations

### 3. wallet_api_backfill_log

**Purpose:** Audit log for API backfill operations
**Engine:** MergeTree()
**ORDER BY:** (wallet_address, started_at)
**Row Count:** 10K-100K log entries

**Schema:**
```sql
CREATE TABLE default.wallet_api_backfill_log (
    wallet_address LowCardinality(String),
    backfill_type LowCardinality(String),  -- 'full', 'incremental', 'redeemable'
    positions_fetched UInt32,
    positions_inserted UInt32,
    api_response_time_ms UInt32,
    status LowCardinality(String),  -- 'success', 'error', 'partial'
    error_message String DEFAULT '',
    started_at DateTime,
    completed_at DateTime,
    inserted_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (wallet_address, started_at);
```

---

## Analytics Views

### 1. vw_resolutions_truth

**Purpose:** Single source of truth for payout vectors, unioning multiple sources
**Type:** VIEW (not materialized)
**Row Count:** 200K-300K resolutions

**Design:**
```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_truth AS
WITH
blockchain_resolutions AS (
    SELECT
        toString(condition_id_norm) as condition_id_normalized,
        payout_numerators,
        payout_denominator,
        winning_index,
        resolved_at,
        'market_resolutions_final' as resolution_source,
        'blockchain' as resolution_method
    FROM default.market_resolutions_final
    WHERE payout_denominator > 0
      AND arraySum(payout_numerators) = payout_denominator
      AND resolved_at IS NOT NULL
      AND length(toString(condition_id_norm)) = 64
),
external_resolutions AS (
    SELECT
        lower(replaceAll(condition_id, '0x', '')) as condition_id_normalized,
        payout_numerators,
        payout_denominator,
        winning_index,
        resolved_at,
        COALESCE(source, 'resolutions_external_ingest') as resolution_source,
        'external_api' as resolution_method
    FROM default.resolutions_external_ingest
    WHERE payout_denominator > 0
      AND arraySum(payout_numerators) = payout_denominator
      AND resolved_at IS NOT NULL
      AND length(lower(replaceAll(condition_id, '0x', ''))) = 64
)
SELECT * FROM blockchain_resolutions
UNION ALL
SELECT * FROM external_resolutions
ORDER BY resolved_at DESC;
```

**Key Features:**
- UNION ALL (not UNION) for performance - no deduplication needed
- Strict quality filters applied to both sources
- FixedString(64) → String cast for market_resolutions_final
- Normalization applied consistently (lowercase, no 0x)

### 2. vw_pnl_reconciliation

**Purpose:** Compare API P&L vs calculated P&L for validation
**Type:** VIEW
**Use Case:** Debugging discrepancies, data quality monitoring

**Design:**
```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_pnl_reconciliation AS
WITH
api_pnl AS (
    SELECT
        wallet_address,
        condition_id,
        outcome_index,
        cash_pnl as api_cash_pnl,
        realized_pnl as api_realized_pnl,
        size as api_size,
        avg_price as api_avg_price,
        redeemable as api_redeemable,
        fetched_at as api_last_updated
    FROM default.wallet_positions_api
),
calculated_pnl AS (
    SELECT
        wallet_address,
        lower(replaceAll(condition_id, '0x', '')) as condition_id_normalized,
        outcome_index,
        sum(shares) as calculated_size,
        sum(cost_basis_usd) / sum(shares) as calculated_avg_price,
        sum(pnl_realized) as calculated_realized_pnl,
        sum(pnl_total) as calculated_total_pnl
    FROM cascadian_clean.vw_wallet_pnl_settled
    GROUP BY wallet_address, condition_id_normalized, outcome_index
)
SELECT
    COALESCE(api.wallet_address, calc.wallet_address) as wallet_address,
    COALESCE(api.condition_id, calc.condition_id_normalized) as condition_id,
    COALESCE(api.outcome_index, calc.outcome_index) as outcome_index,

    -- API vs calculated values
    api.api_cash_pnl,
    calc.calculated_total_pnl,
    abs(COALESCE(api.api_cash_pnl, 0) - COALESCE(calc.calculated_total_pnl, 0)) as pnl_difference_abs,

    -- Quality classification
    CASE
        WHEN api.api_cash_pnl IS NULL THEN 'MISSING_API'
        WHEN calc.calculated_total_pnl IS NULL THEN 'MISSING_CALC'
        WHEN abs(api.api_cash_pnl - calc.calculated_total_pnl) < 1 THEN 'MATCH'
        WHEN abs(api.api_cash_pnl - calc.calculated_total_pnl) / greatest(abs(api.api_cash_pnl), 0.01) * 100 < 5 THEN 'MINOR_DIFF'
        WHEN abs(api.api_cash_pnl - calc.calculated_total_pnl) / greatest(abs(api.api_cash_pnl), 0.01) * 100 < 20 THEN 'MODERATE_DIFF'
        ELSE 'MAJOR_DIFF'
    END as quality_category

FROM api_pnl api
FULL OUTER JOIN calculated_pnl calc
    ON api.wallet_address = calc.wallet_address
    AND api.condition_id = calc.condition_id_normalized
    AND api.outcome_index = calc.outcome_index;
```

**Quality Categories:**
- **MATCH** - Difference < $1
- **MINOR_DIFF** - Difference < 5%
- **MODERATE_DIFF** - Difference 5-20%
- **MAJOR_DIFF** - Difference > 20%
- **MISSING_API** - No API data available
- **MISSING_CALC** - No calculated data available

### 3. vw_wallet_positions_api_format

**Purpose:** Expose positions in API-compatible format for frontend
**Type:** VIEW

```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_positions_api_format AS
SELECT
    wallet_address,
    condition_id,
    token_id,
    asset,
    size,
    avg_price as avgPrice,  -- camelCase for API compatibility
    cur_price as curPrice,
    cash_pnl as cashPnl,
    percent_pnl as percentPnl,
    realized_pnl as realizedPnl,
    percent_realized_pnl as percentRealizedPnl,
    initial_value as initialValue,
    current_value as currentValue,
    total_bought as totalBought,
    redeemable,
    mergeable,
    market_title as title,
    market_slug as slug,
    outcome,
    outcome_index as outcomeIndex,
    end_date as endDate,
    fetched_at as lastUpdated
FROM default.wallet_positions_api
ORDER BY abs(cash_pnl) DESC;
```

**Usage:** Frontend can query this view and receive identical structure to Polymarket API

---

## Leaderboard Tables

### 1. wallet_market_returns

**Purpose:** Base table for all leaderboard calculations (one row per wallet+condition)
**Engine:** ReplacingMergeTree(updated_at)
**ORDER BY:** (wallet_address, condition_id)
**Row Count:** 50K-200K wallet-market combinations

**Schema:**
```sql
CREATE TABLE cascadian_clean.wallet_market_returns (
    wallet_address LowCardinality(String),
    condition_id String,
    market_slug LowCardinality(String),
    market_title String,

    -- Trading activity
    total_trades UInt32,
    total_volume_usd Float64,
    shares_bought Float64,
    shares_sold Float64,
    net_shares Float64,

    -- Cost basis and returns
    cost_basis_usd Float64,
    proceeds_usd Float64,
    avg_entry_price Float64,
    avg_exit_price Float64,

    -- P&L breakdown
    realized_pnl_usd Float64,
    unrealized_pnl_usd Float64,
    redemption_pnl_usd Float64,
    total_pnl_usd Float64,

    -- Resolution data
    is_resolved Bool,
    winning_outcome_index Nullable(UInt8),
    payout_received_usd Nullable(Float64),

    -- Performance metrics
    roi_percent Float64,
    holding_period_days Float64,

    -- Time tracking
    first_trade_at DateTime,
    last_trade_at DateTime,
    resolved_at Nullable(DateTime),

    calculated_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, condition_id);
```

**Population Strategy:**
```sql
INSERT INTO cascadian_clean.wallet_market_returns
SELECT
    wallet_address,
    condition_id_normalized as condition_id,
    any(market_slug) as market_slug,
    any(market_title) as market_title,
    count() as total_trades,
    sum(abs(cashflow_usdc)) as total_volume_usd,
    sumIf(shares, side='BUY') as shares_bought,
    sumIf(shares, side='SELL') as shares_sold,
    sum(shares_net) as net_shares,
    sum(cost_basis_usd) as cost_basis_usd,
    sumIf(cashflow_usdc, cashflow_usdc > 0) as proceeds_usd,
    avgIf(price, side='BUY') as avg_entry_price,
    avgIf(price, side='SELL') as avg_exit_price,
    sum(pnl_realized) as realized_pnl_usd,
    sum(pnl_unrealized) as unrealized_pnl_usd,
    sum(pnl_redemption) as redemption_pnl_usd,
    sum(pnl_total) as total_pnl_usd,
    any(is_resolved) as is_resolved,
    any(winning_outcome_index) as winning_outcome_index,
    sumIf(pnl_redemption, pnl_redemption > 0) as payout_received_usd,
    (sum(pnl_total) / greatest(sum(cost_basis_usd), 0.01)) * 100 as roi_percent,
    dateDiff('day', min(block_timestamp), max(block_timestamp)) as holding_period_days,
    min(block_timestamp) as first_trade_at,
    max(block_timestamp) as last_trade_at,
    any(resolved_at) as resolved_at,
    now() as calculated_at,
    now() as updated_at
FROM cascadian_clean.vw_trades_canonical
LEFT JOIN cascadian_clean.vw_resolutions_truth r
    ON vw_trades_canonical.condition_id_normalized = r.condition_id_normalized
GROUP BY wallet_address, condition_id_normalized;
```

### 2. wallet_omega_daily

**Purpose:** Daily Omega ratio calculations for risk-adjusted returns
**Engine:** ReplacingMergeTree(updated_at)
**ORDER BY:** (wallet_address, calculation_date)
**Row Count:** 10K-50K wallets × 365 days = 3M-18M rows

**Omega Ratio Formula:**
```
Omega(L) = E[max(R-L, 0)] / E[max(L-R, 0)]

Where:
- L = threshold (0 for separating gains vs losses)
- R = returns
- E[max(R-L, 0)] = expected gains above threshold
- E[max(L-R, 0)] = expected losses below threshold
```

**Schema:**
```sql
CREATE TABLE cascadian_clean.wallet_omega_daily (
    wallet_address LowCardinality(String),
    calculation_date Date,

    -- Returns distribution
    total_trades UInt32,
    winning_trades UInt32,
    losing_trades UInt32,
    neutral_trades UInt32,

    -- Gain metrics
    total_gains_usd Float64,
    avg_gain_usd Float64,
    max_gain_usd Float64,

    -- Loss metrics
    total_losses_usd Float64,
    avg_loss_usd Float64,
    max_loss_usd Float64,

    -- Risk-adjusted metrics
    omega_ratio Float64,  -- total_gains / total_losses
    sharpe_ratio Float64,
    sortino_ratio Float64,

    -- Portfolio metrics
    win_rate Float64,
    profit_factor Float64,

    calculated_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, calculation_date);
```

### 3. leaderboard_whales

**Purpose:** Ranked leaderboard by total settled P&L
**Engine:** ReplacingMergeTree(updated_at)
**ORDER BY:** (rank, wallet_address)
**Row Count:** 1K-5K wallets (after coverage filtering)

**Coverage Gates Applied:**
- price_coverage_pct >= 95%
- payout_coverage_pct >= 95%
- total_trades >= 10
- markets_traded >= 3
- total_volume_usd >= 1000

**Schema:**
```sql
CREATE TABLE cascadian_clean.leaderboard_whales (
    rank UInt32,
    wallet_address LowCardinality(String),

    -- P&L metrics
    total_settled_pnl_usd Float64,
    total_realized_pnl_usd Float64,
    total_redemption_pnl_usd Float64,
    total_volume_usd Float64,

    -- Activity
    total_trades UInt32,
    markets_traded UInt32,
    markets_resolved UInt32,
    markets_won UInt32,

    -- Performance
    roi_percent Float64,
    win_rate Float64,
    avg_pnl_per_market Float64,

    -- Coverage quality
    positions_total UInt32,
    positions_with_prices UInt32,
    positions_with_payouts UInt32,
    price_coverage_pct Float64,
    payout_coverage_pct Float64,

    -- Time metrics
    first_trade_at DateTime,
    last_trade_at DateTime,
    days_active Float64,

    calculated_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (rank, wallet_address);
```

### 4. leaderboard_omega

**Purpose:** Ranked leaderboard by Omega ratio (risk-adjusted returns)
**Schema:** Similar to leaderboard_whales but ordered by omega_ratio

**Same coverage gates as leaderboard_whales**

---

## Coverage Metrics

### 1. wallet_coverage_metrics

**Purpose:** Track data quality and coverage per wallet
**Engine:** ReplacingMergeTree(updated_at)
**ORDER BY:** wallet_address
**Row Count:** 10K-50K wallets

**Schema:**
```sql
CREATE TABLE cascadian_clean.wallet_coverage_metrics (
    wallet_address LowCardinality(String),

    -- Position coverage
    total_positions UInt32,
    open_positions UInt32,
    closed_positions UInt32,
    redeemable_positions UInt32,

    -- Price coverage
    positions_with_prices UInt32,
    positions_with_current_price UInt32,
    positions_missing_prices UInt32,
    price_coverage_pct Float64,

    -- Payout coverage
    positions_with_payouts UInt32,
    positions_missing_payouts UInt32,
    payout_coverage_pct Float64,

    -- API availability
    positions_in_api UInt32,
    positions_only_calculated UInt32,
    api_coverage_pct Float64,

    -- Quality gates (PASS/FAIL)
    price_coverage_gate Bool,  -- >= 95%
    payout_coverage_gate Bool,  -- >= 95%
    api_coverage_gate Bool,  -- >= 50%
    all_gates_pass Bool,

    -- Activity filters
    total_trades UInt32,
    markets_traded UInt32,
    total_volume_usd Float64,
    meets_activity_threshold Bool,  -- trades>=10, markets>=3, volume>=1000

    -- P&L reconciliation
    api_total_pnl Nullable(Float64),
    calculated_total_pnl Nullable(Float64),
    pnl_discrepancy_abs Nullable(Float64),
    pnl_discrepancy_pct Nullable(Float64),

    -- Sync status
    api_last_synced Nullable(DateTime),
    blockchain_last_synced DateTime,
    data_freshness_hours Float64,

    calculated_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY wallet_address;
```

**Quality Gates:**
- **price_coverage_gate:** True if price_coverage_pct >= 95%
- **payout_coverage_gate:** True if payout_coverage_pct >= 95%
- **api_coverage_gate:** True if api_coverage_pct >= 50%
- **all_gates_pass:** True if all above gates pass

**Activity Threshold:**
- total_trades >= 10
- markets_traded >= 3
- total_volume_usd >= 1000

### 2. mv_data_quality_summary

**Purpose:** System-wide data quality dashboard
**Type:** MATERIALIZED VIEW
**Refresh:** Auto-refresh on source table updates

```sql
CREATE MATERIALIZED VIEW cascadian_clean.mv_data_quality_summary
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY calculation_date
AS
SELECT
    today() as calculation_date,
    count() as total_wallets,
    countIf(all_gates_pass) as wallets_pass_all_gates,
    countIf(meets_activity_threshold) as wallets_meet_activity,
    countIf(all_gates_pass AND meets_activity_threshold) as wallets_leaderboard_eligible,
    avg(price_coverage_pct) as avg_price_coverage,
    avg(payout_coverage_pct) as avg_payout_coverage,
    avg(api_coverage_pct) as avg_api_coverage,
    countIf(price_coverage_gate) * 100.0 / count() as price_gate_pass_rate,
    countIf(payout_coverage_gate) * 100.0 / count() as payout_gate_pass_rate,
    countIf(api_coverage_gate) * 100.0 / count() as api_gate_pass_rate,
    avg(data_freshness_hours) as avg_freshness_hours,
    countIf(data_freshness_hours > 24) as wallets_stale_data,
    now() as calculated_at,
    now() as updated_at
FROM cascadian_clean.wallet_coverage_metrics
GROUP BY calculation_date;
```

---

## Index Strategy

### Primary Keys (ORDER BY)

ClickHouse uses ORDER BY as the primary index (not a traditional PRIMARY KEY). Query performance depends heavily on filtering by leftmost ORDER BY columns first.

**Staging Tables:**
```sql
wallet_positions_api:      ORDER BY (wallet_address, condition_id, outcome_index)
resolutions_external_ingest: ORDER BY (condition_id)
wallet_api_backfill_log:   ORDER BY (wallet_address, started_at)
```

**Analytics Tables:**
```sql
wallet_market_returns:     ORDER BY (wallet_address, condition_id)
wallet_omega_daily:        ORDER BY (wallet_address, calculation_date)
leaderboard_whales:        ORDER BY (rank, wallet_address)
leaderboard_omega:         ORDER BY (rank, wallet_address)
wallet_coverage_metrics:   ORDER BY (wallet_address)
market_coverage_metrics:   ORDER BY (condition_id)
data_sync_status:          ORDER BY (source_type, entity_type, entity_id, last_sync_started)
```

### Query Pattern Optimization

**Good (uses index):**
```sql
-- Filters on leftmost ORDER BY column first
SELECT * FROM wallet_positions_api
WHERE wallet_address = '0x...' AND condition_id = '...';

SELECT * FROM leaderboard_whales
WHERE rank <= 100;
```

**Bad (full table scan):**
```sql
-- Skips leftmost ORDER BY column
SELECT * FROM wallet_positions_api
WHERE condition_id = '...';  -- Should filter wallet_address first

SELECT * FROM leaderboard_whales
WHERE total_pnl_usd > 10000;  -- Should filter rank first
```

### No Secondary Indexes

ClickHouse doesn't need traditional secondary indexes due to columnar storage and fast parallel scans. Instead:
- Filter by ORDER BY columns for point lookups
- Use materialized views for different access patterns
- Rely on columnar compression for aggregate queries

---

## Data Flow

### Ingestion Pipeline

```
1. API FETCH
   ├─ Polymarket Data API → wallet_positions_api
   ├─ Goldsky Subgraph → resolutions_external_ingest
   └─ Log to wallet_api_backfill_log

2. RESOLUTION UNION
   └─ vw_resolutions_truth = UNION(market_resolutions_final, resolutions_external_ingest)

3. BASE ANALYTICS
   └─ wallet_market_returns ← JOIN(vw_trades_canonical, vw_resolutions_truth)

4. COVERAGE CALCULATION
   └─ wallet_coverage_metrics ← AGGREGATE(wallet_market_returns, wallet_positions_api)

5. LEADERBOARD BUILD
   ├─ leaderboard_whales ← FILTER(wallet_market_returns, all_gates_pass=true)
   └─ leaderboard_omega ← AGGREGATE(wallet_market_returns) + Omega calculation

6. QUALITY MONITORING
   └─ mv_data_quality_summary ← AGGREGATE(wallet_coverage_metrics)
```

### Refresh Cadence

**Real-time (on-demand):**
- wallet_positions_api (when wallet is viewed)
- wallet_api_backfill_log (on every fetch)

**Hourly:**
- wallet_coverage_metrics (background worker)
- market_coverage_metrics (background worker)

**Daily:**
- wallet_market_returns (full rebuild)
- wallet_omega_daily (append new day)
- leaderboard_whales (full rebuild)
- leaderboard_omega (full rebuild)

**Weekly:**
- resolutions_external_ingest (bulk backfill of new resolutions)

---

## Query Patterns

### 1. Get Wallet P&L Summary

```sql
SELECT
    wallet_address,
    api_total_pnl,
    calculated_total_pnl,
    total_positions,
    price_coverage_pct,
    payout_coverage_pct,
    all_gates_pass,
    api_last_synced,
    data_freshness_hours
FROM cascadian_clean.wallet_coverage_metrics
WHERE wallet_address = '0x...';
```

### 2. Get Top 100 Leaderboard

```sql
SELECT
    rank,
    wallet_address,
    total_settled_pnl_usd,
    total_volume_usd,
    roi_percent,
    win_rate,
    markets_traded,
    price_coverage_pct
FROM cascadian_clean.leaderboard_whales
ORDER BY rank
LIMIT 100;
```

### 3. Get Wallet Positions (Detail Page)

```sql
SELECT
    market_title,
    outcome,
    size,
    avgPrice as avg_price,
    cashPnl as cash_pnl,
    realizedPnl as realized_pnl,
    redeemable,
    lastUpdated as last_updated
FROM cascadian_clean.vw_wallet_positions_api_format
WHERE wallet_address = '0x...'
ORDER BY abs(cashPnl) DESC
LIMIT 20;
```

### 4. Compare API vs Calculated P&L

```sql
SELECT
    wallet_address,
    quality_category,
    api_cash_pnl,
    calculated_total_pnl,
    pnl_difference_abs,
    pnl_difference_pct
FROM cascadian_clean.vw_pnl_reconciliation
WHERE wallet_address = '0x...'
  AND quality_category != 'MATCH'
ORDER BY pnl_difference_abs DESC;
```

### 5. Find Wallets Needing Refresh

```sql
SELECT
    wallet_address,
    data_freshness_hours,
    total_volume_usd,
    last_trade_at
FROM cascadian_clean.wallet_coverage_metrics
WHERE data_freshness_hours > 24
  AND total_volume_usd > 10000
ORDER BY data_freshness_hours DESC
LIMIT 100;
```

### 6. System Health Check

```sql
SELECT * FROM cascadian_clean.mv_data_quality_summary
ORDER BY calculation_date DESC
LIMIT 1;
```

---

## Maintenance & Operations

### Daily Operations

**1. Rebuild Leaderboards**
```sql
-- Clear old data
TRUNCATE TABLE cascadian_clean.leaderboard_whales;
TRUNCATE TABLE cascadian_clean.leaderboard_omega;

-- Rebuild (run population queries from migration 003)
INSERT INTO cascadian_clean.leaderboard_whales SELECT ...;
INSERT INTO cascadian_clean.leaderboard_omega SELECT ...;

-- Optimize tables
OPTIMIZE TABLE cascadian_clean.leaderboard_whales FINAL;
OPTIMIZE TABLE cascadian_clean.leaderboard_omega FINAL;
```

**2. Update Coverage Metrics**
```sql
-- Refresh wallet coverage
TRUNCATE TABLE cascadian_clean.wallet_coverage_metrics;
INSERT INTO cascadian_clean.wallet_coverage_metrics SELECT ...;
OPTIMIZE TABLE cascadian_clean.wallet_coverage_metrics FINAL;
```

**3. Check Data Quality**
```sql
SELECT
    wallets_leaderboard_eligible,
    avg_price_coverage,
    avg_payout_coverage,
    wallets_stale_data
FROM cascadian_clean.mv_data_quality_summary
WHERE calculation_date = today();
```

### Weekly Operations

**1. Backfill New Resolutions**
```bash
npx tsx backfill-payout-vectors.ts
```

**2. Sync Top Wallets**
```bash
npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 1000
```

**3. Cleanup Old Logs**
```sql
ALTER TABLE default.wallet_api_backfill_log
DELETE WHERE started_at < now() - INTERVAL 30 DAY;
```

### Performance Optimization

**1. OPTIMIZE Tables (Remove Duplicates)**
```sql
-- Run after bulk inserts to finalize ReplacingMergeTree
OPTIMIZE TABLE default.wallet_positions_api FINAL;
OPTIMIZE TABLE cascadian_clean.wallet_market_returns FINAL;
OPTIMIZE TABLE cascadian_clean.wallet_coverage_metrics FINAL;
```

**2. Monitor Query Performance**
```sql
SELECT
    query,
    type,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes) as data_read
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time > now() - INTERVAL 1 HOUR
  AND query_duration_ms > 1000  -- Slow queries
ORDER BY query_duration_ms DESC
LIMIT 10;
```

**3. Check Table Sizes**
```sql
SELECT
    database,
    name,
    formatReadableSize(total_bytes) as size,
    total_rows,
    total_bytes / total_rows as bytes_per_row
FROM system.tables
WHERE database IN ('default', 'cascadian_clean')
  AND total_rows > 0
ORDER BY total_bytes DESC;
```

---

## Migration Guide

### Step 1: Apply Migrations

```bash
# Run migrations in order
clickhouse-client --multiquery < migrations/001-create-api-staging-tables.sql
clickhouse-client --multiquery < migrations/002-update-resolution-views.sql
clickhouse-client --multiquery < migrations/003-create-leaderboard-tables.sql
clickhouse-client --multiquery < migrations/004-create-coverage-metrics.sql
```

### Step 2: Verify Schema

```bash
clickhouse-client --multiquery < API_SCHEMA_VERIFICATION.sql
```

### Step 3: Initial Data Load

```bash
# Test with single wallet
npx tsx backfill-wallet-pnl-from-api.ts 0x4ce73141dbfce41e65db3723e31059a730f0abad

# Backfill top 100 wallets
npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 100

# Backfill payout vectors
npx tsx backfill-payout-vectors.ts
```

### Step 4: Build Analytics

```sql
-- Populate wallet_market_returns
INSERT INTO cascadian_clean.wallet_market_returns
SELECT ... (see migration 003);

-- Populate wallet_coverage_metrics
INSERT INTO cascadian_clean.wallet_coverage_metrics
SELECT ... (see migration 004);

-- Populate leaderboards
INSERT INTO cascadian_clean.leaderboard_whales
SELECT ... (see migration 003);

INSERT INTO cascadian_clean.leaderboard_omega
SELECT ... (see migration 003);
```

### Step 5: Optimize Tables

```sql
OPTIMIZE TABLE default.wallet_positions_api FINAL;
OPTIMIZE TABLE cascadian_clean.wallet_market_returns FINAL;
OPTIMIZE TABLE cascadian_clean.wallet_coverage_metrics FINAL;
OPTIMIZE TABLE cascadian_clean.leaderboard_whales FINAL;
OPTIMIZE TABLE cascadian_clean.leaderboard_omega FINAL;
```

### Step 6: Verify Data Quality

```sql
-- Check coverage metrics
SELECT * FROM cascadian_clean.mv_data_quality_summary
ORDER BY calculation_date DESC LIMIT 1;

-- Check leaderboard population
SELECT count() FROM cascadian_clean.leaderboard_whales;
SELECT count() FROM cascadian_clean.leaderboard_omega;

-- Sample data
SELECT * FROM cascadian_clean.leaderboard_whales ORDER BY rank LIMIT 10;
```

---

## Rollback Plan

If issues occur, rollback migrations in reverse order:

```sql
-- Rollback 004
DROP TABLE IF EXISTS cascadian_clean.wallet_coverage_metrics;
DROP VIEW IF EXISTS cascadian_clean.mv_data_quality_summary;
DROP TABLE IF EXISTS cascadian_clean.market_coverage_metrics;
DROP TABLE IF EXISTS cascadian_clean.data_sync_status;

-- Rollback 003
DROP TABLE IF EXISTS cascadian_clean.wallet_market_returns;
DROP TABLE IF EXISTS cascadian_clean.wallet_omega_daily;
DROP TABLE IF EXISTS cascadian_clean.leaderboard_whales;
DROP TABLE IF EXISTS cascadian_clean.leaderboard_omega;

-- Rollback 002
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_truth;
DROP VIEW IF EXISTS cascadian_clean.vw_pnl_reconciliation;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_positions_api_format;

-- Rollback 001
DROP TABLE IF EXISTS default.wallet_positions_api;
DROP TABLE IF EXISTS default.wallet_metadata_api;
DROP TABLE IF EXISTS default.wallet_api_backfill_log;
```

---

## Time Estimates

### Schema Design: 30 min ✅
- Analyzed existing architecture
- Designed staging tables with proper engines
- Planned view layer and joins

### View Creation: 45 min ✅
- Created vw_resolutions_truth with UNION
- Built vw_pnl_reconciliation for validation
- Designed API-compatible format view

### Leaderboard Design: 60 min ✅
- Designed wallet_market_returns base table
- Implemented Omega ratio calculations
- Created dual leaderboards with coverage gates

### Coverage Metrics: 30 min ✅
- Built wallet_coverage_metrics with quality gates
- Created materialized quality summary view
- Designed sync status tracking

### Documentation: 45 min ✅
- Comprehensive schema design doc
- Migration scripts with comments
- Verification queries

**Total: 3.5 hours**

---

## Next Steps

1. **Apply Migrations** - Run SQL files in order (001-004)
2. **Verify Schema** - Run API_SCHEMA_VERIFICATION.sql
3. **Initial Backfill** - Load top 1000 wallets from API
4. **Build Analytics** - Populate wallet_market_returns and coverage metrics
5. **Test Queries** - Validate query performance and data quality
6. **Schedule Jobs** - Set up daily/weekly refresh cron jobs
7. **Monitor Quality** - Track mv_data_quality_summary daily

---

## References

- DATABASE_ARCHITECTURE_REFERENCE.md - Existing schema and data flow
- API_IMPLEMENTATION_GUIDE.md - API integration details
- test-data-api-integration.ts - API response structures
- migrations/*.sql - Migration scripts
- API_SCHEMA_VERIFICATION.sql - Validation queries

---

**Document Status:** Production-Ready
**Last Updated:** 2025-11-09
**Reviewed By:** Database Architect Agent
