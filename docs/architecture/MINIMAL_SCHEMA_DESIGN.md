# Minimal Schema Design for CASCADIAN

**Based on:** Dune Analytics Polymarket schema
**Goal:** Clean, maintainable, production-ready database structure
**Current Status:** 60+ tables → Reduce to 10 core tables

---

## Design Principles

1. **Single Source of Truth** - One canonical table per entity type
2. **Normalized IDs** - All condition_ids stored as 64-char lowercase (no 0x prefix)
3. **Blockchain as Authority** - ERC1155 transfers + ERC20 USDC = source of truth
4. **ReplacingMergeTree** - Idempotent updates, no UPDATE statements
5. **Dune-Compatible** - Match Dune's proven schema where possible

---

## Core Tables (10 Total)

### Category 1: Trade Data (3 tables)

#### 1. `trades_canonical` (PRIMARY TABLE)
**Purpose:** All Polymarket trades with full context
**Source:** ERC1155 transfers + CLOB fills + enrichment
**Engine:** ReplacingMergeTree(updated_at)

```sql
CREATE TABLE trades_canonical (
  -- Blockchain identifiers
  block_time DateTime,
  block_number UInt64,
  tx_hash String,
  evt_index UInt32,

  -- Trade participants
  wallet_address String,
  maker String,
  taker String,

  -- Market identifiers
  condition_id_norm FixedString(64),  -- Normalized: lowercase, no 0x, 64 chars
  market_id String,                    -- Polymarket market slug
  question_id String,
  token_id UInt256,

  -- Trade details
  outcome_index UInt8,
  direction Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 0),
  shares Decimal(18, 8),
  price Decimal(18, 8),              -- Price per share (0-1 range)
  usd_value Decimal(18, 2),          -- Total USD value of trade
  fee_usd Decimal(18, 6),

  -- Data quality
  confidence Enum8('HIGH' = 3, 'MEDIUM' = 2, 'LOW' = 1, 'UNKNOWN' = 0),
  data_source LowCardinality(String), -- 'erc1155', 'clob', 'merged'

  -- Metadata
  updated_at DateTime DEFAULT now(),
  created_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (condition_id_norm, wallet_address, block_time, tx_hash, evt_index)
PARTITION BY toYYYYMM(block_time)
SETTINGS index_granularity = 8192;
```

**Indexes:**
```sql
-- Add after table creation
ALTER TABLE trades_canonical ADD INDEX idx_wallet_time (wallet_address, block_time) TYPE minmax GRANULARITY 4;
ALTER TABLE trades_canonical ADD INDEX idx_market_time (market_id, block_time) TYPE minmax GRANULARITY 4;
```

---

#### 2. `user_positions_daily`
**Purpose:** Daily snapshot of user holdings in each market
**Source:** Aggregated from trades_canonical + ERC1155 balances
**Engine:** ReplacingMergeTree(updated_at)

```sql
CREATE TABLE user_positions_daily (
  day Date,
  wallet_address String,
  condition_id_norm FixedString(64),
  token_id UInt256,
  outcome_index UInt8,

  -- Position
  balance Decimal(18, 8),
  cost_basis Decimal(18, 2),        -- Average entry price * shares
  current_value Decimal(18, 2),      -- Latest market price * shares

  -- Status
  is_closed Bool DEFAULT false,

  -- Metadata
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (day, wallet_address, condition_id_norm, token_id)
PARTITION BY toYYYYMM(day)
SETTINGS index_granularity = 8192;
```

---

#### 3. `user_capital_actions`
**Purpose:** Deposits/withdrawals of USDC to/from Polymarket
**Source:** ERC20 transfers (USDC) to/from Polymarket contracts
**Engine:** ReplacingMergeTree(block_time)

