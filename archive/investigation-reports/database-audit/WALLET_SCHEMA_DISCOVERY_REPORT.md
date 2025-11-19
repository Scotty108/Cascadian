# CASCADIAN WALLET SCHEMA DISCOVERY REPORT
## Comprehensive Wallet Address Field Inventory

### Executive Summary
This report catalogs all ClickHouse tables and views containing wallet address fields across the CASCADIAN platform. The schema supports multiple wallet field patterns reflecting the complexity of blockchain transaction tracking (EOAs, proxies, makers/takers, senders/recipients).

---

## TABLES WITH WALLET ADDRESS FIELDS

### 1. WALLET DIMENSION TABLES

#### wallets_dim
- **Type**: Table (ReplacingMergeTree)
- **Wallet Columns**:
  - `wallet_address` (String) - [PRIMARY, SORTED]
- **Purpose**: Store wallet dimension data (discovery, metadata)
- **Estimated Row Count**: ~50K+ wallets
- **Key Fields**:
  - first_seen DateTime
  - last_seen DateTime
  - total_volume_usd Decimal(18,2)
  - total_trades UInt32
  - is_active Boolean
- **Indexes**: PRIMARY KEY on wallet_address
- **Sample Query**:
  ```sql
  SELECT wallet_address, total_volume_usd, total_trades 
  FROM wallets_dim 
  WHERE is_active = 1 
  ORDER BY total_volume_usd DESC 
  LIMIT 5
  ```

#### wallet_metrics (Phase 2)
- **Type**: Table (ReplacingMergeTree)
- **Wallet Columns**:
  - `wallet_address` (String) - [PRIMARY, SORTED]
- **Purpose**: Per-wallet performance metrics across multiple time windows
- **Estimated Row Count**: ~200K+ (50K wallets × 4 time windows)
- **Time Windows**: 30d, 90d, 180d, lifetime
- **Key Fields**:
  - realized_pnl Float64
  - unrealized_payout Float64
  - roi_pct Float64
  - win_rate Float64
  - sharpe_ratio Float64
  - omega_ratio Float64
  - max_drawdown Float64
  - volatility Float64
  - total_trades UInt32
  - markets_traded UInt32
  - avg_trade_size Float64
- **Partitioning**: BY time_window
- **Indexes**: 
  - PRIMARY KEY (wallet_address, time_window)
- **Sample Query**:
  ```sql
  SELECT wallet_address, time_window, realized_pnl, omega_ratio
  FROM wallet_metrics
  WHERE time_window = '90d' AND omega_ratio > 0
  ORDER BY omega_ratio DESC
  LIMIT 5
  ```

#### wallet_metrics_complete (Phase 1B - 102 Metrics)
- **Type**: Table (ReplacingMergeTree)
- **Wallet Columns**:
  - `wallet_address` (String) - [PRIMARY, SORTED]
