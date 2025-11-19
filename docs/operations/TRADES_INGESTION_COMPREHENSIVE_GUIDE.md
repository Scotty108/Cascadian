# COMPREHENSIVE TRADES DATA INGESTION GUIDE
**Cascadian Project - Complete Data Pipeline Documentation**

---

## EXECUTIVE SUMMARY

The Cascadian trades data pipeline ingests Polymarket trading activity from multiple sources:

1. **Primary Source: Blockchain ERC1155 Transfers** (291K rows directly, ~82M+ when enriched)
2. **Secondary Source: CLOB API** (fills, market metadata)
3. **Tertiary Source: Polygon chain events** (resolutions, market creation)

**Current Status:**
- **trades_with_direction**: 82.1M rows (82% coverage, HIGH confidence)
- **vw_trades_canonical**: 157M rows (enriched view with normalized IDs)
- **trades_raw**: 160M rows (primary source, some quality issues)
- **market_resolutions_final**: 224K markets (100% resolution data when resolved)

---

## 1. DATA SOURCES & INGESTION METHODS

### 1.1 Blockchain Data (ERC1155 & ERC20 Transfers)

**What it is:**
- Event logs from Polygon blockchain (CTF/ERC1155 conditional token transfers)
- USDC transfer logs (ERC20 standard)
- Market resolution events from UMA oracle

**Collection Method:**
- RPC calls to Polygon via viem/ethers.js
- Event filters by contract address and topic signatures
- Block range: 1,048 days of history (Dec 18, 2022 - Oct 31, 2025)
- Parallelization: 8-worker sharding system per day

**Key Script:** `/scripts/step3-streaming-backfill-parallel.ts`

**Event Signatures:**
```
ERC20_TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
ERC1155_TRANSFER_SINGLE_TOPIC = 0xc3d58168c5ae7397731d063d5bbf3d657706909c31c4caa39ffeab6ffa4a8fba
ERC1155_TRANSFER_BATCH_TOPIC = 0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595a9738d51b54330fc5
```

**Contract Addresses:**
```
CTF_ADDRESS = 0xd552174f4f14c8f9a6eb4d51e5d2c7bbeafccf61
USDC_ADDRESS = 0x2791bca1f2de4661ed88a30c99a7a9449aa84174
```

---

### 1.2 Polymarket CLOB API

**What it is:**
- Central Limit Order Book (CLOB) API at `https://clob.polymarket.com`
- Provides trade fills, market metadata, and condition_id mappings
- Rate limited: 100 req/s, pagination via offset/limit

**Endpoints Used:**
```
GET /api/v1/trades?trader={wallet}&limit=1000
GET /markets?offset={offset}&limit=100
GET /positions?wallet={wallet}
```

**Worker Scripts:**
- `/worker-clob-api.ts` - Primary ingestion (signed requests with HMAC-SHA256)
- `/worker-clob-api-fast.ts` - Optimized for bulk market mapping
- `/worker-clob-ultra-fast.ts` - Parallel market data pull

**API Signature (Required):**
```typescript
const message = timestamp + method + path + body
const signature = HMAC_SHA256(message, API_SECRET) // base64 encoded
Headers: {
  'CLOB-API-KEY': key,
  'CLOB-API-PASSPHRASE': passphrase,
  'CLOB-API-TIMESTAMP': timestamp,
  'CLOB-API-SIGNATURE': signature
}
```

**Credentials (from .env.local):**
- `CLOB_API_KEY`
- `CLOB_API_SECRET`
- `CLOB_API_PASSPHRASE`

---

### 1.3 Goldsky Substreams

**What it is:**
- Real-time blockchain event streaming via Goldsky
- Used for live PnL updates and settlement notifications
- Module: `polymarket-pnl@v0.3.1` with substreams handlers

**Key Handlers:**
- `map_ctf_exchange_order_filled` - Trade fills
- `map_user_positions` - Position snapshots

---

## 2. DETAILED DATA FLOW