```sql
CREATE TABLE user_capital_actions (
  block_time DateTime,
  block_number UInt64,
  tx_hash String,
  evt_index UInt32,

  action Enum8('DEPOSIT' = 1, 'WITHDRAW' = 2),
  from_address String,
  to_address String,

  symbol String DEFAULT 'USDC',
  amount_raw UInt256,
  amount Decimal(18, 6),             -- Normalized to USDC decimals
  amount_usd Decimal(18, 2)          -- Same as amount for USDC
) ENGINE = ReplacingMergeTree(block_time)
ORDER BY (block_time, from_address, to_address, tx_hash)
PARTITION BY toYYYYMM(block_time)
SETTINGS index_granularity = 8192;
```

---

### Category 2: Market Data (4 tables)

#### 4. `market_details`
**Purpose:** Market metadata and status
**Source:** Polymarket API + on-chain events
**Engine:** ReplacingMergeTree(updated_at)

```sql
CREATE TABLE market_details (
  -- Identifiers
  condition_id_norm FixedString(64),
  question_id String,
  market_id String,                  -- Polymarket slug
  neg_risk_market_id String,         -- For multi-outcome markets

  -- Market info
  question String,
  question_description String,
  event_market_name String,          -- Parent event (e.g., "2024 Election")
  market_slug String,

  -- Outcomes
  outcome_count UInt8,
  outcomes Array(String),            -- ['Yes', 'No'] or ['Team A', 'Team B', ...]

  -- Status
  active Bool,
  archived Bool,
  closed Bool,
  accepting_orders Bool,
  neg_risk Bool,

  -- Timestamps
  market_start_time DateTime,
  market_end_time Nullable(DateTime),

  -- Metadata
  category LowCardinality(String),
  tags Array(String),
  polymarket_link String,

  updated_at DateTime DEFAULT now(),
  created_at DateTime
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY condition_id_norm
SETTINGS index_granularity = 8192;
```

---

#### 5. `market_resolutions`
**Purpose:** Resolution outcomes and payout vectors
**Source:** CTF contracts + Polymarket API
**Engine:** ReplacingMergeTree(version)

```sql
-- NOTE: You already have this as market_resolutions_final!
-- Just need to ensure it matches this schema

CREATE TABLE market_resolutions (
  condition_id_norm FixedString(64),

  -- Resolution
  payout_numerators Array(UInt8),    -- Payout vector (e.g., [1, 0] for Yes win)
  payout_denominator UInt8,          -- Always 1 for binary markets
  outcome_count UInt8,
  winning_index UInt16,              -- Index of winning outcome
  winning_outcome LowCardinality(String), -- 'Yes', 'No', 'Team A', etc.

  -- Metadata
  source LowCardinality(String),     -- 'api', 'blockchain', 'manual'
  version UInt8,                     -- For handling re-resolutions
  resolved_at Nullable(DateTime),
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(version)
ORDER BY condition_id_norm
SETTINGS index_granularity = 8192;
```

---

#### 6. `market_prices_hourly`
**Purpose:** Hourly OHLC price data for each outcome
**Source:** Aggregated from trades_canonical
**Engine:** SummingMergeTree

```sql
CREATE TABLE market_prices_hourly (
  hour DateTime,                     -- Rounded to hour
  condition_id_norm FixedString(64),
  token_id UInt256,
  outcome_index UInt8,

  -- OHLC
  open Decimal(18, 8),
  high Decimal(18, 8),
  low Decimal(18, 8),
  close Decimal(18, 8),

  -- Volume
  volume_usd Decimal(18, 2),
  trade_count UInt32,

  -- Updated
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (condition_id_norm, token_id, hour)
PARTITION BY toYYYYMM(hour)
SETTINGS index_granularity = 8192;
```

---

#### 7. `market_prices_daily`
**Purpose:** Daily OHLC price data (for dashboards)
**Source:** Aggregated from market_prices_hourly
**Engine:** ReplacingMergeTree

```sql
CREATE TABLE market_prices_daily (
  day Date,
  condition_id_norm FixedString(64),
  token_id UInt256,
  outcome_index UInt8,

  -- OHLC
  open Decimal(18, 8),
  high Decimal(18, 8),
  low Decimal(18, 8),
  close Decimal(18, 8),

  -- Volume
  volume_usd Decimal(18, 2),
  trade_count UInt32,

  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (condition_id_norm, token_id, day)
PARTITION BY toYYYYMM(day)
SETTINGS index_granularity = 8192;
```

