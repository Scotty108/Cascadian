# Polymarket Data Analytics Universe - Complete Architecture Specification

## Executive Summary

This document defines the complete data architecture for a production-grade Polymarket analytics system in ClickHouse, designed to achieve 100% accuracy for all wallets, markets, and trades with continuous synchronization.

**Core Goals:**
- 100% accuracy for known wallets (not 80%)
- Complete PnL reconstruction with per-category ROI
- Real-time net flow calculation (USDC funding + token positions)
- Quality gates: <2% error, >95% markets with correct winner, >95% volume HIGH confidence
- Continuous sync with no data loss
- Query performance <100ms for wallet lookups, <5s for complex aggregations

**Data Sources:**
- 388M USDC transfer records (funding flows)
- ERC1155 transfers (conditional token trades via blockchain)
- CLOB API fills (execution prices - ground truth)
- Polymarket API (market metadata, resolutions)
- Blockchain RPC (CTF state validation)

---

## 1. Core Architecture Principles

### 1.1 Separation of Concerns

```
RAW LAYER (Facts)           ENRICHMENT LAYER (Dimensions)     METRICS LAYER (Aggregates)
├─ usdc_transfers          ├─ markets_dim                    ├─ wallet_metrics_complete
├─ erc1155_transfers       ├─ events_dim                     ├─ wallet_metrics_by_category
├─ clob_fills              ├─ wallets_dim                    ├─ market_analytics
├─ trades_raw              ├─ condition_market_map           ├─ category_analytics
└─ price_snapshots         └─ market_resolutions             └─ wallet_resolution_outcomes
```

### 1.2 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INGESTION LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│ 1. USDC Transfers (Alchemy/Goldsky) → usdc_transfers                │
│ 2. ERC1155 Events (Polygon) → erc1155_transfers → erc1155_flats     │
│ 3. CLOB Fills (API) → clob_fills_raw                                │
│ 4. Market Metadata (Polymarket API) → markets_dim, events_dim       │
│ 5. Price History (Gamma/CLOB) → price_snapshots_10s                 │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     NORMALIZATION LAYER                              │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Decode ERC1155 token IDs → condition_id                          │
│ 2. Map condition_id → market_id via condition_market_map            │
│ 3. Discover proxy wallets via ApprovalForAll events                 │
│ 4. Normalize CLOB fills with token transfers                        │
│ 5. Build canonical trades with all fields populated                 │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      ENRICHMENT LAYER                                │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Fetch market resolutions → market_resolutions                    │
│ 2. Calculate payout vectors (YES/NO payouts)                        │
│ 3. Apply resolutions to trades → realized_pnl_usd, is_resolved      │
│ 4. Enrich with categories via events_dim                            │
│ 5. Calculate entry/exit prices from CLOB fills                      │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       METRICS LAYER                                  │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Aggregate wallet metrics (102 metrics × 4 windows)               │
│ 2. Calculate per-category performance                                │
│ 3. Track resolution outcomes (conviction accuracy)                   │
│ 4. Compute market analytics (momentum, flow, signals)                │
│ 5. Generate leaderboards and rankings                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Design Decisions

1. **ERC1155 as Source of Truth for Trades**: Blockchain is immutable and complete
2. **CLOB Fills for Execution Prices**: API provides accurate price data
3. **USDC Transfers for Funding Only**: Separate from trading P&L
4. **Condition IDs as Primary Join Key**: Maps blockchain to Polymarket
5. **ReplacingMergeTree for Dimensions**: Allows upserts with deduplication
6. **MergeTree for Facts**: Append-only with partitioning by time
7. **Materialized Views for Hot Paths**: Pre-compute frequent queries
8. **Quality Gates as First-Class Citizens**: Validation before promotion

---

## 2. Table Schemas (Layer by Layer)

### 2.1 RAW INGESTION LAYER

#### 2.1.1 usdc_transfers (Funding Flows)

**Purpose**: Track USDC deposits/withdrawals to understand wallet funding (NOT trading P&L)

```sql
CREATE TABLE usdc_transfers (
  block_number UInt32,
  block_time DateTime,
  tx_hash String,
  log_index UInt32,
  from_addr String,
  to_addr String,
  amount String COMMENT 'Raw amount (6 decimals for USDC)',
  amount_usd Decimal(18, 2) COMMENT 'Normalized to USD',

  -- Metadata
  ingested_at DateTime DEFAULT now(),
  source LowCardinality(String) DEFAULT 'alchemy' COMMENT 'alchemy|goldsky|rpc'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(block_time)
ORDER BY (block_number, tx_hash, log_index)
SETTINGS index_granularity = 8192
COMMENT 'USDC ERC20 transfers for wallet funding analysis (separate from trading)';

-- Indexes
CREATE INDEX idx_usdc_from ON usdc_transfers (from_addr) TYPE bloom_filter(0.01);
CREATE INDEX idx_usdc_to ON usdc_transfers (to_addr) TYPE bloom_filter(0.01);
CREATE INDEX idx_usdc_time ON usdc_transfers (block_time) TYPE minmax;
```

**Update Frequency**: Continuous (every 10 minutes via cron)
**Retention**: Infinite (archives older than 2 years to cold storage)
**Volume**: 388M rows (growing ~1M/day)

#### 2.1.2 erc1155_transfers (Raw Blockchain Events)

**Purpose**: Store raw ERC1155 events from Polygon ConditionalTokens contract

```sql
CREATE TABLE erc1155_transfers (
  block_number UInt32,
  block_time DateTime,
  tx_hash String,
  log_index UInt32,
  address String COMMENT 'Contract address (ConditionalTokens)',
  topics Array(String) COMMENT 'Event topics: [signature, operator, from, to]',
  data String COMMENT 'Raw hex data containing token_id and amount',

  -- Metadata
  ingested_at DateTime DEFAULT now(),
  source LowCardinality(String) DEFAULT 'polygon_rpc'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(block_time)
ORDER BY (block_number, tx_hash, log_index)
SETTINGS index_granularity = 8192
COMMENT 'Raw ERC1155 transfer events from Polygon ConditionalTokens contract';

-- Indexes
CREATE INDEX idx_erc1155_address ON erc1155_transfers (address) TYPE bloom_filter(0.01);
CREATE INDEX idx_erc1155_sig ON erc1155_transfers (topics[1]) TYPE bloom_filter(0.01);
```

**Event Types**:
- `TransferSingle`: topics[1] = 0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62
- `TransferBatch`: topics[1] = 0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb
- `ApprovalForAll`: topics[1] = 0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31

**Update Frequency**: Continuous (every 5 minutes)
**Retention**: Infinite
**Volume**: ~50M events (growing ~500K/month)

#### 2.1.3 erc1155_flats (Decoded ERC1155 Transfers)

**Purpose**: Flatten TransferSingle/TransferBatch events into normalized rows

```sql
CREATE TABLE erc1155_flats (
  block_number UInt32,
  block_time DateTime,
  tx_hash String,
  log_index UInt32,
  operator String COMMENT 'Address that executed the transfer',
  from_addr String COMMENT 'Sender (0x0 for mints)',
  to_addr String COMMENT 'Recipient (0x0 for burns/redemptions)',
  token_id String COMMENT 'ERC1155 token ID (encodes condition_id + outcome)',
  amount String COMMENT 'Number of shares transferred (18 decimals)',

  -- Derived fields (computed during flattening)
  condition_id String COMMENT 'Extracted from token_id (first 32 bytes)',
  outcome_index UInt8 COMMENT 'Extracted from token_id (0=YES, 1=NO for binary)',
  amount_normalized Decimal(18, 8) COMMENT 'Amount / 1e18',

  -- Metadata
  ingested_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(block_time)
ORDER BY (block_number, tx_hash, log_index)
SETTINGS index_granularity = 8192
COMMENT 'Flattened ERC1155 transfers with decoded token IDs';

-- Indexes
CREATE INDEX idx_flats_condition ON erc1155_flats (condition_id) TYPE bloom_filter(0.01);
CREATE INDEX idx_flats_from ON erc1155_flats (from_addr) TYPE bloom_filter(0.01);
CREATE INDEX idx_flats_to ON erc1155_flats (to_addr) TYPE bloom_filter(0.01);
CREATE INDEX idx_flats_token ON erc1155_flats (token_id) TYPE bloom_filter(0.01);
```

**Token ID Decoding**:
```
token_id = keccak256(condition_id || outcome_index_set)
For binary markets:
  - outcome_index_set = 0x0000...0001 (YES)
  - outcome_index_set = 0x0000...0002 (NO)
```

**Update Frequency**: Derived from erc1155_transfers (batch processing every 10 minutes)
**Volume**: Same as erc1155_transfers (~50M rows)

