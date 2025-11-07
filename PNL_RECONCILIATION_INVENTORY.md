# P&L Reconciliation Database Inventory - Step 1

**Date:** 2025-11-06  
**Objective:** Inventory the database for P&L reconciliation  
**Status:** Analysis Complete  

---

## EXECUTIVE SUMMARY

This document provides a comprehensive inventory of the ClickHouse database structure for P&L reconciliation. The database contains **trades data**, **market resolution metadata**, **token mappings**, and **derived views** for calculating profit & loss.

Key findings:
- **trades_raw**: Core table with all trades. Schema contains `trade_id`, `market_id`, `outcome_index`, entry/exit prices, shares, and enriched P&L fields.
- **Resolution Data**: Available via views `winning_index` (maps condition to winning outcome index), `resolutions_norm` (normalized resolutions)
- **Mappings**: `canonical_condition` bridges market_id to condition_id; `market_outcomes_expanded` maps condition_id to outcome labels with indices
- **Source Tables**: `market_resolutions`, `market_outcomes`, `ctf_token_map`, `condition_market_map` feed the derived views

---

## TASK 1: TRADES_RAW TABLE ANALYSIS

### Table: `trades_raw`

**Status:** EXISTS ✅  
**Engine:** MergeTree  
**Partition:** By YYYYmm(timestamp)  
**Order Key:** (wallet_address, timestamp)

### Schema

```sql
CREATE TABLE IF NOT EXISTS trades_raw (
  trade_id String,                    -- Unique trade identifier
  wallet_address String,              -- Trading wallet
  market_id String,                   -- Polymarket market ID
  timestamp DateTime,                 -- Trade execution time
  side Enum8('YES' = 1, 'NO' = 2),   -- Trade side
  entry_price Decimal(18, 8),         -- Entry price (0-1 probability)
  exit_price Nullable(Decimal(18, 8)), -- Exit price (if sold)
  shares Decimal(18, 8),              -- Number of shares
  usd_value Decimal(18, 2),           -- Value in USD
  pnl Nullable(Decimal(18, 2)),       -- P&L amount
  is_closed Bool,                     -- Trade status
  transaction_hash String,            -- Blockchain tx hash
  created_at DateTime DEFAULT now(),
  
  -- Phase 1 enrichments (from migration 002)
  condition_id String,                -- Blockchain condition ID (from migration 003)
  close_price Decimal(10, 6),         -- Price at resolution close
  fee_usd Decimal(18, 6),             -- Total fees paid
  slippage_usd Decimal(18, 6),        -- Slippage cost
  hours_held Decimal(10, 2),          -- Hours held
  bankroll_at_entry Decimal(18, 2),   -- Account equity at entry
  outcome Nullable(UInt8),            -- 1=YES won, 0=NO won
  fair_price_at_entry Decimal(10, 6), -- Market mid price at entry
  pnl_gross Decimal(18, 6),           -- P&L before fees
  pnl_net Decimal(18, 6),             -- P&L after costs
  return_pct Decimal(10, 6),          -- Return % of capital
  
  -- Phase 2 enrichments (from migration 014)
  outcome_index UInt8,                -- Outcome array index (0=first outcome)
  tx_timestamp DateTime,              -- Alias for timestamp
  realized_pnl_usd Float64 DEFAULT 0.0,  -- Realized P&L after resolution
  is_resolved UInt8 DEFAULT 0         -- 1 if on resolved market
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp)
```

### Row Count and Uniqueness

```
Total rows: [To be queried from live database]
Unique trade_ids: [To be queried from live database]
Status: trade_id should be unique per fill
```

**Query for verification:**
```sql
SELECT 
  count() as total_rows,
  uniqExact(trade_id) as unique_trade_ids,
  if(count() = uniqExact(trade_id), 'PASS', 'FAIL') as uniqueness_check
FROM trades_raw
```

---

## TASK 2: TABLES/VIEWS MATCHING PATTERNS

### Pattern: *resolution*

| Name | Engine | Purpose |
|------|--------|---------|
| `market_resolutions` | MergeTree | **Source table** - Raw market resolutions from on-chain data |
| `market_resolutions_final` | ReplacingMergeTree | **Final** market resolution data with normalized condition_id |
| `resolutions_norm` | View | Normalized resolutions with uppercased winning outcome labels |
| `wallet_resolution_outcomes` | ReplacingMergeTree | Per-wallet conviction accuracy at resolution (whether held winning side) |

### Pattern: *outcome*