### 2.1 Complete Pipeline Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA SOURCES                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────┐  │
│  │ Polygon Blockchain        CLOB API      │  │ Goldsky│  │
│  │ (ERC1155 logs)   │  (Fills, Markets)   │  │Substreams  │
│  └────────┬─────────┘  └────────┬──────────┘  └─────────┘  │
│           │                     │                   │       │
└───────────┼─────────────────────┼───────────────────┼───────┘
            │                     │                   │
            ▼                     ▼                   ▼
    ┌───────────────────────────────────────────────────────┐
    │        RAW INGESTION TABLES (ClickHouse)              │
    ├───────────────────────────────────────────────────────┤
    │                                                       │
    │ ┌──────────────────────────────────────────────────┐ │
    │ │ default.erc1155_transfers (291K rows)            │ │
    │ │ • Raw ERC1155 logs from blockchain               │ │
    │ │ • block_number, tx_hash, topics[], data          │ │
    │ └──────────────────────────────────────────────────┘ │
    │                                                       │
    │ ┌──────────────────────────────────────────────────┐ │
    │ │ default.erc20_transfers_decoded (21M rows)       │ │
    │ │ • Decoded USDC transfers                         │ │
    │ │ • from, to, amount, tx_hash                      │ │
    │ └──────────────────────────────────────────────────┘ │
    │                                                       │
    │ ┌──────────────────────────────────────────────────┐ │
    │ │ default.trades_raw (160M rows) ⚠️ Quality Issues│ │
    │ │ • Side: Enum8('YES'/'NO')                        │ │
    │ │ • market_id: 51M have zeros or '12'              │ │
    │ │ • condition_id: inconsistent format              │ │
    │ │ • Price, shares, cashflow columns present        │ │
    │ └──────────────────────────────────────────────────┘ │
    │                                                       │
    │ ┌──────────────────────────────────────────────────┐ │
    │ │ default.clob_market_mapping (150K+ mappings)     │ │
    │ │ • market_id ↔ condition_id pairs                 │ │
    │ │ • Metadata: slug, question, active status        │ │
    │ └──────────────────────────────────────────────────┘ │
    │                                                       │
    └──────────────────┬─────────────────────────────────────┘
                       │
                       │ TRANSFORMATION
                       │
                       ▼
    ┌────────────────────────────────────────────────────────┐
    │        DECODED & FLATTENED TABLES                      │
    ├────────────────────────────────────────────────────────┤
    │                                                        │
    │ ┌──────────────────────────────────────────────────┐  │
    │ │ pm_erc1155_flats (1M+ rows)                      │  │
    │ │ • Flattened from raw ERC1155 logs                │  │
    │ │ • operator, from_addr, to_addr, token_id, amount│  │
    │ │ • Scripts: flatten-erc1155.ts                    │  │
    │ └──────────────────────────────────────────────────┘  │
    │                                                        │
    │ ┌──────────────────────────────────────────────────┐  │
    │ │ pm_user_proxy_wallets (100K rows)                │  │
    │ │ • Maps user EOA → proxy wallet                   │  │
    │ │ • From ApprovalForAll events                     │  │
    │ │ • Track is_active status                         │  │
    │ └──────────────────────────────────────────────────┘  │
    │                                                        │
    │ ┌──────────────────────────────────────────────────┐  │
    │ │ ctf_token_map (enriched)                         │  │
    │ │ • token_id ↔ condition_id ↔ market_id            │  │
    │ │ • outcome_index, outcome label                   │  │
    │ │ • Source: api_ctf_bridge + ERC1155 logs          │  │
    │ └──────────────────────────────────────────────────┘  │
    │                                                        │
    └──────────────────┬──────────────────────────────────────┘
                       │
                       │ DIRECTION ASSIGNMENT & NORMALIZATION
                       │
                       ▼
    ┌────────────────────────────────────────────────────────┐
    │        CANONICAL TRADE TABLES (PRIMARY SOURCES)         │
    ├────────────────────────────────────────────────────────┤
    │                                                        │
    │ ┌──────────────────────────────────────────────────┐  │
    │ │ default.trades_with_direction (82M rows)         │  │
    │ │ ✅ 100% condition_id coverage (normalized)        │  │
    │ │ ✅ 100% market_id coverage                        │  │
    │ │ ✅ Direction assigned (BUY/SELL from net flows) │  │
    │ │ ✅ HIGH confidence blockchain source             │  │
    │ │                                                   │  │
    │ │ Schema:                                            │  │
    │ │ • condition_id_norm (64-char hex)                 │  │
    │ │ • market_id                                        │  │
    │ │ • tx_hash, wallet_address                         │  │
    │ │ • shares, price, usd_value                        │  │
    │ │ • direction_from_transfers (BUY/SELL/UNKNOWN)    │  │
    │ │ • confidence (HIGH/MEDIUM/LOW)                    │  │
    │ │ • reason (explanation of direction assignment)   │  │
    │ └──────────────────────────────────────────────────┘  │
    │                                                        │
    │ ┌──────────────────────────────────────────────────┐  │
    │ │ cascadian_clean.vw_trades_canonical (157M rows)  │  │
    │ │ ✅ Enriched view with metadata                    │  │
    │ │ ✅ Normalized condition_ids across all columns    │  │
    │ │ ✅ Filtered: excludes market_id='12' placeholders │  │
    │ │ ✅ Computed net flows for direction              │  │
    │ │                                                   │  │
    │ │ Schema (Key Columns):                             │  │
    │ │ • trade_key, trade_id                             │  │
    │ │ • transaction_hash, wallet_address_norm           │  │
    │ │ • market_id_norm, condition_id_norm               │  │
    │ │ • timestamp, outcome_token, outcome_index         │  │
    │ │ • trade_direction, direction_confidence           │  │
    │ │ • shares, usd_value, entry_price                 │  │
    │ │ • created_at (ingestion timestamp)                │  │
    │ └──────────────────────────────────────────────────┘  │
    │                                                        │
    └──────────────────┬──────────────────────────────────────┘
                       │
                       │ AGGREGATION & JOINS
                       │
                       ▼
    ┌────────────────────────────────────────────────────────┐
    │        REFERENCE & RESOLUTION TABLES                    │
    ├────────────────────────────────────────────────────────┤
    │                                                        │
    │ ┌──────────────────────────────────────────────────┐  │
    │ │ default.market_resolutions_final (224K markets)  │  │
    │ │ ✅ 100% condition_id coverage                    │  │
    │ │ ✅ Complete payout vectors (when resolved)      │  │
    │ │                                                   │  │
    │ │ Schema:                                            │  │
    │ │ • condition_id_norm (FixedString(64))            │  │
    │ │ • payout_numerators (Array(UInt8))               │  │
    │ │ • payout_denominator (UInt8)                      │  │
    │ │ • winning_index (UInt16)                          │  │
    │ │ • winning_outcome (String)                        │  │
    │ │ • resolved_at (DateTime, nullable)                │  │
    │ │ • outcome_count                                    │  │
    │ │ • source (chain/api)                              │  │
    │ └──────────────────────────────────────────────────┘  │
    │                                                        │
    │ ┌──────────────────────────────────────────────────┐  │
    │ │ default.condition_market_map (152K mappings)     │  │
    │ │ • Bridges market_id ↔ condition_id               │  │
    │ │ • Used for enrichment only                        │  │
    │ └──────────────────────────────────────────────────┘  │
    │                                                        │
    │ ┌──────────────────────────────────────────────────┐  │
    │ │ default.gamma_markets (150K+ markets)            │  │
    │ │ • Market metadata (titles, categories, outcomes) │  │
    │ │ • 100% coverage of trading markets               │  │
    │ └──────────────────────────────────────────────────┘  │
    │                                                        │
    └──────────────────┬──────────────────────────────────────┘
                       │
                       │ FINAL VIEWS
                       │
                       ▼
    ┌────────────────────────────────────────────────────────┐
    │        ANALYTIC VIEWS (cascadian_clean)                │
    ├────────────────────────────────────────────────────────┤
    │                                                        │
    │ vw_positions_open - Current net positions             │
    │ vw_wallet_pnl_closed - Realized P&L                   │
    │ vw_wallet_pnl_all - Realized + unrealized P&L         │
    │ vw_wallet_pnl_settled - With redemption P&L           │
    │ vw_resolutions_truth - Unified resolution source      │
    │                                                        │
    └────────────────────────────────────────────────────────┘