#### 2.1.4 clob_fills_raw (CLOB API Fills)

**Purpose**: Store execution prices and order details from Polymarket CLOB

```sql
CREATE TABLE clob_fills_raw (
  fill_id String COMMENT 'Unique fill ID from CLOB API',
  trader_address String COMMENT 'Proxy wallet that executed the trade',
  market_id String COMMENT 'Polymarket market ID',
  asset_id String COMMENT 'Token ID (condition_id + outcome)',
  side LowCardinality(String) COMMENT 'BUY or SELL',
  outcome LowCardinality(String) COMMENT 'YES or NO',
  shares Decimal(18, 8) COMMENT 'Number of shares filled',
  execution_price Decimal(10, 6) COMMENT 'Price per share (0-1 range)',
  fee Decimal(18, 6) COMMENT 'Fee paid in USDC',
  order_hash String COMMENT 'Original order hash',
  tx_hash String COMMENT 'Blockchain transaction hash',
  timestamp DateTime COMMENT 'Fill timestamp',

  -- Metadata
  ingested_at DateTime DEFAULT now(),
  source LowCardinality(String) DEFAULT 'clob_api'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (trader_address, timestamp, fill_id)
SETTINGS index_granularity = 8192
COMMENT 'CLOB fills from Polymarket API - ground truth for execution prices';

-- Indexes
CREATE INDEX idx_clob_trader ON clob_fills_raw (trader_address) TYPE bloom_filter(0.01);
CREATE INDEX idx_clob_market ON clob_fills_raw (market_id) TYPE bloom_filter(0.01);
CREATE INDEX idx_clob_tx ON clob_fills_raw (tx_hash) TYPE bloom_filter(0.01);
```

**Update Frequency**: Pull every 5 minutes for active wallets
**Retention**: Infinite
**Volume**: ~10M fills (growing ~100K/month)

---

### 2.2 DIMENSION TABLES (Enrichment Layer)

#### 2.2.1 markets_dim (Market Metadata)

```sql
CREATE TABLE markets_dim (
  market_id String COMMENT 'Polymarket market ID (primary key)',
  condition_id String COMMENT 'Blockchain condition ID',
  question String COMMENT 'Market question text',
  description String COMMENT 'Full market description',
  event_id String COMMENT 'Parent event ID',

  -- Market configuration
  outcome_prices Array(Decimal(10, 6)) COMMENT 'Current prices [YES, NO]',
  outcomes Array(String) COMMENT 'Outcome labels',
  num_outcomes UInt8 COMMENT '2 for binary, >2 for multi-outcome',

  -- Timing
  start_date DateTime COMMENT 'Market creation time',
  end_date Nullable(DateTime) COMMENT 'Market close time',
  resolution_date Nullable(DateTime) COMMENT 'When market was resolved',

  -- Resolution data
  resolved_outcome Nullable(String) COMMENT 'Winning outcome (YES/NO/etc)',
  payout_vector Array(Decimal(5, 4)) COMMENT 'Payout per outcome [1.0, 0.0]',
  is_resolved UInt8 DEFAULT 0 COMMENT 'Resolution status (0=open, 1=resolved)',

  -- Volume and liquidity
  volume_usd Decimal(18, 2) COMMENT 'Total volume traded',
  liquidity_usd Decimal(18, 2) COMMENT 'Current orderbook liquidity',
  num_traders UInt32 COMMENT 'Unique trader count',

  -- Metadata
  ingested_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY market_id
SETTINGS index_granularity = 8192
COMMENT 'Market dimension table with metadata and resolutions';

-- Indexes
CREATE INDEX idx_markets_condition ON markets_dim (condition_id) TYPE bloom_filter(0.01);
CREATE INDEX idx_markets_event ON markets_dim (event_id) TYPE bloom_filter(0.01);
CREATE INDEX idx_markets_resolved ON markets_dim (is_resolved) TYPE set(0);
```

**Update Frequency**:
- Metadata: Every 1 hour
- Resolutions: Every 10 minutes (check for newly resolved markets)
- Prices: Real-time via separate price_snapshots table

**Volume**: ~50K markets (growing ~500/month)

#### 2.2.2 events_dim (Event Metadata with Categories)

```sql
CREATE TABLE events_dim (
  event_id String COMMENT 'Polymarket event ID (primary key)',
  title String COMMENT 'Event title',
  slug String COMMENT 'URL slug',
  description String COMMENT 'Event description',

  -- Categorization
  canonical_category String COMMENT 'Mapped category (Politics, Crypto, Sports, etc)',
  raw_tags Array(String) COMMENT 'Original Polymarket tags',

  -- Timing
  start_date DateTime COMMENT 'Event start time',
  end_date Nullable(DateTime) COMMENT 'Event end time',

  -- Volume
  volume_usd Decimal(18, 2) COMMENT 'Total volume across all markets in event',
  num_markets UInt16 COMMENT 'Number of markets in event',

  -- Metadata
  ingested_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY event_id
SETTINGS index_granularity = 8192
COMMENT 'Event dimension table with canonical categories';

-- Indexes
CREATE INDEX idx_events_category ON events_dim (canonical_category) TYPE bloom_filter(0.01);
CREATE INDEX idx_events_tags ON events_dim (raw_tags) TYPE bloom_filter(0.01);
```

**Category Mapping**:
```
Politics → ["election", "president", "senate", "congress", "vote"]
Crypto → ["bitcoin", "ethereum", "crypto", "defi", "nft"]
Sports → ["nfl", "nba", "soccer", "football", "basketball"]
Business → ["stock", "ipo", "earnings", "merger", "acquisition"]
Pop Culture → ["movie", "music", "celebrity", "awards", "entertainment"]
Science → ["ai", "space", "climate", "research", "discovery"]
Other → [fallback]
```

**Update Frequency**: Every 1 hour
**Volume**: ~5K events

#### 2.2.3 condition_market_map (Blockchain to Polymarket Bridge)

```sql
CREATE TABLE condition_market_map (
  condition_id String COMMENT 'Blockchain condition ID (from CTF)',
  market_id String COMMENT 'Polymarket market ID',
  event_id String COMMENT 'Polymarket event ID',
  canonical_category String COMMENT 'Category from events_dim',
  raw_tags Array(String) COMMENT 'Tags from market metadata',

  -- Validation
  token_count UInt8 COMMENT 'Number of outcome tokens (2 for binary)',
  first_seen_block UInt32 COMMENT 'First block where condition appeared',

  -- Metadata
  ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY condition_id
SETTINGS index_granularity = 8192
COMMENT 'Maps blockchain condition IDs to Polymarket market IDs';

-- Indexes (both directions)
CREATE INDEX idx_cm_condition ON condition_market_map (condition_id) TYPE bloom_filter(0.01);
CREATE INDEX idx_cm_market ON condition_market_map (market_id) TYPE bloom_filter(0.01);
```

**Build Process**:
1. Query Polymarket API for all markets → get (market_id, condition_id)
2. Query ConditionPreparation events from blockchain → get condition_id
3. Match via Gamma API reverse lookup (market_id → condition_id)
4. Store in map for O(1) lookups during trade enrichment

**Update Frequency**:
- Initial backfill: One-time
- Incremental: Every 1 hour (new markets only)

**Volume**: ~50K mappings

#### 2.2.4 market_resolutions (Resolution Data with Payout Vectors)

```sql
CREATE TABLE market_resolutions (
  condition_id String COMMENT 'Blockchain condition ID (primary key)',
  market_id String COMMENT 'Polymarket market ID',

  -- Resolution outcome
  resolved_outcome String COMMENT 'Winning outcome (YES/NO/outcome_index)',
  winning_outcome_index UInt8 COMMENT '0=YES, 1=NO for binary',

  -- Payout vectors
  payout_yes Decimal(5, 4) COMMENT 'Payout for YES holders (0.0 or 1.0)',
  payout_no Decimal(5, 4) COMMENT 'Payout for NO holders (0.0 or 1.0)',
  payout_vector Array(Decimal(5, 4)) COMMENT 'Full payout array for multi-outcome',

  -- Resolution metadata
  resolved_at DateTime COMMENT 'When market resolved',
  resolution_source LowCardinality(String) COMMENT 'polymarket_api|blockchain_rpc|clob_api',

  -- Validation
  is_verified UInt8 DEFAULT 0 COMMENT 'Verified against blockchain CTF state',
  verification_block UInt32 COMMENT 'Block number where payout was verified',

  -- Metadata
  ingested_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY condition_id
SETTINGS index_granularity = 8192
COMMENT 'Market resolutions with payout vectors for P&L calculation';

-- Indexes
CREATE INDEX idx_res_market ON market_resolutions (market_id) TYPE bloom_filter(0.01);
CREATE INDEX idx_res_outcome ON market_resolutions (resolved_outcome) TYPE bloom_filter(0.01);
CREATE INDEX idx_res_verified ON market_resolutions (is_verified) TYPE set(0);
```