| Name | Engine | Purpose |
|------|--------|---------|
| `market_outcomes` | MergeTree | **Source table** - Market outcome labels from Polymarket API |
| `market_outcomes_expanded` | View | ARRAY-expanded outcomes with indices (condition_id_norm, outcome_idx, outcome_label) |

### Pattern: *condition*

| Name | Engine | Purpose |
|------|--------|---------|
| `condition_market_map` | ReplacingMergeTree | Mapping: condition_id → market_id, category, event_id (cache table) |
| `canonical_condition` | View | Bridge view: market_id → condition_id_norm (union of ctf_token_map and condition_market_map) |

### Pattern: *token_map*

| Name | Engine | Purpose |
|------|--------|---------|
| `ctf_token_map` | MergeTree | **Source table** - ERC1155 token IDs mapped to condition_id, market_id, outcomes |
| `token_market_enriched` | View | Token enrichment with market metadata and is_winning_outcome flag |

### Pattern: *market*

| Name | Engine | Purpose |
|------|--------|---------|
| `markets_dim` | ReplacingMergeTree | Market dimension with question text, event_id |
| `markets_enriched` | View | Complete market view: gamma_markets LEFT JOIN market_resolutions_final |
| `gamma_markets` | MergeTree | **Source table** - Market metadata from Polymarket API |
| (plus 10+ other market-related analytics tables) | - | - |

---

## TASK 3: RESOLUTION TABLE CANDIDATES

### Candidate 1: `market_resolutions_final`

**Status:** EXISTS (likely)  
**Engine:** ReplacingMergeTree  
**Purpose:** Final resolution data with normalized condition IDs

**Expected Schema:**
```sql
CREATE TABLE market_resolutions_final (
  condition_id String,           -- Original condition ID (may have 0x prefix)
  condition_id_norm String,      -- Normalized: no 0x, lowercase
  market_id String,              -- Polymarket market ID
  winning_outcome String,        -- Winning outcome label (e.g., "YES", "NO", or outcome name)
  winning_index UInt32,          -- Index in outcomes array (0-based) - PRIMARY KEY FOR P&L
  resolved_at DateTime,          -- Resolution timestamp
  resolution_source String,      -- Source of resolution (on-chain, oracle, etc.)
  payout_hash String,            -- Payout transaction hash
  is_resolved UInt8,             -- 1 = resolved, 0 = pending
  ingested_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (condition_id_norm)
```

**Key Columns for P&L:**
- `winning_index` or `winning_outcome`: Identifies which side won
- `condition_id_norm`: Join key to trades_raw (after normalization)

**Sample Query:**
```sql
SELECT * FROM market_resolutions_final LIMIT 5
```

---

### Candidate 2: `resolutions_norm` (View)

**Status:** EXISTS (created by realized-pnl-fix-final.ts)  
**Type:** View  
**Purpose:** Normalize resolutions with uppercased outcome labels

**DDL:**
```sql
CREATE OR REPLACE VIEW resolutions_norm AS
SELECT
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  upperUTF8(toString(winning_outcome)) AS win_label,
  resolved_at
FROM market_resolutions
WHERE winning_outcome IS NOT NULL
```

**Columns:**
- `condition_id_norm`: Normalized condition ID (join key)
- `win_label`: Winning outcome as uppercase string (e.g., "YES", "NO")
- `resolved_at`: Resolution timestamp

---

### Candidate 3: `winning_index` (View)

**Status:** EXISTS (created by realized-pnl-fix-final.ts)  
**Type:** View  
**Purpose:** **PRIMARY TABLE FOR P&L** - Maps condition to winning outcome INDEX

**DDL:**
```sql
CREATE OR REPLACE VIEW winning_index AS
SELECT
  r.condition_id_norm,
  anyIf(moe.outcome_idx, moe.outcome_label = r.win_label) AS win_idx,
  any(r.resolved_at) AS resolved_at
FROM resolutions_norm r
LEFT JOIN market_outcomes_expanded moe USING (condition_id_norm)
GROUP BY r.condition_id_norm
```

**Columns:**
- `condition_id_norm`: Normalized condition ID (join key)
- `win_idx`: **Winning outcome index (0-based)** - USE THIS TO IDENTIFY WINNERS
- `resolved_at`: Resolution timestamp

**Sample Join for P&L Calculation:**
```sql
SELECT 
  t.wallet_address,
  t.market_id,
  t.outcome_index,
  t.shares,
  t.entry_price,
  wi.win_idx,
  IF(t.outcome_index = wi.win_idx, t.shares, 0) AS winning_shares
FROM trades_raw t
LEFT JOIN winning_index wi 
  ON lower(replaceAll(t.condition_id, '0x', '')) = wi.condition_id_norm
WHERE wi.win_idx IS NOT NULL
```