```

---

### 2.2 ERC1155 → Direction → Trades Flow

**Step 1: Raw Event Decoding**
```
erc1155_transfers (raw logs)
  ↓ flatten-erc1155.ts
pm_erc1155_flats
  • Extracts: operator, from_addr, to_addr, token_id, amount
  • Splits single transfers and batch transfers
  • ~1M-10M rows after full blockchain sync
```

**Step 2: Proxy Resolution**
```
pm_erc1155_flats + ApprovalForAll events
  ↓ build-approval-proxies.ts
pm_user_proxy_wallets
  • Maps user_eoa → proxy_wallet relationships
  • Tracks approval/revocation events
  • Used for identifying actual traders
```

**Step 3: Token-to-Market Mapping**
```
pm_erc1155_flats + api_ctf_bridge + gamma_markets
  ↓ enrich-token-map.ts
ctf_token_map (enriched)
  • Maps token_id → condition_id → market_id
  • Adds outcome labels and indices
  • 1-to-1 mapping for each outcome token
```

**Step 4: Direction Assignment (NET FLOW METHOD)**

From USDC and token flows:
```
BUY:  token_net > 0 AND usdc_net > 0  (received tokens, spent USDC)
SELL: token_net < 0 AND usdc_net < 0  (spent tokens, received USDC)
```

Calculation:
```
token_net = tokens_in - tokens_out
usdc_net = usdc_out - usdc_in
direction_confidence = HIGH if both legs present
```

**Step 5: Canonical Table Population**
```
pm_erc1155_flats + pm_user_proxy_wallets + ctf_token_map + market_resolutions_final
  ↓ (join + normalization)
