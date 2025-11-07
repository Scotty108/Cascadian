# ClickHouse Database Exploration Report

## Overview
This report documents the ClickHouse database structure used in the Cascadian app, specifically focusing on Polymarket trading data, proxy wallet mappings, and P&L calculations.

---

## 1. TABLE STRUCTURES

### 1.1 CORE TRADE TABLES

#### **trades_raw** (Legacy/Primary Trades)
**Purpose:** Original trades table for generic wallet analytics

**CREATE TABLE Statement:**
```sql
CREATE TABLE IF NOT EXISTS trades_raw (
  trade_id String,
  wallet_address String,
  market_id String,
  timestamp DateTime,
  side Enum8('YES' = 1, 'NO' = 2),
  entry_price Decimal(18, 8),
  exit_price Nullable(Decimal(18, 8)),
  shares Decimal(18, 8),
  usd_value Decimal(18, 2),
  pnl Nullable(Decimal(18, 2)),
  is_closed Bool,
  transaction_hash String,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp)
SETTINGS index_granularity = 8192;
```

**Columns:**
- `trade_id` - Unique trade identifier
- `wallet_address` - EOA or proxy wallet address (lowercase)
- `market_id` - Polymarket market identifier
- `timestamp` - Trade execution time
- `side` - YES (1) or NO (2)
- `entry_price` - Execution price (0-1 probability range)
- `exit_price` - Closing price (nullable)
- `shares` - Trade size in outcome tokens
- `usd_value` - Trade size in USD
- `pnl` - P&L (nullable, populated after market resolution)
- `is_closed` - Whether position is closed
- `transaction_hash` - Blockchain tx hash
- `created_at` - Record insertion time

**Engine:** MergeTree (partitioned by month, ordered by wallet + timestamp)
**Index Granularity:** 8192 rows

---

#### **pm_trades** (CLOB API Fills)
**Purpose:** Polymarket CLOB order fills from Polymarket API

**CREATE TABLE Statement:**
```sql
CREATE TABLE IF NOT EXISTS pm_trades
(
  id                 String COMMENT 'Unique trade ID from CLOB API',
  market_id          String COMMENT 'Polymarket market ID',
  asset_id           String COMMENT 'Token ID (same as token_id in other tables)',
  side               LowCardinality(String) COMMENT 'BUY or SELL',
  size               String COMMENT 'Trade size in outcome tokens',
  price              Float64 COMMENT 'Price (0-1 probability)',
  fee_rate_bps       UInt16 COMMENT 'Fee rate in basis points',
  maker_address      String COMMENT 'Maker address (lowercase)',
  taker_address      String COMMENT 'Taker address (lowercase)',
  maker_orders       Array(String) COMMENT 'Array of maker order IDs',
  taker_order_id     String COMMENT 'Taker order ID',
  transaction_hash   String COMMENT 'Blockchain transaction hash',
  timestamp          DateTime COMMENT 'Trade execution timestamp',
  created_at         DateTime DEFAULT now() COMMENT 'Record insertion time',
  
  -- Enriched fields (can be populated later)
  outcome            String DEFAULT '' COMMENT 'Outcome label from token map',
  question           String DEFAULT '' COMMENT 'Market question',
  size_usd           Float64 DEFAULT 0.0 COMMENT 'Trade size in USD (size * price)',
  maker_fee_usd      Float64 DEFAULT 0.0 COMMENT 'Maker fee in USD',
  taker_fee_usd      Float64 DEFAULT 0.0 COMMENT 'Taker fee in USD'
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (market_id, timestamp, id)
PARTITION BY toYYYYMM(timestamp)
SETTINGS index_granularity = 8192
COMMENT 'CLOB trade fills from Polymarket API with full order matching data';
```

**Indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_pm_trades_maker
  ON pm_trades (maker_address)
  TYPE bloom_filter(0.01) GRANULARITY 1;

CREATE INDEX IF NOT EXISTS idx_pm_trades_taker
  ON pm_trades (taker_address)
  TYPE bloom_filter(0.01) GRANULARITY 1;
