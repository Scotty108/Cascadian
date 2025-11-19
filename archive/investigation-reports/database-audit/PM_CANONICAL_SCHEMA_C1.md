# Polymarket Canonical Schema (C1)

**Status:** Implementation-Ready
**Created:** 2025-11-15
**Approach:** CLOB-First with Dual-ID-System Support
**Terminal:** Claude 2

---

## Overview

This document defines the canonical schema for Polymarket analytics in the Cascadian platform. The schema is designed around the **two-ID-system architecture**:

1. **CLOB/Gamma Asset IDs** (decimal strings, 76-78 chars) - PRIMARY for all analytics
2. **ERC-1155 Token IDs** (hex strings, 64 chars) - AUDIT ONLY, limited coverage

The canonical anchor that bridges both systems is:
- `condition_id` (hex, 64 chars, normalized: lowercase, no `0x` prefix)
- `outcome_index` (0-based integer)

---

## Design Principles

1. **CLOB-First:** All analytics use CLOB/Gamma data as source of truth (100% coverage)
2. **Streaming-Friendly:** Views work with continuously ingested base tables
3. **Non-Destructive:** Build new views alongside existing tables
4. **Explicit Normalization:** All IDs follow strict normalization rules
5. **Proxy-Aware:** Track both direct wallets and proxy operators

---

## ID Normalization Rules

### condition_id
- **Format:** Hex string, 64 characters
- **Normalization:** `lower(replaceAll(raw_value, '0x', ''))`
- **Example:** `0x1234...abcd` → `1234...abcd`
- **Source:** CTF (Conditional Token Framework) smart contract

### asset_id_decimal
- **Format:** Decimal string, 76-78 characters
- **Normalization:** None (stored as-is from CLOB)
- **Example:** `21742633143463906290569050155826241533067272736897614950488156847949938836455`
- **Source:** Polymarket CLOB (Gamma backend)

### erc1155_token_id_hex
- **Format:** Hex string, 64 characters
- **Normalization:** `lower(replaceAll(raw_value, '0x', ''))`
- **Example:** `0xabcd...1234` → `abcd...1234`
- **Source:** ERC-1155 smart contract events
- **Coverage:** 6.5% via `legacy_token_condition_map`

### wallet_address
- **Format:** Ethereum address, 42 characters (with `0x`) or 40 characters (without)
- **Normalization:** `lower(raw_value)` (keep `0x` prefix)
- **Example:** `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`

### outcome_index
- **Format:** UInt8 (0-based)
- **Normalization:** Map text labels to integers:
  - `Yes`, `YES`, `0` → `0`
  - `No`, `NO`, `1` → `1`
  - Otherwise: `toUInt8OrZero(outcome)`
- **Source:** Derived from `ctf_token_map.outcome`

---

## Core Views/Tables

### 1. pm_asset_token_map (VIEW) - CLOB Asset Mapping

**Purpose:** PRIMARY mapping from CLOB asset IDs to canonical condition IDs
**Coverage:** 100% of CLOB/Gamma markets
**Source:** `ctf_token_map`
**Type:** VIEW (queries source directly, no materialization)

**Schema:**
```sql
CREATE VIEW pm_asset_token_map AS
SELECT
  -- Asset Identification (CLOB/Gamma world)
  token_id as asset_id_decimal,              -- String, 76-78 chars

  -- Canonical Anchors
  condition_id_norm as condition_id,         -- String, 64 chars (normalized hex)

  -- Outcome Mapping
  multiIf(
    outcome IN ('0', 'Yes', 'YES'), 0,
    outcome IN ('1', 'No', 'NO'), 1,
    toUInt8OrZero(outcome)
  ) as outcome_index,                        -- UInt8, 0-based

  outcome as outcome_label,                  -- String, original label

  -- Metadata
  question,                                  -- String, market question
  outcomes_json,                             -- String, JSON array of all outcomes

  -- Market Linkage
  '' as market_slug,                         -- String (can enrich from api_ctf_bridge)

  -- Source Tracking
  'ctf_token_map' as mapping_source,         -- String
  100 as mapping_confidence                  -- UInt8, 0-100 (max for canonical)

FROM ctf_token_map
WHERE condition_id_norm != ''
  AND token_id != ''
  AND token_id != '0';
```