trades_with_direction
  • 82M rows with 100% condition_id coverage
  • Normalized condition IDs (lowercase, no 0x, 64-char)
  • Direction assigned from net flows
  • Ready for P&L calculation
```

---

## 3. KEY TABLES & SCHEMAS

### 3.1 trades_with_direction (Primary Trade Source)

**Location:** `default.trades_with_direction`  
**Rows:** 82,138,586  
**Engine:** ReplacingMergeTree  
**Updated:** Continuously from ERC1155 events

**Schema:**
| Column | Type | Source | Notes |
|--------|------|--------|-------|
| tx_hash | String | blockchain | Unique transaction hash |
| block_number | UInt32 | blockchain | Block containing trade |
| block_time | DateTime | blockchain | Trade timestamp |
| wallet_address | String | pm_user_proxy_wallets | Trader EOA |
| condition_id_norm | String | ctf_token_map | Normalized 64-char hex |
| market_id | String | gamma_markets | Polymarket ID |
| outcome_index | Int32 | ctf_token_map | 0-based outcome number |
| shares | Decimal(18,8) | ERC1155 amount | Tokens transferred |
| price | Decimal(18,8) | computed/api | Execution price |
| usd_value | Decimal(18,2) | ERC20 transfers | USDC amount |
| direction_from_transfers | String | computed | BUY/SELL/UNKNOWN |
| confidence | String | computed | HIGH/MEDIUM/LOW |
| reason | String | computed | Explanation of direction |
| source | String | metadata | Ingestion source |

---

### 3.2 vw_trades_canonical (Enriched View)

**Location:** `cascadian_clean.vw_trades_canonical`  
**Rows:** 157,000,000+  
**Type:** Materialized view  
**Rebuilt:** As source tables are updated

**Purpose:** Normalized, enriched, production-ready trades

**Key Features:**
- ✅ Normalizes condition_ids across all joins
- ✅ Excludes market_id='12' placeholders
- ✅ Computes net flows and direction
- ✅ Adds metadata from gamma_markets
- ✅ Ready for all downstream analytics

**Key Columns:**
```
trade_key: String (UUID)
transaction_hash: String
wallet_address_norm: String
market_id_norm: String
condition_id_norm: String
timestamp: DateTime
trade_direction: String (BUY/SELL)
direction_confidence: String
shares: Decimal(18,8)
usd_value: Decimal(18,2)
entry_price: Decimal(18,8)
outcome_index: Int32
outcome_token: String
created_at: DateTime
```

---

### 3.3 market_resolutions_final (Resolution Source of Truth)

**Location:** `default.market_resolutions_final`  
**Rows:** 224,396  
**Engine:** ReplacingMergeTree  
**Coverage:** 75.17% of all markets are genuinely unresolved

**Schema:**
| Column | Type | Values | Purpose |
|--------|------|--------|---------|
| condition_id_norm | FixedString(64) | hex | Unique condition identifier |
| payout_numerators | Array(UInt8) | [0,1] or [1,0] | Winner outcome payout |
| payout_denominator | UInt8 | 1-2 | Payout divisor |
| winning_index | UInt16 | 0+ | 0-based outcome winner |
| winning_outcome | String | text | Human-readable outcome |
| outcome_count | UInt8 | 2-4 | Number of possible outcomes |
| resolved_at | DateTime | or NULL | Resolution timestamp |
| source | String | chain/api | Data source |
| version | UInt8 | 1+ | Schema version |

**Critical Rules:**
```sql
-- Always cast FixedString to String for joins:
WHERE toString(condition_id_norm) = condition_id_norm_string

