# CASCADIAN FINAL DATABASE SCHEMA
**Production-Ready Reference for Complete P&L System**

**Last Updated:** 2025-11-08 (After Option B Backfill)
**Coverage Status:** 95-100% expected after backfill completion
**Database:** ClickHouse Cloud

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Trade Data Tables](#trade-data-tables)
3. [Resolution & Market Data](#resolution--market-data)
4. [Wallet Analytics Tables](#wallet-analytics-tables)
5. [Event & Category Mapping](#event--category-mapping)
6. [Supporting Infrastructure](#supporting-infrastructure)
7. [Data Flow Architecture](#data-flow-architecture)
8. [Critical Queries](#critical-queries)

---

## Quick Reference

### Production Table Checklist

**Core Tables (6 - Must Use):**
- ✅ `vw_trades_canonical` - Complete trade universe
- ✅ `vw_resolutions_unified` - All market resolutions (NEW - Option B)
- ✅ `gamma_markets` - Market metadata (questions, outcomes, categories)
- ✅ `wallet_metrics_complete` - Wallet performance metrics
- ✅ `condition_market_map` - Token ID → Market ID mapping
- ✅ `events_dim` - Event categories and tags

**Supporting Tables (5 - Important):**
- ✅ `trades_raw` - Raw blockchain trade data
- ✅ `market_resolutions_final` - Primary resolution source
- ✅ `outcome_positions_v2` - Position snapshots
- ✅ `resolutions_src_api` - API backfill results (NEW - Option B)
- ✅ `backfill_progress` - Backfill tracking (NEW - Option B)

**Analytics Tables (4 - Nice to Have):**
- 🟡 `wallet_pnl_summary_final` - Aggregated P&L
- 🟡 `wallet_resolution_outcomes` - Win/loss by market
- 🟡 `realized_pnl_by_market_final` - Market-level P&L
- 🟡 `market_candles_5m` - Price history

---

## Trade Data Tables

### 1. vw_trades_canonical ⭐ PRIMARY SOURCE

**Purpose:** Complete universe of all trades on Polymarket
**Type:** View (materialized from trades_raw + enrichment)
**Rows:** 159,574,259 trades
**Coverage:** Dec 2022 - Oct 2025 (1,048 days)
**Quality:** HIGH - Blockchain-derived, immutable

**Schema:**
```sql
CREATE VIEW default.vw_trades_canonical AS
SELECT
  wallet_address          String,           -- 996K+ unique wallets
  condition_id_norm       String,           -- Normalized 64-char hex (no 0x prefix)
  market_id               String,           -- Polymarket market ID
  timestamp               DateTime,         -- Trade execution time
  side                    Enum8,            -- 'BUY' or 'SELL'
  outcome_index           UInt8,            -- 0 or 1 for binary markets
  shares                  Decimal(18,8),    -- Token quantity
  usd_value               Decimal(18,2),    -- Cost basis in USDC
  transaction_hash        String,           -- Blockchain tx hash
  block_number            UInt64,           -- Polygon block number

  -- Enrichment fields
  canonical_category      String,           -- Sports, Politics, Crypto, etc.
  question                String,           -- Market question
  outcomes                Array(String),    -- ["Yes", "No"] or custom

  -- P&L fields (computed from resolutions)
  realized_pnl_usd        Float64,          -- Profit/loss if resolved
  unrealized_pnl_usd      Float64,          -- Current value if open
  is_resolved             UInt8             -- 1 if market closed
FROM default.trades_raw
LEFT JOIN cascadian_clean.vw_resolutions_unified r
  ON lower(condition_id_norm) = r.cid_hex
LEFT JOIN default.gamma_markets m
  ON condition_id_norm = m.condition_id
```

**Usage:**
```sql
-- Get all trades for a wallet
SELECT * FROM default.vw_trades_canonical
WHERE wallet_address = '0x...'
ORDER BY timestamp DESC;

-- Get trades by category
SELECT
  canonical_category,
  count(*) as trade_count,
  sum(usd_value) as total_volume
FROM default.vw_trades_canonical
WHERE wallet_address = '0x...'
GROUP BY canonical_category;
```

**Key Features:**
- **Normalized IDs:** All condition_id values lowercased, 0x prefix removed
- **Complete history:** Every trade from blockchain event logs
- **Enriched:** Includes market metadata, categories, P&L
- **Join-ready:** Pre-normalized for fast joins to resolutions

---

### 2. trades_raw (Underlying Source)

**Purpose:** Raw blockchain trade data (base table for vw_trades_canonical)
**Type:** Table (SharedMergeTree)
**Rows:** 159,574,259
**Size:** 9.67 GB
**Partition:** toYYYYMM(timestamp)

**Schema:**
```sql
CREATE TABLE default.trades_raw (
  trade_id                String,
  wallet_address          String,
  market_id               String,
  condition_id            String,          -- Raw format (may have 0x, mixed case)
  timestamp               DateTime,
  side                    Enum8('YES'=1, 'NO'=0),
  entry_price             Decimal(18,8),
  exit_price              Decimal(18,8),
  shares                  Decimal(18,8),
  usd_value               Decimal(18,2),
  pnl                     Float64,         -- May be inaccurate (rebuild needed)
  is_closed               UInt8,
  transaction_hash        String,
  outcome_index           UInt8,
  block_number            UInt64,
  log_index               UInt32,

  -- Enrichment (populated via ETL)
  canonical_category      String,
  question                String,
  outcomes_json           String,
  tags_json               String
) ENGINE = SharedMergeTree
ORDER BY (wallet_address, timestamp)
PARTITION BY toYYYYMM(timestamp)
```

**Source:** Built from ERC1155 transfers + ERC20 USDC flows
**Location:** `/migrations/clickhouse/001_create_trades_table.sql`

**Use vw_trades_canonical instead** - trades_raw is the underlying storage, but the view provides better joins and normalization.

---

### 3. Supporting Trade Views

#### trades_with_direction
**Purpose:** Adds BUY/SELL direction inference from net flows
**Rows:** Same as trades_raw
**Use Case:** When you need explicit direction detection

#### trade_cashflows_v3
**Purpose:** Detailed cashflow attribution (USDC in/out)
**Rows:** ~159M
**Use Case:** Understanding fee structure, settlement patterns

---

## Resolution & Market Data

### 1. vw_resolutions_unified ⭐ CRITICAL (NEW - Option B)

**Purpose:** Unified view of ALL market resolutions from multiple sources
**Type:** View (UNION of 3 sources with priority fallback)
**Expected Coverage:** 95-100% of traded markets after backfill
**Quality:** HIGH - Multi-source verification

**Schema:**
```sql
CREATE VIEW cascadian_clean.vw_resolutions_unified AS

-- SOURCE 1: market_resolutions_final (highest priority)
SELECT
  cid_hex                 String,          -- Normalized condition ID (lowercase, 0x prefix)
  winning_index           Int32,           -- 0-based index of winning outcome
  payout_numerators       Array(Decimal),  -- Payout vector [1,0] or [0,1]
  payout_denominator      Decimal,         -- Usually 1
  resolved_at             DateTime,        -- Resolution timestamp
  winning_outcome         String,          -- "Yes"/"No" or custom
  'market_resolutions_final' AS source
FROM default.market_resolutions_final
WHERE payout_denominator > 0 AND winning_index IS NOT NULL

UNION ALL

-- SOURCE 2: gamma_markets (secondary - for markets not in primary)
SELECT
  lower(condition_id) AS cid_hex,
  arrayFirstIndex(...) - 1 AS winning_index,  -- Derive from outcome
  [...] AS payout_numerators,                 -- One-hot vector
  1 AS payout_denominator,
  now() AS resolved_at,
  outcome AS winning_outcome,
  'gamma_markets' AS source
FROM default.gamma_markets
WHERE closed = 1 AND length(outcome) > 0
  AND NOT IN (market_resolutions_final)

UNION ALL

-- SOURCE 3: resolutions_src_api (tertiary - API backfill)
SELECT
  lower(cid_hex) AS cid_hex,
  winning_index,
  payout_numerators,
  payout_denominator,
  resolution_time AS resolved_at,
  arrayElement(outcomes, winning_index + 1) AS winning_outcome,
  'api_backfill' AS source
FROM cascadian_clean.resolutions_src_api
WHERE resolved = 1 AND winning_index >= 0
  AND NOT IN (market_resolutions_final OR gamma_markets)
```

**Priority Logic:**
1. **market_resolutions_final** - Most authoritative (223K markets)
2. **gamma_markets** - Secondary fallback (adds ~50 markets)
3. **resolutions_src_api** - API backfill (adds ~150K markets) ⬅ NEW

**Usage:**
```sql
-- Check if market is resolved
SELECT * FROM cascadian_clean.vw_resolutions_unified
WHERE cid_hex = '0x1234...';

-- Get all resolutions for a wallet's trades
SELECT
  t.*,
  r.winning_outcome,
  r.resolved_at,
  r.source
FROM default.vw_trades_canonical t
INNER JOIN cascadian_clean.vw_resolutions_unified r
  ON lower(t.condition_id_norm) = r.cid_hex;
```

**Created By:** `/create-unified-resolutions-view.ts`
**After Backfill:** Re-run create script to include api_backfill source

---

### 2. market_resolutions_final (Primary Resolution Source)

**Purpose:** Authoritative resolution data from 6+ API sources
**Type:** Table (SharedReplacingMergeTree)
**Rows:** 223,973 resolved markets
**Size:** 7.87 MB
**Quality:** AUTHORITATIVE

**Schema:**
```sql
CREATE TABLE default.market_resolutions_final (
  market_id               String,
  condition_id            String,
  condition_id_norm       FixedString(64),  -- Normalized (lowercase, no 0x)
  winner                  String,           -- Winning outcome name
  winning_outcome_index   UInt8,            -- 0-based index
  resolution_source       String,           -- rollup, bridge_clob, onchain, gamma, clob
  resolved_at             DateTime,
  payout_hash             String,
  is_resolved             UInt8,
  payout_numerators       Array(UInt256),   -- [1,0] for binary YES win
  payout_denominator      UInt256,          -- Usually 1
  ingested_at             DateTime
) ENGINE = SharedReplacingMergeTree
ORDER BY market_id
```

**Sources (by contribution):**
- rollup: 35.8% (80,287 resolutions)
- bridge_clob: 34.4% (77,097)
- onchain: 25.4% (57,103)
- gamma: 2.8% (6,290)
- clob: 1.4% (3,094)
- Other: 0.2% (524)

**Populated By:**
- `/scripts/27-backfill-missing-resolutions.ts`
- `/scripts/28-fast-backfill-resolutions.ts`

**Status:** Complete for resolved markets, continuously updated

---

### 3. gamma_markets (Market Metadata)

**Purpose:** Market definitions, questions, outcomes, metadata
**Type:** Table (SharedMergeTree)
**Rows:** 149,907 markets
**Size:** 21.44 MB
**Source:** Polymarket Gamma API

**Schema:**
```sql
CREATE TABLE default.gamma_markets (
  market_id               String,
  condition_id            String,
  question                String,           -- "Will Trump win 2024?"
  outcomes                Array(String),    -- ["Yes", "No"] or custom
  outcomes_json           String,           -- JSON backup
  end_date_iso            String,
  tags                    Array(String),    -- ["politics", "election", "2024"]
  category                String,           -- "Politics"
  volume                  Float64,
  liquidity               Float64,
  question_id             String,
  enable_order_book       UInt8,
  closed                  UInt8,            -- 1 if closed
  outcome                 String,           -- Winning outcome (if closed)
  ingested_at             DateTime
) ENGINE = SharedMergeTree
ORDER BY market_id
```

**Usage:**
```sql
-- Get market metadata
SELECT question, outcomes, category, tags
FROM default.gamma_markets
WHERE market_id = '...';

-- Find markets by category
SELECT * FROM default.gamma_markets
WHERE category = 'Politics'
  AND closed = 0
ORDER BY volume DESC;
```

**Refresh Frequency:** Hourly via API sync
**Coverage:** All Polymarket markets (active and closed)

---

### 4. resolutions_src_api (API Backfill Results - NEW)

**Purpose:** Stores resolution data fetched during Option B backfill
**Type:** Table (MergeTree)
**Expected Rows:** ~150K after backfill completes
**Source:** Gamma API `/markets?condition_id=` endpoint

**Schema:**
```sql
CREATE TABLE cascadian_clean.resolutions_src_api (
  cid_hex                 String,           -- Market-level condition ID
  resolved                UInt8,            -- 1 if resolved
  winning_index           Int32,            -- 0-based winner index
  payout_numerators       Array(Decimal(18,8)),
  payout_denominator      Nullable(Decimal(18,8)),
  outcomes                Array(String),    -- Outcome names
  title                   String,           -- Market question
  category                String,           -- Category
  tags                    Array(String),    -- Tags
  resolution_time         Nullable(DateTime64(3, 'UTC')),
  source                  String DEFAULT 'gamma_api',
  inserted_at             DateTime DEFAULT now()
) ENGINE = MergeTree
ORDER BY cid_hex
```

**Populated By:** `/backfill-market-resolutions.ts` (running now at 12.4 req/s)
**Expected Completion:** ~1:15 AM
**Current Status:** In progress (process 61254e)

---

## Wallet Analytics Tables

### 1. wallet_metrics_complete

**Purpose:** Comprehensive wallet performance metrics
**Type:** Table (MergeTree)
**Rows:** ~1,000,000 wallets
**Size:** 41.5 MB

**Schema:**
```sql
CREATE TABLE default.wallet_metrics_complete (
  wallet_address          String,
  total_trades            UInt32,
  total_volume            Float64,          -- Sum of usd_value
  total_pnl               Float64,          -- Realized P&L
  win_rate                Float64,          -- % of winning trades
  avg_win                 Float64,          -- Average winning trade
  avg_loss                Float64,          -- Average losing trade
  pnl_stddev              Float64,          -- Volatility
  sharpe_ratio            Float64,          -- Risk-adjusted return
  max_drawdown            Float64,          -- Worst loss streak
  total_markets           UInt32,           -- Unique markets traded
  active_days             UInt32,           -- Days with trades
  first_trade_date        DateTime,
  last_trade_date         DateTime,
  avg_trade_size          Float64,
  median_trade_size       Float64
) ENGINE = MergeTree
ORDER BY wallet_address
```

**Created By:** `/migrations/clickhouse/004_create_wallet_metrics_complete.sql`

**Usage:**
```sql
-- Get wallet performance summary
SELECT * FROM default.wallet_metrics_complete
WHERE wallet_address = '0x...';

-- Find top performers
SELECT wallet_address, total_pnl, win_rate, sharpe_ratio
FROM default.wallet_metrics_complete
WHERE total_trades >= 10
ORDER BY sharpe_ratio DESC
LIMIT 100;
```

---

### 2. wallet_resolution_outcomes

**Purpose:** Win/loss tracking per market per wallet
**Type:** Table (ReplacingMergeTree)
**Rows:** 9,107
**Size:** 0.30 MB

**Schema:**
```sql
CREATE TABLE default.wallet_resolution_outcomes (
  wallet_address          String,
  condition_id            String,
  market_id               String,
  resolved_outcome        String,           -- "YES"/"NO"/outcome
  final_side              String,           -- Side held at resolution
  won                     UInt8,            -- 1 if matched, 0 otherwise
  resolved_at             DateTime,
  canonical_category      String,
  num_trades              UInt32,
  final_shares            Float64,
  ingested_at             DateTime
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (wallet_address, condition_id)
```

**Usage:**
```sql
-- Get wallet's win record
SELECT
  canonical_category,
  sum(won) as wins,
  count(*) - sum(won) as losses,
  100.0 * sum(won) / count(*) as win_pct
FROM default.wallet_resolution_outcomes
WHERE wallet_address = '0x...'
GROUP BY canonical_category;
```

**Created By:** `/migrations/clickhouse/015_create_wallet_resolution_outcomes.sql`

---

### 3. wallet_pnl_summary_final

**Purpose:** Aggregated P&L per wallet (realized + unrealized)
**Type:** View or Materialized View
**Rows:** ~1M wallets
**Refresh:** On-demand or scheduled

**Schema:**
```sql
CREATE VIEW default.wallet_pnl_summary_final AS
SELECT
  wallet_address,
  sum(realized_pnl_usd) as total_realized_pnl,
  sum(unrealized_pnl_usd) as total_unrealized_pnl,
  sum(realized_pnl_usd) + sum(unrealized_pnl_usd) as total_pnl,
  count(DISTINCT market_id) as markets_traded,
  sum(usd_value) as total_volume,
  min(timestamp) as first_trade,
  max(timestamp) as last_trade
FROM default.vw_trades_canonical
GROUP BY wallet_address
```

---

## Event & Category Mapping

### 1. events_dim (Event Dimension)

**Purpose:** Event/category hierarchy and metadata
**Type:** Table (SharedReplacingMergeTree)
**Rows:** 50,201
**Size:** 0.93 MB

**Schema:**
```sql
CREATE TABLE default.events_dim (
  event_id                String,
  canonical_category      String,           -- Sports, Politics, Crypto, etc.
  raw_tags                Array(String),    -- Original tags
  title                   String,           -- Event title
  ingested_at             DateTime
) ENGINE = SharedReplacingMergeTree(ingested_at)
ORDER BY event_id
```

**Index:** bloom_filter on canonical_category
**Created By:** `/migrations/clickhouse/014_create_ingestion_spine_tables.sql`

**Usage:**
```sql
-- Get events by category
SELECT * FROM default.events_dim
WHERE canonical_category = 'Sports';

-- Map market to category
SELECT
  m.question,
  e.canonical_category,
  e.raw_tags
FROM default.gamma_markets m
INNER JOIN default.markets_dim md ON m.market_id = md.market_id
INNER JOIN default.events_dim e ON md.event_id = e.event_id;
```

---

### 2. condition_market_map (ID Mapping Cache)

**Purpose:** Fast lookups from condition_id → market_id → event_id
**Type:** Table (SharedReplacingMergeTree)
**Rows:** 151,843
**Size:** 9.17 MB

**Schema:**
```sql
CREATE TABLE default.condition_market_map (
  condition_id            String,           -- Token-level condition ID
  market_id               String,           -- Market-level ID
  event_id                String,           -- Event group ID
  canonical_category      String,           -- Category
  raw_tags                Array(String),    -- Tags
  ingested_at             DateTime
) ENGINE = SharedReplacingMergeTree(ingested_at)
ORDER BY condition_id
```

**Index:** bloom_filter on condition_id, market_id
**Coverage:** 151.8K unique conditions mapped

**Usage:**
```sql
-- Map condition to market
SELECT market_id, canonical_category
FROM default.condition_market_map
WHERE condition_id = '0x...';
```

---

### 3. markets_dim (Market Dimension)

**Purpose:** Market dimension table
**Type:** Table (SharedReplacingMergeTree)
**Rows:** 5,781
**Size:** 0.09 MB

**Schema:**
```sql
CREATE TABLE default.markets_dim (
  market_id               String,
  question                String,
  event_id                String,           -- Links to events_dim
  ingested_at             DateTime
) ENGINE = SharedReplacingMergeTree(ingested_at)
ORDER BY market_id
```

---

## Supporting Infrastructure

### 1. vw_token_to_market (Token → Market Mapping - NEW)

**Purpose:** Derives market-level condition IDs from token-level IDs
**Type:** View
**Expected Rows:** ~228K token IDs → ~85K unique markets
**Source:** Option B implementation

**Schema:**
```sql
CREATE VIEW cascadian_clean.vw_token_to_market AS
SELECT
  lower(condition_id_norm) AS token_cid_hex,
  -- Extract market ID by replacing last 2 hex chars (outcome index) with 00
  concat(substring(lower(condition_id_norm), 1, 64), '00') AS market_cid_hex
FROM default.vw_trades_canonical
WHERE length(replaceAll(condition_id_norm, '0x', '')) = 64
  AND lower(condition_id_norm) NOT IN ('0x0000...000')
GROUP BY token_cid_hex, market_cid_hex
```

**Key Insight:** Polymarket ERC-1155 pattern where token_id = market_id * 256 + outcome_index

**Created By:** `/setup-backfill-schema.ts`

---

### 2. backfill_progress (Backfill Tracking - NEW)

**Purpose:** Resumable progress tracking for API backfill
**Type:** Table (ReplacingMergeTree)
**Rows:** ~204,485 (will decrease as processed)
**Source:** Option B implementation

**Schema:**
```sql
CREATE TABLE cascadian_clean.backfill_progress (
  cid_hex                 String,           -- Market-level condition ID
  status                  Enum8('pending'=0, 'ok'=1, 'error'=2),
  attempts                UInt16,
  last_error              String,
  updated_at              DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY cid_hex
```

**Usage:**
```sql
-- Check backfill progress
SELECT
  status,
  count() as cnt,
  100.0 * count() / (SELECT count() FROM cascadian_clean.backfill_progress) as pct
FROM cascadian_clean.backfill_progress
GROUP BY status;

-- Find errors
SELECT cid_hex, last_error, attempts
FROM cascadian_clean.backfill_progress
WHERE status = 'error'
ORDER BY attempts DESC;
```

**Created By:** `/setup-backfill-schema.ts`
**Monitored By:** `/backfill-market-resolutions.ts`

---

### 3. ctf_token_map

**Purpose:** Conditional token metadata
**Type:** Table (SharedReplacingMergeTree)
**Rows:** 41,130
**Size:** 1.46 MB

**Schema:**
```sql
CREATE TABLE default.ctf_token_map (
  token_id                String,
  condition_id_norm       String,
  market_id               String,
  outcome                 String,           -- "Yes"/"No"
  outcome_index           UInt8,            -- 0 or 1
  question                String
) ENGINE = SharedReplacingMergeTree
ORDER BY token_id
```

**Index:** bloom_filter on condition_id_norm, market_id
**Enhanced By:** `/migrations/clickhouse/016_enhance_polymarket_tables.sql`

---

### 4. outcome_positions_v2

**Purpose:** Position snapshots at market resolution
**Type:** Table (curated, pre-aggregated)
**Rows:** ~2,000,000
**Quality:** VALIDATED for P&L calculations

**Schema:**
```sql
CREATE TABLE default.outcome_positions_v2 (
  wallet_address          String,
  condition_id_norm       String,
  outcome_index           UInt8,
  total_shares            Decimal(18,8),    -- Shares held at resolution
  ingested_at             DateTime
) ENGINE = MergeTree
ORDER BY (wallet_address, condition_id_norm, outcome_index)
```

**Critical For:** Determining which outcome a wallet held when market resolved

**Status:** Used in validated P&L formula (tested, -2.3% variance)

---

## Data Flow Architecture

### Complete Trade → P&L Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN DATA SOURCES                       │
│         (Polygon ERC1155 transfers, ERC20 USDC flows)           │
└────────────┬────────────────────────────────┬────────────────────┘
             │                                │
             ▼                                ▼
    ┌──────────────────┐          ┌──────────────────┐
    │ erc1155_transfers│          │ erc20_transfers  │
    │  206K rows       │          │  288K rows       │
    └────────┬─────────┘          └────────┬─────────┘
             │                             │
             └──────────────┬──────────────┘
                            ▼
                   ┌──────────────────────┐
                   │   trades_raw         │
                   │   159.5M rows        │
                   │   [Dec 2022-Oct 2025]│
                   └──────────┬───────────┘
                              │
                              ▼
                   ┌──────────────────────┐
                   │ vw_trades_canonical  │
                   │ ⭐ PRIMARY SOURCE    │
                   │ + enrichment         │
                   │ + normalization      │
                   └──────────┬───────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
         ┌────────────────────┐   ┌────────────────────┐
         │ vw_resolutions     │   │ condition_market   │
         │ _unified           │   │ _map               │
         │ ⭐ NEW (Option B)  │   │ (ID mapping)       │
         │ 95-100% coverage   │   │                    │
         └──────────┬─────────┘   └────────┬───────────┘
                    │                      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │ P&L CALCULATION    │
                    │ Formula:           │
                    │ pnl = shares *     │
                    │   payout_vec -     │
                    │   cost_basis       │
                    └──────────┬─────────┘
                               │
                               ▼
                    ┌────────────────────┐
                    │ wallet_pnl_summary │
                    │ [FINAL OUTPUT]     │
                    │ By category        │
                    │ By market          │
                    │ By event           │
                    └────────────────────┘
```

### Join Pattern for P&L Calculation

```sql
-- Complete P&L query with category breakdown
SELECT
  t.wallet_address,
  r.source AS resolution_source,
  e.canonical_category,

  -- Realized P&L (resolved markets)
  SUM(CASE
    WHEN r.cid_hex IS NOT NULL THEN
      t.shares * (
        arrayElement(r.payout_numerators, r.winning_index + 1) /
        r.payout_denominator
      ) - t.usd_value
    ELSE 0
  END) AS realized_pnl,

  -- Unrealized P&L (open markets - placeholder)
  SUM(CASE
    WHEN r.cid_hex IS NULL THEN
      t.shares * current_price - t.usd_value
    ELSE 0
  END) AS unrealized_pnl,

  COUNT(*) AS total_trades,
  SUM(t.usd_value) AS total_volume

FROM default.vw_trades_canonical t

-- Join to resolutions (unified view with all sources)
LEFT JOIN cascadian_clean.vw_resolutions_unified r
  ON lower(t.condition_id_norm) = r.cid_hex

-- Join to category mapping
LEFT JOIN default.condition_market_map cm
  ON lower(t.condition_id_norm) = cm.condition_id
LEFT JOIN default.events_dim e
  ON cm.event_id = e.event_id

WHERE t.wallet_address = '0x...'
GROUP BY t.wallet_address, r.source, e.canonical_category
ORDER BY realized_pnl DESC
```

---

## Critical Queries

### 1. Wallet P&L by Category

```sql
SELECT
  e.canonical_category,
  COUNT(DISTINCT t.market_id) AS markets_traded,
  COUNT(*) AS total_trades,
  SUM(t.usd_value) AS total_volume,

  SUM(CASE
    WHEN r.winning_index IS NOT NULL THEN
      t.shares * arrayElement(r.payout_numerators, r.winning_index + 1) - t.usd_value
    ELSE 0
  END) AS realized_pnl,

  SUM(CASE WHEN r.winning_index IS NOT NULL THEN 1 ELSE 0 END) AS resolved_trades,
  COUNT(*) - SUM(CASE WHEN r.winning_index IS NOT NULL THEN 1 ELSE 0 END) AS open_trades

FROM default.vw_trades_canonical t
LEFT JOIN cascadian_clean.vw_resolutions_unified r
  ON lower(t.condition_id_norm) = r.cid_hex
LEFT JOIN default.gamma_markets m
  ON t.market_id = m.market_id
LEFT JOIN default.condition_market_map cm
  ON lower(t.condition_id_norm) = cm.condition_id
LEFT JOIN default.events_dim e
  ON cm.event_id = e.event_id

WHERE t.wallet_address = ?

GROUP BY e.canonical_category
ORDER BY realized_pnl DESC
```

---

### 2. Market Resolution Lookup

```sql
-- Check if a market is resolved and get outcome
SELECT
  cid_hex,
  winning_outcome,
  winning_index,
  resolved_at,
  source,
  payout_numerators,
  payout_denominator
FROM cascadian_clean.vw_resolutions_unified
WHERE cid_hex = lower('0x1234...')
```

---

### 3. Coverage Check (After Backfill)

```sql
SELECT
  (SELECT count(DISTINCT condition_id_norm)
   FROM default.vw_trades_canonical
   WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS total_traded,

  (SELECT count(DISTINCT t.condition_id_norm)
   FROM default.vw_trades_canonical t
   INNER JOIN cascadian_clean.vw_resolutions_unified r
     ON lower(t.condition_id_norm) = r.cid_hex
   WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS matched,

  matched * 100.0 / total_traded AS coverage_pct
```

**Expected Result After Backfill:** 95-100% coverage

---

### 4. Top Markets by Volume

```sql
SELECT
  m.question,
  m.category,
  m.tags,
  COUNT(DISTINCT t.wallet_address) AS unique_traders,
  COUNT(*) AS total_trades,
  SUM(t.usd_value) AS total_volume,
  r.winning_outcome,
  r.resolved_at
FROM default.vw_trades_canonical t
INNER JOIN default.gamma_markets m
  ON t.market_id = m.market_id
LEFT JOIN cascadian_clean.vw_resolutions_unified r
  ON lower(t.condition_id_norm) = r.cid_hex
GROUP BY m.question, m.category, m.tags, r.winning_outcome, r.resolved_at
ORDER BY total_volume DESC
LIMIT 100
```

---

## Post-Backfill Verification

### Step 1: Verify Backfill Completion

```bash
npx tsx -e "
const client = require('@clickhouse/client').createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

const res = await client.query({
  query: \`
    SELECT
      status,
      count() as cnt
    FROM cascadian_clean.backfill_progress
    GROUP BY status
  \`,
  format: 'JSONEachRow'
});

console.log(await res.json());
await client.close();
"
```

**Expected:**
- `ok`: ~180K-190K (successful fetches)
- `error`: ~10K-20K (404s, old markets)
- `pending`: 0 (all processed)

---

### Step 2: Rebuild Unified View

```bash
npx tsx create-unified-resolutions-view.ts
```

**Expected Output:**
```
Source breakdown:
  market_resolutions_final       144,015 markets
  api_backfill                   ~150,000 markets
  gamma_markets                       94 markets
  TOTAL                         ~290,000 markets

Coverage: 95-100%
```

---

### Step 3: Validate P&L Calculations

```sql
-- Test on a known wallet
SELECT
  wallet_address,
  COUNT(*) AS total_trades,
  SUM(CASE WHEN r.cid_hex IS NOT NULL THEN 1 ELSE 0 END) AS resolved_trades,
  SUM(t.shares * arrayElement(r.payout_numerators, r.winning_index + 1) - t.usd_value) AS total_pnl
FROM default.vw_trades_canonical t
LEFT JOIN cascadian_clean.vw_resolutions_unified r
  ON lower(t.condition_id_norm) = r.cid_hex
WHERE t.wallet_address = '0x12F9c707388172A9aaCd7cD201E0b260e0760EDB'  -- Reference wallet
GROUP BY wallet_address
```

---

## Migration Checklist

**Before Deployment:**
- [x] Setup backfill schema (`setup-backfill-schema.ts`)
- [x] Create unified resolutions view (`create-unified-resolutions-view.ts`)
- [ ] Complete API backfill (running, ETA ~1:15 AM)
- [ ] Rebuild unified view with backfill data
- [ ] Validate coverage ≥95%
- [ ] Update P&L calculation queries
- [ ] Test on reference wallets
- [ ] Document API routes for UI

**After Deployment:**
- [ ] Monitor query performance
- [ ] Add materialized views if needed
- [ ] Setup scheduled refreshes for analytics tables
- [ ] Archive old backup tables

---

## Performance Optimization

### Recommended Indexes

```sql
-- Add projection index to trades_raw for wallet queries
ALTER TABLE default.trades_raw
ADD PROJECTION wallet_trades_proj (
  SELECT *
  ORDER BY (wallet_address, timestamp)
);

-- Materialize for faster lookups
ALTER TABLE default.trades_raw
MATERIALIZE PROJECTION wallet_trades_proj;

-- Add bloom filter to resolutions for faster joins
ALTER TABLE cascadian_clean.resolutions_src_api
ADD INDEX bloom_cid_idx cid_hex TYPE bloom_filter GRANULARITY 1;
```

### Materialized Views for Dashboards

```sql
-- Pre-aggregate wallet P&L
CREATE MATERIALIZED VIEW default.wallet_pnl_cache
ENGINE = AggregatingMergeTree
ORDER BY wallet_address
POPULATE
AS SELECT
  wallet_address,
  sumState(realized_pnl_usd) AS total_pnl,
  countState() AS total_trades,
  uniqState(market_id) AS unique_markets
FROM default.vw_trades_canonical
GROUP BY wallet_address;
```

---

## Summary

**Production Database Consists Of:**

1. **Trade Universe:** `vw_trades_canonical` (159M trades)
2. **Resolutions:** `vw_resolutions_unified` (95-100% coverage after backfill)
3. **Market Metadata:** `gamma_markets` (150K markets)
4. **Wallet Analytics:** `wallet_metrics_complete` (1M wallets)
5. **Category Mapping:** `events_dim` + `condition_market_map`
6. **Supporting:** Token mappings, backfill tracking

**After Backfill Completion:**
- ✅ 100% of trade data available
- ✅ 95-100% resolution coverage
- ✅ Complete category/tag mapping
- ✅ Ready for category-based P&L analysis

**Key Files:**
- `/backfill-market-resolutions.ts` - Running now
- `/create-unified-resolutions-view.ts` - Run after backfill
- `/OPTION_B_BACKFILL_SUMMARY.md` - Implementation details

---

**Last Updated:** 2025-11-08
**Next Action:** Wait for backfill completion (~1:15 AM), then run unified view rebuild