```

**Key Differences from trades_raw:**
- Includes maker/taker addresses (important for identifying proxy wallets)
- Has array of maker_orders (multi-order fills)
- Stores size as String (not Decimal)
- Uses ReplacingMergeTree with created_at for deduplication
- Ordered by (market_id, timestamp, id) instead of wallet
- Bloom filter indexes for address lookups

---

### 1.2 PROXY WALLET MAPPING

#### **pm_user_proxy_wallets**
**Purpose:** Maps EOA (user) wallets to proxy wallet addresses used on-chain

**CREATE TABLE Statement:**
```sql
CREATE TABLE IF NOT EXISTS pm_user_proxy_wallets
(
  user_eoa       LowCardinality(String),
  proxy_wallet   String,
  source         LowCardinality(String) DEFAULT 'onchain',
  first_seen_at  DateTime DEFAULT now(),
  last_seen_at   DateTime DEFAULT now(),
  is_active      UInt8 DEFAULT 1
)
ENGINE = ReplacingMergeTree()
PRIMARY KEY (proxy_wallet)
ORDER BY (proxy_wallet)
```

**Columns:**
- `user_eoa` - The actual user's EOA wallet (lowercase)
- `proxy_wallet` - The proxy/contract wallet used for trading (lowercase)
- `source` - Where mapping came from ('onchain', 'erc1155_transfers', etc.)
- `first_seen_at` - When this mapping was first detected
- `last_seen_at` - Most recent activity timestamp
- `is_active` - 1 = active, 0 = inactive

**Data Source:** Built from ERC1155 transfer analysis
- Extracted from pm_erc1155_flats table
- Groups by `from_address` (user) and `address` (contract/proxy)

**Key Properties:**
- Many-to-one mapping (multiple proxies per EOA possible)
- Derived from on-chain ERC1155 transfer events
- Used to attribute CLOB trades to actual users

---

### 1.3 ERC1155 TRANSFERS

#### **pm_erc1155_flats**
**Purpose:** Flattened ERC1155 transfer events from Polymarket ConditionalTokens contract

**CREATE TABLE Statement:**
```sql
CREATE TABLE IF NOT EXISTS pm_erc1155_flats
(
  block_number   UInt32,
  block_time     DateTime,
  tx_hash        String,
  log_index      UInt32,
  operator       String,
  from_address   String,
  to_address     String,
  token_id       String,
  amount         String,
  address        String  -- ConditionalTokens contract address
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(block_time)
ORDER BY (block_number, tx_hash, log_index)
```

**Columns:**
- `block_number` - Blockchain block number
- `block_time` - Block timestamp
- `tx_hash` - Transaction hash
- `log_index` - Event index within transaction
- `operator` - Address that initiated transfer (for TransferBatch)
- `from_address` - Sender (EOA/wallet)
- `to_address` - Recipient (proxy/contract)
- `token_id` - ERC1155 token ID (outcome token)
- `amount` - Amount transferred (hex string)
- `address` - ConditionalTokens contract address

**Data Population:**
- Fetches TransferSingle events (signature 0xc3d58...)
- Fetches TransferBatch events (signature 0x4a39dc...)
- Decodes data field to extract token_id and amount
- Filter: ConditionalTokens = 0x4d97dcd97ec945f40cf65f87097ace5ea0476045

---

### 1.4 TOKEN MAPPING & MARKET DATA

#### **ctf_token_map**
**Purpose:** Maps ERC1155 token IDs to Polymarket market metadata

**Enhanced Columns (from migration 016):**
```sql
ALTER TABLE ctf_token_map
  ADD COLUMN IF NOT EXISTS market_id String
  COMMENT 'Polymarket market ID from gamma_markets';
  
ALTER TABLE ctf_token_map
  ADD COLUMN IF NOT EXISTS outcome String
  COMMENT 'Outcome label (Yes/No or specific outcome name)';
  
ALTER TABLE ctf_token_map
  ADD COLUMN IF NOT EXISTS outcome_index UInt8
  COMMENT 'Index of outcome in market outcomes array (0-based)';
  
ALTER TABLE ctf_token_map
  ADD COLUMN IF NOT EXISTS question String
  COMMENT 'Market question text from gamma_markets';
```

**Indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_ctf_token_map_condition
  ON ctf_token_map (condition_id_norm)
  TYPE bloom_filter(0.01) GRANULARITY 1;

CREATE INDEX IF NOT EXISTS idx_ctf_token_map_market
  ON ctf_token_map (market_id)
  TYPE bloom_filter(0.01) GRANULARITY 1;
```

---

### 1.5 CONDITION & MARKET MAPPING

#### **condition_market_map**
**Purpose:** Cache table for condition_id → market_id lookups

**CREATE TABLE Statement:**
```sql
CREATE TABLE IF NOT EXISTS condition_market_map (
  condition_id String COMMENT 'Blockchain condition ID from CTF Exchange',
  market_id String COMMENT 'Polymarket market ID',
  event_id String COMMENT 'Polymarket event ID (nullable if not associated)',
  canonical_category String COMMENT 'Canonical category from tag mapping',
  raw_tags Array(String) COMMENT 'Raw Polymarket tags array',
  ingested_at DateTime DEFAULT now() COMMENT 'When this mapping was cached'
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (condition_id)
SETTINGS index_granularity = 8192
COMMENT 'Cache of condition_id → market metadata. Prevents external API calls.';
```

**Indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_condition_market_map_condition
  ON condition_market_map (condition_id)
  TYPE bloom_filter(0.01) GRANULARITY 1;

CREATE INDEX IF NOT EXISTS idx_condition_market_map_market
  ON condition_market_map (market_id)
  TYPE bloom_filter(0.01) GRANULARITY 1;
```

---

#### **markets_dim**
**Purpose:** Market dimension table with questions and event associations

**CREATE TABLE Statement:**
```sql
CREATE TABLE IF NOT EXISTS markets_dim (
  market_id String COMMENT 'Polymarket market ID',
  question String COMMENT 'Market question text',
  event_id String COMMENT 'Associated event ID',
  ingested_at DateTime DEFAULT now() COMMENT 'When this record was inserted'
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (market_id)
SETTINGS index_granularity = 8192
COMMENT 'Market dimension table with questions and event associations';
```

---

#### **events_dim**
**Purpose:** Event dimension table with categories and tags

**CREATE TABLE Statement:**
```sql
CREATE TABLE IF NOT EXISTS events_dim (
  event_id String COMMENT 'Polymarket event ID',
  canonical_category String COMMENT 'Canonical category from tag mapping',
  raw_tags Array(String) COMMENT 'Raw Polymarket tags array',
  title String COMMENT 'Event title',
  ingested_at DateTime DEFAULT now() COMMENT 'When this record was inserted'
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (event_id)
SETTINGS index_granularity = 8192
COMMENT 'Event dimension table with categories and tags';
```

**Indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_events_dim_category
  ON events_dim (canonical_category)
  TYPE bloom_filter(0.01) GRANULARITY 1;
```

---

### 1.6 RESOLUTION & OUTCOMES

#### **wallet_resolution_outcomes**
**Purpose:** Tracks conviction accuracy - whether a wallet held the winning side at resolution

**CREATE TABLE Statement:**
```sql
CREATE TABLE IF NOT EXISTS wallet_resolution_outcomes (
    wallet_address String,
    condition_id String,
    market_id String,
    resolved_outcome String,        -- "YES" / "NO" / outcome index
    final_side String,              -- What side wallet held at resolution
    won UInt8,                      -- 1 if final_side matched resolved_outcome, 0 otherwise
    resolved_at DateTime,
    canonical_category String,
    num_trades UInt32,              -- How many trades went into this position
    final_shares Float64,           -- Net shares held at resolution (for debugging)
    ingested_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (wallet_address, condition_id);
```

**Note:** This table is distinct from P&L tracking - it measures *accuracy* (whether you were right) vs *profitability* (whether you made money)

---

### 1.7 WALLET METRICS

#### **wallet_metrics_complete**
**Purpose:** Store comprehensive performance metrics for each wallet

**Key Sections (102 total metrics):**
1. **BASE SCREENERS (#1-24):** Omega, sharpe, P&L, drawdown, activity
2. **ADVANCED SCREENERS (#25-47):** Brier score, calibration, CLV, market making
3. **LATENCY-ADJUSTED METRICS (#48-55):** Copyability analysis
4. Plus additional tiers for specialized metrics

**Sample Columns:**
```sql
CREATE TABLE IF NOT EXISTS wallet_metrics_complete (
  wallet_address String,
  window Enum8('30d' = 1, '90d' = 2, '180d' = 3, 'lifetime' = 4),
  calculated_at DateTime,
  trades_analyzed UInt32,
  resolved_trades UInt32,
  track_record_days UInt16,
  raw_data_hash String,
  
  -- Sample metrics
  metric_2_omega_net Decimal(12, 4),
  metric_9_net_pnl_usd Decimal(18, 2),
  metric_12_hit_rate Decimal(5, 4),
  metric_22_resolved_bets UInt32,
  metric_23_track_record_days UInt16,
  
  -- ... 95+ more metrics
)
ENGINE = ReplacingMergeTree(calculated_at)
ORDER BY (wallet_address, window)
```

---

## 2. P&L CALCULATION VIEWS & FORMULAS

### 2.1 SETTLEMENT RULES

The P&L calculation follows specific mathematical rules:

#### **RULE 1: Signed Cashflow (per fill)**
```
IF side = BUY (1):
  signed_cashflow = -(entry_price * shares) - (fee_usd + slippage_usd)

IF side = SELL (2):
  signed_cashflow = +(entry_price * shares) - (fee_usd + slippage_usd)

Result: Negative = cost, Positive = proceeds
```

#### **RULE 2: Settlement on Resolution (per market)**
```
IF side = LONG (1) AND outcome_index = winning_index:
  settlement = 1.0 * shares  (winning long gets $1/share)

ELSE IF side = SHORT (2) AND outcome_index != winning_index:
  settlement = 1.0 * abs(shares)  (winning short gets $1/share)

ELSE:
  settlement = 0  (losing position gets nothing)
```

#### **RULE 3: Realized P&L per Market (SIDE-DEPENDENT)**
```
IF side = LONG (1):
  IF settlement > 0 (won):
    realized_pnl = settlement - total_cashflow
  ELSE (lost):
    realized_pnl = total_cashflow  (keeps negative)

ELSE IF side = SHORT (2):
  IF settlement > 0 (won):
    realized_pnl = settlement + total_cashflow  (add premium received)
  ELSE (lost):
    realized_pnl = -total_cashflow  (negate premium)
```

**Why side-dependent:**
- Longs: cashflow is negative cost, so subtract from settlement
- Shorts: cashflow is positive premium, behavior changes on win/loss
  - Win: keep premium AND get payout (add both)
  - Loss: lost position despite premium (negate the premium)

---

### 2.2 P&L VIEWS (from realized-pnl-corrected.sql)

#### **canonical_condition** (View)
Maps market_id to condition_id_norm from dual sources (ctf_token_map + condition_market_map)

#### **market_outcomes_expanded** (View)
Expands outcome arrays to individual rows with index and label

#### **resolutions_norm** (View)
Normalizes resolution data with uppercase labels

#### **winning_index** (View)
Maps condition_id_norm to winning outcome index

#### **trade_flows_v2** (View)
Computes cashflow and share delta per trade fill

```sql
CREATE OR REPLACE VIEW trade_flows_v2 AS
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  cast(outcome_index as Int16) AS trade_idx,
  toString(outcome) AS outcome_raw,
  round(
    cast(entry_price as Float64) * cast(shares as Float64) *
    if(lowerUTF8(toString(side)) = 'buy', -1, 1),
    8
  ) AS cashflow_usdc,
  if(
    lowerUTF8(toString(side)) = 'buy',
    cast(shares as Float64),
    -cast(shares as Float64)
  ) AS delta_shares
FROM trades_raw
WHERE market_id NOT IN ('12', '0x0000000000000000000000000000000000000000000000000000000000000000');
```

#### **realized_pnl_by_market_v2** (View)
Aggregates realized P&L per wallet per market

```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_v2 AS
SELECT
  tf.wallet,
  tf.market_id,
  cc.condition_id_norm,
  any(wi.resolved_at) AS resolved_at,
  round(
    sum(tf.cashflow_usdc) +
    sumIf(
      tf.delta_shares,
      coalesce(
        tf.trade_idx,
        multiIf(
          upperUTF8(tf.outcome_raw) = 'YES', 1,
          upperUTF8(tf.outcome_raw) = 'NO', 0,
          NULL
        )
      ) = wi.win_idx
    ),
    8
  ) AS realized_pnl_usd,
  count() AS fill_count
FROM trade_flows_v2 tf
JOIN canonical_condition cc ON cc.market_id = tf.market_id
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
WHERE wi.win_idx IS NOT NULL
  AND coalesce(
    tf.trade_idx,
    multiIf(
      upperUTF8(tf.outcome_raw) = 'YES', 1,
      upperUTF8(tf.outcome_raw) = 'NO', 0,
      NULL
    )
  ) IS NOT NULL
GROUP BY tf.wallet, tf.market_id, cc.condition_id_norm;
```

#### **wallet_realized_pnl_v2** (View)
Aggregate realized P&L per wallet across all resolved markets

```sql
CREATE OR REPLACE VIEW wallet_realized_pnl_v2 AS
SELECT
  wallet,
  round(sum(realized_pnl_usd), 2) AS realized_pnl_usd
FROM realized_pnl_by_market_v2
GROUP BY wallet;
```

#### **wallet_pnl_summary_v2** (View)
Combined view: realized + unrealized = total P&L

```sql
CREATE OR REPLACE VIEW wallet_pnl_summary_v2 AS
SELECT
  coalesce(r.wallet, u.wallet) AS wallet,
  coalesce(r.realized_pnl_usd, 0) AS realized_pnl_usd,
  coalesce(u.unrealized_pnl_usd, 0) AS unrealized_pnl_usd,
  round(
    coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0),
    2
  ) AS total_pnl_usd
FROM wallet_realized_pnl_v2 r
FULL JOIN wallet_unrealized_pnl_v2 u USING (wallet);
```

---

## 3. MATERIALIZED VIEWS (from migration 016)

#### **markets_enriched** (View)
Combines gamma_markets with resolution data for complete market view

```sql
CREATE OR REPLACE VIEW markets_enriched AS
SELECT
  m.market_id,
  m.condition_id,
  m.question,
  m.outcomes,
  m.end_date_iso,
  m.tags,
  m.category,
  m.volume,
  m.volume_num,
  m.liquidity,
  m.question_id,
  m.enable_order_book,
  m.ingested_at AS market_ingested_at,
  
  -- Resolution data (if available)
  r.winner,
  r.winning_outcome_index,
  r.resolution_source,
  r.resolved_at,
  r.payout_hash,
  IF(r.is_resolved = 1, 1, 0) AS is_resolved,
  r.ingested_at AS resolution_ingested_at
FROM gamma_markets m
LEFT JOIN market_resolutions_final r
  ON m.market_id = r.market_id;
```

#### **token_market_enriched** (View)
Complete token metadata with market and resolution info

```sql
CREATE OR REPLACE VIEW token_market_enriched AS
SELECT
  t.token_id,
  t.condition_id_norm,
  t.market_id,
  t.outcome,
  t.outcome_index,
  t.question,
  
  -- Market details
  m.outcomes AS all_outcomes,
  m.end_date_iso,
  m.category,
  m.volume,
  m.liquidity,
  
  -- Resolution data
  m.is_resolved,
  m.winner,
  m.winning_outcome_index,
  
  -- Determine if this token is the winner
  IF(
    m.is_resolved = 1 AND t.outcome_index = m.winning_outcome_index,
    1,
    0
  ) AS is_winning_outcome
FROM ctf_token_map t
LEFT JOIN markets_enriched m
  ON t.market_id = m.market_id
WHERE t.market_id != '';
```

#### **proxy_wallets_active** (View)
Only active proxy wallet mappings for easy joins

```sql
CREATE OR REPLACE VIEW proxy_wallets_active AS
SELECT
  user_eoa,
  proxy_wallet,
  source,
  first_seen_at,
  last_seen_at
FROM pm_user_proxy_wallets
WHERE is_active = 1;
```

#### **erc1155_transfers_enriched** (View)
Flattened transfers with market context

```sql
CREATE OR REPLACE VIEW erc1155_transfers_enriched AS
SELECT
  f.block_number,
  f.block_time,
  f.tx_hash,
  f.log_index,
  f.operator,
  f.from_addr,
  f.to_addr,
  f.token_id,
  f.amount,
  f.event_type,
  
  -- Market context
  t.market_id,
  t.outcome,
  t.outcome_index,
  t.question,
  t.is_winning_outcome,
  t.category,
  
  -- Proxy context for from_addr
  pf.user_eoa AS from_eoa,
  IF(pf.user_eoa != '', 'proxy', 'direct') AS from_type,
  
  -- Proxy context for to_addr
  pt.user_eoa AS to_eoa,
  IF(pt.user_eoa != '', 'proxy', 'direct') AS to_type
FROM pm_erc1155_flats f
LEFT JOIN token_market_enriched t
  ON f.token_id = t.token_id
LEFT JOIN proxy_wallets_active pf
  ON lower(f.from_addr) = lower(pf.proxy_wallet)
LEFT JOIN proxy_wallets_active pt
  ON lower(f.to_addr) = lower(pt.proxy_wallet);
```

#### **wallet_positions_current** (View)
Current position holdings per wallet per token

```sql
CREATE OR REPLACE VIEW wallet_positions_current AS
SELECT
  to_addr AS wallet,
  token_id,
  market_id,
  outcome,
  SUM(reinterpretAsUInt256(reverse(unhex(substring(amount, 3))))) AS total_received,
  COUNT(*) AS transfer_count,
  max(block_time) AS last_updated
FROM erc1155_transfers_enriched
WHERE market_id != ''
GROUP BY wallet, token_id, market_id, outcome;
```

---

## 4. RELATIONSHIP DIAGRAM

```
EOA (user_eoa)
    |
    | (many-to-one)
    v
pm_user_proxy_wallets <-- derived from pm_erc1155_flats (from_address, address)
    |
    | (proxy_wallet)
    v
pm_erc1155_flats (token transfers on-chain)
    |
    ├---> token_id
    |        |
    |        v
    |    ctf_token_map
    |        |
    |        ├---> market_id
    |        |        |
    |        |        v
    |        |    gamma_markets (external, not ingested)
    |        |    condition_market_map (cache table)
    |        |    markets_dim
    |        |
    |        ├---> condition_id_norm
    |        |        |
    |        |        v
    |        |    market_resolutions_final
    |        |    winning_index (view)
    |        |
    |        └---> outcome_index
    |
    └---> from_address (user_eoa)
    └---> to_address (proxy_wallet)

trades_raw
    |
    ├---> wallet_address (can be EOA or proxy)
    |
    ├---> market_id
    |        |
    |        v
    |    canonical_condition (view)
    |    winning_index (view)
    |
    ├---> outcome_index
    |        |
    |        v
    |    Side-dependent P&L calculation
    |
    v
realized_pnl_by_market_v2 (view)
    |
    v
wallet_realized_pnl_v2 (view)
    |
    +---> wallet_pnl_summary_v2 (view)
    |
    +---> wallet_unrealized_pnl_v2 (view) [from portfolio_mtm_detailed]

pm_trades (CLOB fills)
    |
    ├---> maker_address / taker_address
    |        |
    |        v
    |    (can join to pm_user_proxy_wallets for attribution)
    |
    └---> market_id (can join to ctf_token_map for outcome)
```

---

## 5. DATA FLOW & PIPELINE

### Step 1: On-Chain Data Ingestion
- Fetch ERC1155 transfer events from Polygon
- Populate: pm_erc1155_flats
- Contains: block_number, block_time, from_address, to_address, token_id, amount

### Step 2: Proxy Wallet Resolution
- Script: build-approval-proxies.ts
- Query: pm_erc1155_flats grouped by (from_address, address)
- Populate: pm_user_proxy_wallets (user_eoa → proxy_wallet mapping)
- Identifies: Which proxy wallets belong to which EOAs

### Step 3: Token Mapping
- Script: flatten-erc1155.ts
- Maps: token_id → market_id, outcome_index, outcome_label
- Populate: ctf_token_map (enriched with market metadata)
- Uses: gamma_markets API data

### Step 4: CLOB Fills Ingestion
- Script: ingest-clob-fills.ts
- Source: Polymarket CLOB API (/api/v1/trades)
- Fetch: Per proxy wallet
- Populate: pm_trades (maker_address, taker_address, market_id, side, size, price)

### Step 5: P&L Calculation
- Script: realized-pnl-corrected.sql
- Join: trades_raw + canonical_condition + winning_index
- Apply: Settlement rules (Rule 1-3)
- Output: 
  - realized_pnl_by_market_v2 (per market, per wallet)
  - wallet_realized_pnl_v2 (aggregate per wallet)
  - wallet_pnl_summary_v2 (realized + unrealized)

### Step 6: Wallet Analytics
- Script: wallet metrics computation (async)
- Aggregate: 102+ metrics per wallet
- Populate: wallet_metrics_complete
- Dimensions: 4 time windows (30d, 90d, 180d, lifetime)

---

## 6. KEY WALLET: 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8

**Expected Data:**
- Proxy wallets: One or more addresses (from pm_user_proxy_wallets WHERE user_eoa = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
- ERC1155 transfers: Multiple transfer events (from pm_erc1155_flats WHERE from_address = <proxy>)
- PM trades: Orders executed via CLOB API (from pm_trades WHERE maker_address OR taker_address = <proxy>)
- Realized P&L: Market-level breakdown (from realized_pnl_by_market_v2 WHERE wallet = lower(<wallet>))
- P&L Summary: Aggregate realized + unrealized (from wallet_pnl_summary_v2)

**Test Query:**
```sql
-- Find all proxy wallets for this EOA
SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets 
WHERE lower(user_eoa) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8');

-- Count trades for this wallet
SELECT COUNT(*) as trade_count FROM trades_raw
WHERE lower(wallet_address) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8');

-- Get realized P&L summary
SELECT * FROM wallet_pnl_summary_v2
WHERE wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8');
```

---

## 7. SUMMARY OF DIFFERENCES: pm_trades vs trades_raw

| Aspect | pm_trades | trades_raw |
|--------|-----------|-----------|
| **Source** | Polymarket CLOB API | Generic trades (legacy) |
| **Key Fields** | maker_address, taker_address, asset_id | wallet_address, market_id |
| **Side Format** | "BUY" / "SELL" (string) | "YES" / "NO" (enum) |
| **Price Type** | Float64 | Decimal(18, 8) |
| **Size Type** | String | Decimal(18, 8) |
| **Maker/Taker** | Yes (separate addresses) | No (single wallet) |
| **Orders** | Array of maker_order_ids | N/A |
| **Engine** | ReplacingMergeTree | MergeTree |
| **Deduplication** | By created_at | N/A |
| **Primary Order** | (market_id, timestamp, id) | (wallet_address, timestamp) |
| **Indexes** | Bloom filters on addresses | N/A explicit |
| **Purpose** | CLOB order matching | Portfolio analytics |

**Relationship:**
- pm_trades = raw CLOB fills (as executed)
- trades_raw = aggregated/attributed trades (post-processing)
- Can join via: maker_address/taker_address → pm_user_proxy_wallets → user_eoa

---

## 8. NOTES ON EXTERNAL TABLES

These tables are referenced but may not be fully ingested in ClickHouse:

- **gamma_markets** - Polymarket market data (HTTPS API fetch)
- **market_resolutions_final** - Resolution outcomes (external source)
- **erc1155_transfers** - Raw ERC1155 logs (blockchain source)

These are typically joined via views that assume external data is available.

---

## 9. VERIFICATION QUERIES

### Check Bridge Coverage (Market ID → Condition ID)
```sql
WITH target_markets AS (
  SELECT DISTINCT lower(market_id) AS market_id
  FROM trades_raw
  WHERE lower(wallet_address) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
)
SELECT
  count() AS markets_touched,
  countIf(cc.condition_id_norm IS NOT NULL) AS bridged,
  countIf(wi.win_idx IS NOT NULL) AS resolvable,
  round(countIf(wi.win_idx IS NOT NULL) * 100.0 / count(), 2) AS pct_resolvable
FROM target_markets tm
LEFT JOIN canonical_condition cc USING (market_id)
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm;
```

### Get P&L for Target Wallet
```sql
SELECT
  wallet,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd
FROM wallet_pnl_summary_v2
WHERE wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
ORDER BY wallet;
```

### Sample Market-Level Breakdown
```sql
SELECT
  wallet,
  market_id,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
ORDER BY resolved_at DESC
LIMIT 10;
```