-- Filter valid resolutions:
WHERE payout_denominator > 0
  AND arraySum(payout_numerators) = payout_denominator
  AND resolved_at IS NOT NULL
```

---

## 4. HISTORICAL BACKFILL STRATEGY

### 4.1 Time Window Coverage

**Current Data:**
- Start: December 18, 2022 (Polymarket launch on Polygon)
- End: October 31, 2025 (current)
- Duration: 1,048 days
- Block Range: Approximately 45M blocks (43,200 blocks/day × 1,048 days)

**Blockchain Sync Method:**
```
Day 0: Blocks 0 - 43,199
Day 1: Blocks 43,200 - 86,399
...
Day 1047: Blocks ~45M blocks end
```

**Chunk Size:** 2,000 blocks per RPC call (Polygon recommends max 2,500)

---

### 4.2 Full Backfill Pipeline (2020-2024)

To backfill trades from before Dec 2022 or catch up to current:

**Option A: From Polymarket API (RECOMMENDED)**

Pros:
- ✅ Official source of truth
- ✅ Includes all historical trades
- ✅ Includes market metadata
- ✅ Rate limited but manageable
- ✅ 1-2 hours runtime

Cons:
- May not have full resolution data
- Rate limited (100 req/s)

**Implementation:**
```typescript
const response = await fetch(
  'https://clob.polymarket.com/positions?wallet=0x...',
  {
    headers: { 'Authorization': `Bearer ${CLOB_API_KEY}` }
  }
)
const positions = await response.json()  // ~2,800+ markets per wallet
// Map to condition_ids and insert into vw_trades_canonical
```

**Option B: Blockchain Reconstruction (EXHAUSTIVE)**

Pros:
- ✅ Verifiable on-chain data
- ✅ Complete history
- ✅ No API dependencies

Cons:
- ❌ 8-24 hours for full backfill
- ❌ Complex decoding logic
- ❌ May miss off-chain settlements
- ❌ High RPC cost

**Implementation:**
```typescript
// Parallel 8-worker system in step3-streaming-backfill-parallel.ts
const SHARDS = 8  // Run 8 workers in parallel
const SHARD_ID = process.env.SHARD_ID

