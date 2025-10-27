# Cascadian App - Complete Database Structure & Data Flow Documentation

Generated: 2025-10-26

---

## Table of Contents
1. [Database Architecture Overview](#database-architecture-overview)
2. [Supabase PostgreSQL Schema](#supabase-postgresql-schema)
3. [ClickHouse Analytics Schema](#clickhouse-analytics-schema)
4. [External Data Sources](#external-data-sources)
5. [API Endpoints](#api-endpoints)
6. [Data Flow Patterns](#data-flow-patterns)
7. [Key Metrics & Calculations](#key-metrics--calculations)

---

## Database Architecture Overview

### Core Systems:
- **Supabase PostgreSQL**: Primary OLTP database (operational data, wallets, markets, strategies)
- **ClickHouse**: Analytical OLAP database (time-series metrics, performance analytics, 102+ metrics per wallet)
- **Goldsky GraphQL API**: Real-time blockchain data source (positions, trades, PnL data)
- **Polymarket Data-API**: Market and trade data from Polymarket protocol

### Key Principles:
- **Separation of Concerns**: Supabase stores operational data, ClickHouse stores analytical metrics
- **Lazy Calculation**: Metrics computed on-demand and cached
- **Multiple Time Windows**: Metrics calculated for 7d, 30d, 90d, and lifetime windows
- **Smart Money Flow**: Identify high-performing wallets and their market positions

---

## Supabase PostgreSQL Schema

### A. Market Data Tables

#### `markets` (PRIMARY KEY: market_id)
**Purpose**: Current state of all Polymarket markets
**Data Source**: Polymarket API (via sync jobs)
**Update Frequency**: Periodic syncs (configurable)

| Column | Type | Purpose |
|--------|------|---------|
| market_id | TEXT | Unique market identifier from Polymarket |
| title | TEXT | Market question |
| slug | TEXT | URL-friendly slug |
| condition_id | TEXT | Polymarket condition ID (links to outcomes) |
| category | TEXT | Market category (Politics, Crypto, Sports, etc.) |
| outcomes | TEXT[] | Array of outcome names ["YES", "NO"] |
| current_price | NUMERIC(18,8) | Current YES outcome price (0-1) |
| volume_24h | NUMERIC(18,2) | Trading volume USD (last 24h) |
| volume_total | NUMERIC(18,2) | Lifetime trading volume |
| liquidity | NUMERIC(18,2) | Available liquidity in USD |
| active | BOOLEAN | Is market currently active? |
| closed | BOOLEAN | Has market resolved? |
| end_date | TIMESTAMPTZ | Market resolution date |
| momentum_score | NUMERIC(5,2) | Phase 2: Market momentum (-100 to +100) |
| sii_score | NUMERIC(5,2) | Phase 2: Smart Imbalance Index (-100 to +100) |
| smart_money_delta | NUMERIC(5,4) | Phase 2: Net smart money flow (-1 to +1) |
| last_trade_timestamp | TIMESTAMPTZ | When last trade occurred |
| raw_polymarket_data | JSONB | Complete API response (for debugging) |
| created_at, updated_at | TIMESTAMPTZ | Timestamps |

**Key Indexes**: active, category, volume_24h, end_date, title (fuzzy), momentum_score, sii_score

---

#### `market_analytics` (PRIMARY KEY: market_id)
**Purpose**: Aggregated trade metrics from CLOB API
**Data Source**: Polymarket CLOB Trades API (aggregated)
**Update Frequency**: Hourly or on-demand

| Column | Type | Purpose |
|--------|------|---------|
| market_id | TEXT | Foreign key to markets |
| condition_id | TEXT | Polymarket condition ID |
| trades_24h | INTEGER | Total trades in last 24h |
| buyers_24h | INTEGER | Unique buyers in 24h window |
| sellers_24h | INTEGER | Unique sellers in 24h window |
| buy_volume_24h | NUMERIC(18,2) | BUY side volume (USD) |
| sell_volume_24h | NUMERIC(18,2) | SELL side volume (USD) |
| buy_sell_ratio | NUMERIC(10,4) | buyers / sellers (sentiment indicator) |
| momentum_score | NUMERIC(10,4) | Price velocity metric |
| price_change_24h | NUMERIC(10,4) | Percentage price change (24h) |
| last_aggregated_at | TIMESTAMPTZ | When metrics were last calculated |

**Key Indexes**: trades_24h, momentum_score, buy_sell_ratio

---

#### `market_sii` (PRIMARY KEY: market_id)
**Purpose**: Smart Investor Index - which side has smarter money (higher Omega scores)
**Data Source**: Calculated from wallet_scores (on-demand refresh)
**Materialized**: Yes - cached results

| Column | Type | Purpose |
|--------|------|---------|
| market_id | TEXT | Market identifier |
| smart_money_side | TEXT | 'YES' \| 'NO' \| 'NEUTRAL' |
| yes_top_wallets | TEXT[] | Top 20 wallet addresses on YES |
| yes_avg_omega | DECIMAL(10,4) | Average Omega score on YES side |
| yes_total_volume | DECIMAL(18,2) | Total volume on YES side |
| yes_wallet_count | INTEGER | Count of YES-side wallets analyzed |
| no_top_wallets | TEXT[] | Top 20 wallet addresses on NO |
| no_avg_omega | DECIMAL(10,4) | Average Omega score on NO side |
| no_total_volume | DECIMAL(18,2) | Total volume on NO side |
| no_wallet_count | INTEGER | Count of NO-side wallets analyzed |
| omega_differential | DECIMAL(10,4) | YES avg Omega - NO avg Omega |
| signal_strength | DECIMAL(5,4) | Signal conviction (0.0 to 1.0) |
| confidence_score | DECIMAL(5,4) | Confidence based on sample quality |
| market_question | TEXT | Market title for quick display |
| current_yes_price | DECIMAL(5,4) | Current YES price |
| current_no_price | DECIMAL(5,4) | Current NO price |
| calculated_at | TIMESTAMPTZ | When SII was calculated |

**Query Pattern**: Find strongest SII signals by signal_strength DESC

---

### B. Wallet Performance Tables

#### `wallets` (PRIMARY KEY: wallet_address)
**Purpose**: Master wallet metadata and aggregated metrics
**Data Source**: Discovered from Goldsky and market participation
**Update Frequency**: Periodic sync (when data changes)

| Column | Type | Purpose |
|--------|------|---------|
| wallet_address | TEXT | Ethereum wallet address |
| wallet_alias | TEXT | User-assigned or auto-generated name |
| ens_name | TEXT | ENS domain if resolved |
| is_whale | BOOLEAN | Identified as large trader? |
| whale_score | NUMERIC(5,2) | Whale classification score (0-100) |
| is_suspected_insider | BOOLEAN | Insider detection flag |
| insider_score | NUMERIC(5,2) | Insider score (0-100) |
| total_volume_usd | NUMERIC(18,2) | Lifetime trading volume |
| total_trades | INTEGER | Total trades executed |
| total_markets_traded | INTEGER | Count of unique markets |
| realized_pnl_usd | NUMERIC(18,2) | Closed position PnL |
| unrealized_pnl_usd | NUMERIC(18,2) | Open position PnL |
| total_pnl_usd | NUMERIC(18,2) | Total PnL (realized + unrealized) |
| win_rate | NUMERIC(5,4) | Win rate (0.0 to 1.0) |
| first_seen_at | TIMESTAMPTZ | First trade timestamp |
| last_seen_at | TIMESTAMPTZ | Most recent trade timestamp |
| active_positions_count | INTEGER | Currently open positions |
| closed_positions_count | INTEGER | Resolved positions |
| portfolio_value_usd | NUMERIC(18,2) | Current portfolio value |

**Key Indexes**: whale_score, insider_score, total_volume_usd, last_seen_at, total_pnl_usd

---

#### `wallet_scores` (PRIMARY KEY: wallet_address)
**Purpose**: Pre-calculated Omega scores and performance metrics
**Data Source**: Calculated from wallet_closed_positions via Goldsky PnL API
**Update Frequency**: On-demand or scheduled
**Caching**: 1 hour TTL (customizable)

| Column | Type | Purpose |
|--------|------|---------|
| wallet_address | TEXT | Wallet identifier |
| omega_ratio | DECIMAL(10,4) | Gains / Losses ratio (higher = better) |
| omega_momentum | DECIMAL(10,4) | Rate of change in Omega (improving/declining) |
| total_positions | INTEGER | Total open + closed positions |
| closed_positions | INTEGER | Resolved positions only |
| total_pnl | DECIMAL(18,2) | Net P&L (USD) |
| total_gains | DECIMAL(18,2) | Sum of positive PnLs |
| total_losses | DECIMAL(18,2) | Sum of negative PnLs (absolute value) |
| win_rate | DECIMAL(5,4) | Winning trades / total trades |
| avg_gain | DECIMAL(18,2) | Average profit per winning trade |
| avg_loss | DECIMAL(18,2) | Average loss per losing trade |
| momentum_direction | TEXT | 'improving' \| 'declining' \| 'stable' \| 'insufficient_data' |
| grade | TEXT | Letter grade: S, A, B, C, D, F |
| meets_minimum_trades | BOOLEAN | >= 5 closed trades? (Austin requirement) |
| calculated_at | TIMESTAMPTZ | When score was calculated |

**Grading Scale**:
- S: Omega >= 3.0
- A: Omega >= 2.0
- B: Omega >= 1.5
- C: Omega >= 1.0
- D: Omega >= 0.5
- F: Omega < 0.5

**Key Indexes**: omega_ratio (for rankings), omega_momentum, grade, meets_minimum_trades

---

#### `wallet_scores_by_category` (UNIQUE: wallet_address + category)
**Purpose**: Omega scores and performance broken down by market category
**Data Source**: Same as wallet_scores, but filtered per category
**Update Frequency**: On-demand or scheduled

| Column | Type | Purpose |
|--------|------|---------|
| wallet_address | TEXT | Wallet address |
| category | TEXT | Market category (Politics, Crypto, Sports, etc.) |
| omega_ratio | DECIMAL(10,4) | Omega in this category |
| omega_momentum | DECIMAL(10,4) | Momentum in this category |
| total_positions | INTEGER | Positions in category |
| closed_positions | INTEGER | Closed positions in category |
| total_pnl | DECIMAL(18,2) | PnL in category |
| total_gains, total_losses | DECIMAL(18,2) | Gains/losses in category |
| win_rate | DECIMAL(5,4) | Win rate in category |
| avg_gain, avg_loss | DECIMAL(18,2) | Average per trade in category |
| roi_per_bet | DECIMAL(18,2) | PnL / closed_positions |
| overall_roi | DECIMAL(10,4) | PnL / (gains + losses) |
| grade | TEXT | Letter grade for this category |
| meets_minimum_trades | BOOLEAN | >= 5 trades in category? |

**Key Use Case**: "Best traders in Politics", "Best cryptobet predictors", etc.

---

#### `wallet_positions` (UNIQUE: wallet_address + market_id + outcome)
**Purpose**: Current open positions for each wallet
**Data Source**: Goldsky Positions subgraph (cached, refreshed on page load)
**Update Frequency**: On-demand (when wallet detail page is viewed)

| Column | Type | Purpose |
|--------|------|---------|
| id | BIGSERIAL | Primary key |
| wallet_address | TEXT | Wallet reference |
| market_id | TEXT | Market reference |
| market_title | TEXT | Human-readable market name |
| condition_id | TEXT | Outcome condition ID |
| outcome | TEXT | 'YES' or 'NO' |
| shares | NUMERIC(18,8) | Position size |
| entry_price | NUMERIC(18,8) | Entry price |
| current_price | NUMERIC(18,8) | Current market price |
| position_value_usd | NUMERIC(18,2) | Current value (shares * price) |
| unrealized_pnl_usd | NUMERIC(18,2) | Unrealized profit/loss |
| opened_at | TIMESTAMPTZ | Position opening timestamp |
| last_updated | TIMESTAMPTZ | When position was refreshed |

---

#### `wallet_trades` (UNIQUE: trade_id)
**Purpose**: Complete trade history for each wallet
**Data Source**: Goldsky PnL subgraph (immutable log)
**Update Frequency**: Incremental sync (new trades only)

| Column | Type | Purpose |
|--------|------|---------|
| id | BIGSERIAL | Primary key |
| trade_id | TEXT | External trade ID (unique) |
| wallet_address | TEXT | Wallet reference |
| market_id | TEXT | Market reference |
| side | TEXT | 'BUY' or 'SELL' |
| outcome | TEXT | 'YES' or 'NO' |
| shares | NUMERIC(18,8) | Trade size |
| price | NUMERIC(18,8) | Execution price |
| amount_usd | NUMERIC(18,2) | Trade value in USD |
| executed_at | TIMESTAMPTZ | Trade execution time |
| market_price_before | NUMERIC(18,8) | Price 1 hour before trade |
| market_price_after | NUMERIC(18,8) | Price 1 hour after trade |
| timing_score | NUMERIC(5,2) | Insider timing metric (0-100) |
| fetched_at | TIMESTAMPTZ | When data was fetched |

**Insider Detection**: timing_score measures how prescient the trade was (early entries into winning bets)

---

#### `wallet_closed_positions` (UNIQUE: position_id)
**Purpose**: Historical closed positions with realized PnL
**Data Source**: Goldsky PnL subgraph
**Update Frequency**: When positions are resolved

| Column | Type | Purpose |
|--------|------|---------|
| position_id | TEXT | Unique position identifier |
| wallet_address | TEXT | Wallet reference |
| market_id | TEXT | Market reference |
| outcome | TEXT | 'YES' or 'NO' |
| shares | NUMERIC(18,8) | Position size |
| entry_price | NUMERIC(18,8) | Entry price |
| exit_price | NUMERIC(18,8) | Exit/resolution price |
| realized_pnl_usd | NUMERIC(18,2) | Profit/loss in USD |
| is_win | BOOLEAN | PnL > 0? |
| opened_at | TIMESTAMPTZ | Position entry time |
| closed_at | TIMESTAMPTZ | Position close time |
| hold_duration_hours | INTEGER | Time position was held |

---

#### `wallet_pnl_snapshots` (UNIQUE: wallet_address + snapshot_at)
**Purpose**: Time-series snapshots for PnL graphs and history
**Data Source**: Calculated from wallet_closed_positions
**Update Frequency**: Periodic (daily or on-demand)
**Use Case**: Historical portfolio value graphs

| Column | Type | Purpose |
|--------|------|---------|
| wallet_address | TEXT | Wallet reference |
| snapshot_at | TIMESTAMPTZ | Snapshot timestamp |
| portfolio_value_usd | NUMERIC(18,2) | Portfolio value at this time |
| realized_pnl_usd | NUMERIC(18,2) | Realized PnL to date |
| unrealized_pnl_usd | NUMERIC(18,2) | Unrealized PnL at this time |
| total_pnl_usd | NUMERIC(18,2) | Total PnL at this time |
| active_positions | INTEGER | Open positions at this time |
| closed_positions | INTEGER | Closed positions at this time |
| win_rate | NUMERIC(5,4) | Win rate at this time |
| roi | NUMERIC(10,4) | Return on investment % |

---

#### `market_holders` (UNIQUE: market_id + wallet_address + outcome)
**Purpose**: Top holders per market (whale concentration analysis)
**Data Source**: Goldsky Positions subgraph
**Update Frequency**: Periodic refresh

| Column | Type | Purpose |
|--------|------|---------|
| market_id | TEXT | Market reference |
| wallet_address | TEXT | Holder address |
| outcome | TEXT | 'YES' or 'NO' |
| shares | NUMERIC(18,8) | Position size |
| position_value_usd | NUMERIC(18,2) | Value of position |
| market_share_percentage | NUMERIC(5,4) | % of total market supply |
| rank | INTEGER | Holder rank (1 = largest) |
| last_updated | TIMESTAMPTZ | When data was last updated |

---

#### `whale_activity_log` (PRIMARY KEY: id)
**Purpose**: Pre-aggregated whale activity for real-time feeds
**Data Source**: Derived from wallet_trades
**Update Frequency**: Real-time (on each trade)

| Column | Type | Purpose |
|--------|------|---------|
| id | BIGSERIAL | Primary key |
| wallet_address | TEXT | Whale address |
| wallet_alias | TEXT | Whale nickname |
| activity_type | TEXT | 'TRADE' \| 'POSITION_FLIP' \| 'LARGE_MOVE' |
| market_id | TEXT | Market reference |
| market_title | TEXT | Market question |
| side | TEXT | 'BUY' or 'SELL' (if trade) |
| outcome | TEXT | 'YES' or 'NO' |
| shares | NUMERIC(18,8) | Trade size |
| price | NUMERIC(18,8) | Trade price |
| amount_usd | NUMERIC(18,2) | Trade value |
| impact_score | NUMERIC(5,2) | Significance (0-100) |
| occurred_at | TIMESTAMPTZ | When activity occurred |
| created_at | TIMESTAMPTZ | When logged |

---

### C. Discovery & Tracking Tables

#### `discovered_wallets` (PRIMARY KEY: wallet_address)
**Purpose**: Master registry of all known Polymarket wallets
**Data Source**: Multiple sources (PnL subgraph, markets DB, activity subgraph)
**Update Frequency**: Continuous discovery

| Column | Type | Purpose |
|--------|------|---------|
| wallet_address | TEXT | Wallet address (primary key) |
| discovery_sources | TEXT[] | Array of discovery sources |
| discovered_at | TIMESTAMPTZ | When first discovered |
| needs_sync | BOOLEAN | Needs historical trade sync? |
| last_synced_at | TIMESTAMPTZ | When last synced to ClickHouse |
| sync_attempts | INTEGER | Number of sync attempts |
| sync_error | TEXT | Last error message (if any) |
| created_at, updated_at | TIMESTAMPTZ | Timestamps |

**Views**:
- `wallets_needing_sync`: Priority queue of wallets to sync
- `discovery_stats`: Summary statistics
- `wallets_by_source`: Breakdown by source

---

#### `watchlist_markets` (UNIQUE: market_id)
**Purpose**: User-selected markets for live tracking (cost management)
**Data Source**: User selections + auto-add from strategies
**Update Frequency**: On user selection or strategy trigger

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| market_id | TEXT | Market identifier |
| market_slug | TEXT | URL slug |
| condition_id | TEXT | Outcome condition |
| category | TEXT | Market category |
| question | TEXT | Market question |
| added_by_user_id | UUID | User who added it |
| auto_added | BOOLEAN | Added by strategy? |
| auto_added_reason | TEXT | Why auto-added |
| priority | INT | Sort priority |
| created_at, updated_at | TIMESTAMPTZ | Timestamps |

---

#### `watchlist_wallets` (UNIQUE: wallet_address)
**Purpose**: Elite wallets to monitor for signals and copy trading
**Data Source**: User selections + strategy discoveries

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| wallet_address | TEXT | Wallet to watch |
| omega_score | DECIMAL(10,4) | Cached Omega score |
| win_rate | DECIMAL(5,4) | Cached win rate |
| closed_positions | INT | Cached position count |
| category | TEXT | Primary category focus |
| grade | TEXT | Cached grade |
| added_by_user_id | UUID | User who added it |
| auto_added | BOOLEAN | Added by strategy? |
| auto_added_reason | TEXT | Why auto-added |
| last_trade_detected_at | TIMESTAMPTZ | When last trade occurred |
| total_signals_generated | INT | Signals this wallet triggered |

---

### D. Workflow & Strategy Tables

#### `workflow_sessions` (PRIMARY KEY: id)
**Purpose**: User-created AI workflows using ReactFlow visual canvas
**Data Source**: User input
**Version**: Full version control support

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| user_id | UUID | Owner user ID |
| name | TEXT | Workflow name |
| description | TEXT | Workflow description |
| nodes | JSONB | ReactFlow nodes array |
| edges | JSONB | ReactFlow edges array |
| trigger | JSONB | Trigger config (manual/schedule/continuous) |
| variables | JSONB | User-defined variables |
| version | INTEGER | Version number |
| is_current_version | BOOLEAN | Is this the current version? |
| parent_workflow_id | UUID | Previous version (if versioned) |
| tags | TEXT[] | Organization tags |
| is_template | BOOLEAN | Public template? |
| is_favorite | BOOLEAN | User favorite? |
| folder | TEXT | Organization folder |
| status | TEXT | 'draft' \| 'active' \| 'paused' \| 'archived' |
| last_executed_at | TIMESTAMPTZ | Last execution time |
| execution_count | INTEGER | Total executions |
| created_at, updated_at | TIMESTAMPTZ | Timestamps |

---

#### `workflow_executions` (PRIMARY KEY: id)
**Purpose**: Audit trail of workflow executions and results
**Data Source**: Workflow execution engine

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| workflow_id | UUID | Workflow reference |
| user_id | UUID | User who triggered |
| execution_started_at | TIMESTAMPTZ | Start time |
| execution_completed_at | TIMESTAMPTZ | End time |
| duration_ms | INTEGER | Duration in milliseconds |
| status | TEXT | 'running' \| 'completed' \| 'failed' \| 'cancelled' |
| nodes_executed | INTEGER | How many nodes ran |
| outputs | JSONB | Results by node ID |
| errors | JSONB | Error details (array) |
| workflow_snapshot | JSONB | Workflow state at execution |

---

#### `strategy_definitions` (PRIMARY KEY: strategy_id)
**Purpose**: User-created and predefined strategies (node-based)
**Data Source**: 11 predefined + user creations
**Execution**: Manual, Auto, or Scheduled

| Column | Type | Purpose |
|--------|------|---------|
| strategy_id | UUID | Primary key |
| strategy_name | TEXT | Human-readable name |
| strategy_description | TEXT | What it does |
| strategy_type | TEXT | 'SCREENING' \| 'MOMENTUM' \| 'ARBITRAGE' \| 'CUSTOM' |
| is_predefined | BOOLEAN | Built-in strategy? |
| node_graph | JSONB | Node/edge structure (DATA_SOURCE, FILTER, LOGIC, etc.) |
| execution_mode | TEXT | 'MANUAL' \| 'AUTO' \| 'SCHEDULED' |
| schedule_cron | TEXT | Cron expression (if scheduled) |
| is_active | BOOLEAN | Enabled? |
| total_executions | INTEGER | Times executed |
| last_executed_at | TIMESTAMPTZ | Last run |
| avg_execution_time_ms | INTEGER | Average runtime |
| created_by | UUID | Creator user ID |
| version | INTEGER | Version number |
| parent_strategy_id | UUID | Parent (if forked) |

**Predefined Strategies** (11 seeded):
1. Omega Screener (>= 2.0 Omega, >= 10 trades)
2. Balanced Hybrid (2.0 Omega, good risk management)
3. Category Specialists (Top performers in each category)
...and 8 more based on various signals

---

#### `strategy_executions` (PRIMARY KEY: execution_id)
**Purpose**: Track when strategies run and what they matched
**Data Source**: Strategy execution engine

| Column | Type | Purpose |
|--------|------|---------|
| execution_id | UUID | Primary key |
| strategy_id | UUID | Strategy reference |
| executed_at | TIMESTAMPTZ | Execution time |
| execution_mode | TEXT | How it was triggered |
| triggered_by | UUID | User ID (if manual) |
| results | JSONB | Matched wallets, markets, signals, aggregations |
| execution_time_ms | INTEGER | Runtime |
| nodes_evaluated | INTEGER | Graph nodes executed |
| data_points_processed | INTEGER | Records processed |
| status | TEXT | 'SUCCESS' \| 'PARTIAL' \| 'FAILED' |
| error_message | TEXT | If failed |

---

#### `strategy_watchlist_items` (PRIMARY KEY: id)
**Purpose**: Items flagged by strategy signals (wallets, markets, categories)
**Data Source**: Strategy execution results
**Status**: WATCHING, TRIGGERED, DISMISSED, EXPIRED

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| strategy_id | UUID | Strategy reference |
| execution_id | UUID | Which execution flagged this |
| item_type | watchlist_item_type | 'WALLET' \| 'MARKET' \| 'CATEGORY' |
| item_id | TEXT | wallet_address, market_id, or category_name |
| item_data | JSONB | Cached metrics snapshot |
| signal_reason | TEXT | Why flagged (e.g., "omega_ratio > 2.0") |
| confidence | signal_confidence | 'HIGH' \| 'MEDIUM' \| 'LOW' |
| status | watchlist_status | Current status |
| triggered_at | TIMESTAMPTZ | When signal fired |
| created_at, updated_at | TIMESTAMPTZ | Timestamps |

---

#### `strategy_positions` (PRIMARY KEY: id)
**Purpose**: Positions created by strategy signals (automated or manual)
**Data Source**: Strategy execution (auto) or user action (manual)
**Status**: OPEN, CLOSED, PARTIAL, CANCELLED

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| strategy_id | UUID | Strategy reference |
| watchlist_item_id | UUID | Watchlist item that triggered |
| market_id | TEXT | Market for position |
| market_slug | TEXT | URL slug |
| market_title | TEXT | Market question |
| condition_id | TEXT | Outcome condition |
| outcome | trade_outcome | 'YES' \| 'NO' |
| category | TEXT | Market category |
| entry_signal_type | TEXT | Signal type (HIGH_OMEGA_WALLET, SII_THRESHOLD, etc.) |
| entry_timestamp | TIMESTAMPTZ | When opened |
| entry_price | NUMERIC(10,4) | Entry price (0-1) |
| entry_shares | NUMERIC(20,8) | Position size |
| entry_amount_usd | NUMERIC(20,2) | Entry USD value |
| current_price | NUMERIC(10,4) | Current price |
| current_value_usd | NUMERIC(20,2) | Current USD value |
| unrealized_pnl | NUMERIC(20,2) | Unrealized profit/loss |
| unrealized_pnl_percent | NUMERIC(10,4) | As percentage |
| exit_timestamp | TIMESTAMPTZ | When closed (if closed) |
| exit_price | NUMERIC(10,4) | Exit price |
| exit_shares | NUMERIC(20,8) | Exit size |
| exit_amount_usd | NUMERIC(20,2) | Exit USD value |
| realized_pnl | NUMERIC(20,2) | Realized profit/loss |
| realized_pnl_percent | NUMERIC(10,4) | As percentage |
| fees_paid | NUMERIC(20,2) | Trading fees |
| status | position_status | Position state |
| auto_entered | BOOLEAN | Strategy auto-opened? |
| auto_exited | BOOLEAN | Strategy auto-closed? |
| exit_signal_type | TEXT | Why closed (TAKE_PROFIT, STOP_LOSS, etc.) |
| metadata | JSONB | Stop loss, take profit levels, notes |
| created_at, updated_at | TIMESTAMPTZ | Timestamps |

---

### E. Notifications & Preferences

#### `notifications` (PRIMARY KEY: id)
**Purpose**: User notification system for alerts and updates
**Data Source**: Various triggers (whale activity, market alerts, system events)

| Column | Type | Purpose |
|--------|------|---------|
| id | BIGSERIAL | Primary key |
| user_id | UUID | User reference (nullable for anonymous) |
| type | TEXT | 'whale_activity' \| 'market_alert' \| 'insider_alert' \| 'strategy_update' \| 'system' \| 'security' \| 'account' |
| title | TEXT | Notification title |
| message | TEXT | Notification content |
| link | TEXT | Optional navigation URL |
| is_read | BOOLEAN | Read status |
| is_archived | BOOLEAN | Archived? |
| priority | TEXT | 'low' \| 'normal' \| 'high' \| 'urgent' |
| metadata | JSONB | wallet_address, market_id, etc. |
| created_at | TIMESTAMPTZ | Creation time |
| read_at | TIMESTAMPTZ | When marked read |
| archived_at | TIMESTAMPTZ | When archived |

---

### F. Polymarket Enrichment Tables

#### `events` (if exists - event-level data)
**Purpose**: Polymarket events (groups of related markets)
**Data Source**: Polymarket API

| Column | Type | Purpose |
|--------|------|---------|
| event_id | TEXT | Unique event ID |
| slug | TEXT | URL slug |
| title | TEXT | Event title |
| markets | TEXT[] | Array of market IDs in this event |
| created_at | TIMESTAMPTZ | Event creation time |

---

---

## ClickHouse Analytics Schema

ClickHouse stores **time-series and analytical data** for fast aggregation queries. Tables are optimized for INSERT-heavy workloads and complex analytics.

### A. Core Tables

#### `trades_raw` (MergeTree, partitioned by month)
**Purpose**: Raw trade data for all wallets
**Data Source**: Goldsky PnL and Activity subgraphs (via sync scripts)
**Partitioning**: By month (YYYYMM)
**Order**: (wallet_address, timestamp)

| Column | Type | Purpose |
|--------|------|---------|
| trade_id | String | Unique trade identifier |
| wallet_address | String | Trader address |
| market_id | String | Market traded |
| timestamp | DateTime | Trade execution time |
| side | Enum8 | 'YES' = 1, 'NO' = 2 |
| entry_price | Decimal(18,8) | Execution price |
| exit_price | Nullable(Decimal) | Exit price (if closed) |
| shares | Decimal(18,8) | Trade size |
| usd_value | Decimal(18,2) | Trade value USD |
| pnl | Nullable(Decimal) | Realized PnL (if closed) |
| is_closed | Bool | Position resolved? |
| transaction_hash | String | On-chain transaction |
| created_at | DateTime | Record creation time |

**Materialized View**: `wallet_metrics_daily` (SummingMergeTree)
Aggregates daily metrics per wallet (counts, PnL, volume, etc.)

---

#### `wallet_metrics_complete` (ReplacingMergeTree, versioned by calculated_at)
**Purpose**: All 102 metrics for each wallet across time windows
**Data Source**: Calculated from trades_raw + Goldsky data
**Metrics Tracked**: 102 total (Tier 1-4 across 13 phases)
**Time Windows**: 30d, 90d, 180d, lifetime
**Update**: Whenever new data arrives

**Key Metric Groups** (from DATABASE_ARCHITECT_SPEC.md):

1. **Base Screeners** (#1-24):
   - Omega ratio, Sortino, Calmar, Sharpe, Martin ratios
   - Net PnL, CAGR, Win rate, Profit factor
   - Hit rate, Average gains/losses
   - Expected value per bet
   - Drawdown metrics (max, avg, recovery)
   - Track record (days, bets/week)

2. **Advanced Screeners** (#25-47):
   - Brier score, Log score (forecasting skill)
   - Calibration metrics
   - Closing Line Value (CLV)
   - Market making participation
   - Risk metrics (VaR, CVaR, max drawdown %)
   - Holding period analysis
   - Diversification (HHI)
   - Position sizing volatility

3. **Latency-Adjusted Metrics** (#48-55) - **TIER 1 CRITICAL**:
   - Omega with 30s, 2min, 5min copy delays
   - CLV with delays
   - Edge half-life (how long edge lasts)
   - Latency penalty index

4. **Momentum & Trends** (#56-88) - **TIER 1 CRITICAL**:
   - Omega momentum (30d, 90d Theil-Sen slopes)
   - PnL trend and acceleration
   - Tail ratio (asymmetric upside)
   - Skewness and kurtosis
   - Kelly criterion utilization
   - Risk of ruin probability
   - Capital efficiency (EV per hour capital)
   - Fee analysis
   - Streak metrics (win/loss streaks)

5. **Advanced Patterns** (#89-102):
   - Behavioral indicators
   - Edge source decomposition (JSON)
   - Directional bias (YES vs NO preference)
   - Market shock responsiveness
   - Crowd orthogonality

| Column | Type | Purpose |
|--------|------|---------|
| wallet_address | String | Wallet identifier |
| window | Enum8 | '30d'=1, '90d'=2, '180d'=3, 'lifetime'=4 |
| calculated_at | DateTime | When calculated |
| trades_analyzed | UInt32 | Trades in window |
| resolved_trades | UInt32 | Closed positions |
| track_record_days | UInt16 | Days from first to last |
| metric_1_omega_gross | Decimal(12,4) | Gains / Losses |
| metric_2_omega_net | Decimal(12,4) | **TIER 1 CRITICAL** |
| metric_5_sortino | Decimal(12,4) | Downside-adjusted return |
| metric_8_calmar | Decimal(12,4) | CAGR / Max Drawdown |
| metric_9_net_pnl_usd | Decimal(18,2) | Total P&L |
| metric_12_hit_rate | Decimal(5,4) | Win rate |
| metric_22_resolved_bets | UInt32 | **TIER 1 CRITICAL** - Count |
| metric_23_track_record_days | UInt16 | **TIER 1 CRITICAL** - Days active |
| metric_24_bets_per_week | Decimal(10,2) | **TIER 1 CRITICAL** - Activity |
| metric_48_omega_lag_30s | Decimal(12,4) | **TIER 1 CRITICAL** - Copyability |
| metric_49_omega_lag_2min | Decimal(12,4) | **TIER 1 CRITICAL** |
| metric_50_omega_lag_5min | Decimal(12,4) | **TIER 1 CRITICAL** |
| metric_56_omega_momentum_30d | Decimal(12,6) | **TIER 1 CRITICAL** - Trend |
| metric_60_tail_ratio | Decimal(10,4) | **TIER 1 CRITICAL** - Upside |
| metric_69_ev_per_hour_capital | Decimal(18,6) | **TIER 1 CRITICAL** - Capital efficiency |
| ... | ... | 102 metrics total |

---

#### `category_analytics` (SummingMergeTree)
**Purpose**: Market category-level analytics
**Data Source**: Aggregated from trades_raw grouped by category
**Time Windows**: Daily snapshots

| Column | Type | Purpose |
|--------|------|---------|
| category | String | Market category |
| date | Date | Day |
| total_trades | UInt32 | Trades in category |
| total_volume | Decimal(18,2) | Trading volume USD |
| unique_traders | UInt32 | Unique wallet count |
| avg_win_rate | Decimal(5,4) | Average win rate |
| median_omega | Decimal(10,4) | Median Omega score |
| top_performers | String | JSON array of top 10 wallets |

---

#### `market_price_momentum` (SummingMergeTree)
**Purpose**: Market price velocity and momentum metrics
**Data Source**: Market price snapshots + calculated metrics
**Frequency**: Periodic updates

| Column | Type | Purpose |
|--------|------|---------|
| market_id | String | Market identifier |
| condition_id | String | Outcome condition |
| timestamp | DateTime | Snapshot time |
| yes_price | Decimal(10,8) | YES outcome price |
| no_price | Decimal(10,8) | NO outcome price |
| price_velocity | Decimal(10,6) | Price change / time |
| momentum_score | Decimal(10,4) | Momentum metric |
| volatility | Decimal(10,6) | Price volatility |
| volume_24h | Decimal(18,2) | 24h trading volume |

---

#### `momentum_trading_signals` (MergeTree)
**Purpose**: Generated trading signals based on momentum
**Data Source**: market_price_momentum analysis
**Types**: BREAKOUT, REVERSAL, CONSOLIDATION, ACCELERATION

| Column | Type | Purpose |
|--------|------|---------|
| signal_id | String | Unique signal ID |
| market_id | String | Market reference |
| signal_type | String | Signal classification |
| triggered_at | DateTime | Signal generation time |
| momentum_score | Decimal(10,4) | Momentum value |
| confidence | Decimal(5,4) | Signal confidence (0-1) |
| recommended_side | String | 'YES' or 'NO' |
| expected_move | Decimal(10,4) | Expected price move |
| stop_loss | Decimal(10,4) | Suggested stop loss |
| take_profit | Decimal(10,4) | Suggested take profit |

---

#### `wallet_metrics_by_category` (ReplacingMergeTree)
**Purpose**: 102 metrics broken down by market category per wallet
**Data Source**: wallet_metrics_complete filtered by category
**Time Windows**: 30d, 90d, 180d, lifetime

| Column | Type | Purpose |
|--------|------|---------|
| wallet_address | String | Wallet identifier |
| category | String | Market category |
| window | Enum8 | Time window |
| calculated_at | DateTime | When calculated |
| metric_2_omega_net | Decimal(12,4) | Omega in this category |
| metric_22_resolved_bets | UInt32 | Resolved bets in category |
| metric_23_track_record_days | UInt16 | Days active in category |
| ... | ... | All 102 metrics per category |

---

#### `price_snapshots_10s` (MergeTree, compressed)
**Purpose**: Market price snapshots every 10 seconds
**Data Source**: Real-time market data feeds
**Compression**: High (time-series data) 
**Retention**: Limited window (e.g., 30 days)

| Column | Type | Purpose |
|--------|------|---------|
| market_id | String | Market identifier |
| timestamp | DateTime | Snapshot time (10s intervals) |
| yes_price | Decimal(10,8) | YES price |
| no_price | Decimal(10,8) | NO price |
| spread | Decimal(10,8) | Bid-ask spread |
| volume_24h | Decimal(18,2) | 24h volume at snapshot |

---

#### `market_price_history` (MergeTree, partitioned by market)
**Purpose**: Complete price history for analysis and backtesting
**Data Source**: price_snapshots_10s aggregated
**Granularity**: Hourly or daily snapshots
**Retention**: Full history

| Column | Type | Purpose |
|--------|------|---------|
| market_id | String | Market identifier |
| condition_id | String | Outcome condition |
| date | Date | Date of snapshot |
| hour | UInt8 | Hour (0-23) |
| yes_price_open | Decimal(10,8) | Opening price |
| yes_price_close | Decimal(10,8) | Closing price |
| yes_price_high | Decimal(10,8) | High price |
| yes_price_low | Decimal(10,8) | Low price |
| no_price_open | Decimal(10,8) | NO opening price |
| no_price_close | Decimal(10,8) | NO closing price |
| volume_traded | Decimal(18,2) | Volume USD |
| trades_count | UInt32 | Number of trades |

---

#### `elite_trade_attributions` (MergeTree)
**Purpose**: Track trades that copy elite wallet signals
**Data Source**: Matched signals from wallets in watchlists
**Use Case**: Attribution analysis for signal quality

| Column | Type | Purpose |
|--------|------|---------|
| attribution_id | String | Unique identifier |
| signal_wallet | String | Wallet that placed original trade |
| copy_wallet | String | Wallet that copied |
| market_id | String | Market traded |
| signal_timestamp | DateTime | When original trade occurred |
| copy_timestamp | DateTime | When copied |
| delay_seconds | Int32 | Delay between trades |
| original_pnl | Decimal(18,2) | Original trade PnL |
| copy_pnl | Decimal(18,2) | Copy trade PnL |
| signal_strength | Decimal(5,4) | Signal quality metric |

---

#### `fired_signals` (MergeTree)
**Purpose**: Log of all generated trading signals
**Data Source**: Various signal generation engines
**Types**: SII, Momentum, Insider, Whale Activity, etc.

| Column | Type | Purpose |
|--------|------|---------|
| signal_id | String | Unique signal identifier |
| signal_type | String | Type of signal |
| market_id | String | Market |
| triggered_at | DateTime | When fired |
| trigger_source | String | Who/what triggered (strategy, algorithm, etc.) |
| recommended_side | String | 'YES' or 'NO' |
| confidence | Decimal(5,4) | Confidence (0-1) |
| metadata | String | JSON with additional data |

---

### Summary: ClickHouse Table Stats
- **Total Tables**: ~13 main tables
- **Total Metrics per Wallet**: 102 across 4 time windows (30d, 90d, 180d, lifetime)
- **Storage Engine**: MergeTree family (optimized for analytics)
- **Compression**: High compression for historical data
- **Partitioning**: By date/month for easy pruning
- **Materialized Views**: ~5 for common aggregations

---

## External Data Sources

### 1. **Goldsky GraphQL API** (Public - No Auth Required)
**Endpoints**:
- `activity-subgraph`: FPMM positions and market activities
- `positions-subgraph`: User balances per outcome (for SII calculation)
- `pnl-subgraph`: Realized PnL per position (for Omega calculation)
- `orderbook-subgraph`: Order book data and trades
- `oi-subgraph`: Open interest metrics

**Primary Use Cases**:
- Wallet position discovery (which wallets hold what)
- PnL calculation (Omega scores)
- Market participant identification
- Smart money flow analysis

**Key Queries**:
- `GetWalletPositions`: User positions with PnL
- `GetUserBalances`: Position sizes per outcome
- `GetMarketPositions`: Top holders by outcome
- `GetNetUserBalances`: Net directional positions

---

### 2. **Polymarket Data-API** (REST)
**Base URL**: `https://data-api.polymarket.com`

**Key Endpoints**:
- `GET /markets`: List all markets
- `GET /events`: Events (groups of markets)
- `GET /trades?user={address}`: Wallet trades
- `GET /positions?user={address}`: Wallet positions (open)
- `GET /closed-positions?user={address}`: Resolved positions
- `GET /order-book/{marketId}`: Order book depth
- `GET /trades?conditionId={id}`: Market trades (CLOB)

**Data Updated**: Real-time (within seconds)

**Rate Limits**: ~100 req/sec per IP

**Data Quality**:
- Markets: Complete, ~20,000 active
- Trades: Complete historical record
- Prices: Real-time
- Volumes: Updated per trade

---

### 3. **On-Chain Blockchain Data**
**Source**: Polygon network (where Polymarket markets are settled)
**Access**: Via Goldsky subgraphs (indexed data)
**Data**:
- Transaction hashes
- Token transfer events
- Market resolution outcomes
- Fee payments

---

## API Endpoints

### Summary: 60+ API Routes

**Organized by Domain**:

### A. Market Data APIs

| Endpoint | Method | Purpose | Query Params | Notes |
|----------|--------|---------|--------------|-------|
| `/api/polymarket/markets` | GET | List all active markets | limit, category, search | Paginated |
| `/api/polymarket/markets/[id]` | GET | Get single market details | - | Includes analytics |
| `/api/polymarket/events` | GET | List market events | - | Event groupings |
| `/api/polymarket/events/[slug]` | GET | Get event details | - | With related markets |
| `/api/polymarket/holders` | GET | Market participants list | market_id, limit | Top holders |
| `/api/polymarket/market/[marketId]/holders` | GET | Holders for specific market | limit | With rankings |
| `/api/polymarket/holders-graph/[tokenId]` | GET | Holder concentration graph | - | Time-series |
| `/api/polymarket/order-book/[marketId]` | GET | Order book depth | - | Bid-ask spreads |
| `/api/polymarket/ohlc/[marketId]` | GET | OHLC price history | period | For charts |

---

### B. Wallet APIs

| Endpoint | Method | Purpose | Query Params | Cache |
|----------|--------|---------|--------------|-------|
| `/api/wallet/[address]` | GET | Wallet profile summary | - | 5 min |
| `/api/wallets/[address]/score` | GET | Omega score calculation | fresh, ttl | 1 hour |
| `/api/wallets/[address]/metrics` | GET | Comprehensive wallet metrics | - | 1 hour |
| `/api/wallets/top` | GET | Top wallets leaderboard | limit, min_trades, sort_by | 5 min |
| `/api/wallets/filter` | POST | Filter wallets by criteria | - | Dynamic |
| `/api/omega/leaderboard` | GET | Omega ranking + grades | limit, min_trades, sort_by | 5 min |
| `/api/polymarket/wallet/[address]/positions` | GET | Open positions | - | Real-time |
| `/api/polymarket/wallet/[address]/trades` | GET | Trade history | limit | 30 sec |
| `/api/polymarket/wallet/[address]/closed-positions` | GET | Historical closed positions | - | Real-time |
| `/api/polymarket/wallet/[address]/activity` | GET | Recent activity feed | - | Real-time |
| `/api/polymarket/wallet/[address]/value` | GET | Portfolio value over time | - | Real-time |
| `/api/polymarket/wallet/[address]/profile` | GET | Polymarket profile data | - | 1 hour |

---

### C. Smart Money & SII APIs

| Endpoint | Method | Purpose | Query Params | Notes |
|----------|--------|---------|--------------|-------|
| `/api/markets/[id]/sii` | GET | Smart Investor Index | fresh, ttl | Shows which side has smarter money |
| `/api/sii/refresh` | POST | Recalculate SII for market | market_id | Refresh cache |
| `/api/insiders/wallets` | GET | Suspected insider wallets | limit | High win rate, suspicious timing |
| `/api/insiders/markets` | GET | Markets with insider activity | - | Markets with unusual patterns |

---

### D. Whale Activity APIs

| Endpoint | Method | Purpose | Query Params | Cache |
|----------|--------|---------|--------------|-------|
| `/api/whale/trades` | GET | Recent whale trades | limit, hours_back | Real-time |
| `/api/whale/positions` | GET | Whale positions snapshot | - | Real-time |
| `/api/whale/scoreboard` | GET | Whale rankings | limit | 5 min |
| `/api/whale/flows` | GET | Smart money flows | market_id | Recent |
| `/api/whale/flips` | GET | Position reversals | hours_back | Recent |
| `/api/whale/concentration` | GET | Market concentration metrics | - | Per market |
| `/api/polymarket/whale-trades/[marketId]` | GET | Whale trades in specific market | - | Recent |

---

### E. Strategy APIs

| Endpoint | Method | Purpose | Body | Notes |
|----------|--------|---------|------|-------|
| `/api/strategies` | GET | List all strategies | - | Includes predefines |
| `/api/strategies` | POST | Create new strategy | node_graph, name, etc. | Version 1 |
| `/api/strategies/[id]` | GET | Get strategy definition | - | Full node graph |
| `/api/strategies/[id]` | PUT | Update strategy | Updated fields | Increments version |
| `/api/strategies/execute` | POST | Run strategy manually | strategy_id, params | Generates watchlist items |
| `/api/strategies/[id]/performance` | GET | Strategy backtest results | - | Historical metrics |
| `/api/strategies/[id]/positions` | GET | Positions from strategy | - | All opened positions |
| `/api/strategies/[id]/trades` | GET | Trades from strategy | - | Execution history |
| `/api/strategies/[id]/watchlist` | GET | Current watchlist items | - | From last execution |

---

### F. Workflow APIs

| Endpoint | Method | Purpose | Notes |
|----------|--------|---------|-------|
| `/api/execute-workflow` | POST | Execute workflow | Returns outputs by node |
| Various workflow query endpoints | GET | List, load workflows | In component code |

---

### G. Signals & Technical Analysis

| Endpoint | Method | Purpose | Query Params | Notes |
|----------|--------|---------|--------------|-------|
| `/api/signals/tsi/[marketId]` | GET | True Strength Index signal | period | Momentum indicator |

---

### H. Category Analytics

| Endpoint | Method | Purpose | Query Params | Notes |
|----------|--------|---------|--------------|-------|
| `/api/austin/categories` | GET | Category list with stats | - | Top traders per category |
| `/api/austin/categories/[category]` | GET | Category details | - | Top performers |
| `/api/austin/recommend` | GET | Recommendations by category | - | Using Austin methodology |
| `/api/austin/refresh` | POST | Recalculate category stats | - | Refresh cache |
| `/api/cron/refresh-category-analytics` | POST | Scheduled category refresh | - | Cron job |

---

### I. Data Sync & Admin APIs

| Endpoint | Method | Purpose | Query Params | Notes |
|----------|--------|---------|--------------|-------|
| `/api/polymarket/sync` | POST | Sync markets from API | full, limit | Upsert to DB |
| `/api/polymarket/aggregate` | POST | Aggregate trade analytics | - | CLOB trade aggregation |
| `/api/polymarket/enrich-categories` | POST | Enrich markets with categories | - | Data enrichment |
| `/api/migrations/run` | POST | Run database migrations | - | Admin only |
| `/api/admin/apply-migration` | POST | Apply specific migration | migration_id | Admin only |
| `/api/admin/pipeline-status` | GET | Data pipeline health | - | Sync job status |
| `/api/cron/refresh-wallets` | POST | Refresh wallet scores | limit | Scheduled job |

---

### J. Notifications

| Endpoint | Method | Purpose | Body/Params | Notes |
|----------|--------|---------|-------------|-------|
| `/api/notifications` | GET | List user notifications | - | Recent first |
| `/api/notifications/count` | GET | Unread count | - | Quick metric |
| `/api/notifications/mark-all-read` | PUT | Mark all as read | - | Bulk update |
| `/api/notifications/[id]` | GET/PUT | Single notification | - | Get or update |

---

### K. AI/Conversational APIs

| Endpoint | Method | Purpose | Notes |
|----------|--------|---------|-------|
| `/api/ai/conversational-build` | POST | Natural language strategy building | LLM-powered |

---

---

## Data Flow Patterns

### 1. **Market Data Flow**

```
Polymarket API
    ↓
/api/polymarket/sync (periodic)
    ↓
Supabase: markets, market_analytics
    ↓
Frontend: Market Screener, Market Detail
    ↓
Real-time calculations: SII, momentum signals
```

**Latency**: ~30 sec cache, can be refreshed with `?fresh=true`

---

### 2. **Wallet Metrics Flow**

```
Goldsky GraphQL (Public)
    ↓
calculate_wallet_omega_score()
    ↓
/api/wallets/[address]/score
    ↓
Supabase: wallet_scores, wallet_scores_by_category
    ↓
Frontend: Leaderboard, Wallet Detail
    ↓
Caching: 1 hour default (customizable with ?ttl param)
```

**Critical Metric**: Omega Ratio = Total Gains / Total Losses
**Data Source**: Goldsky PnL subgraph (with 13.2399x correction factor applied)

---

### 3. **Smart Investor Index (SII) Flow**

```
wallet_scores table
    ↓
Get top 20 wallets on YES side
Get top 20 wallets on NO side
    ↓
Calculate average Omega per side
    ↓
Compare: higher Omega = smart money
    ↓
Supabase: market_sii table
    ↓
/api/markets/[id]/sii endpoint
    ↓
Frontend: Market Detail page (smart money indicator)
```

**Key Signal**: omega_differential (YES avg - NO avg)
- Positive = smart money on YES
- Negative = smart money on NO
- Magnitude = conviction level

---

### 4. **Whale Activity Detection & Notification**

```
Polymarket Trades API (real-time)
    ↓
Filter large trades (> threshold)
    ↓
Identify whale wallet
    ↓
Supabase: whale_activity_log
    ↓
Generate notification (optional)
    ↓
/api/whale/trades endpoint
    ↓
Frontend: Whale Activity Dashboard
```

---

### 5. **Insider Detection Flow**

```
wallet_trades table (all trades)
    ↓
Calculate timing_score for each trade
    (market price 1h before vs 1h after)
    ↓
Aggregate: average timing_score per wallet
    ↓
If avg > threshold → is_suspected_insider = TRUE
    ↓
Supabase: wallets.is_suspected_insider
    ↓
/api/insiders/wallets endpoint
    ↓
Frontend: Insider Detection dashboard
```

**Timing Score**: How early was the entry relative to market move?
- High score = entered before big moves (suspicious)

---

### 6. **Strategy Execution Flow**

```
User creates strategy (node-based)
    ↓
strategy_definitions table (stored)
    ↓
Trigger: Manual, Auto, or Scheduled
    ↓
/api/strategies/execute
    ↓
Execute node graph:
  1. Data source nodes → fetch wallets/markets
  2. Filter nodes → apply criteria
  3. Logic nodes → combine with AND/OR
  4. Signal nodes → generate trading signals
    ↓
Results:
  - Matched wallets/markets
  - Generated signals
  - Aggregation metrics
    ↓
strategy_executions table (logged)
strategy_watchlist_items table (matched items)
    ↓
Optional: Auto-create positions (if enabled)
    ↓
Frontend: Strategy results display
```

---

### 7. **ClickHouse Analytics Pipeline**

```
Goldsky PnL & Activity Subgraphs
    ↓
Sync scripts (e.g., sync-wallet-trades.ts)
    ↓
ClickHouse: trades_raw table
    ↓
Materialized views aggregate:
  - wallet_metrics_daily
  - wallet_metrics_complete (102 metrics, 4 windows)
  - wallet_metrics_by_category
  - category_analytics
    ↓
/api/wallets/[address]/metrics
    ↓
Supabase caching tables (wallet_scores)
    ↓
Frontend: Analytics visualizations
```

**Metrics Calculated**:
- Base: Omega, Sortino, Sharpe, hit rate, PnL
- Advanced: Calibration, CLV, maker/taker ratio
- **TIER 1 CRITICAL**: Omega lag (copyability), track record, bets/week, tail ratio, EV/hour
- Momentum: 30/90-day trends, streak analysis
- Risk: VaR, CVaR, drawdown recovery

---

### 8. **Watchlist & Notification Pipeline**

```
Strategy executes
    ↓
Generates watchlist items (wallets/markets/categories)
    ↓
strategy_watchlist_items table
    ↓
Monitor for:
  - New trades from watchlist wallets
  - Price movements in watchlist markets
  - Category performance changes
    ↓
Trigger notifications:
  - whale_activity
  - market_alert
  - insider_alert
  - strategy_update
    ↓
notifications table
    ↓
/api/notifications endpoint
    ↓
Frontend: Notification center
```

---

### 9. **Copy Trading / Signal Attribution**

```
Elite wallet places trade
    ↓
Detected by whale monitoring
    ↓
Trade published to watchlist
    ↓
Other users see signal:
  - In strategy results
  - In whale activity feed
  - In notifications (if subscribed)
    ↓
User copies trade
    ↓
ClickHouse: elite_trade_attributions
    ↓
Track performance:
  - Original PnL
  - Copy PnL
  - Delay between trades
  - Signal quality
    ↓
Frontend: Attribution analytics
    ↓
Feedback loop: Improve signal strength
```

---

### 10. **Category Specialist Discovery**

```
Austin Methodology:
  1. Identify top traders (Omega >= 2.0, >= 5 trades)
  2. Break down by market category
  3. Find specialists (best in each category)
    ↓
wallet_scores_by_category table
    ↓
/api/austin/categories endpoint
    ↓
/api/austin/recommend endpoint
    ↓
Frontend: Category specialists leaderboard
    ↓
Use for:
  - Category-based strategies
  - Expert recommendations
  - Specialized watchlists
```

---

## Key Metrics & Calculations

### 1. **Omega Ratio** (Primary Performance Metric)

```
Omega = Sum of Gains / Sum of Losses

Example:
  Closed positions: [+100, +50, -30, -20, +200, -10]
  Total Gains = 100 + 50 + 200 = 350
  Total Losses = 30 + 20 + 10 = 60
  Omega = 350 / 60 = 5.83
  
Interpretation:
  - Omega > 2.0 = Good (A grade)
  - Omega > 3.0 = Excellent (S grade)
  - Omega < 1.0 = Loses more than wins (F grade)
```

**Data Source**: Goldsky PnL subgraph
**Important**: Correction factor 13.2399x applied (Goldsky multi-outcome aggregation issue)
**Caching**: 1 hour in wallet_scores table
**Minimum Requirement**: >= 5 closed trades (Austin requirement)

---

### 2. **Omega Momentum** (Direction of Change)

```
Omega Momentum = Theil-Sen slope of Omega over time period

Slope > 0 = Improving (trader getting better)
Slope < 0 = Declining (trader getting worse)
|Slope| > threshold = Significant trend

Calculated for: 30-day and 90-day windows
```

**Use Case**: Avoid stale winners, find improving traders

---

### 3. **Smart Investor Index (SII)**

```
1. Get top 20 YES positions by value
   - Calculate average Omega of these wallets
   - yes_avg_omega = 2.45

2. Get top 20 NO positions by value
   - Calculate average Omega of these wallets
   - no_avg_omega = 1.80

3. Calculate differential:
   omega_differential = 2.45 - 1.80 = 0.65 (positive)
   smart_money_side = 'YES'
   
4. Calculate signal strength:
   signal_strength = min(abs(differential) / 2.0, 1.0)
   = min(0.65 / 2.0, 1.0) = 0.325 (moderate strength)

Interpretation:
  - signal_strength > 0.7 = Strong signal
  - signal_strength > 0.5 = Moderate signal
  - signal_strength < 0.3 = Weak signal
  - NEUTRAL if close to 0.5
```

**Data Source**: wallet_scores table (pre-calculated Omega)
**Update Frequency**: On-demand or periodic refresh
**Use Case**: Know which market side the smart money is on

---

### 4. **Win Rate**

```
Win Rate = (Winning Trades / Total Resolved Trades) * 100

Example:
  Closed: [+100, +50, -30, -20, +200, -10]
  Wins: 3 (+100, +50, +200)
  Total: 6
  Win Rate = 3/6 = 50%
  
Grading:
  50% = Decent (average)
  > 60% = Good (beating randomness)
  > 70% = Excellent (consistent winner)
```

---

### 5. **Timing Score** (Insider Detection)

```
For each trade:
  market_price_before = price 1 hour before trade
  market_price_after = price 1 hour after trade
  
  If trade was BUY YES:
    timing_score = (market_price_after - entry_price) / entry_price
    High positive = entered before big move (suspicious)
    
Average timing_score across all trades = insider_score

insider_score > threshold → is_suspected_insider = TRUE
```

**Interpretation**: Wallets with high timing scores consistently enter BEFORE big moves

---

### 6. **Risk Metrics** (ClickHouse)

```
Volatility = stddev(returns)
Max Drawdown = largest peak-to-trough decline %
Sharpe Ratio = (mean_return - risk_free_rate) / volatility
Sortino Ratio = (mean_return) / downside_volatility

Calmar Ratio = CAGR / Max Drawdown
  > 1.0 = Good recovery from losses
  > 2.0 = Excellent risk management
```

---

### 7. **Omega Lag (Copyability Metric - TIER 1 CRITICAL)**

```
If we copy this trader's trades with a delay, 
how much does their edge decay?

omega_lag_30s = Omega if we enter 30s later
omega_lag_2min = Omega if we enter 2min later
omega_lag_5min = Omega if we enter 5min later

Example:
  Original Omega: 2.50
  Omega at 30s lag: 2.40 (still good)
  Omega at 2min lag: 1.95 (edge weakening)
  Omega at 5min lag: 1.20 (edge mostly gone)

Interpretation: This trader's edge decays quickly
(good signal dies within 5 minutes)
```

**Use Case**: Know which traders are copyable and for how long

---

### 8. **Tail Ratio** (Asymmetric Upside - TIER 1 CRITICAL)**

```
Tail Ratio = Average(top 10% wins) / Average(bottom 10% losses)

Example:
  All trades: [+500, +200, +100, +50, 0, -50, -100, -150, -200, -500]
  
  Top 10% (1 trade): +500
  Bottom 10% (1 trade): -500
  
  Tail Ratio = 500 / 500 = 1.0 (symmetric)
  
If instead: [+1000, +900, +800, +700, +600, -50, -40, -30, -20, -10]
  Top 10%: +1000 (avg of top 10%)
  Bottom 10%: -50 (avg of bottom 10%)
  Tail Ratio = 1000 / 50 = 20.0 (asymmetric upside!)

Interpretation:
  > 1.0 = Wins are bigger than losses (convex strategy)
  < 1.0 = Losses are bigger than wins (concave strategy)
  >> 2.0 = Exceptional asymmetry (rare edge)
```

**Value Proposition**: Identify traders with rare positive skew

---

### 9. **Expected Value per Hour Capital (EV/hour - TIER 1 CRITICAL)**

```
EV/hour/capital = (Total EV generated / Hours held) / Average capital deployed

Example:
  Total PnL: $10,000
  Hours active: 1,000 hours
  Average capital deployed: $100,000
  
  EV/hour/capital = (10,000 / 1,000) / 100,000
                  = 10 / 100,000
                  = 0.0001 per hour
                  = $0.01 per $1 capital per hour

Higher = more efficient capital deployment
```

**Use Case**: Identify capital-efficient traders (not just profitable)

---

### 10. **102 Metrics in ClickHouse**

Organized by Tier & Phase:

**TIER 1 CRITICAL (8 metrics)**:
1. Omega (net of fees)
2. Sortino Ratio (downside-risk adjusted)
3. Calmar Ratio (CAGR / Max Drawdown)
4. Net PnL (absolute dollars)
5. Track Record (days active)
6. Resolved Bets (count)
7. Bets per Week (activity)
8. Omega Lag (copyability) - TIER 1 CRITICAL across 3 timeframes (30s, 2min, 5min)
9. Tail Ratio (asymmetric upside)
10. EV per hour capital (capital efficiency)
11. Omega Momentum (trend)

**TIER 2 ADVANCED (20+ metrics)**:
- Brier Score, Log Score (forecasting skill)
- Calibration metrics
- Closing Line Value (CLV) + variants
- Maker/Taker ratio
- Risk metrics (VaR, CVaR)
- Diversification (HHI)
- Position sizing volatility
- Kelly Criterion utilization

**TIER 3+ (remaining ~70 metrics)**:
- Streaks and consistency
- Time-based patterns
- Behavioral indicators
- Edge source decomposition
- Directional bias
- Market shock response
- And many more specialized metrics

---

### Summary

The Cascadian database is a **sophisticated multi-tier analytics system** designed to:

1. **Identify Smart Money**: Wallets with high Omega, low drawdown, and consistent alpha
2. **Generate Signals**: SII (which market side has smarter traders), whale activity alerts, insider detection
3. **Enable Strategies**: Node-based strategy builder with predefined patterns
4. **Support Copy Trading**: Track elite traders and signal their moves
5. **Deep Analytics**: 102 metrics per wallet across 4 time windows (30d, 90d, 180d, lifetime)
6. **Real-time Updates**: Polymarket integration for live market data, Goldsky for blockchain data
7. **Category Expertise**: Find specialists in each market category

**Key Innovation**: Emphasis on **copyability metrics** (omega lag) and **asymmetric upside** (tail ratio) to identify traders whose edges are both strong AND actionable for other traders.