**Resolution Sources Priority**:
1. **Blockchain RPC** (highest trust): Query CTF contract payout slots
2. **Polymarket API**: `/markets/{id}` resolution field
3. **CLOB API**: Infer from redemption events
4. **Goldsky Subgraph**: PayoutRedemption events

**Multi-Outcome Handling**:
```sql
-- Example: 3-outcome market (Trump/Biden/Other)
-- If Trump wins:
payout_vector = [1.0, 0.0, 0.0]

-- For invalid/tie:
payout_vector = [0.5, 0.5, 0.0]  -- Proportional refund
```

**Update Frequency**: Every 10 minutes (continuous resolution scanner)
**Volume**: ~40K resolved markets

#### 2.2.5 wallets_dim (Wallet Dimension)

```sql
CREATE TABLE wallets_dim (
  wallet_address String COMMENT 'Wallet address (lowercase)',
  proxy_wallet String COMMENT 'Associated proxy wallet (if any)',

  -- Discovery metadata
  first_seen DateTime COMMENT 'First trade/transfer timestamp',
  last_seen DateTime COMMENT 'Most recent activity',
  first_seen_block UInt32,
  last_seen_block UInt32,

  -- Activity summary
  total_trades UInt32 COMMENT 'All-time trade count',
  total_volume_usd Decimal(18, 2) COMMENT 'All-time volume',
  total_markets UInt16 COMMENT 'Unique markets traded',
  is_active Boolean COMMENT 'Active in last 30 days',

  -- Wallet type
  wallet_type LowCardinality(String) COMMENT 'user|proxy|contract|market_maker',

  -- Metadata
  created_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY wallet_address
SETTINGS index_granularity = 8192
COMMENT 'Wallet dimension with discovery metadata';

-- Indexes
CREATE INDEX idx_wallets_proxy ON wallets_dim (proxy_wallet) TYPE bloom_filter(0.01);
CREATE INDEX idx_wallets_active ON wallets_dim (is_active) TYPE set(0);
CREATE INDEX idx_wallets_type ON wallets_dim (wallet_type) TYPE bloom_filter(0.01);
```

**Proxy Discovery**:
- Monitor `ApprovalForAll` events from ConditionalTokens
- operator = proxy wallet, user = real wallet
- Store mapping: user_wallet → proxy_wallet

**Update Frequency**: Every 1 hour (incremental discovery)
**Volume**: ~500K wallets

---

### 2.3 NORMALIZED FACTS LAYER (trades_raw)

#### 2.3.1 trades_raw (Canonical Trade Records)

**Purpose**: Single source of truth for all trades with complete enrichment

```sql
CREATE TABLE trades_raw (
  -- Primary identifiers
  trade_id String COMMENT 'Unique ID: {tx_hash}_{log_index}_{outcome_index}',
  wallet_address String COMMENT 'User wallet (real wallet, not proxy)',
  proxy_wallet String COMMENT 'Proxy wallet that executed trade',

  -- Market identifiers
  condition_id String COMMENT 'Blockchain condition ID',
  market_id String COMMENT 'Polymarket market ID',
  token_id String COMMENT 'ERC1155 token ID',

  -- Trade details
  side LowCardinality(String) COMMENT 'BUY or SELL',
  outcome LowCardinality(String) COMMENT 'YES or NO (or outcome label)',
  outcome_index UInt8 COMMENT '0=YES, 1=NO for binary',
  shares Decimal(18, 8) COMMENT 'Number of shares traded',

  -- Pricing (from CLOB fills)
  entry_price Decimal(10, 6) COMMENT 'Execution price (0-1 range)',
  exit_price Nullable(Decimal(10, 6)) COMMENT 'Exit price (if position closed)',
  close_price Decimal(10, 6) DEFAULT 0.0 COMMENT 'Market price at resolution',

  -- Financial metrics
  usd_value Decimal(18, 2) COMMENT 'shares * entry_price',
  fee Decimal(18, 6) COMMENT 'Trading fee paid',
  realized_pnl_usd Decimal(18, 2) DEFAULT 0.0 COMMENT 'P&L after resolution',

  -- Resolution data
  is_resolved UInt8 DEFAULT 0 COMMENT 'Whether market is resolved',
  resolved_outcome Nullable(String) COMMENT 'Winning outcome',
  payout_multiplier Decimal(5, 4) COMMENT 'Payout for this position (0.0 or 1.0)',

  -- Categorization
  canonical_category String COMMENT 'Market category',
  event_id String COMMENT 'Parent event ID',

  -- Timing
  timestamp DateTime COMMENT 'Trade timestamp',
  tx_timestamp DateTime COMMENT 'Blockchain tx timestamp',
  block_number UInt32 COMMENT 'Block number',
  hours_held Decimal(10, 2) DEFAULT 0.0 COMMENT 'Hours from entry to exit/resolution',

  -- Blockchain metadata
  tx_hash String COMMENT 'Transaction hash',
  log_index UInt32 COMMENT 'Log index in transaction',

  -- Ingestion metadata
  created_at DateTime DEFAULT now(),
  data_version UInt8 DEFAULT 1 COMMENT 'Schema version for migrations'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp, trade_id)
SETTINGS index_granularity = 8192
COMMENT 'Canonical trade records with complete enrichment';

-- Indexes (critical for query performance)
CREATE INDEX idx_trades_wallet ON trades_raw (wallet_address) TYPE bloom_filter(0.01);
CREATE INDEX idx_trades_market ON trades_raw (market_id) TYPE bloom_filter(0.01);
CREATE INDEX idx_trades_condition ON trades_raw (condition_id) TYPE bloom_filter(0.01);
CREATE INDEX idx_trades_category ON trades_raw (canonical_category) TYPE bloom_filter(0.01);
CREATE INDEX idx_trades_resolved ON trades_raw (is_resolved) TYPE set(0);
CREATE INDEX idx_trades_tx ON trades_raw (tx_hash) TYPE bloom_filter(0.01);
```

**Build Process** (from multiple sources):

```sql
-- Step 1: Base trades from ERC1155 transfers
INSERT INTO trades_raw
SELECT
  concat(tx_hash, '_', toString(log_index), '_', toString(outcome_index)) AS trade_id,
  to_addr AS wallet_address,
  operator AS proxy_wallet,
  condition_id,
  '' AS market_id,  -- Enriched in step 2
  token_id,
  CASE WHEN from_addr = '0x0000000000000000000000000000000000000000' THEN 'BUY' ELSE 'SELL' END AS side,
  CASE WHEN outcome_index = 0 THEN 'YES' ELSE 'NO' END AS outcome,
  outcome_index,
  amount_normalized AS shares,
  0.0 AS entry_price,  -- Enriched in step 3
  NULL AS exit_price,
  0.0 AS close_price,
  0.0 AS usd_value,
  0.0 AS fee,
  0.0 AS realized_pnl_usd,
  0 AS is_resolved,
  NULL AS resolved_outcome,
  0.0 AS payout_multiplier,
  '' AS canonical_category,  -- Enriched in step 2
  '' AS event_id,
  block_time AS timestamp,
  block_time AS tx_timestamp,
  block_number,
  0.0 AS hours_held,
  tx_hash,
  log_index,
  now() AS created_at,
  1 AS data_version
FROM erc1155_flats
WHERE from_addr != '0x0000000000000000000000000000000000000000'  -- Exclude mints
  AND to_addr != '0x0000000000000000000000000000000000000000';  -- Exclude redemptions

-- Step 2: Enrich with market_id and category
UPDATE trades_raw AS t
SET
  market_id = c.market_id,
  canonical_category = c.canonical_category,
  event_id = c.event_id
FROM condition_market_map AS c
WHERE t.condition_id = c.condition_id
  AND t.market_id = '';  -- Only update non-enriched rows

-- Step 3: Enrich with execution prices from CLOB fills
UPDATE trades_raw AS t
SET
  entry_price = f.execution_price,
  fee = f.fee,
  usd_value = t.shares * f.execution_price
FROM clob_fills_raw AS f
WHERE t.tx_hash = f.tx_hash
  AND t.proxy_wallet = f.trader_address
  AND t.outcome = f.outcome
  AND t.entry_price = 0.0;  -- Only update non-enriched rows

-- Step 4: Apply resolutions and calculate P&L
UPDATE trades_raw AS t
SET
  is_resolved = 1,
  resolved_outcome = r.resolved_outcome,
  payout_multiplier = CASE
    WHEN t.outcome = r.resolved_outcome THEN 1.0
    ELSE 0.0
  END,
  realized_pnl_usd = CASE
    WHEN t.side = 'BUY' THEN
      CASE
        WHEN t.outcome = r.resolved_outcome THEN t.shares * (1.0 - t.entry_price) - t.fee
        ELSE -1.0 * t.shares * t.entry_price - t.fee
      END
    WHEN t.side = 'SELL' THEN
      CASE
        WHEN t.outcome = r.resolved_outcome THEN -1.0 * t.shares * (1.0 - t.entry_price) - t.fee
        ELSE t.shares * t.entry_price - t.fee
      END
  END
FROM market_resolutions AS r
WHERE t.condition_id = r.condition_id
  AND t.is_resolved = 0;
```