**Key Columns:**

| Column | Type | Description |
|--------|------|-------------|
| `asset_id_decimal` | String | CLOB asset ID (decimal, 76-78 chars) |
| `condition_id` | String | Normalized condition ID (hex, 64 chars) |
| `outcome_index` | UInt8 | 0-based outcome index |
| `outcome_label` | String | Original outcome text ("Yes", "No", etc.) |
| `question` | String | Market question |
| `outcomes_json` | String | JSON array of all outcomes |
| `market_slug` | String | Market slug (empty, can enrich) |
| `mapping_source` | String | Always "ctf_token_map" |
| `mapping_confidence` | UInt8 | Always 100 |

**Usage:**
- Join CLOB fills to this view using `asset_id`
- Primary source for all PnL calculations
- 139,140 assets mapped (100% coverage)

**Created:** `scripts/77b-create-pm-asset-token-map-view.ts`

---

### 2. pm_erc1155_token_map_hex (TABLE) - ERC-1155 Hex Mapping

**Purpose:** AUDIT-ONLY mapping from ERC-1155 hex tokens to condition IDs
**Coverage:** 6.5% of on-chain ERC-1155 tokens
**Source:** `legacy_token_condition_map`
**Type:** TABLE (ReplacingMergeTree)

**Schema:**
```sql
CREATE TABLE pm_erc1155_token_map_hex (
  -- Token Identification (On-Chain ERC-1155)
  erc1155_token_id_hex    String,        -- Hex, 64 chars (normalized: no 0x, lowercase)

  -- Canonical Anchors
  condition_id            String,        -- Hex, 64 chars (normalized)
  outcome_index           UInt8,         -- 0 for legacy 1:1 mapping (unknown outcome)
  outcome_label           String,        -- Empty for legacy data

  -- Metadata
  question                String,        -- Market question (if available)
  market_slug             String,        -- Market slug (if available)

  -- Event Metadata (for debugging and temporal analysis)
  first_seen_block        UInt64,        -- First block where this token appeared
  first_seen_timestamp    DateTime,      -- Timestamp of first appearance
  first_seen_tx           String,        -- Transaction hash of first appearance

  -- Source Tracking
  mapping_source          String,        -- 'legacy_token_condition_map'
  mapping_confidence      UInt8,         -- 0-100, higher = more reliable (90 for legacy)

  -- Housekeeping
  created_at              DateTime DEFAULT now(),
  updated_at              DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (erc1155_token_id_hex, condition_id);
```

**Key Columns:**

| Column | Type | Description |
|--------|------|-------------|
| `erc1155_token_id_hex` | String | ERC-1155 token ID (hex, 64 chars) |
| `condition_id` | String | Normalized condition ID (hex, 64 chars) |
| `outcome_index` | UInt8 | Always 0 (legacy uses 1:1 token=condition) |
| `outcome_label` | String | Always empty (no outcome differentiation) |
| `question` | String | Market question |
| `market_slug` | String | Market slug |
| `first_seen_block` | UInt64 | First block appearance |
| `first_seen_timestamp` | DateTime | First timestamp |
| `first_seen_tx` | String | First transaction hash |
| `mapping_source` | String | Always "legacy_token_condition_map" |
| `mapping_confidence` | UInt8 | Always 90 |

**Usage:**
- AUDIT ONLY: Cross-check on-chain transfers against CLOB data
- Limited coverage: 17,136 tokens (6.5% of erc1155_transfers)
- NOT suitable for primary analytics or PnL calculations

**Limitations:**
- Only covers legacy markets
- 1:1 token=condition mapping (no outcome differentiation)
- No comprehensive blockchain verification possible

**Created:** `scripts/78-create-pm-erc1155-token-map-hex.ts`

---

