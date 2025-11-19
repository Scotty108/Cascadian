# CASCADIAN DATA TRANSFORMATION & MAPPING LOGIC - Complete Documentation

**Created:** November 7, 2025  
**Status:** Comprehensive catalog of all data pipelines, normalization, and transformation logic  
**Scope:** Source data → ClickHouse tables → Aggregation views

---

## TABLE OF CONTENTS

1. [Normalization Patterns](#normalization-patterns)
2. [Field Transformations](#field-transformations)
3. [Data Source Chains](#data-source-chains)
4. [Mapping Tables & Bridges](#mapping-tables--bridges)
5. [Join Patterns](#join-patterns)
6. [File Index by Purpose](#file-index-by-purpose)

---

## NORMALIZATION PATTERNS

### 1. condition_id Normalization (Stable Pattern - **IDN**)

**Pattern:** `lower(replaceAll(condition_id, '0x', ''))`

**Rules:**
- Strip `0x` prefix (if present)
- Convert to lowercase
- Expected length: 64 characters (32-byte hex)
- Store as `String` type (NOT `FixedString`)

**Implementation Locations:**

| Location | Purpose | Context |
|----------|---------|---------|
| `/scripts/run-market-id-normalization.ts` line 155 | View creation: `outcome_positions_v2` | Creates normalized condition_id_norm field |
| `/scripts/run-market-id-normalization.ts` line 188 | View creation: `trade_cashflows_v3` | Normalized cashflow calculations |
| `/scripts/implement-correct-settlement.ts` line 37 | Settlement rules calculation | Joins with market resolution data |
| `/scripts/delta-probes-abc.ts` lines 66, 119, 155, 169 | Multi-step PnL verification | Joins to `winning_index` and `market_resolutions_final` |
| `/scripts/build-trades-dedup-mat.ts` lines 85-98 | Deduplication materialized table | Lowercases wallet and market_id |

**Applied To:**
- `ctf_token_map.condition_id_norm` - normalized token map
- `winning_index.condition_id_norm` - normalized winning outcomes
- `market_resolutions_final.condition_id_norm` - normalized market resolutions
- Joins between all above tables

**Validation:**
```sql
-- Check for normalization issues
SELECT DISTINCT
  length(condition_id_norm) as len,
  count() as cnt
FROM ctf_token_map
GROUP BY len
-- Expected: all 64 chars (100% of rows)
```

---

### 2. Wallet Address Normalization

**Pattern:** `lower(wallet_address)` or `lower(proxy_wallet)`

**Rules:**
- Always convert to lowercase
- Strip whitespace
- Compare using lowercase consistently

**Implementation Locations:**

| Location | Purpose |
|----------|---------|
| `/scripts/build-trades-dedup-mat.ts` line 85 | Trades materialized table |
| `/scripts/run-market-id-normalization.ts` line 154 | Outcome positions view |
| `/scripts/pnl-investigation-root-cause.ts` multiple lines | Wallet aggregations |
| `/scripts/diagnostic-final-validation.ts` lines 37, 45, 74, 82 | Diagnostic queries |

**Critical:** ALL wallet joins must use lowercase normalized form

---

### 3. market_id Normalization

**Pattern:** `lower(toString(market_id))`

**Rules:**
- Store as lowercase string
- May be hex (long form) or integer (short form)
- **Issue:** Format inconsistency (HEX vs INTEGER) was causing JOIN failures
- **Solution:** Always normalize to lowercase, group by condition_id_norm (not market_id)

**Key Files:**
- `/scripts/run-market-id-normalization.ts` - Migration to remove market_id from group-by operations
- `/scripts/build-trades-dedup-mat.ts` line 86 - Normalizes market_id in materialized table

---

## FIELD TRANSFORMATIONS

### 1. Side/Direction Determination (Stable Pattern - **NDR**)

**Formula:** Infer from net flows

```typescript
// BUY: usdc_net > 0 AND token_net > 0
//   (spent USDC, received tokens)
// SELL: usdc_net < 0 AND token_net < 0
//   (received USDC, spent tokens)

const usdc_net = usdc_out - usdc_in
const token_net = tokens_in - tokens_out

if (usdc_net > 0 && token_net > 0) {
  side = 'BUY'    // or 1
} else if (usdc_net < 0 && token_net < 0) {
  side = 'SELL'   // or 2
} else {
  side = 'UNKNOWN'
}
```

**Implementation Locations:**

| Location | Purpose |
|----------|---------|
| `/scripts/step4-settlement-rules.ts` lines 101-103 | Settlement math: `sign = test.side === "BUY" ? -1 : 1` |
| `/scripts/test-settlement-rules.ts` lines 65-70 | Long settlement: buy+win=payout, buy+lose=0 |
| `/scripts/test-settlement-rules.ts` lines 73-117 | Short settlement: sell+lose=payout, sell+win=0 |
| `/scripts/test-settlement-rules.ts` lines 97-110 | PnL calculation with signed cashflows |
| `/scripts/step4-settlement-rules.ts` line 101 | Cashflow sign: `sign * price * abs_shares` |

**ClickHouse Schema:**
- `trades_raw.side` - Enum8('YES' = 1, 'NO' = 2)
- `trades_dedup_mat.side` - LowCardinality(String) storing 'BUY'/'SELL'
- `pm_trades.side` - LowCardinality(String)

---

### 2. Outcome Index Calculation & Mapping (Stable Pattern - **CAR**)

**Critical Rule:** ClickHouse arrays are 1-indexed. Always add 1 when accessing.

```sql
-- CORRECT: outcome_index is 0-based, arrayElement is 1-based
SELECT 
  arrayElement(outcomes, outcome_index + 1) as outcome_label
FROM gamma_markets m
WHERE condition_id = '...'
```

**Implementation Locations:**

| File | Line(s) | Purpose |
|------|---------|---------|
| `/scripts/enrich-token-map.ts` | 141, 216 | Maps token_id → outcome label |
| `/scripts/step5-outcome-mapping.ts` | 61 | Validates outcome at winning_index |
| `/scripts/check-outcomes-table.ts` | 31-32 | Fetches outcomes array elements |
| `/migrations/clickhouse/016_enhance_polymarket_tables.sql` | 270 | Updates ctf_token_map outcome column |

**Data Structure:**
```json
{
  "outcomes": ["YES", "NO"],           // Array is 1-indexed in ClickHouse
  "outcome_index": 0,                  // 0-based from trades
  "winning_outcome_index": 1           // 0-based result
}
```

**Validation Query:**
```sql
-- Verify outcome_index + 1 stays within bounds
SELECT
  COUNT() as total,
  SUM(IF(outcome_index + 1 > arraySize(outcomes), 1, 0)) as out_of_bounds
FROM trades_raw t
LEFT JOIN gamma_markets m ON t.condition_id = m.condition_id
```

---

### 3. Cashflow Calculation (Stable Pattern - **PNL**)

**Formula:**
```
cashflow_usd = price * shares * sign - fees - slippage
where sign = -1 for BUY, +1 for SELL
```

**Implementation:**

| File | Lines | Formula |
|------|-------|---------|
| `/scripts/run-market-id-normalization.ts` | 192-195 | `price * shares * if(side=1, -1, 1)` |
| `/scripts/step4-settlement-rules.ts` | 101-103 | `sign * price * abs_shares - fees - slippage` |
| `/scripts/test-settlement-rules.ts` | 100-103 | Unit test cashflow calculation |
| `/migrations/clickhouse/016_enhance_polymarket_tables.sql` | Line 80 | Field definition |

**ClickHouse View:**
```sql
-- From: /scripts/run-market-id-normalization.ts lines 178-201
CREATE VIEW trade_cashflows_v3 (
  wallet String,
  condition_id_norm String,
  outcome_idx Int16,
  px Float64,
  sh Float64,
  cashflow_usdc Float64
) AS
SELECT
  lower(t.wallet_address) AS wallet,
  lower(replaceAll(t.condition_id, '0x', '')) AS condition_id_norm,
  t.outcome_index AS outcome_idx,
  toFloat64(t.entry_price) AS px,
  toFloat64(t.shares) AS sh,
  round(
    toFloat64(t.entry_price) * toFloat64(t.shares) * if(t.side = 1, -1, 1),
    8
  ) AS cashflow_usdc
FROM trades_dedup_mat AS t
WHERE t.outcome_index IS NOT NULL
  AND t.condition_id IS NOT NULL
  AND t.condition_id != ''
  AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
```

---

### 4. Settlement & Realized PnL Calculation (Stable Pattern - **PNL**)

**Formula:**
```
settlement_usd = {
  if side=BUY and outcome_index == winning_index:
    shares * payout_per_share (typically 1.0)
  elif side=SELL and outcome_index != winning_index:
    shares * payout_per_share (typically 1.0)
  else:
    0
}

realized_pnl = settlement_usd + cashflow_usd
```

**Implementation:**

| File | Lines | Logic |
|------|-------|-------|
| `/scripts/step4-settlement-rules.ts` | 106-119 | Settlement logic with tests |
| `/scripts/test-settlement-rules.ts` | 62-119 | Complete settlement + PnL math |
| `/scripts/validate-exact-methodology.ts` | 58-90 | Single market validation |

**ClickHouse Payout Vector Form:**
```sql
-- From CLAUDE.md stable facts
pnl_usd = shares * (
  arrayElement(payout_numerators, winning_index + 1) / payout_denominator
) - cost_basis
```

**Example Unit Tests:**

| Test Name | Side | Price | Shares | Win? | Expected Cashflow | Expected Settlement | Expected PnL |
|-----------|------|-------|--------|------|-------------------|----------------------|--------------|
| Long-Win | BUY | $0.50 | 100 | YES (idx 0) | -51.50 | +100.00 | +48.50 |
| Long-Lose | BUY | $0.50 | 100 | NO (idx 1) | -51.50 | 0 | -51.50 |
| Short-Win | SELL | $0.50 | 100 | NO (idx 1) | +48.50 | +100.00 | +148.50 |
| Short-Lose | SELL | $0.50 | 100 | YES (idx 0) | +48.50 | 0 | +48.50 |

**Source:** `/scripts/step4-settlement-rules.ts` lines 32-85

---

### 5. Unrealized P&L Calculation

**Formula:**
```
unrealized_pnl = net_shares * current_market_price - cost_basis
```

Where:
- `net_shares` = sum of all shares (positive for longs, negative for shorts)
- `current_market_price` = latest price from market_candles_5m or API
- `cost_basis` = sum of (entry_price * shares * sign)

**Data Source:** Market candles table
- Table: `market_candles_5m`
- Fields: `market_id`, `close_price`, `timestamp`

---

## DATA SOURCE CHAINS

### Chain 1: CLOB Fills → Trades Raw → Dedup Mat

**Source:** Polymarket CLOB API  
**Endpoint:** `https://clob.polymarket.com/api/v1/trades`

**Flow:**
```
CLOB API (raw fills)
    ↓
/scripts/ingest-clob-fills.ts
    ↓ INSERT INTO
trades_raw table
    ├─ Fields from API: trader, outcome, shares, price, orderHash, timestamp, transactionHash
    ├─ Denormalized outcome field (string, not yet mapped)
    └─ No outcome_index yet
    ↓
/scripts/build-trades-dedup-mat.ts
    ├─ Deduplication via deterministic key
    ├─ Normalization: lower() wallet, market_id
    ├─ Casting: entry_price → Float64, shares → Float64
    └─ Added fields: condition_id (from join), outcome_index
    ↓ CREATE TABLE AS SELECT then RENAME
trades_dedup_mat (ReplacingMergeTree)
    ├─ Deduplicated trades
    ├─ Normalized IDs and values
    └─ Ready for PnL views
```

**Key Scripts:**
- `/scripts/ingest-clob-fills.ts` - Fetches CLOB API, inserts to trades_raw
- `/scripts/build-trades-dedup-mat.ts` - Creates deduplicated materialized table
- `/scripts/ingest-clob-fills-correct.ts` - Alternative version with corrections

---

### Chain 2: ERC1155 Transfers → Flattened → Position Tracking

**Source:** Blockchain ERC1155 TransferSingle + TransferBatch events

**Flow:**
```
Blockchain Events (via Goldsky/RPC)
    ├─ TransferSingle (single token transfer)
    ├─ TransferBatch (multiple tokens, multiple amounts)
    └─ Each has topics and data fields
    ↓
/scripts/flatten-erc1155.ts
    ├─ Decode token_id from topics[2]
    ├─ Decode amount from data
    ├─ Handle both Single and Batch events
    └─ Normalize addresses to lowercase
    ↓ INSERT INTO
pm_erc1155_flats
    ├─ block_number, block_time, tx_hash, log_index
    ├─ operator, from_addr, to_addr
    ├─ token_id (decoded), amount (decoded)
    └─ event_type: TransferSingle | TransferBatch
    ↓
/scripts/build-approval-proxies.ts (parallel)
    ├─ Extract ApprovalForAll events
    ├─ Decode user_eoa, proxy_wallet from topics
    └─ Track activation/deactivation
    ↓ INSERT INTO
pm_user_proxy_wallets
    ├─ user_eoa, proxy_wallet mapping
    ├─ source: 'onchain' | 'api'
    ├─ first_seen_block, last_seen_block
    └─ is_active: 0 | 1
    ↓
/scripts/enrich-token-map.ts (join both)
    ├─ Join pm_erc1155_flats → pm_tokenid_market_map
    ├─ Resolve token_id → condition_id, market_id, outcome_index
    └─ Add outcome label via arrayElement(outcomes, index+1)
    ↓ Final view
erc1155_transfers_enriched
    ├─ Complete position tracking with market context
    └─ Ready for wallet P&L aggregation
```

**Key Scripts:**
- `/scripts/flatten-erc1155.ts` - Decodes ERC1155 transfers
- `/scripts/build-approval-proxies.ts` - Builds proxy wallet mapping
- `/scripts/enrich-token-map.ts` - Enriches tokens with market metadata

---

### Chain 3: Market Data → Condition Map → Outcome Index Mapping

**Source 1:** Gamma API  
**Source 2:** Polymarket CLOB API  
**Source 3:** Market Resolutions (event logs or API)

**Flow:**
```
Gamma API (markets endpoint)
    ├─ market_id, condition_id
    ├─ outcomes: ["YES", "NO"] | ["0", "1", "2"]
    ├─ question, category, tags
    ├─ volume, liquidity, metadata
    └─ end_date_iso, resolution_status
    ↓ /scripts/map-tokenid-to-market.ts
    ├─ Derive token_ids from condition_id
    ├─ For each outcome, compute: keccak256(condition_id || outcome_index)
    └─ For binary: YES=0, NO=1
    ↓ INSERT INTO
ctf_token_map
    ├─ token_id (derived)
    ├─ condition_id, condition_id_norm (normalized)
    ├─ market_id, outcome_index
    └─ outcome: initially empty
    ↓
/scripts/enrich-token-map.ts (UPDATE)
    ├─ Join ctf_token_map → gamma_markets
    ├─ For each token, fetch market outcomes array
    ├─ outcome = arrayElement(outcomes, outcome_index + 1)
    └─ question = market.question
    ↓
ctf_token_map (enriched)
    ├─ outcome: "YES" | "NO" | "..." (filled)
    ├─ question: market question text
    └─ market_id: linked to gamma_markets

PARALLEL: Market Resolutions (Resolution Contract Events)
    ├─ Payload oracle answers
    ├─ winner: which outcome won
    ├─ payout_hash: merkle root of resolution
    └─ resolved_at: block timestamp
    ↓
/scripts/step5-outcome-mapping.ts
    ├─ Match winner string to outcomes array
    ├─ Resolve to winning_index (0-based)
    ├─ Validate: arrayElement(outcomes, winning_index + 1) == winner
    └─ Store in winning_index table
    ↓
winning_index table
    ├─ condition_id_norm
    ├─ winning_index: 0 | 1 | 2 | ...
    └─ resolved_at, resolver_method
    ↓
Final Join Pattern (for P&L):
    ├─ trades_dedup_mat t
    ├─ LEFT JOIN winning_index w ON t.condition_id_norm = w.condition_id_norm
    ├─ Access: arrayElement(payout_numerators, w.winning_index + 1)
    └─ PnL = shares * (payout / denom) - cost_basis
```

**Key Scripts:**
- `/scripts/map-tokenid-to-market.ts` - Builds token → market mapping
- `/scripts/enrich-token-map.ts` - Enriches with outcome labels
- `/scripts/step5-outcome-mapping.ts` - Maps resolutions to indices
- `/scripts/validate-outcome-mapping.ts` - Validates outcome mapping

---

## MAPPING TABLES & BRIDGES

### 1. condition_market_map

**Purpose:** Maps condition_id (from blockchain) to market_id (Polymarket identifier)

**Schema:**
```sql
CREATE TABLE condition_market_map (
  condition_id String,           -- Raw from contract (may have 0x prefix)
  condition_id_norm String,      -- Normalized: lower, no 0x
  market_id String,              -- Polymarket market ID
  created_at DateTime DEFAULT now()
)
```

**Creation Location:**
- Built dynamically from gamma_markets table
- No explicit migration; created on-demand by queries

**Sample Data:**
```
condition_id: 0x123abc...
condition_id_norm: 123abc...
market_id: 0x1234567890abcdef
```

**Used By:**
- Trade deduplication (`trades_dedup_mat` creation)
- Resolution joins (`winning_index` lookups)
- Position aggregation queries

---

### 2. pm_tokenid_market_map

**Purpose:** Maps token_id (ERC1155 token from blockchain) to market outcome info

**Schema:**
```sql
CREATE TABLE pm_tokenid_market_map (
  token_id String PRIMARY KEY,
  market_id String,
  outcome_index UInt8,
  outcome_label String,
  condition_id String,
  market_title String,
  source String DEFAULT 'gamma_api'
)
```

**Creation Location:**
- `/scripts/map-tokenid-to-market.ts` - Initial build from Gamma API
- `/scripts/enrich-token-map.ts` - Updates outcome_label

**Sample Data:**
```
token_id: 0xabc123...def456
market_id: 0x9876543210fedcba
outcome_index: 0
outcome_label: "YES"
condition_id: 0x123abc...
```

**Used By:**
- ERC1155 transfer enrichment
- Wallet position tracking
- Outcome resolution mapping

---

### 3. ctf_token_map

**Purpose:** Complete token metadata with market and outcome context

**Schema:**
```sql
CREATE TABLE ctf_token_map (
  token_id String,
  condition_id String,
  condition_id_norm String,
  market_id String,
  outcome String,
  outcome_index UInt8,
  question String,
  created_at DateTime DEFAULT now()
)
```

**Creation Location:**
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql` - ALTER TABLE ADD COLUMN
- `/scripts/enrich-token-map.ts` - Populates fields via UPDATE

**Enrichment Process:**
```sql
-- Step 1: Create base table (001)
CREATE TABLE ctf_token_map (
  token_id String,
  condition_id String,
  ...
)

-- Step 2: Migrate 016 adds columns
ALTER TABLE ctf_token_map ADD COLUMN market_id String
ALTER TABLE ctf_token_map ADD COLUMN outcome String
ALTER TABLE ctf_token_map ADD COLUMN outcome_index UInt8
ALTER TABLE ctf_token_map ADD COLUMN question String

-- Step 3: Enrich via UPDATE
UPDATE ctf_token_map t
SET outcome = arrayElement(m.outcomes, t.outcome_index + 1),
    market_id = m.market_id,
    question = m.question
FROM gamma_markets m
WHERE t.condition_id_norm = m.condition_id
```

**Used By:**
- Outcome mapping validation
- ERC1155 position enrichment
- Market context joins

---

### 4. winning_index

**Purpose:** Maps condition_id_norm to winning outcome index after market resolution

**Schema:**
```sql
CREATE TABLE winning_index (
  condition_id_norm String PRIMARY KEY,
  winning_index UInt8,
  resolved_at DateTime,
  resolver_method String,
  payout_hash String
)
```

**Creation Location:**
- `/scripts/step5-outcome-mapping.ts` - Parses resolutions, determines winning index
- `/migrations/clickhouse/015_create_wallet_resolution_outcomes.sql` - Migration

**Sample Data:**
```
condition_id_norm: 123abc...
winning_index: 0
resolved_at: 2024-11-05 14:30:00
resolver_method: "payloads_oracle"
payout_hash: 0xdef789...
```

**Critical Usage:**
```sql
-- In PnL calculation (arrayElement is 1-indexed!)
SELECT
  shares,
  payout_numerators,  -- e.g., [1000000, 0]
  payout_denominator, -- e.g., 1000000
  arrayElement(payout_numerators, winning_index + 1) as winning_payout,
  shares * (winning_payout / payout_denominator) - cost_basis as realized_pnl
FROM ...
WHERE condition_id_norm = w.condition_id_norm
```

---

### 5. market_resolutions_final

**Purpose:** Complete market resolution data with payout vectors

**Schema:**
```sql
CREATE TABLE market_resolutions_final (
  market_id String,
  condition_id String,
  condition_id_norm String,
  winner String,          -- Winning outcome label
  winning_index UInt8,    -- Index in outcomes array
  payout_numerators Array(UInt64),  -- [YES_payout, NO_payout]
  payout_denominator UInt64,        -- Typically 1000000
  resolved_at DateTime,
  resolution_source String,
  payout_hash String
)
```

**Creation Location:**
- Multiple scripts build this table atomically
- `/scripts/run-market-id-normalization.ts` - Uses as reference
- `/scripts/step5-outcome-mapping.ts` - Builds from resolutions

**Sample Data:**
```
market_id: 0x1234567890abcdef
condition_id: 0x123abc...
condition_id_norm: 123abc...
winner: "YES"
winning_index: 0
payout_numerators: [1000000, 0]  -- YES wins with $1 payout
payout_denominator: 1000000
```

---

## JOIN PATTERNS

### Pattern 1: Trade → Market Resolution (for PnL)

**Purpose:** Calculate realized PnL by joining trades to market resolutions

**Implementation:**
```sql
SELECT
  t.wallet_address,
  t.condition_id_norm,
  t.outcome_index,
  t.shares,
  t.entry_price,
  
  -- Resolution context
  m.winner,
  m.winning_index,
  m.payout_numerators,
  m.payout_denominator,
  
  -- PnL calculation
  t.shares * (
    arrayElement(m.payout_numerators, m.winning_index + 1) / 
    toFloat64(m.payout_denominator)
  ) - (t.entry_price * t.shares * IF(t.side=1, -1, 1)) as realized_pnl
  
FROM trades_dedup_mat t
LEFT JOIN winning_index m 
  ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
WHERE t.outcome_index IS NOT NULL
```

**Key Files:**
- `/scripts/run-market-id-normalization.ts` line 264 - Uses this join pattern
- `/scripts/delta-probes-abc.ts` multiple lines - Variant with different aggregations
- `/scripts/final-pnl-diagnostic-fixed.ts` - Production PnL query

**Critical:** Always normalize condition_id before join!

---

### Pattern 2: Position → Outcome Mapping (for current holdings)

**Purpose:** Enrich wallet positions with outcome labels

**Implementation:**
```sql
SELECT
  f.to_addr as wallet,
  f.token_id,
  f.market_id,
  t.outcome,
  t.outcome_index,
  SUM(CAST(f.amount as Float64)) as net_shares,
  MAX(f.block_time) as last_updated
  
FROM pm_erc1155_flats f
LEFT JOIN token_market_enriched t
  ON f.token_id = t.token_id
GROUP BY f.to_addr, f.token_id, f.market_id, t.outcome, t.outcome_index
```

**Key Files:**
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql` line 191 - Defines `erc1155_transfers_enriched` view
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql` line 229 - Defines `wallet_positions_current` view

---

### Pattern 3: Proxy Wallet Resolution

**Purpose:** Map observed blockchain addresses back to user EOAs

**Implementation:**
```sql
SELECT
  f.from_addr,
  p.user_eoa,
  f.token_id,
  f.amount,
  f.block_time
  
FROM pm_erc1155_flats f
LEFT JOIN pm_user_proxy_wallets p
  ON lower(f.from_addr) = lower(p.proxy_wallet)
WHERE p.is_active = 1
```

**Key Files:**
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql` line 176 - `proxy_wallets_active` view
- `/migrations/clickhouse/016_enhance_polymarket_tables.sql` line 213-226 - Enriched joins

---

## FILE INDEX BY PURPOSE

### Normalization & Deduplication

| File | Purpose | Key Function |
|------|---------|--------------|
| `/scripts/build-trades-dedup-mat.ts` | Creates deduplicated trades table | Dedup key logic + materialization |
| `/scripts/run-market-id-normalization.ts` | Rebuilds views without market_id | **IDN** normalization demo |
| `/scripts/validate-outcome-mapping-final.ts` | Validates condition_id normalization | Verification + audit |

### Mapping Table Creation

| File | Purpose | Key Function |
|------|---------|--------------|
| `/scripts/map-tokenid-to-market.ts` | Builds pm_tokenid_market_map | Token ID derivation |
| `/scripts/stepA_build_condition_market_map.ts` | Builds condition_market_map | Condition ID mapping |
| `/scripts/enrich-token-map.ts` | Enriches ctf_token_map with outcomes | **CAR** array indexing |
| `/scripts/step5-outcome-mapping.ts` | Maps resolutions to outcome indices | Winning index resolution |

### Settlement & PnL Calculation

| File | Purpose | Key Function |
|------|---------|--------------|
| `/scripts/step4-settlement-rules.ts` | Tests settlement math | **NDR** + **PNL** patterns |
| `/scripts/test-settlement-rules.ts` | Unit tests for settlement logic | Complete PnL formula |
| `/scripts/validate-exact-methodology.ts` | Single-market PnL validation | Formula validation |
| `/scripts/calculate-realized-pnl.ts` | Computes realized PnL for wallet | End-to-end PnL pipeline |

### Data Ingestion

| File | Purpose | Key Function |
|------|---------|--------------|
| `/scripts/ingest-clob-fills.ts` | Fetches CLOB API → trades_raw | CLOB API integration |
| `/scripts/flatten-erc1155.ts` | Decodes ERC1155 transfers | ERC1155 event decoding |
| `/scripts/build-approval-proxies.ts` | Builds proxy wallet mapping | Proxy detection |

### Verification & Audit

| File | Purpose | Key Function |
|------|---------|--------------|
| `/scripts/coverage-monitor.ts` | Monitors resolution join coverage | **JD** join audit |
| `/scripts/analyze-mapping-tables.ts` | Audits mapping tables | Data quality checks |
| `/scripts/diagnostic-final-validation.ts` | End-to-end diagnostics | Multi-step verification |
| `/scripts/run-market-id-normalization.ts` | Migration + verification checks | **AR** atomic rebuild |

### Views & Aggregations

| File | Purpose | Key Columns |
|------|---------|------------|
| `/migrations/clickhouse/016_enhance_polymarket_tables.sql` line 104 | `markets_enriched` view | market metadata + resolution |
| `/migrations/clickhouse/016_enhance_polymarket_tables.sql` line 138 | `token_market_enriched` view | token + market + resolution |
| `/migrations/clickhouse/016_enhance_polymarket_tables.sql` line 191 | `erc1155_transfers_enriched` view | transfers + market context |
| `/migrations/clickhouse/016_enhance_polymarket_tables.sql` line 233 | `wallet_positions_current` view | current holdings aggregated |

---

## SCHEMA REFERENCE

### Core Tables

**trades_raw** - Raw CLOB fills from API
```sql
trade_id, wallet_address, market_id, condition_id, outcome_index, side, 
entry_price, shares, transaction_hash, log_index, block_number, created_at
```

**trades_dedup_mat** - Deduplicated, normalized trades (ReplacingMergeTree)
```sql
dedup_key, wallet_address, market_id, condition_id, outcome_index, side,
entry_price, shares, transaction_hash, log_index, block_number, created_at, _version
```

**ctf_token_map** - Complete token metadata
```sql
token_id, condition_id, condition_id_norm, market_id, outcome, 
outcome_index, question, created_at
```

**pm_erc1155_flats** - Flattened ERC1155 transfers
```sql
block_number, block_time, tx_hash, log_index, operator, from_addr, to_addr,
token_id, amount, event_type
```

**pm_user_proxy_wallets** - EOA → Proxy wallet mapping (ReplacingMergeTree)
```sql
user_eoa, proxy_wallet, source, first_seen_block, last_seen_block, 
first_seen_at, last_seen_at, is_active
```

**winning_index** - Market resolution outcomes
```sql
condition_id_norm, winning_index, resolved_at, resolver_method, payout_hash
```

**market_resolutions_final** - Complete resolution with payout vectors
```sql
market_id, condition_id, condition_id_norm, winner, winning_index,
payout_numerators (Array), payout_denominator, resolved_at, 
resolution_source, payout_hash
```

**gamma_markets** - Market master data
```sql
market_id, condition_id, question, outcomes (Array), end_date_iso,
tags (Array), category, volume, liquidity, question_id, 
enable_order_book, ingested_at
```

### Aggregation Views

**outcome_positions_v2**
```sql
wallet, condition_id_norm, outcome_idx, net_shares
```

**trade_cashflows_v3**
```sql
wallet, condition_id_norm, outcome_idx, px, sh, cashflow_usdc
```

**markets_enriched**
```sql
market_id, condition_id, question, outcomes, is_resolved, 
winner, winning_outcome_index, ...
```

**token_market_enriched**
```sql
token_id, condition_id_norm, market_id, outcome, outcome_index,
all_outcomes, is_resolved, winner, winning_outcome_index,
is_winning_outcome
```

---

## STABLE TRANSFORMATION PATTERNS (From CLAUDE.md)

### **IDN** - ID Normalization
- `lower(replaceAll(condition_id, '0x', ''))`
- Always 64 chars for condition_id
- Store as String, never FixedString

### **NDR** - Net Direction Resolver
- BUY: usdc_net > 0 AND token_net > 0
- SELL: usdc_net < 0 AND token_net < 0
- Sign calculation: -1 for BUY, +1 for SELL

### **PNL** - PnL from Vector
- `shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis`
- cost_basis = entry_price * shares * sign

### **CAR** - ClickHouse Array Rule
- Arrays are 1-indexed
- Always add 1 to outcome_index: `arrayElement(outcomes, outcome_index + 1)`

### **AR** - Atomic Rebuild
- Use `CREATE TABLE AS SELECT` then `RENAME`
- Never use `ALTER TABLE UPDATE` on large ranges
- Pattern used in: `/scripts/run-market-id-normalization.ts`

### **JD** - Join Discipline
- Join on normalized condition_id_norm only
- Never slug-to-hex joins
- Verify rowcount changes after joins

### **GATE** - Quality Thresholds
- Cash neutrality error < 2% globally
- Per-market < 2% for 95% of markets, worst < 5%
- Coverage ≥ 95% of volume

---

## CRITICAL GOTCHAS

1. **Array Indexing:** ClickHouse arrays are 1-indexed. `arrayElement(arr, idx + 1)`

2. **condition_id Format:** Always normalize BEFORE joining:
   - Strip `0x` prefix
   - Convert to lowercase
   - Expect 64 characters

3. **Signed Cashflows:** BUY = negative, SELL = positive
   - `price * shares * IF(side=1, -1, 1)`

4. **Settlement Logic:**
   - BUY + WIN = payout per share
   - BUY + LOSE = 0
   - SELL + WIN = 0
   - SELL + LOSE = payout per share

5. **Payout Vectors:** Stored as Array(UInt64) with denominator
   - Access: `arrayElement(payout_numerators, winning_index + 1)`
   - Divide by `payout_denominator` for USD value

6. **Deduplication Key:** Use `concat()` with transaction_hash + log_index
   - Fallback to market + outcome + price + shares combo

---

## EXECUTION ORDER (Full Pipeline)

1. **Ingest CLOB Fills** → `trades_raw`
2. **Flatten ERC1155** → `pm_erc1155_flats`
3. **Build Proxy Map** → `pm_user_proxy_wallets`
4. **Map Token IDs** → `pm_tokenid_market_map`
5. **Build Dedup Mat** → `trades_dedup_mat`
6. **Enrich Token Map** → `ctf_token_map`
7. **Resolve Outcomes** → `winning_index`
8. **Aggregate Positions** → Views (outcome_positions_v2, trade_cashflows_v3)
9. **Calculate PnL** → Via queries joining to winning_index

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-07  
**Applicable To:** Cascadian-app version with P&L pipeline complete (85%+ done)