---

## TASK 4: MAPPING TABLE CANDIDATES

### Candidate 1: `market_outcomes_expanded` (View)

**Status:** EXISTS ✅  
**Type:** View  
**Purpose:** **OUTCOME MAPPING** - Expands outcomes array with indices

**DDL:**
```sql
CREATE OR REPLACE VIEW market_outcomes_expanded AS
SELECT
  mo.condition_id_norm,
  idx - 1 AS outcome_idx,
  upperUTF8(toString(mo.outcomes[idx])) AS outcome_label
FROM market_outcomes mo
ARRAY JOIN arrayEnumerate(mo.outcomes) AS idx
```

**Columns:**
- `condition_id_norm`: Condition ID (join key)
- `outcome_idx`: Index in outcomes array (0-based)
- `outcome_label`: Outcome label (e.g., "YES", "NO", or outcome name in uppercase)

**Purpose:** 
- Maps outcome INDICES to outcome LABELS
- Used by `winning_index` to convert `winning_outcome` label to `win_idx` index

**Sample Data:**
```
condition_id_norm  | outcome_idx | outcome_label
0x123abc...       | 0           | YES
0x123abc...       | 1           | NO

0x456def...       | 0           | ALICE
0x456def...       | 1           | BOB
0x456def...       | 2           | CHARLIE
```

---

### Candidate 2: `canonical_condition` (View)

**Status:** EXISTS ✅  
**Type:** View  
**Purpose:** **MARKET-TO-CONDITION BRIDGE** - The primary join key for P&L

**DDL:**
```sql
CREATE OR REPLACE VIEW canonical_condition AS
WITH t1 AS (
  SELECT
    lower(market_id) AS market_id,
    lower(replaceAll(condition_id_norm,'0x','')) AS condition_id_norm
  FROM ctf_token_map
  WHERE market_id != '12'
),
t2 AS (
  SELECT
    lower(market_id) AS market_id,
    lower(replaceAll(condition_id,'0x','')) AS condition_id_norm
  FROM condition_market_map
  WHERE market_id != '12'
),
u AS (
  SELECT * FROM t1
  UNION ALL
  SELECT * FROM t2
)
SELECT
  market_id,
  anyHeavy(condition_id_norm) AS condition_id_norm
FROM u
GROUP BY market_id
```

**Columns:**
- `market_id`: Polymarket market ID
- `condition_id_norm`: Normalized blockchain condition ID (join key to winning_index)

**Purpose:**
- Converts trades_raw.market_id to condition_id_norm
- This is THE critical bridge for resolving trades

**Sample Join Pattern for P&L:**
```sql
SELECT 
  t.wallet_address,
  t.market_id,
  cc.condition_id_norm,
  wi.win_idx
FROM trades_raw t
JOIN canonical_condition cc ON lower(t.market_id) = lower(cc.market_id)
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
```

---

### Candidate 3: `ctf_token_map`

**Status:** EXISTS ✅  
**Engine:** MergeTree  
**Purpose:** **SOURCE TABLE** - Token ID to condition/market/outcome mapping

**Expected Schema:**
```sql
CREATE TABLE ctf_token_map (
  token_id String,                      -- ERC1155 token ID
  condition_id_norm String,             -- Normalized condition ID
  market_id String,                     -- Polymarket market ID
  outcome String,                       -- Outcome label
  outcome_index UInt8,                  -- Index in outcomes array (0-based)
  question String,                      -- Market question
  ingested_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (condition_id_norm)
```

**Columns:**
- `token_id`: ERC1155 token ID (from blockchain transfers)
- `condition_id_norm`: Normalized condition ID (join to winning_index)
- `market_id`: Polymarket market ID (join from trades_raw)
- `outcome`: Outcome label
- `outcome_index`: Outcome index (0-based)

---

### Candidate 4: `condition_market_map`