### 3. pm_trades (VIEW) - Canonical Trades

**Purpose:** Canonical trade events with standardized schema
**Coverage:** 100% of CLOB fills
**Source:** CLOB fills table (e.g., `clob_fills`)
**Type:** VIEW

**Schema (To Be Implemented):**
```sql
CREATE VIEW pm_trades AS
SELECT
  -- Event Identification
  fill_id,                                   -- String, unique fill ID from CLOB
  block_time,                                -- DateTime, when trade occurred
  block_number,                              -- UInt64, block number
  tx_hash,                                   -- String, transaction hash

  -- Asset & Market (CLOB IDs)
  asset_id_decimal,                          -- String, CLOB asset ID (76-78 chars)

  -- Canonical Anchors (via pm_asset_token_map)
  condition_id,                              -- String, condition ID (64 chars)
  outcome_index,                             -- UInt8, 0-based outcome index
  outcome_label,                             -- String, "Yes", "No", etc.
  question,                                  -- String, market question

  -- Wallet Information
  wallet_address,                            -- String, direct wallet (normalized)
  operator_address,                          -- String, proxy operator if applicable
  is_proxy_trade,                            -- UInt8, 1 if operator != wallet

  -- Trade Details
  side,                                      -- String, 'BUY' or 'SELL'
  price,                                     -- Float64, price per share (0-1)
  shares,                                    -- Float64, number of shares
  collateral_amount,                         -- Float64, USDC amount (shares * price)
  fee_amount,                                -- Float64, trading fee in USDC

  -- Source Tracking
  data_source                                -- String, 'clob_fills'

FROM clob_fills cf
INNER JOIN pm_asset_token_map atm
  ON cf.asset_id = atm.asset_id_decimal
WHERE cf.fill_id IS NOT NULL
  AND cf.asset_id IS NOT NULL;
```

**Key Columns:**

| Column | Type | Description |
|--------|------|-------------|
| `fill_id` | String | Unique CLOB fill identifier |
| `block_time` | DateTime | Trade timestamp |
| `block_number` | UInt64 | Block number |
| `tx_hash` | String | Transaction hash |
| `asset_id_decimal` | String | CLOB asset ID |
| `condition_id` | String | Canonical condition ID |
| `outcome_index` | UInt8 | Outcome index (0-based) |
| `outcome_label` | String | Outcome label text |
| `question` | String | Market question |
| `wallet_address` | String | Direct wallet address |
| `operator_address` | String | Proxy operator (if applicable) |
| `is_proxy_trade` | UInt8 | 1 if proxy, 0 if direct |
| `side` | String | 'BUY' or 'SELL' |
| `price` | Float64 | Price per share (0-1 range) |
| `shares` | Float64 | Number of shares traded |
| `collateral_amount` | Float64 | USDC amount |
| `fee_amount` | Float64 | Trading fee |
| `data_source` | String | Always 'clob_fills' |

**Usage:**
- Primary source for all trade analytics
- Foundation for PnL calculations
- Smart money tracking
- Market volume analysis

**Notes:**
- Uses `asset_id_decimal` from `pm_asset_token_map` (CLOB-first)
- Includes proxy-wallet tracking (`is_proxy_trade`, `operator_address`)
- All monetary amounts in USDC

**To Be Implemented:** Task K (`scripts/80-build-pm-trades-view.ts`)

---

### 4. pm_markets (VIEW) - Canonical Markets

**Purpose:** One row per outcome token (market + outcome combination)
**Coverage:** 100% of Gamma markets
**Source:** `gamma_markets`, `gamma_resolved`, `pm_asset_token_map`
**Type:** VIEW