// Each worker claims days and fetches logs
for (let day = SHARD_ID; day < TOTAL_DAYS; day += SHARDS) {
  const ranges = getBlockRangesForDay(day)
  for (const range of ranges) {
    const logs = await client.getLogs({
      address: CTF_ADDRESS,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
      topics: [ERC1155_TRANSFER_SINGLE_TOPIC]
    })
    // Insert into erc1155_transfers
  }
}
```

**Option C: Hybrid Approach (BEST)**

1. Query API for market list and metadata (fast)
2. Verify critical trades on blockchain (spot checks)
3. Store both with source attribution

---

### 4.3 Running a Full Backfill

**Prerequisites:**
```bash
# Install dependencies
npm install

# Set environment variables
export CLICKHOUSE_HOST=https://...
export CLICKHOUSE_USER=default
export CLICKHOUSE_PASSWORD=...
export CLICKHOUSE_DATABASE=default
export ETHEREUM_RPC_URLS=https://polygon-rpc-1,https://polygon-rpc-2
export CLOB_API_KEY=...
export CLOB_API_SECRET=...
export CLOB_API_PASSPHRASE=...
```

**Command to Run:**
```bash
# Full blockchain backfill (1,048 days)
npx tsx scripts/step3-streaming-backfill-parallel.ts

# Or with sharding (run 8 workers):
SHARDS=8 SHARD_ID=0 npx tsx scripts/step3-streaming-backfill-parallel.ts
SHARDS=8 SHARD_ID=1 npx tsx scripts/step3-streaming-backfill-parallel.ts
... (repeat for SHARD_ID=2-7)

# Monitor checkpoints
docker exec clickhouse clickhouse-client \
  -q "SELECT * FROM backfill_checkpoint ORDER BY day_idx"
```

**Expected Runtime:**
- Single worker: 2-5 hours
- 8 workers in parallel: 20-40 minutes total

**Validation:**
```sql
-- Check ingestion progress
SELECT
  COUNT(*) as total_rows,
  COUNT(DISTINCT tx_hash) as unique_txs,
  MIN(block_time) as earliest,
  MAX(block_time) as latest
FROM erc1155_transfers;

-- Should show ~291K rows increasing over time
```

---

## 5. DIRECTION ASSIGNMENT LOGIC (DETAILED)

### 5.1 The Challenge

**Problem:** ERC1155 events don't include trade price or direction (BUY vs SELL).  
They only show: sender → recipient transfer

**Solution:** Infer from net flows across ERC1155 + USDC transfers

### 5.2 Direction Algorithm

**Step 1: Reconstruct USDC flows**
```sql
WITH usdc_flows AS (
  SELECT
    tx_hash,
    wallet_address,
    SUM(CASE WHEN from_addr = wallet_address THEN -amount ELSE amount END) as usdc_net
  FROM erc20_transfers_decoded
  WHERE token = 'USDC'
  GROUP BY tx_hash, wallet_address
)
```

**Step 2: Calculate token net flows**
```sql
WITH token_flows AS (
  SELECT
    tx_hash,
    wallet_address,
    SUM(CASE WHEN from_addr = wallet_address THEN -amount ELSE amount END) as token_net
  FROM pm_erc1155_flats
  GROUP BY tx_hash, wallet_address, token_id
)
```

**Step 3: Determine direction**
```sql
SELECT
  *,
  CASE
    WHEN usdc_net > 0 AND token_net > 0 THEN 'BUY'      -- Spent USDC, got tokens
    WHEN usdc_net < 0 AND token_net < 0 THEN 'SELL'     -- Got USDC, spent tokens
    ELSE 'UNKNOWN'
  END as direction,
  CASE
    WHEN usdc_net != 0 AND token_net != 0 THEN 'HIGH'   -- Both legs present
    WHEN usdc_net != 0 OR token_net != 0 THEN 'MEDIUM'  -- Only one leg
    ELSE 'LOW'
  END as confidence