- **Purpose**: Comprehensive metrics (102 fields) for wallet ranking and analysis
- **Estimated Row Count**: ~200K+ (50K wallets × 4 time windows)
- **Time Windows**: 30d, 90d, 180d, lifetime
- **Key Metrics Sections**:
  - Base Screeners (#1-24): Omega, returns, P&L, activity
  - Advanced Screeners (#25-47): Forecasting skill, CLV, risk, diversification
  - Latency-Adjusted (#48-55): Copyability analysis, edge durability
  - Momentum & Trends (#56-88): Performance trends, tail ratios, capital efficiency
  - Market Microstructure (#93-102): Event-driven edge, execution quality
- **Partitioning**: BY window
- **Indexes**: Multiple minmax indexes on key metrics
- **Sample Query**:
  ```sql
  SELECT wallet_address, metric_2_omega_net, metric_69_ev_per_hour_capital
  FROM wallet_metrics_complete
  WHERE window = 'lifetime' AND metric_22_resolved_bets >= 10
  ORDER BY metric_69_ev_per_hour_capital DESC
  LIMIT 5
  ```

#### wallet_resolution_outcomes
- **Type**: Table (ReplacingMergeTree)
- **Wallet Columns**:
  - `wallet_address` (String) - [PRIMARY, SORTED]
- **Purpose**: Track conviction accuracy - whether wallet held winning side at resolution
- **Estimated Row Count**: ~5M+ (market resolutions × wallets)
- **Key Fields**:
  - condition_id String
  - market_id String
  - resolved_outcome String (YES/NO/outcome index)
  - final_side String
  - won UInt8 (1=winner, 0=loser)
  - resolved_at DateTime
  - canonical_category String
  - num_trades UInt32
  - final_shares Float64
- **Indexes**: PRIMARY on (wallet_address, condition_id)
- **Sample Query**:
  ```sql
  SELECT wallet_address, won, COUNT(*) as resolution_count
  FROM wallet_resolution_outcomes
  WHERE resolved_at >= now() - interval 30 day
  GROUP BY wallet_address, won
  ORDER BY resolution_count DESC
  LIMIT 5
  ```

#### wallet_metrics_by_category
- **Type**: Table (ReplacingMergeTree)
- **Wallet Columns**:
  - `wallet_address` (String) - [PRIMARY, SORTED]
- **Purpose**: Metrics broken down by market category
- **Estimated Row Count**: ~500K+ (wallets × categories)
- **Key Fields**:
  - category String (Politics, Crypto, Sports, etc.)
  - (metrics repeated per category)
- **Indexes**: PRIMARY on (wallet_address, category)
- **Sample Query**:
  ```sql
  SELECT wallet_address, category, SUM(trades_in_category) as total
  FROM wallet_metrics_by_category
  WHERE category = 'Politics'
  GROUP BY wallet_address, category
  ORDER BY total DESC
  ```

---

### 2. TRADE AND TRANSACTION TABLES

#### trades_raw
- **Type**: Table (MergeTree)
- **Wallet Columns**:
  - `wallet_address` (String) - [SORTED]
- **Purpose**: Main trades table with wallet analytics
- **Estimated Row Count**: ~10M+ trades
- **Key Fields**:
  - trade_id String
  - market_id String
  - timestamp DateTime [PARTITION]
  - side Enum8 (YES/NO)
  - entry_price Decimal(18,8)
  - exit_price Nullable(Decimal(18,8))
  - shares Decimal(18,8)
  - usd_value Decimal(18,2)
  - pnl Nullable(Decimal(18,2))
  - is_closed Boolean
  - tx_timestamp DateTime
  - realized_pnl_usd Float64
  - is_resolved UInt8
  - transaction_hash String
- **Partitioning**: BY toYYYYMM(timestamp)
- **Sorting**: (wallet_address, timestamp)
- **Indexes**: None explicitly defined
- **Sample Query**:
  ```sql
  SELECT wallet_address, COUNT(*) as trades, SUM(usd_value) as volume
  FROM trades_raw
  WHERE timestamp >= now() - interval 30 day
  GROUP BY wallet_address
  ORDER BY volume DESC
  LIMIT 10
  ```

#### elite_trade_attributions
- **Type**: Table (MergeTree)
- **Wallet Columns**:
  - `wallet_address` (String) - [SORTED]
- **Purpose**: Track elite wallet activity in watchlist markets
- **Estimated Row Count**: ~500K+ elite trades
- **Key Fields**:
  - trade_id String
  - market_id String
  - side Enum8 (BUY/SELL)
  - size_usd Decimal(18,2)
  - is_elite Boolean
  - elite_omega_score Nullable(Decimal(10,4))
  - timestamp DateTime [PARTITION]
- **Partitioning**: BY toYYYYMM(timestamp)
- **Sorting**: (market_id, timestamp, wallet_address)
- **Indexes**: minmax on wallet_address
- **Sample Query**:
  ```sql
  SELECT wallet_address, COUNT(*) as elite_trades, AVG(size_usd) as avg_size
  FROM elite_trade_attributions
  WHERE is_elite = 1
  GROUP BY wallet_address
  ORDER BY elite_trades DESC
  LIMIT 5
  ```

#### pm_trades
- **Type**: Table (ReplacingMergeTree)
- **Wallet Columns**:
  - `maker_address` (String) - [INDEX: bloom_filter]
  - `taker_address` (String) - [INDEX: bloom_filter]
- **Purpose**: CLOB trade fills from Polymarket API
- **Estimated Row Count**: ~50M+ fills
- **Key Fields**:
  - id String (unique trade ID)
  - market_id String
  - asset_id String (token ID)
  - side LowCardinality(String) (BUY/SELL)
  - size String
  - price Float64 (0-1 probability)
  - fee_rate_bps UInt16
  - maker_orders Array(String)
  - taker_order_id String
  - transaction_hash String
  - timestamp DateTime
  - outcome String
  - question String
  - size_usd Float64
  - maker_fee_usd Float64
  - taker_fee_usd Float64
- **Partitioning**: BY toYYYYMM(timestamp)
- **Sorting**: (market_id, timestamp, id)
- **Indexes**: 
  - bloom_filter on maker_address
  - bloom_filter on taker_address
- **Sample Query**:
  ```sql
  SELECT maker_address, COUNT(*) as maker_trades, SUM(size_usd) as maker_volume
  FROM pm_trades
  WHERE timestamp >= now() - interval 30 day
  GROUP BY maker_address
  ORDER BY maker_volume DESC
  LIMIT 5
  ```

#### pm_trades_external
- **Type**: Table (ReplacingMergeTree)
- **Wallet Columns**:
  - `wallet_address` (String) - [INDEX: bloom_filter]
  - `operator_address` (String)
- **Purpose**: External trade data (Data API, Subgraph, AMM)
- **Estimated Row Count**: ~20M+ trades
- **Key Fields**:
  - fill_id String
  - block_time DateTime
  - block_number UInt64
  - tx_hash String
  - asset_id_decimal String
  - condition_id String
  - outcome_index UInt8
  - outcome_label String
  - question String
  - side LowCardinality(String) (BUY/SELL)
  - price Float64
  - shares Float64
  - collateral_amount Float64
  - fee_amount Float64
  - data_source LowCardinality(String) (data_api, subgraph, dune, amm)
  - is_proxy_trade UInt8
- **Partitioning**: BY toYYYYMM(block_time)
- **Sorting**: (condition_id, wallet_address, block_time, fill_id)
- **Indexes**:
  - bloom_filter on wallet_address
  - bloom_filter on condition_id
  - bloom_filter on data_source
- **Sample Query**:
  ```sql
  SELECT wallet_address, data_source, COUNT(*) as trade_count
  FROM pm_trades_external
  WHERE block_time >= now() - interval 60 day
  GROUP BY wallet_address, data_source
  ORDER BY trade_count DESC
  ```

---

### 3. BLOCKCHAIN TRANSACTION TABLES

#### erc1155_transfers_enriched (VIEW)
- **Type**: View (materialized support via pm_erc1155_flats)
- **Wallet Columns**:
  - `from_addr` (String)
  - `to_addr` (String)
  - `from_eoa` (String) - Decoded EOA if from_addr is proxy
  - `to_eoa` (String) - Decoded EOA if to_addr is proxy
  - `operator` (String)
- **Purpose**: Flattened ERC1155 transfers with market context
- **Estimated Row Count**: ~100M+ transfers
- **Key Fields**:
  - block_number UInt64
  - block_time DateTime
  - tx_hash String
  - log_index UInt32
  - token_id String
  - amount String (hex)
  - event_type String (TransferSingle, TransferBatch)
  - market_id String
  - outcome String
  - outcome_index UInt8
  - question String
  - is_winning_outcome UInt8
  - category String
  - from_type String ('proxy' or 'direct')
  - to_type String ('proxy' or 'direct')
- **Join Pattern**: 
  - pm_erc1155_flats LEFT JOIN proxy_wallets_active (for from/to EOA mapping)
- **Sample Query**:
  ```sql
  SELECT from_addr, COUNT(*) as send_count, SUM(amount) as total_sent
  FROM erc1155_transfers_enriched
  WHERE block_time >= now() - interval 7 day
  GROUP BY from_addr
  ORDER BY total_sent DESC
  ```

#### wallet_positions_current (VIEW)
- **Type**: View (aggregated from erc1155_transfers_enriched)
- **Wallet Columns**:
  - `wallet` (String, aliased from to_addr)
- **Purpose**: Current position holdings per wallet per token
- **Estimated Row Count**: ~5M+ active positions
- **Key Fields**:
  - token_id String
  - market_id String
  - outcome String
  - total_received UINT256 (decoded from hex)
  - transfer_count UInt32
  - last_updated DateTime
- **Sample Query**:
  ```sql
  SELECT wallet, COUNT(*) as positions, SUM(total_received) as total_holdings
  FROM wallet_positions_current
  GROUP BY wallet
  ORDER BY positions DESC
  LIMIT 10
  ```

---

### 4. PROXY AND MAPPING TABLES

#### pm_user_proxy_wallets
- **Type**: Table
- **Wallet Columns**:
  - `user_eoa` (String) - [PRIMARY]
  - `proxy_wallet` (String) - [PRIMARY]
- **Purpose**: Map between EOA operators and proxy wallet contracts
- **Estimated Row Count**: ~5K+ proxy mappings
- **Key Fields**:
  - source String (approval, transfer, inference)
  - first_seen_at DateTime
  - last_seen_at DateTime
  - is_active UInt8
  - ingested_at DateTime
- **Indexes**: PRIMARY on (user_eoa, proxy_wallet)
- **Sample Query**:
  ```sql
  SELECT user_eoa, COUNT(*) as proxy_count
  FROM pm_user_proxy_wallets
  WHERE is_active = 1
  GROUP BY user_eoa
  ORDER BY proxy_count DESC
  ```

#### proxy_wallets_active (VIEW)
- **Type**: View (filtered from pm_user_proxy_wallets)
- **Wallet Columns**:
  - `user_eoa` (String)
  - `proxy_wallet` (String)
- **Purpose**: Only active proxy wallet mappings for easy joins
- **Sample Query**:
  ```sql
  SELECT * FROM proxy_wallets_active LIMIT 10
  ```

---

### 5. MATERIALIZED VIEWS

#### wallet_metrics_daily (MATERIALIZED VIEW)
- **Wallet Columns**:
  - `wallet_address` (String) - [PRIMARY, SORTED]
- **Purpose**: Daily wallet metrics aggregation
- **Engine**: SummingMergeTree
- **Partitioning**: BY toYYYYMM(date)
- **Key Fields**:
  - date Date
  - total_trades UInt32
  - wins UInt32
  - losses UInt32
  - total_pnl Decimal
  - avg_win Decimal
  - avg_loss Decimal
  - pnl_stddev Float64
  - total_volume Decimal
  - first_trade_time DateTime
  - last_trade_time DateTime
- **Sample Query**:
  ```sql
  SELECT wallet_address, date, total_pnl, total_trades
  FROM wallet_metrics_daily
  WHERE date >= toDate(now()) - 30
  ORDER BY date DESC, total_pnl DESC
  ```

#### wallet_metrics_30d (MATERIALIZED VIEW)
- **Wallet Columns**:
  - `wallet_address` (String)
- **Purpose**: Cached 30-day metrics
- **Sample Query**:
  ```sql
  SELECT * FROM wallet_metrics_30d
  ORDER BY omega_ratio DESC LIMIT 10
  ```

---

### 6. REFERENCE AND CACHE TABLES

#### condition_market_map
- **Type**: Table (ReplacingMergeTree)
- **Purpose**: Cache for condition_id → market metadata lookups
- **Estimated Row Count**: ~10K+ market mappings
- **Key Fields**:
  - condition_id String - [PRIMARY, bloom_filter index]
  - market_id String - [bloom_filter index]
  - event_id String
  - canonical_category String
  - raw_tags Array(String)
- **Sample Query**:
  ```sql
  SELECT condition_id, market_id, canonical_category
  FROM condition_market_map
  LIMIT 10
  ```

#### markets_dim
- **Type**: Table (ReplacingMergeTree)
- **Purpose**: Market dimension table
- **Key Fields**:
  - market_id String - [PRIMARY]
  - question String
  - event_id String
- **Sample Query**:
  ```sql
  SELECT * FROM markets_dim LIMIT 5
  ```

#### events_dim
- **Type**: Table (ReplacingMergeTree)
- **Purpose**: Event dimension table with categories
- **Estimated Row Count**: ~1K+ events
- **Key Fields**:
  - event_id String - [PRIMARY]
  - canonical_category String - [bloom_filter index]
  - raw_tags Array(String)
  - title String
- **Sample Query**:
  ```sql
  SELECT event_id, canonical_category, COUNT(*) as markets
  FROM events_dim
  GROUP BY event_id, canonical_category
  ```

---

## WALLET FIELD STANDARDIZATION INVENTORY

### Field Name Frequency

| Field Name | Count | Primary Use | Type |
|-----------|-------|-----------|------|
| `wallet_address` | 10 | Generic wallet identifier | String |
| `proxy_wallet` | 2 | Proxy contract address | String |
| `user_eoa` | 2 | Owner's EOA (from proxy) | String |
| `from_addr` | 2 | ERC1155 sender | String |
| `to_addr` | 2 | ERC1155 recipient | String |
| `maker_address` | 1 | CLOB order maker | String |
| `taker_address` | 1 | CLOB order taker | String |
| `from_eoa` | 1 | Decoded maker EOA | String |
| `to_eoa` | 1 | Decoded recipient EOA | String |
| `operator_address` | 1 | Transaction operator | String |
| `operator` | 1 | Event operator | String |

### Canonicalization Challenges

1. **Case Sensitivity**: Ethereum addresses are case-insensitive but stored as lowercase in most tables
2. **Proxy vs EOA**: Different tables track maker/taker separately or as wallet_address
3. **Format**: All stored as String, 42-character Ethereum format (0x...)
4. **Null Handling**: Some operator_address fields are nullable or empty strings

---

## INDEXES AND CONSTRAINTS SUMMARY

### Primary Keys (Composite)
- `(wallet_address)` - wallets_dim, wallet_metrics_daily
- `(wallet_address, time_window)` - wallet_metrics, wallet_metrics_complete
- `(wallet_address, condition_id)` - wallet_resolution_outcomes
- `(condition_id, wallet_address, block_time, fill_id)` - pm_trades_external
- `(market_id, timestamp, wallet_address)` - elite_trade_attributions
- `(user_eoa, proxy_wallet)` - pm_user_proxy_wallets

### Bloom Filters (Fast Lookups)
- `wallet_address` - pm_trades_external, pm_trades (maker/taker)
- `condition_id` - pm_trades_external
- `data_source` - pm_trades_external
- `maker_address`, `taker_address` - pm_trades
- `market_id` - ctf_token_map
- `condition_id_norm` - ctf_token_map

### MinMax Indexes (Range Queries)
- `omega_net` - wallet_metrics_complete
- `ev_per_hour_capital` - wallet_metrics_complete
- `resolved_bets` - wallet_metrics_complete
- `wallet_address` - elite_trade_attributions

---

## DATA DISTRIBUTION ESTIMATES

| Table | Estimated Rows | Primary Wallet Field | Growth Rate |
|-------|---------------|--------------------|------------|
| wallets_dim | 50K | wallet_address | ~100/day |
| wallet_metrics | 200K | wallet_address | ~400/day (4 windows) |
| wallet_metrics_complete | 200K | wallet_address | ~400/day (4 windows) |
| wallet_resolution_outcomes | 5M | wallet_address | ~10K/day |
| trades_raw | 10M | wallet_address | ~20K/day |
| pm_trades | 50M | maker/taker_address | ~50K/day |
| pm_trades_external | 20M | wallet_address | ~10K/day |
| erc1155_transfers_enriched | 100M | from_addr, to_addr | ~50K/day |
| pm_user_proxy_wallets | 5K | user_eoa, proxy_wallet | ~10/day |
| elite_trade_attributions | 500K | wallet_address | ~1K/day |

---

## SAMPLE QUERIES FOR WALLET CANONICALIZATION

### 1. Find All Wallet Addresses Across System
```sql
SELECT DISTINCT wallet_address FROM wallets_dim
UNION DISTINCT
SELECT DISTINCT wallet_address FROM wallet_metrics
UNION DISTINCT
SELECT DISTINCT wallet_address FROM trades_raw
UNION DISTINCT
SELECT DISTINCT maker_address FROM pm_trades
UNION DISTINCT
SELECT DISTINCT taker_address FROM pm_trades
UNION DISTINCT
SELECT DISTINCT from_addr FROM erc1155_transfers_enriched
UNION DISTINCT
SELECT DISTINCT to_addr FROM erc1155_transfers_enriched
```

### 2. Map Proxies to EOAs
```sql
SELECT 
  user_eoa,
  arrayJoin(groupArray(proxy_wallet)) as proxy_wallet,
  COUNT(*) as activity_count
FROM pm_user_proxy_wallets
WHERE is_active = 1
GROUP BY user_eoa
ORDER BY activity_count DESC
```

### 3. Wallet Activity Across All Sources
```sql
SELECT 
  'trades_raw' as source,
  wallet_address,
  COUNT(*) as event_count,
  'wallet_address' as field_name
FROM trades_raw
GROUP BY wallet_address

UNION ALL

SELECT 
  'pm_trades_maker' as source,
  maker_address,
  COUNT(*),
  'maker_address'
FROM pm_trades
GROUP BY maker_address

UNION ALL

SELECT 
  'pm_trades_taker' as source,
  taker_address,
  COUNT(),
  'taker_address'
FROM pm_trades
GROUP BY taker_address
```

---

## CANONICALIZATION ACTION PLAN

### Phase 1: Inventory & Mapping
1. Create canonical_wallet_addresses table with:
   - normalized_address (standard format)
   - addresses_seen (array of all variations)
   - primary_eoa (if proxy relationship exists)
   - first_seen, last_seen timestamps
   - status (active/inactive)

2. Build mappings:
   - wallet_address → canonical
   - maker/taker_address → canonical
   - from/to_addr → canonical
   - user_eoa / proxy_wallet → canonical

### Phase 2: Standardize Primary Tables
1. Update wallets_dim with canonical_address column
2. Create view: wallets_canonical (using updated wallets_dim)
3. Update queries in API endpoints to use canonical addresses

### Phase 3: Update Trade Tables
1. Add canonical_wallet_address column to pm_trades (maker/taker)
2. Add canonical_wallet_address column to trades_raw
3. Create indexes on canonical fields for fast lookups

### Phase 4: Backfill & Validation
1. Backfill historical data with canonical addresses
2. Validate join consistency across tables
3. Update all downstream views and reports

---

**Report Generated**: 2025-11-16
**Status**: Exploration Complete
**Next Step**: Implement wallet canonicalization according to Phase 1-4 plan