**Schema (To Be Implemented):**
```sql
CREATE VIEW pm_markets AS
SELECT
  -- Canonical Anchors
  condition_id,                              -- String, condition ID (64 chars)
  outcome_index,                             -- UInt8, 0-based outcome index

  -- Market Identification
  market_slug,                               -- String, Polymarket market slug
  question,                                  -- String, market question
  outcome_label,                             -- String, "Yes", "No", etc.

  -- Market Metadata
  outcomes_json,                             -- String, JSON array of all outcomes
  total_outcomes,                            -- UInt8, number of outcomes
  market_type,                               -- String, 'binary', 'categorical', etc.

  -- Status
  status,                                    -- String, 'open', 'resolved', 'closed'
  resolved_at,                               -- DateTime, resolution timestamp (if resolved)
  winning_outcome_index,                     -- UInt8, winning outcome (if resolved)
  is_winning_outcome,                        -- UInt8, 1 if this outcome won

  -- Enrichment (optional)
  description,                               -- String, market description
  category,                                  -- String, market category
  end_date,                                  -- DateTime, market end date

  -- Source Tracking
  data_source                                -- String, 'gamma_markets'

FROM pm_asset_token_map atm
LEFT JOIN gamma_markets gm
  ON atm.condition_id = gm.condition_id_norm
LEFT JOIN gamma_resolved gr
  ON atm.condition_id = gr.condition_id
WHERE atm.condition_id IS NOT NULL;
```

**Key Columns:**

| Column | Type | Description |
|--------|------|-------------|
| `condition_id` | String | Canonical condition ID |
| `outcome_index` | UInt8 | 0-based outcome index |
| `market_slug` | String | Polymarket market slug |
| `question` | String | Market question |
| `outcome_label` | String | Outcome text |
| `outcomes_json` | String | JSON array of all outcomes |
| `total_outcomes` | UInt8 | Number of outcomes |
| `market_type` | String | Market type |
| `status` | String | 'open', 'resolved', 'closed' |
| `resolved_at` | DateTime | Resolution timestamp |
| `winning_outcome_index` | UInt8 | Winning outcome (if resolved) |
| `is_winning_outcome` | UInt8 | 1 if this outcome won |
| `description` | String | Market description |
| `category` | String | Market category |
| `end_date` | DateTime | Market end date |
| `data_source` | String | Always 'gamma_markets' |

**Usage:**
- Join to `pm_trades` on `condition_id` + `outcome_index`
- Filter markets by status, category, date
- Determine winning outcomes for PnL calculations
- Market discovery and search

**Notes:**
- **One row per outcome token**, not per market (e.g., binary market = 2 rows)
- `is_winning_outcome` simplifies PnL queries (no need to compare indices)
- `winning_outcome_index` is NULL for unresolved markets

**To Be Implemented:** Task L (`scripts/82-build-pm-markets-view.ts`)

---

### 5. pm_ctf_events (VIEW) - On-Chain CTF Events

**Purpose:** ERC-1155 transfer events for audit and verification
**Coverage:** 100% of on-chain ERC-1155 transfers
**Source:** `erc1155_transfers`
**Type:** VIEW

**Schema (Conceptual - Future Work):**
```sql
CREATE VIEW pm_ctf_events AS
SELECT
  -- Event Identification
  tx_hash,                                   -- String, transaction hash
  block_number,                              -- UInt64, block number
  block_timestamp,                           -- DateTime, block timestamp
  log_index,                                 -- UInt64, log index within transaction

  -- Token & Transfer
  erc1155_token_id_hex,                      -- String, hex token ID (64 chars, normalized)
  from_address,                              -- String, sender address (normalized)
  to_address,                                -- String, receiver address (normalized)
  value,                                     -- UInt256, number of tokens transferred

  -- Canonical Bridge (via pm_erc1155_token_map_hex)
  condition_id,                              -- String (nullable), condition ID if mapped
  outcome_index,                             -- UInt8 (nullable), outcome index if mapped
  mapping_coverage_status,                   -- String, 'mapped' or 'unmapped'

  -- Source Tracking
  data_source                                -- String, 'erc1155_transfers'

FROM erc1155_transfers et
LEFT JOIN pm_erc1155_token_map_hex htm
  ON lower(replaceAll(et.token_id, '0x', '')) = htm.erc1155_token_id_hex;
```

**Key Columns:**