FROM usdc_flows f
LEFT JOIN token_flows t USING (tx_hash, wallet_address)
```

**Step 4: Assign outcome_index**
```sql
-- For BUY: typically buying outcome at index 0 or 1
-- For SELL: typically selling outcome at opposite index
-- Determined by comparing token_id to ctf_token_map
SELECT
  f.tx_hash,
  f.wallet_address,
  f.direction,
  t.outcome_index,  -- From ctf_token_map
  t.condition_id_norm
FROM combined_flows f
LEFT JOIN ctf_token_map t USING (token_id)
```

---

## 6. CRITICAL GOTCHAS & RULES

### 6.1 Condition ID Normalization (MUST DO)

**Problem:** Condition IDs appear in multiple formats across tables:
```
0xB3D36E59...      (uppercase with 0x)
0xb3d36e59...      (lowercase with 0x)
b3d36e59...        (lowercase no 0x)
B3D36E59...        (uppercase no 0x)
```

**Solution: ALWAYS Normalize**
```sql
-- Before any join:
lower(replaceAll(condition_id, '0x', '')) as condition_id_norm

-- This produces: 64-char lowercase hex (standard)
-- Example: "b3d36e59d0bda47a29e7f4f06e19db1f08d50ddd2f1b2c5f6a8e9d0c1b2a3f4e"

-- In joins:
WHERE
  lower(replaceAll(t.condition_id, '0x', ''))
  = lower(replaceAll(r.condition_id, '0x', ''))
```

### 6.2 FixedString(64) Casting

**Problem:** `market_resolutions_final.condition_id_norm` is FixedString(64), not String

**Solution:**
```sql
-- Before comparison:
WHERE toString(r.condition_id_norm) = t.condition_id_norm
```

### 6.3 Placeholder Market IDs

**Problem:** Corrupted trades have market_id='12' or token_id='' (placeholders)

**Solution:**
```sql
WHERE
  market_id NOT IN ('12', '0', '')
  AND token_id NOT IN ('', '0x')
  AND condition_id_norm NOT IN ('', '0000000000000000000000000000000000000000000000000000000000000000')
```

### 6.4 Enum8 Side Fields

**Problem:** `trades_raw.side` is Enum8 with values 'YES'/'NO', not numeric

**Solution:**
```sql
-- Don't do this:
CASE WHEN side = 1 THEN ... END  -- WRONG

-- Do this:
CASE WHEN side = 'YES' THEN ...  -- RIGHT
```

### 6.5 Array Indexing (ClickHouse 1-Based)

**Problem:** ClickHouse arrays are 1-indexed, not 0-based

**Solution:**
```sql
-- To get outcome at index 0:
arrayElement(payout_numerators, 0 + 1)  -- Use +1