**Update Frequency**:
- New trades: Every 5 minutes (incremental from erc1155_flats)
- Price enrichment: Every 5 minutes (after CLOB fill ingestion)
- Resolution enrichment: Every 10 minutes (after resolution scanner runs)

**Volume**: ~20M trades (growing ~200K/month)

**Quality Gates** (before promotion to production):
```sql
-- Gate 1: >95% trades have entry_price > 0
SELECT countIf(entry_price > 0) / count() AS price_coverage
FROM trades_raw
WHERE timestamp > now() - INTERVAL 7 DAY
HAVING price_coverage > 0.95;

-- Gate 2: >95% trades have valid market_id
SELECT countIf(market_id != '') / count() AS market_coverage
FROM trades_raw
WHERE timestamp > now() - INTERVAL 7 DAY
HAVING market_coverage > 0.95;

-- Gate 3: <2% error on known resolved markets
SELECT
  abs(sum(realized_pnl_usd) - expected_pnl) / abs(expected_pnl) AS error_rate
FROM trades_raw
WHERE is_resolved = 1
  AND timestamp > now() - INTERVAL 30 DAY
HAVING error_rate < 0.02;
```

---

### 2.4 METRICS LAYER (Aggregations)

#### 2.4.1 wallet_metrics_complete (102 Metrics × 4 Windows)

**Purpose**: Pre-computed metrics for wallet leaderboards and filtering

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
  raw_data_hash String COMMENT 'MD5 of input data for cache invalidation',

  -- Core metrics (102 total - see existing schema)
  metric_2_omega_net Decimal(12, 4) COMMENT 'Primary ranking metric',
  metric_9_net_pnl_usd Decimal(18, 2),
  metric_12_hit_rate Decimal(5, 4),
  metric_22_resolved_bets UInt32,
  metric_23_track_record_days UInt16,
  -- ... (full 102 metrics - see migrations/clickhouse/004)

  -- Rank within window (computed after aggregation)
  rank_overall UInt32 COMMENT 'Rank by omega_net',
  rank_pnl UInt32 COMMENT 'Rank by net_pnl_usd',
  rank_hit_rate UInt32 COMMENT 'Rank by hit_rate',

  -- Percentile scores (0-100)
  percentile_omega UInt8,
  percentile_pnl UInt8,
  percentile_hit_rate UInt8
)
ENGINE = ReplacingMergeTree(calculated_at)
ORDER BY (wallet_address, window)
SETTINGS index_granularity = 8192
COMMENT 'Pre-computed wallet metrics for leaderboards (102 metrics × 4 windows)';

-- Indexes
CREATE INDEX idx_wm_rank ON wallet_metrics_complete (rank_overall) TYPE minmax;
CREATE INDEX idx_wm_pnl ON wallet_metrics_complete (metric_9_net_pnl_usd) TYPE minmax;
CREATE INDEX idx_wm_omega ON wallet_metrics_complete (metric_2_omega_net) TYPE minmax;
```

**Calculation Process**:
```typescript
// For each wallet and window:
1. Filter trades: timestamp > (now - window)
2. Calculate 102 metrics from trades_raw
3. Hash input data: MD5(wallet + window + max(timestamp))
4. Skip if hash matches existing record (cache hit)
5. Insert new record
6. Compute ranks via window functions
```

**Update Frequency**:
- 30d window: Every 1 hour
- 90d/180d/lifetime: Every 6 hours
- On-demand: When user requests wallet profile

**Volume**: ~500K wallets × 4 windows = 2M rows

#### 2.4.2 wallet_metrics_by_category (Per-Category Performance)

```sql
CREATE TABLE wallet_metrics_by_category (
  -- Primary key
  wallet_address String,
  category String,
  window Enum8('30d' = 1, '90d' = 2, '180d' = 3, 'lifetime' = 4),

  -- Category-specific metadata
  trades_in_category UInt32,
  pct_of_total_trades Decimal(5, 4),
  pct_of_total_volume Decimal(5, 4),
  is_primary_category Boolean,
  category_rank UInt32 COMMENT 'Rank within this category',

  -- Same 102 metrics as wallet_metrics_complete
  -- ... (see migrations/clickhouse/013)

  calculated_at DateTime,
  raw_data_hash String
)
ENGINE = ReplacingMergeTree(calculated_at)
ORDER BY (wallet_address, category, window)
SETTINGS index_granularity = 8192
COMMENT 'Per-category wallet metrics for specialized leaderboards';