| Column | Type | Description |
|--------|------|-------------|
| `tx_hash` | String | Transaction hash |
| `block_number` | UInt64 | Block number |
| `block_timestamp` | DateTime | Block timestamp |
| `log_index` | UInt64 | Log index |
| `erc1155_token_id_hex` | String | Hex token ID (normalized) |
| `from_address` | String | Sender address |
| `to_address` | String | Receiver address |
| `value` | UInt256 | Tokens transferred |
| `condition_id` | String | Condition ID (nullable, 6.5% mapped) |
| `outcome_index` | UInt8 | Outcome index (nullable) |
| `mapping_coverage_status` | String | 'mapped' or 'unmapped' |
| `data_source` | String | Always 'erc1155_transfers' |

**Usage:**
- AUDIT ONLY: Verify CLOB fills against on-chain events
- Detect discrepancies between CLOB and blockchain
- Track settlement/redemption events

**Limitations:**
- Only 6.5% of tokens can be mapped to `condition_id`
- Not suitable for primary analytics (use `pm_trades` instead)
- Comprehensive blockchain verification not possible with current data

**To Be Implemented:** Future work (out of scope for C1)

---

### 6. pm_users (TABLE) - User/Wallet Metadata

**Purpose:** Wallet metadata, labels, proxy relationships
**Coverage:** All wallets in system (CLOB + on-chain)
**Source:** To be built from wallet analytics
**Type:** TABLE (ReplacingMergeTree)

**Schema (Conceptual - Future Work):**
```sql
CREATE TABLE pm_users (
  -- Wallet Identification
  wallet_address           String,          -- Normalized wallet address (primary key)

  -- Wallet Type
  wallet_type              String,          -- 'direct', 'proxy', 'contract', 'system'
  is_proxy                 UInt8,           -- 1 if this is a known proxy contract

  -- Proxy Relationships
  proxy_operator_address   String,          -- Operator address if wallet is a proxy
  proxy_wallets            Array(String),   -- List of proxy wallets this operator controls

  -- Labels & Metadata
  wallet_label             String,          -- Optional label ('Smart Money Whale', etc.)
  ens_name                 String,          -- ENS name if resolved
  first_seen               DateTime,        -- First appearance in system
  last_active              DateTime,        -- Most recent trade/transfer

  -- Smart Money Metrics
  is_smart_money           UInt8,           -- 1 if meets smart money criteria
  win_rate                 Float64,         -- Win rate (0-1)
  total_pnl                Float64,         -- Lifetime PnL in USDC
  total_volume             Float64,         -- Lifetime volume in USDC
  sharpe_ratio             Float64,         -- Risk-adjusted returns

  -- Activity Stats
  total_trades             UInt64,          -- Number of trades
  total_markets            UInt64,          -- Number of unique markets traded
  avg_position_size        Float64,         -- Average position size in USDC

  -- Housekeeping
  created_at               DateTime DEFAULT now(),
  updated_at               DateTime DEFAULT now()

) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY wallet_address;
```

**Key Columns:**

| Column | Type | Description |
|--------|------|-------------|
| `wallet_address` | String | Normalized wallet address |
| `wallet_type` | String | 'direct', 'proxy', 'contract', 'system' |
| `is_proxy` | UInt8 | 1 if proxy contract |
| `proxy_operator_address` | String | Operator if wallet is proxy |
| `proxy_wallets` | Array(String) | Proxies controlled by this operator |
| `wallet_label` | String | Optional label |
| `ens_name` | String | ENS name |
| `first_seen` | DateTime | First appearance |
| `last_active` | DateTime | Most recent activity |
| `is_smart_money` | UInt8 | 1 if smart money |
| `win_rate` | Float64 | Win rate |
| `total_pnl` | Float64 | Lifetime PnL |
| `total_volume` | Float64 | Lifetime volume |
| `sharpe_ratio` | Float64 | Risk-adjusted returns |
| `total_trades` | UInt64 | Number of trades |
| `total_markets` | UInt64 | Markets traded |
| `avg_position_size` | Float64 | Average position size |

