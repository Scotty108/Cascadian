# Polymarket ClickHouse Data Pipeline - Audit Report & Implementation Plan

**Generated:** 2025-11-06
**Status:** Complete audit with exact implementation steps

---

## Executive Summary

This report provides a comprehensive audit of the Cascadian Polymarket ClickHouse data pipeline and exact SQL/TypeScript implementation steps to:

1. **Autodetect** the ConditionalTokens contract address
2. **Populate** `pm_erc1155_flats` from raw `erc1155_transfers`
3. **Build** `pm_user_proxy_wallets` from ApprovalForAll events
4. **Enhance** `ctf_token_map` with market_id and outcome columns
5. **Ingest** CLOB fills with lossless pagination
6. **Create** enriched views for analytics

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Autodetect CT Address](#autodetect-ct-address)
3. [Implementation Plan](#implementation-plan)
4. [Scripts Created](#scripts-created)
5. [Testing & Validation](#testing--validation)
6. [Estimated Runtime](#estimated-runtime)
7. [Edge Cases & Solutions](#edge-cases--solutions)

---

## Current State Analysis

### Source Tables

#### erc1155_transfers
- **Purpose:** Raw ERC1155 event logs from blockchain
- **Contains:** TransferSingle, TransferBatch, ApprovalForAll events
- **Schema:**
  ```sql
  - block_number: UInt32
  - block_time: DateTime
  - tx_hash: String
  - log_index: UInt32
  - address: String (contract address)
  - topics: Array(String) (indexed parameters)
  - data: String (non-indexed parameters)
  ```
- **Issues:**
  - Data is not decoded (hex strings in topics/data)
  - TransferBatch requires ABI decoding
  - No market context

### Target Tables

#### 1. pm_erc1155_flats
- **Status:** ⚠️ EMPTY - needs population
- **Purpose:** Flattened, decoded ERC1155 transfers
- **Required Schema:**
  ```sql
  CREATE TABLE pm_erc1155_flats (
    block_number   UInt32,
    block_time     DateTime,
    tx_hash        String,
    log_index      UInt32,
    operator       String,      -- Decoded from topics[2]
    from_addr      String,      -- Decoded from topics[3]
    to_addr        String,      -- Decoded from topics[4]
    token_id       String,      -- Extracted from data
    amount         String,      -- Extracted from data
    event_type     LowCardinality(String) DEFAULT 'single'
  ) ENGINE = MergeTree
  PARTITION BY toYYYYMM(block_time)
  ORDER BY (block_number, tx_hash, log_index);
  ```

#### 2. pm_user_proxy_wallets
- **Status:** ⚠️ MAY BE EMPTY - needs population from ApprovalForAll
- **Purpose:** Maps user EOA addresses to their proxy wallets
- **Existing Script:** `/scripts/build-approval-proxies.ts` (has incorrect event signature)
- **Correct Event Signature:** `0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31`
- **Current Script Uses:** `0xa39707aee45523880143dba1da92036e62aa63c0` ❌ WRONG

#### 3. ctf_token_map
- **Status:** ❌ MISSING COLUMNS - needs market_id and outcome
- **Purpose:** Maps token IDs to markets and outcomes
- **Current Schema:** token_id, condition_id_norm, outcome_index
- **Missing Columns:**
  - `market_id String` - Link to gamma_markets
  - `outcome String` - Outcome label (Yes/No/outcome name)
  - `question String` - Market question text

#### 4. gamma_markets
- **Status:** ✅ EXISTS - source of market data
- **Key Columns:**
  - `market_id` - Polymarket market ID
  - `condition_id` - Blockchain condition ID
  - `question` - Market question
  - `outcomes` - Array(String) of outcome labels
  - `category` - Market category

#### 5. market_resolutions_final
- **Status:** ❓ UNKNOWN - may exist
- **Purpose:** Resolution data for settled markets
- **Key Columns:**
  - `market_id`
  - `winner` - Winning outcome
  - `winning_outcome_index`
  - `is_resolved`

#### 6. pm_trades
- **Status:** ❓ UNKNOWN - for CLOB fills
- **Purpose:** Trade fills from CLOB API

---

## Autodetect CT Address

### Method
Query `erc1155_transfers` for the address emitting the most TransferSingle/TransferBatch events.

### SQL Query
```sql
SELECT
  lower(address) as address,
  count() AS event_count
FROM erc1155_transfers
WHERE topics[1] IN (
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',  -- TransferSingle
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'   -- TransferBatch
)
GROUP BY address
ORDER BY event_count DESC
LIMIT 5;
```

### Expected Result
Top address should be: `0x4d97dcd97ec945f40cf65f87097ace5ea0476045` (Polymarket ConditionalTokens on Polygon)

### Execution
```bash
npx tsx scripts/audit-polymarket-clickhouse.ts
```

---

## Implementation Plan

### STEP 1: Autodetect CT Address (READ-ONLY)
**Duration:** < 30 seconds

```bash
npx tsx scripts/audit-polymarket-clickhouse.ts
```

**Output:** Detected CT address and current state of all tables

---

### STEP 2: Populate pm_erc1155_flats

#### 2A: TransferSingle Events
**Duration:** 10-30 minutes (depends on row count)

**Script:** `/scripts/flatten-erc1155.ts`

**How it works:**
1. Queries `erc1155_transfers` for TransferSingle events
2. Extracts operator, from, to from topics[2-4]
3. Extracts token_id (bytes 0-32) and amount (bytes 32-64) from data field
4. Inserts into `pm_erc1155_flats` in batches

**Execute:**
```bash
npx tsx scripts/flatten-erc1155.ts
```

**Verification:**
```sql
SELECT
  event_type,
  COUNT(*) as cnt
FROM pm_erc1155_flats
GROUP BY event_type;
```

#### 2B: TransferBatch Events
**Duration:** 5-15 minutes

**Script:** `/scripts/decode-transfer-batch.ts` (NEW - just created)

**How it works:**
1. Uses ethers.js Interface to properly decode TransferBatch data
2. Data contains two dynamic arrays: ids[] and amounts[]
3. Flattens into individual rows (one per token in batch)
4. Marks with `event_type = 'batch'`

**Execute:**
```bash
npx tsx scripts/decode-transfer-batch.ts
```

**Why needed:** TransferBatch has complex ABI encoding that can't be parsed with simple hex slicing. Must use ethers.js ABI decoder.

---

### STEP 3: Build pm_user_proxy_wallets

#### 3A: Fix ApprovalForAll Event Signature
**Issue:** Existing script uses incorrect signature

**Fix in:** `/scripts/build-approval-proxies.ts`

**Change:**
```typescript
// WRONG (current):
const APPROVAL_FOR_ALL_SIG = "0xa39707aee45523880143dba1da92036e62aa63c0";

// CORRECT:
const APPROVAL_FOR_ALL = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";
```

#### 3B: Execute Script
**Duration:** 5-10 minutes

```bash
npx tsx scripts/build-approval-proxies.ts
```

**What it does:**
1. Creates `pm_user_proxy_wallets` table if not exists
2. Extracts ApprovalForAll events from `erc1155_transfers`
3. Decodes topics[2] → user_eoa, topics[3] → proxy_wallet
4. Tracks approval/revocation status from data field
5. Inserts with first_seen_at and last_seen_at

**Schema:**
```sql
CREATE TABLE pm_user_proxy_wallets (
  user_eoa         String,
  proxy_wallet     String,
  source           String DEFAULT 'onchain',
  first_seen_block UInt32,
  last_seen_block  UInt32,
  first_seen_at    DateTime,
  last_seen_at     DateTime DEFAULT now(),
  is_active        UInt8 DEFAULT 1
) ENGINE = ReplacingMergeTree()
PRIMARY KEY (proxy_wallet)
ORDER BY (proxy_wallet);
```

---

### STEP 4: Enhance ctf_token_map

#### 4A: Run Migration
**Duration:** < 1 minute

```bash
# Apply migration
clickhouse-client --queries-file migrations/clickhouse/016_enhance_polymarket_tables.sql
```

**What it does:**
- Adds `market_id String` column
- Adds `outcome String` column
- Adds `outcome_index UInt8` column
- Adds `question String` column
- Creates bloom filter indexes

#### 4B: Populate Market Data
**Duration:** 2-10 minutes

**Script:** `/scripts/enrich-token-map.ts` (NEW - just created)

```bash
npx tsx scripts/enrich-token-map.ts
```

**Two methods (script tries both):**

**Method 1: Direct UPDATE**
```sql
ALTER TABLE ctf_token_map
UPDATE
  market_id = m.market_id,
  outcome = arrayElement(m.outcomes, outcome_index + 1),
  question = m.question
FROM gamma_markets m
WHERE ctf_token_map.condition_id_norm = m.condition_id
  AND ctf_token_map.market_id = '';
```

**Method 2: Create enriched table and swap** (if Method 1 not supported)
```sql
CREATE TABLE ctf_token_map_enriched
ENGINE = MergeTree
ORDER BY (token_id, condition_id_norm)
AS
SELECT
  t.token_id,
  t.condition_id_norm,
  COALESCE(m.market_id, '') AS market_id,
  COALESCE(arrayElement(m.outcomes, t.outcome_index + 1), '') AS outcome,
  t.outcome_index,
  COALESCE(m.question, '') AS question
FROM ctf_token_map t
LEFT JOIN gamma_markets m
  ON t.condition_id_norm = m.condition_id;

-- Then manually:
RENAME TABLE ctf_token_map TO ctf_token_map_backup;
RENAME TABLE ctf_token_map_enriched TO ctf_token_map;
DROP TABLE ctf_token_map_backup;
```

**Verification:**
```sql
SELECT
  COUNT(*) as total,
  countIf(market_id != '') as with_market_id,
  countIf(outcome != '') as with_outcome
FROM ctf_token_map;
```

---

### STEP 5: Create Enriched Views

**Duration:** < 1 minute

```sql
-- Already in migration 016_enhance_polymarket_tables.sql

-- View 1: markets_enriched
CREATE OR REPLACE VIEW markets_enriched AS
SELECT
  m.*,
  r.winner,
  r.winning_outcome_index,
  r.is_resolved
FROM gamma_markets m
LEFT JOIN market_resolutions_final r
  ON m.market_id = r.market_id;

-- View 2: token_market_enriched
CREATE OR REPLACE VIEW token_market_enriched AS
SELECT
  t.token_id,
  t.condition_id_norm,
  t.market_id,
  t.outcome,
  t.outcome_index,
  t.question,
  m.outcomes AS all_outcomes,
  m.category,
  m.is_resolved,
  m.winner,
  IF(m.is_resolved = 1 AND t.outcome_index = m.winning_outcome_index, 1, 0) AS is_winning_outcome
FROM ctf_token_map t
LEFT JOIN markets_enriched m ON t.market_id = m.market_id
WHERE t.market_id != '';

-- View 3: erc1155_transfers_enriched
CREATE OR REPLACE VIEW erc1155_transfers_enriched AS
SELECT
  f.*,
  t.market_id,
  t.outcome,
  t.question,
  t.is_winning_outcome,
  pf.user_eoa AS from_eoa,
  pt.user_eoa AS to_eoa
FROM pm_erc1155_flats f
LEFT JOIN token_market_enriched t ON f.token_id = t.token_id
LEFT JOIN pm_user_proxy_wallets pf ON lower(f.from_addr) = lower(pf.proxy_wallet) AND pf.is_active = 1
LEFT JOIN pm_user_proxy_wallets pt ON lower(f.to_addr) = lower(pt.proxy_wallet) AND pt.is_active = 1;
```

---

### STEP 6: Ingest CLOB Fills

**Duration:** 30-120 minutes (depends on number of wallets and API rate limits)

**Script:** `/scripts/ingest-clob-fills.ts` (EXISTS - may need updates)

**Current issues:**
- Uses old pm_trades schema
- May not handle pagination properly
- Doesn't enrich with market data

**Enhanced schema (from migration 016):**
```sql
CREATE TABLE IF NOT EXISTS pm_trades (
  id                 String,
  market_id          String,
  asset_id           String,
  side               LowCardinality(String),
  size               String,
  price              Float64,
  fee_rate_bps       UInt16,
  maker_address      String,
  taker_address      String,
  maker_orders       Array(String),
  taker_order_id     String,
  transaction_hash   String,
  timestamp          DateTime,
  created_at         DateTime DEFAULT now(),
  outcome            String DEFAULT '',
  question           String DEFAULT '',
  size_usd           Float64 DEFAULT 0.0
) ENGINE = ReplacingMergeTree(created_at)
ORDER BY (market_id, timestamp, id)
PARTITION BY toYYYYMM(timestamp);
```

**Execute:**
```bash
npx tsx scripts/ingest-clob-fills.ts
```

**Pagination strategy:**
The Polymarket CLOB API supports pagination via:
- `limit` parameter (max 1000)
- `next_cursor` parameter for pagination

**Improved fetch logic:**
```typescript
async function fetchAllFillsForMarket(
  marketId: string,
  batchSize = 1000
): Promise<ClobFill[]> {
  const allFills: ClobFill[] = [];
  let cursor: string | undefined;

  do {
    const url = cursor
      ? `${CLOB_API}/api/v1/trades?market=${marketId}&limit=${batchSize}&cursor=${cursor}`
      : `${CLOB_API}/api/v1/trades?market=${marketId}&limit=${batchSize}`;

    const resp = await fetch(url);
    const data = await resp.json();

    allFills.push(...data.data);
    cursor = data.next_cursor;

    await new Promise(r => setTimeout(r, 100)); // Rate limit
  } while (cursor);

  return allFills;
}
```

---

## Scripts Created

| Script | Purpose | Status |
|--------|---------|--------|
| `scripts/audit-polymarket-clickhouse.ts` | Comprehensive audit of all tables | ✅ NEW |
| `scripts/flatten-erc1155.ts` | Populate pm_erc1155_flats (TransferSingle) | ✅ EXISTS |
| `scripts/decode-transfer-batch.ts` | Decode TransferBatch with ethers.js | ✅ NEW |
| `scripts/build-approval-proxies.ts` | Build proxy wallet mappings | ⚠️ EXISTS (needs signature fix) |
| `scripts/enrich-token-map.ts` | Add market_id/outcome to ctf_token_map | ✅ NEW |
| `scripts/ingest-clob-fills.ts` | Ingest CLOB fills with pagination | ⚠️ EXISTS (may need updates) |
| `migrations/clickhouse/016_enhance_polymarket_tables.sql` | Add columns and create views | ✅ NEW |

---

## Testing & Validation

### After Each Step

#### Step 2: Verify pm_erc1155_flats
```sql
-- Check row counts by event type
SELECT event_type, COUNT(*) as cnt, min(block_time) as first, max(block_time) as last
FROM pm_erc1155_flats
GROUP BY event_type;

-- Sample data
SELECT * FROM pm_erc1155_flats LIMIT 5;

-- Verify token_id format (should be 66 chars: 0x + 64 hex)
SELECT
  length(token_id) as id_length,
  COUNT(*) as cnt
FROM pm_erc1155_flats
GROUP BY id_length;
```

#### Step 3: Verify pm_user_proxy_wallets
```sql
-- Active mappings
SELECT
  COUNT(*) as total,
  COUNT(DISTINCT user_eoa) as unique_eoas,
  COUNT(DISTINCT proxy_wallet) as unique_proxies
FROM pm_user_proxy_wallets
WHERE is_active = 1;

-- Sample data
SELECT * FROM pm_user_proxy_wallets LIMIT 5;

-- Check for data quality issues
SELECT
  countIf(user_eoa = '' OR user_eoa = '0x0000000000000000000000000000000000000000') as bad_eoas,
  countIf(proxy_wallet = '' OR proxy_wallet = '0x0000000000000000000000000000000000000000') as bad_proxies
FROM pm_user_proxy_wallets;
```

#### Step 4: Verify ctf_token_map enrichment
```sql
-- Enrichment coverage
SELECT
  COUNT(*) as total_tokens,
  countIf(market_id != '') as with_market,
  countIf(outcome != '') as with_outcome,
  countIf(question != '') as with_question,
  round(countIf(market_id != '') / COUNT(*) * 100, 2) as coverage_pct
FROM ctf_token_map;

-- Sample enriched tokens
SELECT token_id, market_id, outcome, outcome_index, substring(question, 1, 50) as q
FROM ctf_token_map
WHERE market_id != ''
LIMIT 10;

-- Tokens without market data (investigate)
SELECT token_id, condition_id_norm
FROM ctf_token_map
WHERE market_id = ''
LIMIT 10;
```

#### Step 5: Verify views
```sql
-- Test markets_enriched
SELECT market_id, question, is_resolved, winner
FROM markets_enriched
WHERE is_resolved = 1
LIMIT 5;

-- Test token_market_enriched
SELECT token_id, market_id, outcome, is_winning_outcome
FROM token_market_enriched
WHERE market_id != ''
LIMIT 10;

-- Test erc1155_transfers_enriched
SELECT
  tx_hash,
  from_addr,
  from_eoa,
  to_addr,
  to_eoa,
  token_id,
  market_id,
  outcome
FROM erc1155_transfers_enriched
WHERE market_id != ''
LIMIT 10;
```

#### Step 6: Verify pm_trades
```sql
-- Trade statistics
SELECT
  COUNT(*) as total_trades,
  COUNT(DISTINCT market_id) as unique_markets,
  COUNT(DISTINCT maker_address) as unique_makers,
  COUNT(DISTINCT taker_address) as unique_takers,
  min(timestamp) as first_trade,
  max(timestamp) as last_trade,
  sum(size_usd) as total_volume_usd
FROM pm_trades;

-- Sample trades
SELECT * FROM pm_trades LIMIT 5;

-- Missing market data
SELECT COUNT(*) as trades_without_market
FROM pm_trades
WHERE market_id = '';
```

### End-to-End Validation

```sql
-- Complete data flow test
WITH sample_tokens AS (
  SELECT token_id
  FROM ctf_token_map
  WHERE market_id != ''
  LIMIT 100
)
SELECT
  COUNT(DISTINCT t.token_id) as tokens,
  COUNT(DISTINCT f.tx_hash) as transfers,
  COUNT(DISTINCT tr.id) as trades,
  COUNT(DISTINCT p.proxy_wallet) as proxies
FROM sample_tokens st
LEFT JOIN pm_erc1155_flats f ON st.token_id = f.token_id
LEFT JOIN pm_trades tr ON st.token_id = tr.asset_id
LEFT JOIN pm_user_proxy_wallets p ON lower(f.to_addr) = lower(p.proxy_wallet);
```

---

## Estimated Runtime

| Step | Task | Estimated Time | Parallelizable |
|------|------|----------------|----------------|
| 1 | Autodetect CT address | 30 seconds | N/A |
| 2A | Flatten TransferSingle | 10-30 minutes | No |
| 2B | Decode TransferBatch | 5-15 minutes | No |
| 3 | Build proxy wallets | 5-10 minutes | No |
| 4A | Add columns to ctf_token_map | < 1 minute | No |
| 4B | Enrich ctf_token_map | 2-10 minutes | No |
| 5 | Create views | < 1 minute | No |
| 6 | Ingest CLOB fills | 30-120 minutes | Partially |

**Total Estimated Time:** 1-3 hours (depends on data volume and API rate limits)

**Bottlenecks:**
- Step 2A: Large number of TransferSingle events
- Step 6: CLOB API rate limits

**Optimization opportunities:**
- Step 2A & 2B can run in parallel after audit
- Step 6 can fetch multiple wallets in parallel (respect rate limits)

---

## Edge Cases & Solutions

### 1. TransferBatch Decoding Failures

**Issue:** Some TransferBatch events may have malformed data

**Solution:**
```typescript
// In decode-transfer-batch.ts
try {
  const decodedData = iface.parseLog({ topics: row.topics, data: row.data });
  // ... process
} catch (e) {
  failed++;
  if (failed <= 10) {
    console.error(`Failed to decode event at block ${row.block_number}: ${e.message}`);
  }
  continue; // Skip malformed events
}
```

### 2. Address Extraction from Topics

**Issue:** Topics are 32-byte padded, addresses are 20 bytes

**Solution:**
```typescript
function extractAddress(topic: string): string {
  // Topics format: 0x + 64 hex chars (32 bytes)
  // Address is last 20 bytes (40 hex chars)
  if (!topic || topic.length < 66) return "0x0000000000000000000000000000000000000000";
  return "0x" + topic.slice(-40);
}

// In SQL:
lower(substring(topics[2], 27)) -- Skip 0x + 24 hex chars padding
```

### 3. Condition ID Normalization

**Issue:** `ctf_token_map.condition_id_norm` may differ from `gamma_markets.condition_id`

**Symptoms:** Low join coverage in Step 4B

**Investigation:**
```sql
-- Check format differences
SELECT DISTINCT length(condition_id_norm) as len FROM ctf_token_map LIMIT 10;
SELECT DISTINCT length(condition_id) as len FROM gamma_markets LIMIT 10;

-- Check case sensitivity
SELECT DISTINCT substring(condition_id_norm, 1, 10) FROM ctf_token_map LIMIT 10;
SELECT DISTINCT substring(condition_id, 1, 10) FROM gamma_markets LIMIT 10;
```

**Solution:** Apply normalization in join:
```sql
WHERE lower(trim(ctf_token_map.condition_id_norm)) = lower(trim(m.condition_id))
```

### 4. Outcome Array Indexing

**Issue:** ClickHouse arrays are 1-indexed, but outcome_index may be 0-indexed

**Test:**
```sql
SELECT
  outcome_index,
  outcomes,
  arrayElement(outcomes, outcome_index) as zero_based,
  arrayElement(outcomes, outcome_index + 1) as one_based
FROM gamma_markets
WHERE arraySize(outcomes) > 1
LIMIT 5;
```

**Solution:** Use `arrayElement(outcomes, outcome_index + 1)` if 0-indexed

### 5. CLOB API Rate Limiting

**Issue:** API may return 429 Too Many Requests

**Solution:**
```typescript
async function fetchWithRetry(url: string, maxRetries = 3): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(url);
      if (resp.status === 429) {
        const waitTime = Math.pow(2, i) * 1000; // Exponential backoff
        console.log(`Rate limited. Waiting ${waitTime}ms...`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      return await resp.json();
    } catch (e) {
      if (i === maxRetries - 1) throw e;
    }
  }
}
```

### 6. Proxy Wallet Revocations

**Issue:** ApprovalForAll can be revoked (approved = false)

**Solution:** Track latest state using `ReplacingMergeTree` and `is_active` flag

```sql
-- Only active proxies
SELECT * FROM pm_user_proxy_wallets WHERE is_active = 1;
```

### 7. Missing Market Data in ctf_token_map

**Issue:** Some tokens may not have matching markets in gamma_markets

**Investigation:**
```sql
SELECT
  COUNT(*) as unmatched_tokens,
  COUNT(DISTINCT condition_id_norm) as unique_conditions
FROM ctf_token_map
WHERE market_id = '';

-- Check if these conditions exist in gamma_markets
SELECT c.condition_id_norm
FROM ctf_token_map c
LEFT JOIN gamma_markets m ON c.condition_id_norm = m.condition_id
WHERE c.market_id = '' AND m.market_id IS NULL
LIMIT 10;
```

**Solution:** These may be old/deprecated markets. Document coverage % and exclude from analytics.

---

## Execution Checklist

```bash
# Prerequisites
export CLICKHOUSE_HOST="https://your-clickhouse-instance"
export CLICKHOUSE_USER="default"
export CLICKHOUSE_PASSWORD="your-password"
export CLICKHOUSE_DATABASE="default"

# Step 1: Audit current state
npx tsx scripts/audit-polymarket-clickhouse.ts > audit-report.txt

# Step 2: Populate pm_erc1155_flats
npx tsx scripts/flatten-erc1155.ts
npx tsx scripts/decode-transfer-batch.ts

# Step 3: Build proxy wallets (after fixing signature)
npx tsx scripts/build-approval-proxies.ts

# Step 4: Enhance ctf_token_map
clickhouse-client --queries-file migrations/clickhouse/016_enhance_polymarket_tables.sql
npx tsx scripts/enrich-token-map.ts

# Step 5: Views created in migration above (no action needed)

# Step 6: Ingest CLOB fills
npx tsx scripts/ingest-clob-fills.ts

# Validation
clickhouse-client --query "SELECT COUNT(*) FROM pm_erc1155_flats"
clickhouse-client --query "SELECT COUNT(*) FROM pm_user_proxy_wallets WHERE is_active = 1"
clickhouse-client --query "SELECT countIf(market_id != '') / COUNT(*) as coverage FROM ctf_token_map"
clickhouse-client --query "SELECT COUNT(*) FROM pm_trades"
```

---

## Next Steps After Implementation

1. **Build Position Tracking:**
   - Aggregate `pm_erc1155_flats` by wallet + token
   - Calculate net positions (received - sent)
   - Join with `token_market_enriched` for P&L

2. **Build Wallet Analytics:**
   - Win rate by wallet
   - ROI by wallet
   - Category preferences
   - Trading patterns

3. **Build Market Analytics:**
   - Volume by market
   - Liquidity depth
   - Price movements
   - Popular outcomes

4. **Real-time Updates:**
   - Set up streaming ingestion from new blocks
   - Incremental updates instead of full reprocessing
   - Trigger refreshes on new data

5. **Performance Optimization:**
   - Add projections for common query patterns
   - Optimize table partitioning
   - Add materialized views for heavy aggregations

---

## Appendix: Event Signatures Reference

```typescript
// ERC1155 Events
const TRANSFER_SINGLE = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const TRANSFER_BATCH = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";
const APPROVAL_FOR_ALL = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";

// ConditionalTokens Contract (Polygon)
const CONDITIONAL_TOKENS = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
```

---

## Appendix: Key SQL Patterns

### Extract address from topic
```sql
lower(substring(topic, 27)) -- Removes 0x + 24 chars padding, takes last 40 chars
```

### Extract uint256 from hex
```sql
reinterpretAsUInt256(reverse(unhex(substring(hex_value, 3))))
```

### Array element (1-indexed)
```sql
arrayElement(array_column, index + 1) -- If index is 0-based
```

### Join with deduplication
```sql
FROM table1 t
LEFT JOIN (
  SELECT DISTINCT col1, col2 FROM table2
) t2 ON t.col1 = t2.col1
```

---

**End of Report**