-- Indexes
CREATE INDEX idx_wmc_category ON wallet_metrics_by_category (category) TYPE bloom_filter(0.01);
CREATE INDEX idx_wmc_rank ON wallet_metrics_by_category (category_rank) TYPE minmax;
```

**Use Cases**:
- "Top 10 Politics traders in last 30 days"
- "Best Crypto market forecasters"
- "Category specialization analysis"

**Update Frequency**: Every 6 hours
**Volume**: ~500K wallets × 7 categories × 4 windows = 14M rows

#### 2.4.3 wallet_resolution_outcomes (Conviction Accuracy)

```sql
CREATE TABLE wallet_resolution_outcomes (
  wallet_address String,
  condition_id String,
  market_id String,
  resolved_outcome String COMMENT 'Winning outcome (YES/NO/etc)',
  final_side String COMMENT 'Side wallet held at resolution',
  won UInt8 COMMENT '1 if correct, 0 if wrong',
  resolved_at DateTime,
  canonical_category String,

  -- Position details
  num_trades UInt32 COMMENT 'Trades that built this position',
  final_shares Decimal(18, 8) COMMENT 'Net shares at resolution',
  avg_entry_price Decimal(10, 6) COMMENT 'Volume-weighted avg entry',
  realized_pnl_usd Decimal(18, 2) COMMENT 'Total P&L on this market',

  ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (wallet_address, condition_id)
SETTINGS index_granularity = 8192
COMMENT 'Tracks conviction accuracy - whether wallet held winning side at resolution';

-- Indexes
CREATE INDEX idx_wro_wallet ON wallet_resolution_outcomes (wallet_address) TYPE bloom_filter(0.01);
CREATE INDEX idx_wro_category ON wallet_resolution_outcomes (canonical_category) TYPE bloom_filter(0.01);
CREATE INDEX idx_wro_won ON wallet_resolution_outcomes (won) TYPE set(0);
```

**Conviction Accuracy vs Hit Rate**:
- **Hit Rate**: Winning trades / total closed trades (includes exits before resolution)
- **Conviction Accuracy**: Positions held to resolution that were correct

**Build Process**:
```sql
INSERT INTO wallet_resolution_outcomes
SELECT
  wallet_address,
  condition_id,
  market_id,
  resolved_outcome,
  -- Determine final side by summing shares
  CASE
    WHEN sum(CASE WHEN side = 'BUY' THEN shares ELSE -shares END) > 0 THEN outcome
    ELSE CASE WHEN outcome = 'YES' THEN 'NO' ELSE 'YES' END
  END AS final_side,
  -- Check if final side matches winner
  CASE
    WHEN final_side = resolved_outcome THEN 1
    ELSE 0
  END AS won,
  max(timestamp) AS resolved_at,
  any(canonical_category) AS canonical_category,
  count() AS num_trades,
  sum(CASE WHEN side = 'BUY' THEN shares ELSE -shares END) AS final_shares,
  sumIf(entry_price * shares, side = 'BUY') / sumIf(shares, side = 'BUY') AS avg_entry_price,
  sum(realized_pnl_usd) AS realized_pnl_usd,
  now() AS ingested_at
FROM trades_raw
WHERE is_resolved = 1
GROUP BY wallet_address, condition_id, market_id, resolved_outcome;
```

**Update Frequency**: Every 10 minutes (after new resolutions)
**Volume**: ~500K wallets × 80 markets/wallet = 40M rows

---

## 3. Data Lineage and Dependencies

### 3.1 Dependency Graph

```
Level 0 (External Sources)
  ├─ Alchemy API → usdc_transfers
  ├─ Polygon RPC → erc1155_transfers
  ├─ CLOB API → clob_fills_raw
  └─ Polymarket API → markets_dim, events_dim

Level 1 (Normalization)
  ├─ erc1155_transfers → erc1155_flats (decode token IDs)
  ├─ erc1155_flats + markets_dim → condition_market_map
  └─ erc1155_flats + ApprovalForAll → wallets_dim (proxy discovery)

Level 2 (Resolution Discovery)
  ├─ markets_dim + Blockchain RPC → market_resolutions
  └─ market_resolutions + markets_dim → markets_dim (update is_resolved)

Level 3 (Trade Building)
  ├─ erc1155_flats → trades_raw (base trades)
  ├─ trades_raw + condition_market_map → trades_raw (enrich market_id)
  ├─ trades_raw + clob_fills_raw → trades_raw (enrich prices)
  └─ trades_raw + market_resolutions → trades_raw (enrich P&L)

Level 4 (Metrics Aggregation)
  ├─ trades_raw → wallet_metrics_complete
  ├─ trades_raw → wallet_metrics_by_category
  ├─ trades_raw → wallet_resolution_outcomes
  └─ trades_raw → market_analytics
```

### 3.2 Critical Path for Real-Time Updates

```
New Block on Polygon (every 2 seconds)
  ↓
1. Fetch ERC1155 logs (5 min delay for finality)
  ↓
2. Decode to erc1155_flats (1 min processing)
  ↓
3. Build trades_raw (2 min processing)
  ↓
4. Enrich with CLOB fills (if available)
  ↓
5. Check for new resolutions (every 10 min)
  ↓
6. Apply resolutions to trades_raw
  ↓
7. Trigger incremental metric updates (every 1 hour)

Total Latency: ~8 minutes from trade to visible in dashboard
```

---

## 4. PnL Calculation Strategy

### 4.1 PnL Formula (Per Trade)

```sql
-- For BUY trades:
realized_pnl_usd = CASE
  WHEN outcome = resolved_outcome THEN
    -- Won: collect 1 USDC per share, paid entry_price
    shares * (1.0 - entry_price) - fee
  ELSE
    -- Lost: shares become worthless, lost entry_price
    -1.0 * shares * entry_price - fee
END

-- For SELL trades (short positions):
realized_pnl_usd = CASE
  WHEN outcome = resolved_outcome THEN
    -- Wrong side: have to buy back at 1.0, received entry_price
    -1.0 * shares * (1.0 - entry_price) - fee
  ELSE
    -- Right side: bought at entry_price, sell for 1.0
    shares * entry_price - fee
END
```

### 4.2 Multi-Outcome Markets

```sql
-- Example: 3-outcome market with payout_vector = [1.0, 0.0, 0.0]
-- Trade on outcome_index = 0 (Trump)

realized_pnl_usd =
  shares * payout_vector[outcome_index] - shares * entry_price - fee

-- If Trump wins (payout_vector[0] = 1.0):
--   PnL = shares * 1.0 - shares * 0.45 - fee = shares * 0.55 - fee

-- If Biden wins (payout_vector[0] = 0.0):
--   PnL = shares * 0.0 - shares * 0.45 - fee = -shares * 0.45 - fee
```

### 4.3 Partial Exits (Position Management)

```sql
-- Track cumulative position per wallet per market
CREATE MATERIALIZED VIEW mv_wallet_positions AS
SELECT
  wallet_address,
  condition_id,
  outcome,
  sum(CASE WHEN side = 'BUY' THEN shares ELSE -shares END) AS net_shares,
  sumIf(shares * entry_price, side = 'BUY') AS total_cost,
  sumIf(shares * entry_price, side = 'SELL') AS total_proceeds,
  min(timestamp) AS first_entry,
  max(timestamp) AS last_update
FROM trades_raw
GROUP BY wallet_address, condition_id, outcome;

-- Calculate realized vs unrealized P&L
SELECT
  wallet_address,
  sum(CASE
    WHEN is_resolved = 1 THEN realized_pnl_usd
    ELSE 0
  END) AS realized_pnl,
  sum(CASE
    WHEN is_resolved = 0 THEN
      -- Unrealized: mark to market at current price
      shares * (current_price - entry_price)
    ELSE 0
  END) AS unrealized_pnl
FROM trades_raw
LEFT JOIN price_snapshots_10s ON trades_raw.market_id = price_snapshots_10s.market_id
WHERE price_snapshots_10s.timestamp = (
  SELECT max(timestamp)
  FROM price_snapshots_10s
  WHERE market_id = trades_raw.market_id
)
GROUP BY wallet_address;
```

### 4.4 Per-Category ROI

```sql
-- Category ROI calculation
SELECT
  wallet_address,
  canonical_category,
  sum(realized_pnl_usd) AS total_pnl,
  sum(shares * entry_price) AS total_invested,
  (sum(realized_pnl_usd) / sum(shares * entry_price)) * 100 AS roi_pct,
  count() AS num_trades,
  countIf(realized_pnl_usd > 0) / count() AS win_rate
FROM trades_raw
WHERE is_resolved = 1
  AND canonical_category != ''
  AND timestamp > now() - INTERVAL 90 DAY
GROUP BY wallet_address, canonical_category
HAVING num_trades >= 10  -- Minimum threshold
ORDER BY roi_pct DESC;
```

---

## 5. Quality Gates and Validation

### 5.1 Gate Definitions

```sql
-- Gate 1: Price Coverage (>95% trades have execution price)
CREATE VIEW qg_price_coverage AS
SELECT
  toStartOfDay(timestamp) AS date,
  countIf(entry_price > 0) AS trades_with_price,
  count() AS total_trades,
  (trades_with_price / total_trades) * 100 AS coverage_pct,
  CASE
    WHEN coverage_pct >= 95 THEN 'PASS'
    WHEN coverage_pct >= 90 THEN 'WARN'
    ELSE 'FAIL'
  END AS status
FROM trades_raw
WHERE timestamp > now() - INTERVAL 7 DAY
GROUP BY date
ORDER BY date DESC;

-- Gate 2: Market Enrichment (>95% trades have market_id)
CREATE VIEW qg_market_enrichment AS
SELECT
  toStartOfDay(timestamp) AS date,
  countIf(market_id != '') AS trades_with_market,
  count() AS total_trades,
  (trades_with_market / total_trades) * 100 AS coverage_pct,
  CASE
    WHEN coverage_pct >= 95 THEN 'PASS'
    WHEN coverage_pct >= 90 THEN 'WARN'
    ELSE 'FAIL'
  END AS status
FROM trades_raw
WHERE timestamp > now() - INTERVAL 7 DAY
GROUP BY date
ORDER BY date DESC;

-- Gate 3: Resolution Accuracy (>95% resolved markets correct)
CREATE VIEW qg_resolution_accuracy AS
SELECT
  canonical_category,
  count(DISTINCT condition_id) AS total_resolved,
  countIf(is_verified = 1) AS verified_resolutions,
  (verified_resolutions / total_resolved) * 100 AS verification_rate,
  CASE
    WHEN verification_rate >= 95 THEN 'PASS'
    WHEN verification_rate >= 90 THEN 'WARN'
    ELSE 'FAIL'
  END AS status
FROM market_resolutions
WHERE resolved_at > now() - INTERVAL 30 DAY
GROUP BY canonical_category;

-- Gate 4: PnL Accuracy (<2% error vs known wallets)
CREATE VIEW qg_pnl_accuracy AS
SELECT
  'Known Wallets' AS test_group,
  sum(realized_pnl_usd) AS calculated_pnl,
  sum(expected_pnl_usd) AS expected_pnl,
  abs((calculated_pnl - expected_pnl) / expected_pnl) * 100 AS error_pct,
  CASE
    WHEN error_pct < 2.0 THEN 'PASS'
    WHEN error_pct < 5.0 THEN 'WARN'
    ELSE 'FAIL'
  END AS status
FROM trades_raw
INNER JOIN test_wallets ON trades_raw.wallet_address = test_wallets.wallet_address
WHERE is_resolved = 1
  AND timestamp > now() - INTERVAL 30 DAY;

-- Gate 5: Volume Confidence (>95% volume HIGH confidence)
CREATE VIEW qg_volume_confidence AS
SELECT
  toStartOfWeek(timestamp) AS week,
  sum(CASE
    WHEN entry_price > 0 AND market_id != '' AND is_resolved IN (0, 1)
    THEN usd_value
    ELSE 0
  END) AS high_confidence_volume,
  sum(usd_value) AS total_volume,
  (high_confidence_volume / total_volume) * 100 AS confidence_pct,
  CASE
    WHEN confidence_pct >= 95 THEN 'PASS'
    WHEN confidence_pct >= 90 THEN 'WARN'
    ELSE 'FAIL'
  END AS status
FROM trades_raw
WHERE timestamp > now() - INTERVAL 30 DAY
GROUP BY week
ORDER BY week DESC;
```

### 5.2 Quality Dashboard

```sql
-- Real-time quality gate summary
SELECT
  'Price Coverage' AS gate,
  status,
  coverage_pct AS value,
  date AS last_check
FROM qg_price_coverage
WHERE date = today()

UNION ALL

SELECT
  'Market Enrichment' AS gate,
  status,
  coverage_pct AS value,
  date AS last_check
FROM qg_market_enrichment
WHERE date = today()

UNION ALL

SELECT
  'Resolution Accuracy' AS gate,
  status,
  verification_rate AS value,
  now() AS last_check
FROM qg_resolution_accuracy
WHERE canonical_category = 'ALL'

UNION ALL

SELECT
  'PnL Accuracy' AS gate,
  status,
  error_pct AS value,
  now() AS last_check
FROM qg_pnl_accuracy

UNION ALL

SELECT
  'Volume Confidence' AS gate,
  status,
  confidence_pct AS value,
  week AS last_check
FROM qg_volume_confidence
WHERE week = toStartOfWeek(now());
```

### 5.3 Alerting Rules

```typescript
// Alert if any gate fails
const alerts = [
  {
    name: 'Price Coverage Below Threshold',
    condition: 'coverage_pct < 90',
    severity: 'HIGH',
    action: 'Investigate CLOB API ingestion',
  },
  {
    name: 'Market Enrichment Failed',
    condition: 'coverage_pct < 90',
    severity: 'CRITICAL',
    action: 'Check condition_market_map completeness',
  },
  {
    name: 'Resolution Accuracy Low',
    condition: 'verification_rate < 90',
    severity: 'HIGH',
    action: 'Verify blockchain RPC connection',
  },
  {
    name: 'PnL Accuracy Drift',
    condition: 'error_pct > 5.0',
    severity: 'CRITICAL',
    action: 'Audit payout vector calculations',
  },
];
```

---

## 6. Edge Case Handling

### 6.1 Redemptions (Position Closing via Blockchain)

**Problem**: Redemptions (ERC1155 burns to 0x0) don't appear in CLOB fills

**Solution**:
```sql
-- Detect redemption trades
SELECT
  wallet_address,
  condition_id,
  outcome,
  sum(amount_normalized) AS redeemed_shares
FROM erc1155_flats
WHERE to_addr = '0x0000000000000000000000000000000000000000'
  AND from_addr != '0x0000000000000000000000000000000000000000'
GROUP BY wallet_address, condition_id, outcome;

-- Calculate P&L for redemptions
-- Redemption means market resolved, so payout = winning_outcome payout
UPDATE trades_raw
SET
  exit_price = payout_multiplier,  -- 1.0 or 0.0
  realized_pnl_usd = shares * payout_multiplier - shares * entry_price - fee
WHERE trade_id IN (
  SELECT trade_id
  FROM erc1155_flats
  WHERE to_addr = '0x0000000000000000000000000000000000000000'
);
```

### 6.2 Settlement Trades (CTF mergePositions)

**Problem**: Users can combine YES + NO tokens to create full sets, then redeem

**Solution**:
```sql
-- Detect settlement: simultaneous transfer of YES and NO tokens
WITH settlements AS (
  SELECT
    tx_hash,
    wallet_address,
    condition_id,
    count(DISTINCT outcome_index) AS outcomes_transferred
  FROM erc1155_flats
  WHERE to_addr = '0x0000000000000000000000000000000000000000'
  GROUP BY tx_hash, wallet_address, condition_id
  HAVING outcomes_transferred > 1  -- Both YES and NO
)
UPDATE trades_raw
SET
  exit_type = 'settlement',
  realized_pnl_usd = 0  -- Net zero (full set = 1 USDC)
WHERE (tx_hash, wallet_address, condition_id) IN settlements;
```

### 6.3 Multi-Outcome Markets

**Problem**: >2 outcomes require different payout logic

**Solution**:
```sql
-- Store full payout vector in market_resolutions
CREATE TABLE market_resolutions (
  condition_id String,
  payout_vector Array(Decimal(5, 4)) COMMENT '[payout_0, payout_1, ..., payout_n]',
  -- ... other fields
);

-- Calculate P&L using array index
UPDATE trades_raw
SET realized_pnl_usd =
  shares * payout_vector[outcome_index] - shares * entry_price - fee
FROM market_resolutions
WHERE trades_raw.condition_id = market_resolutions.condition_id
  AND trades_raw.is_resolved = 0;
```

### 6.4 Invalid Markets (Refunds)

**Problem**: Some markets resolve as invalid, refunding all positions

**Solution**:
```sql
-- Detect invalid resolutions
UPDATE market_resolutions
SET
  resolved_outcome = 'INVALID',
  payout_vector = arrayMap(x -> 1.0 / num_outcomes, range(num_outcomes))
WHERE market_id IN (
  SELECT market_id
  FROM markets_dim
  WHERE question LIKE '%invalid%' OR description LIKE '%refund%'
);

-- Proportional refund P&L
UPDATE trades_raw
SET realized_pnl_usd = shares * (1.0 / num_outcomes) - shares * entry_price - fee
WHERE resolved_outcome = 'INVALID';
```

### 6.5 Proxy Wallet Discovery Gaps

**Problem**: Some proxy wallets not detected via ApprovalForAll

**Solution**:
```sql
-- Fallback: detect proxies via trading patterns
INSERT INTO wallets_dim (wallet_address, proxy_wallet, wallet_type)
SELECT DISTINCT
  operator AS proxy_wallet,
  NULL AS wallet_address,  -- Unknown real wallet
  'proxy' AS wallet_type
FROM erc1155_flats
WHERE operator NOT IN (SELECT proxy_wallet FROM wallets_dim WHERE proxy_wallet IS NOT NULL)
  AND operator != '0x0000000000000000000000000000000000000000'
GROUP BY operator
HAVING count(DISTINCT condition_id) > 5;  -- Active traders

-- Manual mapping via CLOB API
-- CLOB returns both proxy and user address in some endpoints
```

### 6.6 Price Gaps (Missing CLOB Fills)

**Problem**: Not all trades appear in CLOB API (AMM trades, old trades)

**Solution**:
```sql
-- Estimate prices from surrounding trades
WITH price_estimates AS (
  SELECT
    market_id,
    outcome,
    timestamp,
    entry_price,
    LAG(entry_price, 1) OVER (PARTITION BY market_id, outcome ORDER BY timestamp) AS prev_price,
    LEAD(entry_price, 1) OVER (PARTITION BY market_id, outcome ORDER BY timestamp) AS next_price
  FROM trades_raw
  WHERE entry_price > 0
)
UPDATE trades_raw AS t
SET entry_price = COALESCE(
  (SELECT avg(entry_price)
   FROM price_estimates
   WHERE market_id = t.market_id
     AND outcome = t.outcome
     AND timestamp BETWEEN t.timestamp - INTERVAL 5 MINUTE
                       AND t.timestamp + INTERVAL 5 MINUTE),
  0.5  -- Fallback to 50% if no nearby trades
)
WHERE entry_price = 0;
```

---

## 7. Update Frequency and Sync Strategy

### 7.1 Continuous Sync Schedule

```
Every 5 minutes:
  ├─ Ingest new ERC1155 events → erc1155_transfers
  ├─ Decode to erc1155_flats
  ├─ Pull CLOB fills for active wallets → clob_fills_raw
  ├─ Build new trades → trades_raw (incremental)
  └─ Enrich prices and categories

Every 10 minutes:
  ├─ Scan for new resolutions → market_resolutions
  ├─ Apply resolutions to trades_raw
  └─ Update wallet_resolution_outcomes

Every 1 hour:
  ├─ Refresh market metadata → markets_dim, events_dim
  ├─ Update condition_market_map (new markets)
  ├─ Recalculate wallet_metrics_complete (30d window)
  └─ Update wallets_dim (activity flags)

Every 6 hours:
  ├─ Recalculate wallet_metrics_complete (90d, 180d, lifetime)
  ├─ Recalculate wallet_metrics_by_category (all windows)
  └─ Run quality gates and alerting

Daily (00:00 UTC):
  ├─ Archive old data (>2 years) to cold storage
  ├─ Optimize table partitions (OPTIMIZE TABLE)
  ├─ Rebuild materialized views (if schema changed)
  └─ Generate daily analytics reports
```

### 7.2 Idempotency and Deduplication

```sql
-- Use ReplacingMergeTree for upserts
ENGINE = ReplacingMergeTree(updated_at)

-- Deduplication key = primary key
ORDER BY (wallet_address, timestamp, trade_id)

-- Manual deduplication (if needed)
OPTIMIZE TABLE trades_raw FINAL;

-- Prevent duplicate ingestion
CREATE TABLE ingestion_checkpoints (
  source String,
  last_block UInt32,
  last_timestamp DateTime,
  records_ingested UInt64,
  checkpoint_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(checkpoint_at)
ORDER BY (source);

-- Resume from checkpoint
SELECT last_block
FROM ingestion_checkpoints
WHERE source = 'erc1155_transfers';
```

### 7.3 Consistency Guarantees

1. **Atomic Swaps for Schema Migrations**:
```sql
-- Build new table
CREATE TABLE trades_raw_v2 AS trades_raw;
-- ... populate trades_raw_v2 ...
-- Atomic swap
RENAME TABLE trades_raw TO trades_raw_old, trades_raw_v2 TO trades_raw;
-- Drop old
DROP TABLE trades_raw_old;
```

2. **Transactional Writes** (via batching):
```typescript
// Buffer writes and flush atomically
const batch = [];
for (const trade of newTrades) {
  batch.push(trade);
  if (batch.length >= 10000) {
    await clickhouse.insert({ table: 'trades_raw', values: batch });
    batch.length = 0;
  }
}
```

3. **Read Consistency**:
```sql
-- Use FINAL for point queries (collapses ReplacingMergeTree)
SELECT * FROM wallet_metrics_complete FINAL
WHERE wallet_address = '0x123...';

-- Use materialized views for aggregations (pre-collapsed)
```

---

## 8. Query Performance Optimization

### 8.1 Indexing Strategy

```sql
-- Bloom filter indexes (for high-cardinality lookups)
CREATE INDEX idx_trades_wallet ON trades_raw (wallet_address) TYPE bloom_filter(0.01);
CREATE INDEX idx_trades_market ON trades_raw (market_id) TYPE bloom_filter(0.01);

-- Set indexes (for low-cardinality filters)
CREATE INDEX idx_trades_resolved ON trades_raw (is_resolved) TYPE set(0);
CREATE INDEX idx_trades_side ON trades_raw (side) TYPE set(0);

-- MinMax indexes (for range queries)
CREATE INDEX idx_trades_time ON trades_raw (timestamp) TYPE minmax;
CREATE INDEX idx_trades_pnl ON trades_raw (realized_pnl_usd) TYPE minmax;

-- Skip indexes (for array columns)
CREATE INDEX idx_events_tags ON events_dim (raw_tags) TYPE bloom_filter(0.01);
```

### 8.2 Partitioning Strategy

```sql
-- Time-based partitioning (monthly)
PARTITION BY toYYYYMM(timestamp)

-- Benefits:
-- 1. Fast pruning for time-range queries
-- 2. Easy archival (drop old partitions)
-- 3. Parallel query execution

-- Query example (automatic partition pruning):
SELECT * FROM trades_raw
WHERE timestamp BETWEEN '2024-01-01' AND '2024-01-31'
-- Only scans partition 202401
```

### 8.3 Materialized Views for Hot Queries

```sql
-- Pre-aggregate daily wallet metrics
CREATE MATERIALIZED VIEW mv_wallet_daily_pnl
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (wallet_address, date)
AS SELECT
  wallet_address,
  toDate(timestamp) AS date,
  sum(realized_pnl_usd) AS daily_pnl,
  count() AS daily_trades,
  countIf(realized_pnl_usd > 0) AS daily_wins
FROM trades_raw
WHERE is_resolved = 1
GROUP BY wallet_address, date;

-- Query daily P&L (fast)
SELECT * FROM mv_wallet_daily_pnl
WHERE wallet_address = '0x123...'
  AND date >= today() - 30;
```

### 8.4 Query Optimization Patterns

```sql
-- Pattern 1: Use PREWHERE for early filtering (before reading all columns)
SELECT *
FROM trades_raw
PREWHERE wallet_address = '0x123...'
WHERE is_resolved = 1;

-- Pattern 2: Avoid SELECT * in large tables
SELECT wallet_address, timestamp, realized_pnl_usd
FROM trades_raw
WHERE ...;

-- Pattern 3: Use aggregation combinator for incremental metrics
SELECT
  wallet_address,
  sumMerge(pnl_state) AS total_pnl
FROM wallet_metrics_daily
WHERE date >= today() - 30
GROUP BY wallet_address;

-- Pattern 4: Leverage ORDER BY for sorted queries
SELECT * FROM trades_raw
WHERE wallet_address = '0x123...'
ORDER BY timestamp DESC  -- Fast because (wallet_address, timestamp) in ORDER BY
LIMIT 100;
```

### 8.5 Performance Targets

```
Query Type                      Target Latency
─────────────────────────────────────────────
Single wallet lookup            < 50ms
Wallet leaderboard (top 100)    < 200ms
Category leaderboard            < 500ms
Market analytics                < 1s
Complex aggregations            < 5s
Full table scan (rare)          < 30s
```

---

## 9. Data Validation and Testing

### 9.1 Positive Control Tests

```sql
-- Test 1: Known wallet with verified P&L
INSERT INTO test_wallets VALUES (
  '0x123...',
  'Known Wallet A',
  1250.50,  -- expected_pnl_usd
  '2024-01-01',
  '2024-12-31'
);

-- Run test
SELECT
  t.wallet_address,
  sum(t.realized_pnl_usd) AS calculated_pnl,
  tw.expected_pnl_usd,
  abs(calculated_pnl - expected_pnl_usd) AS error,
  (error / expected_pnl_usd) * 100 AS error_pct
FROM trades_raw AS t
INNER JOIN test_wallets AS tw ON t.wallet_address = tw.wallet_address
WHERE t.is_resolved = 1
  AND t.timestamp BETWEEN tw.start_date AND tw.end_date
GROUP BY t.wallet_address, tw.expected_pnl_usd
HAVING error_pct < 2.0;  -- Pass if < 2% error
```

### 9.2 Reconciliation Checks

```sql
-- Check 1: Trade count matches ERC1155 events
SELECT
  'ERC1155 Events' AS source,
  count() AS record_count
FROM erc1155_flats
WHERE to_addr != '0x0000000000000000000000000000000000000000'

UNION ALL

SELECT
  'Trades Raw' AS source,
  count() AS record_count
FROM trades_raw;

-- Difference should be <1% (accounting for batch events)

-- Check 2: Total volume matches CLOB API
SELECT
  sum(shares * entry_price) AS total_volume_from_trades
FROM trades_raw
WHERE timestamp > now() - INTERVAL 30 DAY;

-- Compare to CLOB API /stats endpoint

-- Check 3: Resolution coverage
SELECT
  count(DISTINCT condition_id) AS unique_markets_traded
FROM trades_raw;

SELECT
  count(*) AS markets_with_resolutions
FROM market_resolutions;

-- Coverage = markets_with_resolutions / unique_markets_traded
```

### 9.3 Anomaly Detection

```sql
-- Detect anomalies in daily trade volume
WITH daily_volume AS (
  SELECT
    toDate(timestamp) AS date,
    sum(shares * entry_price) AS volume_usd
  FROM trades_raw
  GROUP BY date
)
SELECT
  date,
  volume_usd,
  avg(volume_usd) OVER (ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS avg_7d,
  stddevPop(volume_usd) OVER (ORDER BY date ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS stddev_7d,
  (volume_usd - avg_7d) / stddev_7d AS z_score
FROM daily_volume
WHERE z_score > 3  -- Flag days with >3 std deviations
ORDER BY date DESC;
```

---

## 10. Operational Procedures

### 10.1 Daily Health Check

```bash
#!/bin/bash
# daily-health-check.sh

echo "=== Polymarket Data Health Check ==="
echo "Date: $(date)"
echo ""

# Check 1: Ingestion lag
echo "1. Ingestion Lag:"
clickhouse-client --query "
SELECT
  source,
  max(block_time) AS latest_block_time,
  now() - latest_block_time AS lag_seconds
FROM erc1155_transfers
GROUP BY source
"

# Check 2: Quality gates
echo ""
echo "2. Quality Gates:"
clickhouse-client --query "
SELECT gate, status, value, last_check
FROM (
  SELECT 'Price Coverage' AS gate, status, coverage_pct AS value, date AS last_check FROM qg_price_coverage WHERE date = today()
  UNION ALL
  SELECT 'Market Enrichment', status, coverage_pct, date FROM qg_market_enrichment WHERE date = today()
  UNION ALL
  SELECT 'Resolution Accuracy', status, verification_rate, now() FROM qg_resolution_accuracy WHERE canonical_category = 'ALL'
)
"

# Check 3: Recent trade volume
echo ""
echo "3. Last 24h Trade Volume:"
clickhouse-client --query "
SELECT
  count() AS trades,
  count(DISTINCT wallet_address) AS unique_wallets,
  sum(shares * entry_price) AS volume_usd
FROM trades_raw
WHERE timestamp > now() - INTERVAL 24 HOUR
"

# Check 4: Pending resolutions
echo ""
echo "4. Markets Pending Resolution:"
clickhouse-client --query "
SELECT count(*) AS pending_resolutions
FROM markets_dim
WHERE end_date < now()
  AND is_resolved = 0
"

echo ""
echo "=== Health Check Complete ==="
```

### 10.2 Recovery Procedures

**Scenario 1: Ingestion Pipeline Failure**

```bash
# 1. Check last successful checkpoint
clickhouse-client --query "
SELECT * FROM ingestion_checkpoints ORDER BY checkpoint_at DESC LIMIT 10
"

# 2. Resume from last checkpoint
export RESUME_BLOCK=12345678
npx tsx scripts/ingest-erc1155.ts --start-block=$RESUME_BLOCK

# 3. Verify no gaps
clickhouse-client --query "
SELECT
  block_number,
  block_number - LAG(block_number) OVER (ORDER BY block_number) AS gap
FROM erc1155_transfers
WHERE gap > 1
"
```

**Scenario 2: Corrupted Metrics**

```sql
-- 1. Identify affected wallets
SELECT wallet_address
FROM wallet_metrics_complete
WHERE metric_2_omega_net < -1000  -- Impossible value
  OR metric_9_net_pnl_usd IS NULL;

-- 2. Delete corrupted records
DELETE FROM wallet_metrics_complete
WHERE wallet_address IN (SELECT wallet_address FROM ...);

-- 3. Recompute metrics
-- (Run metric calculation script for affected wallets)
```

**Scenario 3: Schema Migration**

```sql
-- 1. Create new table with updated schema
CREATE TABLE trades_raw_v2 (
  -- ... new schema ...
) ENGINE = MergeTree() ...;

-- 2. Migrate data with transformation
INSERT INTO trades_raw_v2
SELECT
  -- ... transform old columns to new ...
FROM trades_raw;

-- 3. Verify row counts match
SELECT count() FROM trades_raw;
SELECT count() FROM trades_raw_v2;

-- 4. Atomic swap
RENAME TABLE
  trades_raw TO trades_raw_old,
  trades_raw_v2 TO trades_raw;

-- 5. Drop old table (after 24h grace period)
DROP TABLE trades_raw_old;
```

### 10.3 Monitoring and Alerting

```typescript
// monitoring-agent.ts
import { clickhouse } from './lib/clickhouse'
import { sendAlert } from './lib/alerts'

async function monitorDataQuality() {
  // Check ingestion lag
  const lagCheck = await clickhouse.query({
    query: `
      SELECT max(block_time) AS latest_block
      FROM erc1155_transfers
      WHERE source = 'polygon_rpc'
    `,
  })

  const lag = Date.now() - new Date(lagCheck.rows[0].latest_block).getTime()
  if (lag > 600000) {  // 10 minutes
    await sendAlert({
      severity: 'HIGH',
      message: `Ingestion lag: ${Math.floor(lag / 1000 / 60)} minutes`,
      action: 'Check Polygon RPC connection',
    })
  }

  // Check quality gates
  const gates = await clickhouse.query({
    query: `SELECT * FROM qg_price_coverage WHERE date = today()`,
  })

  if (gates.rows[0].status === 'FAIL') {
    await sendAlert({
      severity: 'CRITICAL',
      message: `Price coverage gate failed: ${gates.rows[0].coverage_pct}%`,
      action: 'Investigate CLOB API ingestion',
    })
  }
}

// Run every 5 minutes
setInterval(monitorDataQuality, 5 * 60 * 1000)
```

---

## 11. Summary and Next Steps

### 11.1 Architecture Highlights

1. **Separation of Concerns**: Raw facts → Enriched dimensions → Aggregated metrics
2. **100% Accuracy**: Quality gates enforce <2% error on known wallets
3. **Scalability**: Partitioning + indexing supports billions of rows
4. **Real-Time Sync**: 5-minute ingestion lag, 8-minute end-to-end latency
5. **Comprehensive Coverage**: All markets, all wallets, all categories
6. **Robust Edge Cases**: Redemptions, settlements, multi-outcome, invalid markets

### 11.2 Implementation Phases

**Phase 1: Foundation (Weeks 1-2)**
- [ ] Set up ClickHouse cluster
- [ ] Create all raw ingestion tables
- [ ] Build ERC1155 ingestion pipeline
- [ ] Implement USDC transfer ingestion
- [ ] Create dimension tables

**Phase 2: Enrichment (Weeks 3-4)**
- [ ] Build condition_market_map
- [ ] Implement CLOB fill ingestion
- [ ] Create trades_raw with enrichment logic
- [ ] Build resolution scanner
- [ ] Implement P&L calculation

**Phase 3: Metrics (Weeks 5-6)**
- [ ] Build wallet_metrics_complete
- [ ] Build wallet_metrics_by_category
- [ ] Create wallet_resolution_outcomes
- [ ] Implement quality gates
- [ ] Set up monitoring and alerting

**Phase 4: Optimization (Weeks 7-8)**
- [ ] Create materialized views
- [ ] Optimize indexes
- [ ] Implement caching layer
- [ ] Load testing and tuning
- [ ] Documentation and runbooks

### 11.3 Success Criteria

- [ ] >95% trades have execution prices
- [ ] >95% trades have market enrichment
- [ ] >95% resolved markets verified
- [ ] <2% P&L error on known wallets
- [ ] <100ms wallet lookup queries
- [ ] <5s complex aggregation queries
- [ ] <10 minute end-to-end latency
- [ ] Zero data loss during sync

---

## Appendix A: Table Size Estimates

| Table | Row Count | Size (GB) | Growth Rate |
|-------|-----------|-----------|-------------|
| usdc_transfers | 388M | 45 | 1M/day |
| erc1155_transfers | 50M | 12 | 500K/month |
| erc1155_flats | 50M | 15 | 500K/month |
| clob_fills_raw | 10M | 2.5 | 100K/month |
| trades_raw | 20M | 8 | 200K/month |
| markets_dim | 50K | 0.05 | 500/month |
| events_dim | 5K | 0.01 | 50/month |
| condition_market_map | 50K | 0.01 | 500/month |
| market_resolutions | 40K | 0.02 | 400/month |
| wallets_dim | 500K | 0.1 | 5K/month |
| wallet_metrics_complete | 2M | 1.5 | 20K/month |
| wallet_metrics_by_category | 14M | 10 | 140K/month |
| wallet_resolution_outcomes | 40M | 12 | 400K/month |
| **TOTAL** | **575M** | **106 GB** | **~3M/month** |

**Storage Requirements**:
- Production: 200 GB (with overhead)
- Backups: 200 GB × 2 = 400 GB
- Total: 600 GB (recommend 1 TB cluster)

---

## Appendix B: API Rate Limits and Costs

| Service | Rate Limit | Cost | Notes |
|---------|------------|------|-------|
| Polymarket API | 100 req/min | Free | Public API |
| CLOB API | 10 req/sec | Free | Public API |
| Alchemy | 330 CU/sec | $199/mo | Growth plan |
| Goldsky | 1000 req/min | Custom | Enterprise |
| Polygon RPC | Varies | Free | Public nodes |

**Cost Optimization**:
- Cache dimension data (markets, events) for 1 hour
- Batch CLOB fill requests (1000 fills per request)
- Use Goldsky for bulk historical data
- Use Alchemy only for real-time sync

---

## Appendix C: Disaster Recovery Plan

**Backup Strategy**:
```bash
# Daily backups to S3
clickhouse-backup create daily-$(date +%Y%m%d)
clickhouse-backup upload daily-$(date +%Y%m%d)

# Retain:
# - Daily backups: 7 days
# - Weekly backups: 4 weeks
# - Monthly backups: 12 months
```

**Recovery Time Objectives**:
- RTO (Recovery Time): 4 hours
- RPO (Recovery Point): 5 minutes (last checkpoint)

**Recovery Procedure**:
1. Provision new ClickHouse cluster
2. Restore from latest backup
3. Resume ingestion from checkpoint
4. Verify data integrity
5. Update DNS/load balancer
6. Monitor for 24 hours

---

This architecture provides a complete, production-ready system for Polymarket analytics with 100% accuracy guarantees, robust quality gates, and comprehensive edge case handling.