**Usage:**
- Join to `pm_trades` on `wallet_address`
- Filter smart money wallets for copy trading
- Resolve proxy relationships
- Track wallet performance over time

**Notes:**
- **Proxy-aware:** Tracks both proxy contracts and their operators
- **From Track B findings:** Use direct wallet attribution with optional proxy metadata
- Metrics updated via periodic aggregation jobs

**To Be Implemented:** Future work (out of scope for C1)

---

### 7. pm_wallet_market_pnl_resolved (VIEW) - P&L Analytics

**Purpose:** Wallet-level P&L aggregation for resolved markets
**Coverage:** All resolved binary markets from CLOB
**Source:** `pm_trades` ⟕ `pm_markets`
**Type:** VIEW
**Specification:** See `PM_PNL_SPEC_C1.md` for complete mathematical definitions

**Schema:**
```sql
CREATE VIEW pm_wallet_market_pnl_resolved AS
SELECT
  -- Grouping Keys
  wallet_address,                            -- String, wallet address
  condition_id,                              -- String, condition ID (64 chars)
  outcome_index,                             -- UInt8, 0-based outcome index
  outcome_label,                             -- String, "Yes", "No", etc.
  question,                                  -- String, market question

  -- Trade Metrics
  total_trades,                              -- UInt64, COUNT(*)
  total_shares,                              -- Float64, SUM(ABS(shares))
  net_shares,                                -- Float64, SUM(signed_shares)
  avg_price,                                 -- Float64, weighted average price

  -- Notional Metrics
  gross_notional,                            -- Float64, SUM(ABS(shares) * price)
  net_notional,                              -- Float64, SUM(signed_shares * price)

  -- P&L Metrics
  fees_paid,                                 -- Float64, SUM(fee_amount)
  pnl_gross,                                 -- Float64, SUM(signed_shares * (payout - price))
  pnl_net,                                   -- Float64, pnl_gross - fees_paid

  -- Market Context
  resolved_at,                               -- DateTime, resolution timestamp
  winning_outcome_index,                     -- UInt8, winning outcome
  is_winning_outcome,                        -- UInt8, 1 if this outcome won

  -- Source Tracking
  data_source                                -- String, 'pm_trades_v1'

FROM pm_trades t
INNER JOIN pm_markets m
  ON t.condition_id = m.condition_id
  AND t.outcome_index = m.outcome_index
WHERE m.status = 'resolved'
  AND m.market_type = 'binary'
GROUP BY
  wallet_address,
  condition_id,
  outcome_index,
  outcome_label,
  question,
  resolved_at,
  winning_outcome_index,
  is_winning_outcome;
```

**Key Formulas (from PM_PNL_SPEC_C1.md):**
```
signed_shares = CASE
  WHEN side = 'BUY'  THEN +shares
  WHEN side = 'SELL' THEN -shares
END

payout_per_share = CASE
  WHEN is_winning_outcome = 1 THEN 1.0
  WHEN is_winning_outcome = 0 THEN 0.0
END

pnl_trade = signed_shares * (payout_per_share - price)
pnl_net = pnl_trade - fee_amount
```

**Key Columns:**

| Column | Type | Description |
|--------|------|-------------|
| `wallet_address` | String | Wallet address (grouping key) |
| `condition_id` | String | Market condition ID (grouping key) |
| `outcome_index` | UInt8 | Outcome index (grouping key) |
| `total_trades` | UInt64 | Number of trades for this position |
| `net_shares` | Float64 | Net position (+long, -short, 0=flat) |
| `avg_price` | Float64 | Weighted average entry price |
| `gross_notional` | Float64 | Total capital deployed |
| `net_notional` | Float64 | Net capital (can be negative for shorts) |
| `fees_paid` | Float64 | Total trading fees paid |
| `pnl_gross` | Float64 | P&L before fees |
| `pnl_net` | Float64 | P&L after fees (final metric) |
| `is_winning_outcome` | UInt8 | 1 if this outcome won |