---

### Category 3: User Data (2 tables)

#### 8. `users`
**Purpose:** User wallet registry (Safe + Magic wallets)
**Source:** SafeProxyFactory + MagicWalletFactory events
**Engine:** ReplacingMergeTree(block_time)

```sql
CREATE TABLE users (
  created_time DateTime,
  block_number UInt64,
  tx_hash String,
  evt_index UInt32,

  wallet_type Enum8('safe' = 1, 'magic' = 2, 'eoa' = 3),
  owner String,                      -- EOA that controls the wallet
  polymarket_wallet String,          -- Proxy wallet address

  -- Funding info
  first_funded_time Nullable(DateTime),
  first_funded_by String,
  has_been_funded Bool,
  minutes_to_first_funding Nullable(UInt32)
) ENGINE = ReplacingMergeTree(created_time)
ORDER BY polymarket_wallet
SETTINGS index_granularity = 8192;
```

---

#### 9. `wallet_metrics`
**Purpose:** Smart money scoring and wallet analytics
**Source:** Computed from trades_canonical
**Engine:** ReplacingMergeTree(updated_at)

```sql
CREATE TABLE wallet_metrics (
  wallet_address String,

  -- Trading stats
  total_trades UInt32,
  total_volume_usd Decimal(18, 2),
  winning_trades UInt32,
  losing_trades UInt32,
  win_rate Decimal(5, 2),

  -- PnL
  realized_pnl_usd Decimal(18, 2),
  unrealized_pnl_usd Decimal(18, 2),
  total_pnl_usd Decimal(18, 2),
  roi Decimal(10, 4),

  -- Timing
  avg_hold_time_hours Decimal(10, 2),
  first_trade_time DateTime,
  last_trade_time DateTime,

  -- Smart money score
  smart_money_score Decimal(5, 2),   -- 0-100 scale
  rank UInt32,                       -- Global rank

  -- Metadata
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY wallet_address
SETTINGS index_granularity = 8192;
```

---

### Category 4: Raw Blockchain Data (1 table)

#### 10. `erc1155_transfers`
**Purpose:** Raw ERC1155 transfer events (for rebuilds)
**Source:** Polygon blockchain
**Engine:** ReplacingMergeTree(block_time)

```sql
CREATE TABLE erc1155_transfers (
  block_time DateTime,
  block_number UInt64,
  tx_hash String,
  evt_index UInt32,

  contract_address String,           -- CTF Exchange address
  operator String,
  from_address String,
  to_address String,

  token_ids Array(UInt256),
  values Array(UInt256),

  -- Decoded
  condition_ids Array(String),       -- Extracted from token_ids
  outcome_indices Array(UInt8)       -- Extracted from token_ids
) ENGINE = ReplacingMergeTree(block_time)
ORDER BY (block_time, tx_hash, evt_index)
PARTITION BY toYYYYMM(block_time)
SETTINGS index_granularity = 8192;
```

---

## Materialized Views (For Performance)

### View: `trades_with_pnl` (Most commonly queried)

```sql
CREATE MATERIALIZED VIEW trades_with_pnl
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, block_time)
AS
SELECT
  t.*,

  -- Resolution data
  r.winning_outcome,
  r.payout_numerators,
  r.payout_denominator,
  r.winning_index,
  r.resolved_at,

  -- Market data
  m.question,
  m.market_slug,
  m.category,

  -- PnL calculation
  CASE
    WHEN r.winning_index IS NOT NULL AND t.direction = 'BUY' THEN
      t.shares * (arrayElement(r.payout_numerators, t.outcome_index + 1) / r.payout_denominator) - t.usd_value
    WHEN r.winning_index IS NOT NULL AND t.direction = 'SELL' THEN
      t.usd_value - t.shares * (arrayElement(r.payout_numerators, t.outcome_index + 1) / r.payout_denominator)
    ELSE
      NULL
  END as realized_pnl_usd,

  now() as updated_at
FROM trades_canonical t
LEFT JOIN market_resolutions r ON t.condition_id_norm = r.condition_id_norm
LEFT JOIN market_details m ON t.condition_id_norm = m.condition_id_norm;
```