-- Get winning outcome payout:
arrayElement(payout_numerators, winning_index + 1)
```

---

## 7. RECOMMENDED PRODUCTION QUERY

**Use this as the standard for all trades queries:**

```sql
SELECT
  t.tx_hash,
  t.wallet_address,
  t.condition_id_norm,
  t.market_id,
  t.outcome_index,
  t.shares,
  t.price,
  t.usd_value,
  t.direction_from_transfers as direction,
  t.confidence,
  r.winning_index,
  r.payout_numerators,
  r.payout_denominator,
  -- PnL calculation
  CASE
    WHEN r.winning_index IS NOT NULL THEN
      t.shares * (arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - t.usd_value
    ELSE
      NULL  -- Market not resolved
  END as realized_pnl_usd

FROM default.trades_with_direction t

LEFT JOIN default.market_resolutions_final r
  ON toString(r.condition_id_norm) = t.condition_id_norm

WHERE
  -- Exclude placeholders
  t.market_id NOT IN ('12', '0', '')
  AND t.condition_id_norm NOT IN ('', '0' || repeat('0', 62))

  -- Filter wallets (optional)
  AND t.wallet_address IN (...)

  -- Filter date range (optional)
  AND t.block_time >= toDateTime('2024-01-01')

ORDER BY t.block_time DESC
```

---

## 8. TROUBLESHOOTING & VALIDATION

### 8.1 Validation Queries

**Check trades_with_direction coverage:**
```sql
SELECT
  COUNT(*) as total_trades,
  COUNT(DISTINCT tx_hash) as unique_txs,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  COUNT(DISTINCT condition_id_norm) as unique_markets,
  MIN(block_time) as earliest_trade,
  MAX(block_time) as latest_trade,
  COUNT(DISTINCT direction_from_transfers) as direction_types
FROM trades_with_direction
WHERE confidence = 'HIGH';
```

**Expected output:**
```
total_trades:      82,138,586
unique_txs:        ~33,600,000
unique_wallets:    ~936,800
unique_markets:    ~150,000
earliest_trade:    2022-12-18
latest_trade:      2025-10-31
direction_types:   3 (BUY, SELL, UNKNOWN)
```

**Check for missing direction assignments:**
```sql
SELECT
  direction_from_transfers,
  COUNT(*) as count,
  COUNT(*) * 100.0 / (SELECT COUNT(*) FROM trades_with_direction) as pct
FROM trades_with_direction
GROUP BY direction_from_transfers
ORDER BY count DESC;
```

**Expected distribution:**
- BUY: ~35-40%
- SELL: ~35-40%
- UNKNOWN: ~20-30%

### 8.2 Common Issues & Fixes

| Issue | Symptom | Root Cause | Fix |
|-------|---------|-----------|-----|
| Join returns 0 rows | No matches between tables | Condition ID format mismatch | Normalize: `lower(replaceAll(...))` |
| Wrong P&L calculation | 100x or 0.01x off | Array indexing issue (0-based vs 1-based) | Use `arrayElement(..., index + 1)` |
| Market_id='12' in results | Spurious trades appear | Placeholder data ingestion | Filter: `WHERE market_id NOT IN ('12')` |
| Direction is UNKNOWN for all | No direction assignments | USDC flow not matched | Check erc20_transfers_decoded joins |
| Missing recent trades | Historical data only | Backfill not up to date | Run `step3-streaming-backfill-parallel.ts` |

---

## 9. FILES REFERENCE

### Key Ingestion Scripts
- `/worker-clob-api.ts` - CLOB API market mapping
- `/scripts/step3-streaming-backfill-parallel.ts` - Blockchain sync (8-worker sharded)
- `/scripts/flatten-erc1155.ts` - ERC1155 event flattening
- `/scripts/build-approval-proxies.ts` - Proxy wallet discovery
- `/scripts/build-positions-from-erc1155.ts` - Position reconstruction

### Key SQL/Schema Files
- `/migrations/clickhouse/001_create_trades_table.sql` - Initial schema
- `/DATABASE_ARCHITECTURE_REFERENCE.md` - Authoritative schema docs
- `/POLYMARKET_DATA_FLOW_DIAGRAM.md` - Visual data flow

### Investigation & Reference
- `/SMOKING_GUN_FINDINGS.md` - Data quality analysis
- `/BACKFILL_INVESTIGATION_FINAL_REPORT.md` - Complete table audit
- `/CLAUDE.md` - Project guidelines (Stable Pack section)

---

## 10. KEY METRICS

| Metric | Value | Notes |
|--------|-------|-------|
| **Total Trades** | 82M+ | trades_with_direction |
| **Unique Wallets** | 936K+ | Active traders |
| **Unique Markets** | 150K+ | Condition IDs |
| **Data Coverage** | 1,048 days | Dec 2022 - Oct 2025 |
| **High Confidence Trades** | 77%+ | direction_confidence='HIGH' |
| **Resolved Markets** | 224K (75% gap) | Unresolved markets are genuine |
| **Backfill Runtime** | 2-5 hours | Single worker, full 1,048 days |
| **Parallel Runtime** | 20-40 min | 8 workers in parallel |

---

**Document Version:** 2.0  
**Last Updated:** November 9, 2025  
**Maintained By:** Cascadian Data Platform Team  
**Status:** CURRENT & AUTHORITATIVE