**Usage:**
- Wallet leaderboards (ORDER BY pnl_net DESC)
- Smart money identification (wallets with consistently high pnl_net)
- Market analysis (which markets had most profit/loss)
- Win rate calculation (COUNT(DISTINCT condition_id WHERE pnl_net > 0))

**Constraints (V1):**
- ❌ Only resolved markets (`status = 'resolved'`)
- ❌ Only binary markets (`market_type = 'binary'`)
- ❌ No unrealized P&L (open positions excluded)
- ❌ No categorical markets (>2 outcomes)

**To Be Implemented:** Task P2 (`scripts/90-build-pm_wallet_market_pnl_resolved_view.ts`)

---

## Proxy Wallet Decision (from Track B)

**Track B Investigation Findings:**
- xcnstrategy wallet operates through proxy contracts
- API attributes trades to proxy wallets
- ClickHouse data also uses proxy wallets

**Canonical Decision:**
- **Store proxy wallet as `wallet_address`** (matches CLOB data)
- **Store operator as `operator_address`** (supplementary)
- **Add `is_proxy_trade` flag** to indicate proxy vs direct trades
- **Join on `wallet_address`** for maximum coverage (matches both systems)
- **Use `pm_users` table** to resolve proxy → operator relationships

**Rationale:**
1. Consistency with source data (CLOB uses proxy addresses)
2. Avoids data loss from missing proxy mappings
3. Enables both proxy-aware and proxy-agnostic queries
4. Supports gradual enrichment of proxy relationships

---

## Join Patterns

### Primary Join: pm_trades ⟕ pm_markets
```sql
SELECT
  t.fill_id,
  t.wallet_address,
  t.side,
  t.price,
  t.shares,
  m.question,
  m.status,
  m.is_winning_outcome
FROM pm_trades t
INNER JOIN pm_markets m
  ON t.condition_id = m.condition_id
  AND t.outcome_index = m.outcome_index
WHERE t.block_time >= '2024-01-01'
  AND m.status = 'resolved';
```

### Smart Money Filter: pm_trades ⟕ pm_users
```sql
SELECT
  t.fill_id,
  t.wallet_address,
  u.wallet_label,
  u.win_rate,
  t.price,
  t.shares
FROM pm_trades t
INNER JOIN pm_users u
  ON t.wallet_address = u.wallet_address
WHERE u.is_smart_money = 1
  AND t.block_time >= '2024-11-01';
```

### Audit: pm_trades vs pm_ctf_events (limited coverage)
```sql
SELECT
  t.fill_id,
  t.wallet_address,
  t.shares as clob_shares,
  e.value as onchain_value,
  e.mapping_coverage_status
FROM pm_trades t
LEFT JOIN pm_ctf_events e
  ON t.condition_id = e.condition_id
  AND t.outcome_index = e.outcome_index
  AND t.wallet_address = e.to_address
  AND abs(toUnixTimestamp(t.block_time) - toUnixTimestamp(e.block_timestamp)) < 60
WHERE e.mapping_coverage_status = 'mapped';
-- Note: This will only match ~6.5% of trades due to hex bridge coverage
```

---

## Coverage Summary

| View/Table | Coverage | Purpose | Source |
|------------|----------|---------|--------|
| `pm_asset_token_map` | 100% CLOB | PRIMARY mapping | ctf_token_map |
| `pm_erc1155_token_map_hex` | 6.5% hex | AUDIT ONLY | legacy_token_condition_map |
| `pm_trades` | 100% CLOB | Canonical trades | CLOB fills |
| `pm_markets` | 100% Gamma | Market metadata | gamma_markets |
| `pm_wallet_market_pnl_resolved` | Resolved binary | P&L analytics | pm_trades ⟕ pm_markets |
| `pm_ctf_events` | 100% on-chain | Audit/verification | erc1155_transfers |
| `pm_users` | All wallets | Wallet metadata | Derived |

---

## Implementation Notes