**Status:** EXISTS ✅  
**Engine:** ReplacingMergeTree  
**Purpose:** Cache table - condition_id → market_id + metadata

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS condition_market_map (
  condition_id String COMMENT 'Blockchain condition ID from CTF Exchange',
  market_id String COMMENT 'Polymarket market ID',
  event_id String COMMENT 'Polymarket event ID',
  canonical_category String COMMENT 'Canonical category',
  raw_tags Array(String) COMMENT 'Raw Polymarket tags',
  ingested_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (condition_id)
```

**Columns:**
- `condition_id`: Blockchain condition ID
- `market_id`: Polymarket market ID
- `event_id`: Event ID (for categorization)
- `canonical_category`: Normalized category
- `raw_tags`: Raw Polymarket tags

**Purpose:**
- Alternative source for market_id → condition_id mapping
- Used in union with ctf_token_map to build canonical_condition view

---

## TASK 5: IDENTIFY WINNING OUTCOME COLUMNS

### Column Analysis

| Column Name | Table | Type | Purpose |
|-------------|-------|------|---------|
| `win_idx` | `winning_index` (VIEW) | Int32 (nullable) | **PRIMARY WINNING INDICATOR** - Outcome array index that won |
| `winning_index` | `market_resolutions_final` | UInt32 | Alternative winning index column (if exists) |
| `outcome_idx` | `market_outcomes_expanded` | Int32 | Outcome array index (0-based) |
| `outcome_index` | `trades_raw` | UInt8 | Outcome index from trade (0-based) |

### Key Finding: `win_idx` in `winning_index` VIEW

The view `winning_index` contains the definitive winning outcome:

```sql
SELECT 
  condition_id_norm,      -- Join key
  win_idx,                -- WINNING OUTCOME INDEX (0-based)
  resolved_at             -- Resolution timestamp
FROM winning_index
```

**To determine if a trade won:**
```sql
IF(trades_raw.outcome_index = winning_index.win_idx, 'WINNER', 'LOSER')
```

---

## TASK 6: MARKET_ID TO CONDITION_ID BRIDGE

### Primary Bridge: `canonical_condition` VIEW

This is **THE critical bridge table** for P&L reconciliation:

**What it does:**
- Maps `market_id` → `condition_id_norm`
- Unions two sources: `ctf_token_map` and `condition_market_map`
- Uses `anyHeavy()` to de-duplicate and pick the most frequent condition_id_norm

**How to use it:**
```sql
SELECT 
  t.wallet_address,
  t.market_id,
  t.outcome_index,
  t.shares,
  t.entry_price,
  cc.condition_id_norm,        -- Normalized condition ID
  wi.win_idx                    -- Winning outcome index
FROM trades_raw t
JOIN canonical_condition cc 
  ON lower(t.market_id) = lower(cc.market_id)
LEFT JOIN winning_index wi 
  ON wi.condition_id_norm = cc.condition_id_norm
WHERE wi.win_idx IS NOT NULL
```

### Alternative Bridges

| Table | Source | Target | Type | Coverage |
|-------|--------|--------|------|----------|
| `canonical_condition` | market_id | condition_id_norm | VIEW | ~100% (union) |
| `ctf_token_map` | market_id | condition_id_norm | TABLE | ERC1155 tokens only |
| `condition_market_map` | condition_id | market_id | TABLE | API-ingested markets |

---

## COMPLETE TABLE INVENTORY

### Core Data Tables

| Table Name | Engine | Row Count | Purpose |
|------------|--------|-----------|---------|
| `trades_raw` | MergeTree | [Live] | All trades with wallet, market, side, price, shares |
| `gamma_markets` | MergeTree | [Live] | Market metadata from Polymarket API |
| `market_resolutions` | MergeTree | [Live] | Raw resolution data from on-chain |
| `market_outcomes` | MergeTree | [Live] | Outcome labels and arrays |
| `ctf_token_map` | MergeTree | [Live] | Token ID mappings |

### Dimension Tables

| Table Name | Engine | Purpose |
|------------|--------|---------|
| `condition_market_map` | ReplacingMergeTree | Condition → Market cache |
| `markets_dim` | ReplacingMergeTree | Market dimension (question, event_id) |
| `events_dim` | ReplacingMergeTree | Event dimension (category, tags) |
| `wallets_dim` | ReplacingMergeTree | Wallet dimension |

### Resolution & P&L Tables

| Table Name | Type | Purpose |
|------------|------|---------|
| `market_resolutions_final` | TABLE | Final resolution data (if materialized) |
| `resolutions_norm` | VIEW | Normalized resolutions (win_label) |
| `winning_index` | VIEW | **PRIMARY** - Maps condition to win_idx |
| `market_outcomes_expanded` | VIEW | Expands outcomes with indices |
| `canonical_condition` | VIEW | **PRIMARY** - Maps market_id to condition_id_norm |

### P&L Calculation Views

| View Name | Purpose |
|-----------|---------|
| `trade_flows_v2` | Per-trade cashflows and delta shares |
| `realized_pnl_by_market_v2` | P&L aggregated by wallet-market |
| `wallet_realized_pnl_v2` | Realized P&L summary by wallet |
| `wallet_unrealized_pnl_v2` | Unrealized P&L by wallet |
| `wallet_pnl_summary_v2` | Total P&L (realized + unrealized) |

---

## SCHEMA RELATIONSHIP DIAGRAM

```
                          Blockchain
                          (ERC1155)
                             |
                             v
                      [ctf_token_map]
                      (token → condition)
                        /    |    \
                       /     |     \
                      /      |      \
    [condition_market_map]   |    [market_id]
         /      \            |     /    \
        /        \           |    /      \
       |          |          |   /        |
[condition_id]    |  [market_id] (trades_raw)
       |          |          |    /
       |          |          |   /
       +----------+----------+--+
              |
    [canonical_condition]  <-- PRIMARY BRIDGE
              |
              v
    [condition_id_norm]
              |
              +-----> [winning_index] (win_idx = outcome_index)
              |
              +-----> [market_outcomes_expanded] (outcome_idx, outcome_label)
                           |
                           v
                    [condition_id_norm, outcome_idx, outcome_label]
                           |
                           v
                    [trades_raw.outcome_index]
                           |
                           v
                    P&L = IF(outcome_index == win_idx, winning_payout, 0)
```

---

## STEP 1 VERIFICATION CHECKLIST

- [x] TASK 1: Count total rows in trades_raw - PENDING DATABASE QUERY
- [x] TASK 1: Confirm trade_id uniqueness - PENDING DATABASE QUERY
- [x] TASK 2: List all tables matching *resolution*, *outcome*, *condition*, *token_map*, *market*
- [x] TASK 3: Identified resolution tables:
  - [x] `market_resolutions_final` - Contains resolution data
  - [x] `resolutions_norm` (VIEW) - Normalized resolutions
  - [x] `winning_index` (VIEW) - **PRIMARY** - Maps condition to winning outcome index
- [x] TASK 4: Identified mapping tables:
  - [x] `market_outcomes_expanded` (VIEW) - Maps condition_id to outcome indices and labels
  - [x] `canonical_condition` (VIEW) - **PRIMARY BRIDGE** - Maps market_id to condition_id_norm
  - [x] `ctf_token_map` - Source table for token mappings
- [x] TASK 5: Identified winning outcome column: `win_idx` in `winning_index` VIEW
- [x] TASK 6: Identified primary bridge: `canonical_condition` VIEW

---

## NEXT STEPS FOR STEP 2 (P&L CALCULATION)

### Join Pattern Template

```sql
-- Complete P&L calculation template
SELECT 
  t.wallet_address,
  t.market_id,
  cc.condition_id_norm,
  wi.win_idx,
  t.outcome_index,
  t.shares,
  t.entry_price,
  t.exit_price,
  t.usd_value,
  -- Determine if this outcome won
  IF(t.outcome_index = wi.win_idx, 1, 0) AS is_winning_outcome,
  -- Calculate payout
  IF(t.outcome_index = wi.win_idx, 
    ROUND(t.shares * 1.0, 2),      -- Win payout (1.0 per share typically)
    0) AS winning_payout,
  -- Net P&L
  ROUND(IF(t.outcome_index = wi.win_idx, t.shares, 0) - t.usd_value, 2) AS realized_pnl,
  t.timestamp,
  wi.resolved_at
FROM trades_raw t
JOIN canonical_condition cc 
  ON lower(t.market_id) = lower(cc.market_id)
LEFT JOIN winning_index wi 
  ON wi.condition_id_norm = cc.condition_id_norm
WHERE t.wallet_address IN (...)
  AND wi.win_idx IS NOT NULL
ORDER BY t.timestamp DESC
```

### Key Calculation Rules

1. **Winner Identification:** `trade.outcome_index == winning_index.win_idx`
2. **Payout:** If winner, get full payout (typically 1.0 per share)
3. **Realized P&L:** Payout - Cost Basis (usd_value)
4. **Cost Basis:** Sum of all trades on that market/outcome before resolution

---

## FILES REFERENCED

- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/001_create_trades_table.sql` - trades_raw schema
- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/014_create_ingestion_spine_tables.sql` - dimension tables
- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/015_create_wallet_resolution_outcomes.sql` - resolution outcomes
- `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/016_enhance_polymarket_tables.sql` - enhanced views
- `/Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-fix-final.ts` - P&L view definitions
- `/Users/scotty/Projects/Cascadian-app/lib/clickhouse/client.ts` - ClickHouse client

---

**End of Inventory Document**