---

## Migration Plan

### Phase 1: Build Core Tables (Today)

1. **Create trades_canonical from trades_with_direction:**
```sql
CREATE TABLE trades_canonical AS
SELECT
  timestamp as block_time,
  0 as block_number,  -- Backfill later from blockchain
  tx_hash,
  0 as evt_index,     -- Backfill later from blockchain

  wallet_address,
  '' as maker,        -- Backfill from CLOB data
  '' as taker,

  condition_id_norm,
  market_id,
  '' as question_id,  -- Backfill from market_details
  0 as token_id,      -- Calculate from condition_id + outcome_index

  outcome_index,
  direction_from_transfers as direction,
  shares,
  price,
  usd_value,
  0 as fee_usd,

  confidence,
  data_source,

  computed_at as updated_at,
  computed_at as created_at
FROM trades_with_direction;
```

2. **Verify market_resolutions_final matches schema** (it already does!)

3. **Create market_details from gamma_markets + market_key_map**

### Phase 2: Enrich from trades_dedup_mat_new (Tomorrow)

1. Normalize condition_ids in trades_dedup_mat_new
2. Anti-join to find unique trades
3. INSERT INTO trades_canonical

### Phase 3: Delete Old Tables (End of Week)

Drop all the tables listed in SMOKING_GUN_FINDINGS.md under "Delete" and "Archive".

---

## Table Size Estimates

| Table | Estimated Rows | Estimated Size | Retention |
|-------|----------------|----------------|-----------|
| trades_canonical | 110M | ~50 GB | Forever |
| user_positions_daily | 50M | ~10 GB | 2 years |
| user_capital_actions | 5M | ~1 GB | Forever |
| market_details | 250K | ~100 MB | Forever |
| market_resolutions | 250K | ~50 MB | Forever |
| market_prices_hourly | 100M | ~20 GB | 2 years |
| market_prices_daily | 3M | ~500 MB | Forever |
| users | 1M | ~100 MB | Forever |
| wallet_metrics | 1M | ~200 MB | Forever |
| erc1155_transfers | 300M | ~100 GB | 1 year |
| **TOTAL** | **564M** | **~182 GB** | |

Compare to current: **60+ tables, many with 0 rows, unorganized**

---

## Query Examples

### Get wallet P&L with resolved markets:
```sql
SELECT
  wallet_address,
  sum(realized_pnl_usd) as total_pnl,
  count() as trade_count,
  countIf(realized_pnl_usd > 0) as winning_trades
FROM trades_with_pnl
WHERE resolved_at IS NOT NULL
GROUP BY wallet_address
ORDER BY total_pnl DESC
LIMIT 100;
```

### Get market price history:
```sql
SELECT
  day,
  close as price,
  volume_usd
FROM market_prices_daily
WHERE condition_id_norm = '...'
  AND outcome_index = 0  -- 'Yes' outcome
ORDER BY day DESC
LIMIT 30;
```

### Get smart money wallet positions:
```sql
SELECT
  p.wallet_address,
  m.question,
  p.balance,
  p.current_value,
  wm.smart_money_score
FROM user_positions_daily p
JOIN market_details m ON p.condition_id_norm = m.condition_id_norm
JOIN wallet_metrics wm ON p.wallet_address = wm.wallet_address
WHERE p.day = today()
  AND wm.smart_money_score > 80
  AND p.balance > 0
ORDER BY wm.smart_money_score DESC;
```

---

## Next Steps

1. **Review this schema** with your team
2. **Run Phase 1 migration** to create trades_canonical
3. **Validate data quality** (row counts, join tests)
4. **Update frontend** to use new tables
5. **Delete old tables** once migration is verified
6. **Set up monitoring** for data freshness

**Estimated time:** 2-4 hours for Phase 1, then ongoing cleanup over the week.
