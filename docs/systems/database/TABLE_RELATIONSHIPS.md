# CASCADIAN Database Table Relationships

**Last Updated:** 2025-11-11
**Purpose:** Comprehensive guide to all tables, their relationships, and join patterns

> **🔄 LIVING DOCUMENT:** This is the authoritative reference for database structure.
>
> **#remember Rules:**
> 1. ✅ **Read this FIRST** before any database investigation or search
> 2. ✅ **Update this document** when you discover:
>    - New tables or columns
>    - New relationships or join patterns
>    - Different data formats than documented
>    - Better query approaches
>    - Common mistakes or gotchas
> 3. ✅ **Keep it current** - Add discoveries immediately, don't batch updates
>
> This prevents rediscovering information and builds institutional knowledge.

---

## Quick Navigation

| Section | Description |
|---------|-------------|
| [Core Tables](#core-tables) | Primary data sources (6 tables) |
| [Supporting Tables](#supporting-tables) | Enrichment and metadata (10 tables) |
| [Bridge Tables](#bridge-tables) | ID mappings and translations (5 tables) |
| [Relationship Diagram](#relationship-diagram) | Visual ERD |
| [Common Join Patterns](#common-join-patterns) | Frequently used queries |
| [Data Flow](#data-flow) | How data moves between tables |

---

## Core Tables (Primary Data Sources)

### 1. `clob_fills` - Trade Events (38.9M rows)
**Purpose:** Raw CLOB trade data from Polymarket order book
**Source:** Polymarket CLOB API
**Key Columns:**
- `asset_id` (String) - Token identifier (77-78 digit decimal)
- `maker_address` (String) - Wallet placing order
- `taker_address` (String) - Wallet filling order
- `price` (Decimal) - Fill price
- `size` (Decimal) - Fill size in USDC
- `timestamp` (DateTime) - Trade execution time
- `transaction_hash` (String) - Blockchain tx hash

**Relationships:**
- → `ctf_token_map` via `asset_id = token_id`
- → `gamma_markets` via extracted `condition_id`

---

### 2. `erc1155_transfers` - Token Transfers (61.4M rows)
**Purpose:** Blockchain ERC1155 token transfer events
**Source:** Polygon blockchain via Goldsky
**Key Columns:**
- `token_id` (String) - ERC1155 token ID (hex with 0x prefix)
- `from_address` (String) - Sender wallet
- `to_address` (String) - Receiver wallet
- `amount` (UInt256) - Token quantity
- `transaction_hash` (String) - Blockchain tx hash
- `block_number` (UInt64) - Block number
- `block_timestamp` (DateTime) - Transfer time

**Relationships:**
- → `ctf_token_map` via `lower(hex(toUInt256(token_id))) = token_id` (after conversion)
- → `canonical_condition` via decoded condition_id

**Format Note:** Uses hex format with 0x prefix, different from `clob_fills.asset_id` (decimal)

---

### 3. `ctf_token_map` - Token→Condition Mapping (60,806 rows)
**Purpose:** Maps asset_ids/token_ids to condition_ids and outcome indices
**Source:** Built from multiple sources (erc1155, id_bridge, gamma_markets)
**Key Columns:**
- `token_id` (String) - Token identifier (decimal or hex)
- `condition_id_norm` (String) - Normalized 64-char hex condition ID (no 0x)
- `outcome_index` (UInt8) - Outcome position (0, 1, 2, etc.)
- `source` (String) - Origin of mapping ('decoded', 'id_bridge', 'gamma')

**Relationships:**
- ← `clob_fills` via `token_id = asset_id`
- ← `erc1155_transfers` via `token_id = lower(hex(toUInt256(token_id)))`
- → `canonical_condition` via `condition_id_norm = condition_id_norm`
- → `gamma_markets` via `condition_id_norm = condition_id`

**CRITICAL:** This is the bridge between trading data and market metadata

---

### 4. `gamma_markets` - Market Metadata (149,908 rows)
**Purpose:** Complete market information from Polymarket Gamma API
**Source:** Polymarket Gamma API
**Key Columns:**
- `id` (String) - Market ID (6-digit numeric)
- `condition_id` (String) - 64-char hex (normalized, no 0x)
- `question` (String) - Market question
- `outcomes` (Array(String)) - Outcome labels ["Yes", "No"]
- `category` (String) - Market category
- `metadata` (String) - JSON with additional data
- `clobTokenIds` (Array in metadata) - **Contains token mappings in decimal format!**

**Relationships:**
- ← `ctf_token_map` via `condition_id = condition_id_norm`
- → `market_resolutions_final` via `condition_id = condition_id_norm`
- → `events_dim` via category mapping

**Discovery:** `metadata` JSON field contains `clobTokenIds` array with 149K+ token mappings - this was missed in initial Phase 2 investigation!

---

### 5. `market_resolutions_final` - Resolution Data (218,325 rows)
**Purpose:** Final resolved outcomes for markets
**Source:** Combined from API + blockchain events
**Key Columns:**
- `condition_id_norm` (String) - 64-char hex condition ID
- `winning_index` (UInt8) - Index of winning outcome
- `payout_numerators` (Array(UInt8)) - Payout vector [1,0] or [0,1]
- `payout_denominator` (UInt8) - Usually 1
- `resolved_at` (DateTime) - Resolution timestamp
- `resolution_source` (String) - 'api', 'blockchain', 'manual'

**Relationships:**
- ← `gamma_markets` via `condition_id_norm = condition_id`
- → P&L calculations (used to compute realized PnL)

---

### 6. `canonical_condition` - Validated Conditions (151,843 rows)
**Purpose:** Ground truth for valid condition IDs
**Source:** Extracted from blockchain + API
**Key Columns:**
- `condition_id_norm` (String) - 64-char hex (PRIMARY KEY)
- `market_id` (String) - Associated market ID
- `first_seen` (DateTime) - When first observed
- `source` (String) - Origin of condition

**Relationships:**
- Used for validation in `ctf_token_map` backfills
- → `gamma_markets` via `condition_id_norm = condition_id`

---

## Supporting Tables

### 7. `id_bridge` - Market Metadata Bridge (10,000 rows)
**Purpose:** Links condition_ids to market_ids with metadata
**Source:** Polymarket API snapshots
**Key Columns:**
- `condition_id_norm` (String) - 64-char hex
- `market_id` (String) - Market ID
- `metadata` (String) - **JSON with clobTokenIds array**
- `source` (String) - 'gamma_api', 'clob_api'

**Relationships:**
- → Extract `clobTokenIds` from metadata for `ctf_token_map` expansion
- → `gamma_markets` via `market_id = id`

**Phase 2 Discovery:** This table contains 9,931 markets with clobTokenIds, adding 5.48% coverage

---

### 8. `api_ctf_bridge` - CLOB API Bridge (156,952 rows)
**Purpose:** Maps condition_ids to CLOB api_market_ids
**Key Columns:**
- `condition_id` (String) - 64-char hex
- `api_market_id` (String) - CLOB market slug
- `resolved_outcome` (String) - Outcome name if resolved
- `source` (String) - 'clob'

**Relationships:**
- → `gamma_markets` via `condition_id = condition_id`

---

### 9. `market_outcomes` - Outcome Definitions (149,907 rows)
**Purpose:** Defines possible outcomes for each market
**Key Columns:**
- `market_id` (String)
- `outcome_index` (UInt8)
- `outcome_label` (String) - "Yes", "No", or custom
- `condition_id_norm` (String)

---

### 10. `events_dim` - Event Categories
**Purpose:** Categorizes markets into events/topics
**Key Columns:**
- `event_id` (String)
- `event_name` (String)
- `category` (String)
- `tags` (Array(String))

---

## Bridge Tables (ID Translations)

### token_to_cid_bridge (cascadian_clean, 17,340 rows)
**Purpose:** Alternative token→condition mapping (hex format)
**Key Columns:**
- `token_hex` (String) - Hex token ID
- `cid_hex` (String) - Condition ID
- `outcome_index` (UInt16)

**Format:** Uses hex with 0x prefix, 0% match with clob_fills (different system)

---

### market_key_map (default, 156,952 rows)
**Purpose:** Maps various market ID formats
**Key Columns:**
- `market_id` (String)
- `condition_id` (String)
- `api_market_id` (String)
- `market_slug` (String)

---

### condition_market_map (default, 151,843 rows)
**Purpose:** Simple condition→market mapping
**Key Columns:**
- `condition_id` (String)
- `market_id` (String)

---

### token_condition_market_map (cascadian_clean, 227,838 rows)
**Purpose:** Three-way mapping
**Key Columns:**
- `token_id_erc1155` (String) - **Currently EMPTY**
- `condition_id_32b` (String)
- `market_id_cid` (String)

**Status:** Table exists but token_id field is unpopulated

---

## Relationship Diagram

```
┌─────────────────┐
│  clob_fills     │ 38.9M trades (CLOB data)
│  ===============│
│  asset_id       │────┐
│  maker_address  │    │
│  taker_address  │    │
│  price, size    │    │
└─────────────────┘    │
                       │ Join via asset_id = token_id
                       │
                       ▼
              ┌──────────────────┐
              │ ctf_token_map    │ 60K mappings
              │ ================│
              │ token_id         │←─────┐
              │ condition_id_norm│      │ Built from multiple sources
              │ outcome_index    │      │
              └──────────────────┘      │
                       │                │
                       │ Join via       │
                       │ condition_id   │
                       ▼                │
              ┌──────────────────┐     │
              │ gamma_markets    │ 149K markets
              │ ================│     │
              │ condition_id     │     │
              │ question         │     │ Extract clobTokenIds from metadata
              │ outcomes[]       │     │
              │ metadata (JSON)  │─────┘ *** DISCOVERY: Contains token mappings! ***
              │  └─ clobTokenIds │
              └──────────────────┘
                       │
                       │ Resolution data
                       ▼
         ┌──────────────────────────┐
         │ market_resolutions_final │ 218K resolutions
         │ ========================│
         │ condition_id_norm        │
         │ winning_index            │
         │ payout_numerators[]      │
         └──────────────────────────┘
                       │
                       │ Used for P&L calculation
                       ▼
              [ wallet_pnl_summary ]


┌──────────────────────┐
│ erc1155_transfers    │ 61.4M transfers (Blockchain data)
│ ====================│
│ token_id (hex+0x)    │────┐
│ from_address         │    │ Convert: lower(hex(toUInt256(token_id)))
│ to_address           │    │
│ amount               │    │
└──────────────────────┘    │
                            │
                            ▼
                   ┌──────────────────┐
                   │ ctf_token_map    │
                   │ (via conversion) │
                   └──────────────────┘


SUPPORTING BRIDGES:

┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ id_bridge   │────→│ ctf_token_map    │←────│ canonical_      │
│ (metadata)  │     │ (expansion)      │     │ condition       │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │                                                 │
      │ Extract clobTokenIds                           │ Validation
      └─────────────────────────────────────────────────┘
```

---

## Common Join Patterns

### Pattern 1: Get all trades with market metadata
```sql
SELECT
  cf.maker_address,
  cf.taker_address,
  cf.size,
  gm.question,
  gm.outcomes,
  gm.category
FROM clob_fills cf
INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
INNER JOIN gamma_markets gm ON ctm.condition_id_norm = gm.condition_id
WHERE cf.timestamp >= '2025-01-01'
```

### Pattern 2: Calculate wallet P&L for resolved markets
```sql
SELECT
  cf.maker_address as wallet,
  gm.question,
  mr.winning_index,
  SUM(cf.size * arrayElement(mr.payout_numerators, ctm.outcome_index + 1)) as pnl_usd
FROM clob_fills cf
INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
INNER JOIN gamma_markets gm ON ctm.condition_id_norm = gm.condition_id
INNER JOIN market_resolutions_final mr ON gm.condition_id = mr.condition_id_norm
WHERE mr.winning_index >= 0
GROUP BY wallet, gm.question, mr.winning_index
```

### Pattern 3: Blockchain to market metadata (ERC1155 → Markets)
```sql
SELECT
  et.from_address,
  et.to_address,
  et.amount,
  gm.question,
  gm.category
FROM erc1155_transfers et
INNER JOIN ctf_token_map ctm
  ON lower(hex(toUInt256(et.token_id))) = ctm.token_id
INNER JOIN gamma_markets gm
  ON ctm.condition_id_norm = gm.condition_id
WHERE et.block_timestamp >= '2025-01-01'
```

### Pattern 4: Extract tokens from gamma_markets metadata
```sql
SELECT
  gm.id as market_id,
  gm.condition_id,
  replaceAll(replaceAll(
    arrayJoin(JSONExtractArrayRaw(JSONExtractString(gm.metadata, 'clobTokenIds'))),
    '"', ''), '\\', '') as token_id,
  rowNumberInBlock() - 1 as outcome_index
FROM gamma_markets gm
WHERE JSONExtractString(gm.metadata, 'clobTokenIds') != ''
  AND JSONExtractString(gm.metadata, 'clobTokenIds') != '[]'
```

---

## Data Flow

### Trade Data Pipeline

```
1. CLOB Fills → clob_fills table (38.9M rows)
   ↓
2. Map asset_id → condition_id via ctf_token_map (60K mappings)
   ↓
3. Enrich with market metadata from gamma_markets (149K markets)
   ↓
4. Join resolutions from market_resolutions_final (218K resolutions)
   ↓
5. Calculate P&L → wallet_pnl_summary
```

### Token Mapping Sources (Priority Order)

```
1. Existing ctf_token_map (41,130 tokens) - Phase 1 baseline
   ↓
2. id_bridge.metadata.clobTokenIds (19,676 tokens) - Phase 2 discovered
   ↓
3. gamma_markets.metadata.clobTokenIds (149,772 tokens) - *** BREAKTHROUGH! ***
   ↓
4. erc1155_transfers decoded (via conversion) - Blockchain fallback
   ↓
RESULT: 100% coverage (all 118,870 unique asset_ids mapped)
```

### Resolution Data Flow

```
1. Polymarket API → resolutions_src_api (130K API resolutions)
   ↓
2. Blockchain events → market_resolutions (137K blockchain resolutions)
   ↓
3. Merge + dedupe → market_resolutions_final (218K total)
   ↓
4. Join to trades via condition_id_norm
   ↓
5. Compute P&L using payout vectors
```

---

## Critical Lessons Learned

### Phase 2 Investigation Lesson

**RULE: DESCRIBE + SAMPLE before dismissing any table**

**What happened:**
- Investigated 40+ tables looking for token mappings
- Checked `gamma_markets` for `metadata` column → failed
- Concluded "gamma_markets has no tokens" ❌ **WRONG**
- Spent 4 hours on alternative approaches
- Later discovered `gamma_markets.metadata` contains `clobTokenIds` with 149K+ mappings

**What should have been done:**
```sql
-- Instead of just:
SELECT metadata FROM gamma_markets;  -- ❌ Column doesn't exist, gave up

-- Should have done:
DESCRIBE TABLE gamma_markets;  -- ✅ Shows actual schema
SELECT * FROM gamma_markets LIMIT 5;  -- ✅ Shows data structure
-- Would have found: metadata field with clobTokenIds array!
```

**Result:** `gamma_markets` had everything needed for 100% coverage all along.

### Key Takeaways

1. **Never assume column names** - `metadata` vs `meta` vs JSON fields
2. **Check format variations** - decimal vs hex, with/without 0x prefix
3. **Look in largest tables first** - They often have the most complete data
4. **Arrays in JSON fields** - Check for nested data structures
5. **Always run DESCRIBE + SAMPLE** - See what's actually there

---

## Table Naming Conventions

### Prefixes
- `vw_` - View (computed from other tables)
- `fact_` - Fact table (transaction/event data)
- `dim_` - Dimension table (lookup/metadata)
- No prefix - Base table (physical storage)

### Suffixes
- `_final` - Production-ready version
- `_backup` - Backup copy
- `_staging` - Temporary staging table
- `_v2`, `_v3` - Version numbers
- `_raw` - Unprocessed source data
- `_clean` - Cleaned/validated data

### Databases
- `default` - Primary database (production tables)
- `cascadian_clean` - Cleaned/curated versions
- Legacy tables may exist in both

---

## Quick Reference: Join Keys

| From Table | To Table | Join Condition |
|------------|----------|----------------|
| clob_fills | ctf_token_map | `cf.asset_id = ctm.token_id` |
| ctf_token_map | gamma_markets | `ctm.condition_id_norm = gm.condition_id` |
| gamma_markets | market_resolutions_final | `gm.condition_id = mr.condition_id_norm` |
| erc1155_transfers | ctf_token_map | `lower(hex(toUInt256(et.token_id))) = ctm.token_id` |
| ctf_token_map | canonical_condition | `ctm.condition_id_norm = cc.condition_id_norm` |
| gamma_markets | events_dim | `gm.category = ed.category` |
| id_bridge | gamma_markets | `ib.condition_id_norm = gm.condition_id` |

---

## Performance Notes

### High-Cardinality Columns (Index These)
- `wallet_address` - 996K+ unique values
- `condition_id_norm` - 151K+ unique values
- `transaction_hash` - High cardinality
- `market_id` - 149K+ unique values

### Large Tables (Optimize Joins)
1. `erc1155_transfers` - 61.4M rows (use sampling for dev)
2. `clob_fills` - 38.9M rows (partition by date)
3. `erc20_transfers` - Large (blockchain data)

### Small Lookup Tables (Safe to Load Fully)
- `ctf_token_map` - 60K rows
- `gamma_markets` - 149K rows
- `market_resolutions_final` - 218K rows

---

**Last Updated:** 2025-11-11
**Status:** Complete with Phase 2 discoveries documented