### Streaming-Friendly Design
All views are designed to work with continuously ingested base tables:
- No assumptions about data completeness
- Use `LEFT JOIN` for optional enrichment
- Include `data_source` column for debugging
- Support time-based filtering (`block_time >= X`)

### Non-Destructive Approach
- Build new views alongside existing tables
- Don't drop/rename existing tables (e.g., keep `clob_fills` as-is)
- Use deprecation notices in documentation
- Additive schema evolution

### Future Extensions
Possible future additions (out of scope for C1):
- `pm_positions`: Current holdings per wallet
- `pm_pnl_daily`: Daily PnL rollups
- `pm_market_stats`: Market-level aggregates
- `pm_smart_money_signals`: Smart money consensus tracking

---

## Implementation Order

**Phase 1 (Complete):**
1. ✅ `pm_asset_token_map` (VIEW) - COMPLETE
2. ✅ `pm_erc1155_token_map_hex` (TABLE) - COMPLETE

**Phase 2 (Complete - Tasks J, K, L, M):**
3. ✅ Canonical schema documentation (Task J) - COMPLETE
4. ✅ `pm_trades` (VIEW) - COMPLETE (Task K)
5. ✅ `pm_markets` (VIEW) - COMPLETE (Task L)
6. ✅ Join coverage diagnostics - COMPLETE (Task M)

**Phase 3 (Current - Tasks P1, P2, P3, P4):**
7. ✅ P&L specification (Task P1) - COMPLETE (`PM_PNL_SPEC_C1.md`)
8. 🔄 `pm_wallet_market_pnl_resolved` (VIEW) - NEXT (Task P2)
9. 🔄 P&L diagnostics - NEXT (Task P3)
10. 🔄 Fixture validation - NEXT (Task P4)

**Phase 4 (Future):**
11. `pm_users` (TABLE)
12. `pm_ctf_events` (VIEW or TABLE)
13. Additional analytics views as needed

---

## References

- **Data Coverage Report:** `DATA_COVERAGE_REPORT_C1.md`
- **Mapping Scripts:**
  - `scripts/77b-create-pm-asset-token-map-view.ts`
  - `scripts/78-create-pm-erc1155-token-map-hex.ts`
- **Coverage Report:** `scripts/79-final-mapping-coverage.ts`
- **Track B Analysis:** `TRACK_B_FINAL_ANALYSIS.md`
- **Root Cause Report:** `TASK_D_ROOT_CAUSE_REPORT.md`
- **Solution Proposal:** `TASK_D_SOLUTION_PROPOSAL.md`

---

## Key Decisions

### CLOB-First Approach
We use CLOB/Gamma data as the primary source of truth because:
1. **100% coverage** of all trading activity
2. **Authoritative** - comes directly from Polymarket's trading engine
3. **Complete metadata** - includes prices, sizes, timestamps, wallet info
4. **Already normalized** - clean, consistent format

### Two-ID-System Architecture
We acknowledge and support two separate ID systems:
1. **CLOB/Gamma (decimal):** Primary for analytics
   - `asset_id_decimal` in `pm_asset_token_map`
   - 76-78 character decimal strings
   - 100% coverage
2. **ERC-1155 (hex):** Audit-only for blockchain verification
   - `erc1155_token_id_hex` in `pm_erc1155_token_map_hex`
   - 64 character hex strings
   - 6.5% coverage (legacy markets only)

**Bridge:** Both systems link to `condition_id` (canonical anchor)

### Outcome Index Convention
- **0-based indexing** throughout the schema
- Text labels ("Yes", "No") mapped to integers (0, 1)
- Consistent with ClickHouse array indexing: `arrayElement(outcomes, outcome_index + 1)`

### Proxy Wallet Attribution
- **Store proxy wallet as primary identifier** (matches CLOB data)
- **Track operator separately** for enrichment
- **Enable both proxy-aware and proxy-agnostic queries**

---

**Document Status:** Implementation-Ready
**Last Updated:** 2025-11-15
**Next Steps:** Implement `pm_trades` view (Task K)

---

**Terminal:** Claude 2
