# Cascadian P&L Rebuild Scripts - Complete Index

## Overview
This document provides a complete index of all scripts that rebuild the core P&L tables:
- `outcome_positions_v2` (wallet positions per market/outcome)
- `trade_cashflows_v3` (wallet cashflows per market/outcome)
- `realized_pnl_by_market_final` (final P&L calculations)

---

## Primary Daily Rebuild Script

### **Daily Sync (MAIN)**
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/daily-sync-polymarket.ts`
**Purpose:** Rebuilds P&L tables from source blockchain data
**Execution:** Manual trigger or daily cron
**Duration:** 2-5 hours (first run), <5 minutes (incremental)

**What it does:**
1. Rebuilds `outcome_positions_v2` from `erc1155_transfers`
2. Rebuilds `trade_cashflows_v3` from `erc20_transfers`
3. Uses atomic RENAME to avoid data loss
4. Handles NULL values and filters invalid outcomes

**Key SQL:**
```sql
CREATE TABLE outcome_positions_v2_new AS
SELECT wallet, market_id, condition_id_norm, outcome_idx,
       SUM(CAST(balance AS Float64)) AS net_shares
FROM erc1155_transfers
WHERE outcome_idx >= 0
GROUP BY wallet, market_id, condition_id_norm, outcome_idx
HAVING net_shares != 0;
RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old;
RENAME TABLE outcome_positions_v2_new TO outcome_positions_v2;
DROP TABLE outcome_positions_v2_old;
```

---

## Data Pipeline Scripts (In Order)

### 1. Create Staging Tables
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/create-transfer-staging-tables.ts`
**Purpose:** Initialize empty ClickHouse tables for blockchain data
**Tables Created:**
- `erc20_transfers_staging` (ReplacingMergeTree)
- `erc1155_transfers_staging` (ReplacingMergeTree)
- `backfill_checkpoint` (progress tracking)
- `worker_heartbeats` (worker monitoring)

---

### 2. Parallel Backfill from Blockchain
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/step3-streaming-backfill-parallel.ts`
**Purpose:** Fetch 1,048 days of blockchain logs and populate staging tables
**Configuration:**
- Workers: 8 (SHARDS=8, one per SHARD_ID)
- Total Days: 1,048 (2022-12-18 to 2025-10-31)
- CTF Address: `0xd552174f4f14c8f9a6eb4d51e5d2c7bbeafccf61`
- USDC Address: `0x2791bca1f2de4661ed88a30c99a7a9449aa84174`
- Duration: 2-5 hours

**What it does:**
1. Calculates block ranges (43,200 blocks/day)
2. Fetches ERC20 Transfer logs for USDC
3. Fetches ERC1155 Transfer logs for ConditionalTokens
4. Inserts into staging tables in 5,000-row batches
5. Records checkpoint for each day (prevents reprocessing)

**Usage:**
```bash
# Run for 8 workers in parallel
SHARD_ID=0 npx tsx scripts/step3-streaming-backfill-parallel.ts &
SHARD_ID=1 npx tsx scripts/step3-streaming-backfill-parallel.ts &
# ... etc to SHARD_ID=7
```

---

### 3. Flatten ERC1155 Events
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/flatten-erc1155.ts`
**Purpose:** Decode ERC1155 transfer events into readable format
**Tables Created/Updated:**
- `pm_erc1155_flats` (flattened transfers with decoded data)

**What it does:**
1. Reads `erc1155_transfers` from blockchain
2. Decodes TransferSingle events (extracts token_id, amount from data field)
3. Decodes TransferBatch events (complex ABI decoding)
4. Stores results in `pm_erc1155_flats` table

**Schema:**
```
block_number     UInt32
block_time       DateTime
tx_hash          String
log_index        UInt32
operator         String
from_address     String (lowercase)
to_address       String (lowercase)
token_id         String (HEX format 0x...)
amount           String (HEX format 0x...)
address          String (contract address)
```

---

### 4. Build Proxy Mappings
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/build-approval-proxies.ts`
**Purpose:** Create EOA → proxy wallet mappings for wallet consolidation
**Tables Created:**
- `pm_user_proxy_wallets` (links user_eoa to proxy_wallet addresses)

**What it does:**
1. Analyzes approval transactions
2. Links original EOA wallet addresses to their proxy wallets
3. Tracks first_seen_at and last_seen_at
4. Enables wallet tracking across different wallet addresses

---

### 5. Further ERC1155 Enrichment
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/flatten-erc1155-correct.ts`
**Purpose:** Additional enrichment and correction of ERC1155 flats
**Tables Updated:**
- Further processes `pm_erc1155_flats`

---

### 6. Run Migration & Update Token Map
**File:** `/Users/scotty/Projects/Cascadian-app/migrations/clickhouse/016_enhance_polymarket_tables.sql`
**Purpose:** CRITICAL - This is where market_id format is set!
**Tables Altered:**
- `ctf_token_map` (adds market_id, outcome, outcome_index, question)

**Tables Created:**
- `pm_trades` (CLOB fills with enriched data)
- `markets_enriched` (view combining markets + resolution)
- `token_market_enriched` (view with market context)
- `proxy_wallets_active` (view of active proxy mappings)
- `erc1155_transfers_enriched` (view with market context)
- `wallet_positions_current` (aggregated positions)

**Critical Update (Line 264-272):**
```sql
UPDATE ctf_token_map
SET
  market_id = m.market_id,
  outcome = arrayElement(m.outcomes, outcome_index + 1),
  question = m.question
FROM gamma_markets m
WHERE ctf_token_map.condition_id_norm = m.condition_id;
```

**IMPORTANT:** This is where `market_id` format inconsistency originates!
- `gamma_markets.market_id` could be HEX or INTEGER
- No normalization applied
- Propagates to all downstream views

---

## Alternative Rebuild Approaches

### Option A: Dedup + Materialization (Full)
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/build-trades-dedup-mat.ts`
**Purpose:** Create deduped source table instead of building from transfers
**Tables Created:**
- `trades_dedup_keyed` (view with deterministic dedup key)
- `trades_dedup_mat` (ReplacingMergeTree for idempotent updates)
- Alternative views: `outcome_positions_v2`, `trade_cashflows_v3`, `realized_pnl_by_market_final`

**Key Features:**
- Uses ReplacingMergeTree for automatic deduplication
- Deterministic key: trade_id OR tx_hash:log_index OR wallet:market:outcome:block:price:shares
- Dedup reduces duplicates by ~10-20%
- Version tracking via _version timestamp

---

### Option B: Simple Dedup + View Rebuild
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/fast-dedup-rebuild.ts`
**Purpose:** Simpler alternative using row_number() windowing
**Tables Created/Updated:**
- `trades_dedup_view` (view using row_number())
- `trades_dedup_mat` (MergeTree materialization)
- Updates downstream views to use dedup_mat

**SQL Example:**
```sql
CREATE OR REPLACE VIEW trades_dedup_view AS
SELECT * EXCEPT rn
FROM (
  SELECT *,
         row_number() OVER (
           PARTITION BY transaction_hash, lower(wallet_address)
           ORDER BY created_at
         ) AS rn
  FROM trades_raw
)
WHERE rn = 1;
```

---

## PnL Calculation Scripts

### Realized PnL View Fix
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/fix-realized-pnl-view.ts`
**Purpose:** Create/update the final realized PnL calculation view
**Tables Created/Updated:**
- `realized_pnl_by_market_final` (final P&L by wallet/market)

**Formula:**
```
realized_pnl_usd = Sum(winning_shares * $1) - Sum(all_cashflows)
where:
  winning_shares = shares held in the winning outcome
  all_cashflows = sum of USDC spent/received on that outcome
```

---

## Additional Utilities

### Market ID Backfill Script
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/backfill-market-ids.ts`
**Purpose:** Attempt to recover missing market_id values
**What it does:**
1. Identifies trades with missing market_id ('' or 'unknown')
2. Queries Polymarket Gamma API to resolve condition_id → market_id
3. Generates backfill JSON file (does NOT update database)
4. Reports recovery percentage

**Problem it solves:** Trades lacking market_id cannot be attributed to categories or analyzed properly

---

## View Hierarchy

### Source Tables (Rebuilt from Blockchain)
```
erc1155_transfers    ← Aggregated from pm_erc1155_flats + enrichment
erc20_transfers      ← Aggregated from blockchain events + enrichment
```

### Aggregated Tables (Rebuilt Daily)
```
outcome_positions_v2
  ├─ Source: erc1155_transfers
  ├─ Aggregation: SUM(net_shares) by wallet, market_id, condition_id_norm, outcome_idx
  └─ Rows: ~10M-100M

trade_cashflows_v3
  ├─ Source: erc20_transfers
  ├─ Aggregation: SUM(value) by wallet, market_id, condition_id_norm
  └─ Rows: ~5M-50M
```

### PnL Calculation
```
realized_pnl_by_market_final
  ├─ Joins: outcome_positions_v2 + trade_cashflows_v3 + winning_index
  ├─ Calculation: winning_shares - cashflows
  └─ Output: realized_pnl_usd by wallet/market
```

---

## Critical Issues Identified

### Issue 1: market_id Format Inconsistency

**Origin:** `migrations/clickhouse/016_enhance_polymarket_tables.sql` (line 264)

**Problem:**
```sql
UPDATE ctf_token_map
SET market_id = m.market_id
FROM gamma_markets m
```

- `gamma_markets.market_id` is copied without normalization
- Could be HEX: "0x123abc..."
- Could be INTEGER: "12345"
- Results in duplicate position records when aggregating

**Impact:**
- GROUP BY market_id creates separate rows for same market
- Example: market "0x3039" and "12345" treated as different markets
- Causes 2-3x inflation of position records

**Fix Strategy:** Normalize market_id in ONE location:
1. In `016_enhance_polymarket_tables.sql` (at enrichment time)
2. In `daily-sync-polymarket.ts` (at rebuild time)
3. In view definitions (in-query normalization)

Choose ONE and apply consistently.

### Issue 2: No Normalization Pattern for market_id

**Contrast with condition_id_norm:**
```typescript
// condition_id PROPERLY normalized:
lower(replaceAll(condition_id, '0x', ''))
// Result: 64 chars, lowercase, no 0x

// market_id NOT normalized:
lower(market_id)  // Just lowercase, doesn't fix HEX↔INTEGER
```

---

## Execution Flow Diagram

```
Blockchain Logs
    ↓
step3-streaming-backfill-parallel.ts (2-5h)
    ↓
[erc20_transfers_staging, erc1155_transfers_staging]
    ↓
flatten-erc1155.ts
    ↓
[pm_erc1155_flats]
    ↓
build-approval-proxies.ts
    ↓
[pm_user_proxy_wallets]
    ↓
016_enhance_polymarket_tables.sql ← SETS market_id FORMAT
    ↓
[erc1155_transfers, erc20_transfers] (aggregated)
    ↓
daily-sync-polymarket.ts (or build-trades-dedup-mat.ts)
    ↓
[outcome_positions_v2, trade_cashflows_v3]
    ↓
fix-realized-pnl-view.ts
    ↓
[realized_pnl_by_market_final]
```

---

## Files Summary Table

| File | Location | Purpose | Type | Duration |
|------|----------|---------|------|----------|
| create-transfer-staging-tables.ts | /scripts/ | Create staging tables | Setup | <1s |
| step3-streaming-backfill-parallel.ts | /scripts/ | Backfill blockchain logs | Data Load | 2-5h |
| flatten-erc1155.ts | /scripts/ | Decode ERC1155 events | Transform | 30m |
| flatten-erc1155-correct.ts | /scripts/ | Enrich ERC1155 data | Transform | 10m |
| build-approval-proxies.ts | /scripts/ | Create proxy mappings | Enrich | 10m |
| 016_enhance_polymarket_tables.sql | /migrations/clickhouse/ | Enrich token map (CRITICAL) | Enrich | 5m |
| daily-sync-polymarket.ts | /scripts/ | Rebuild PnL tables | MAIN | <5m |
| build-trades-dedup-mat.ts | /scripts/ | Alternative: dedup approach | Alternative | 30m |
| fast-dedup-rebuild.ts | /scripts/ | Alternative: simple dedup | Alternative | 30m |
| fix-realized-pnl-view.ts | /scripts/ | Create PnL view | View | <1m |
| backfill-market-ids.ts | /scripts/ | Recover missing market_ids | Utility | 30m |

---

## Key Findings

1. **Primary rebuild:** `/Users/scotty/Projects/Cascadian-app/scripts/daily-sync-polymarket.ts`
2. **Data lineage:** Blockchain → staging → transforms → erc*_transfers → aggregation
3. **Rebuild pattern:** CREATE TABLE AS SELECT (from source) → RENAME (atomic swap) → DROP old
4. **Market ID issue:** Set in `016_enhance_polymarket_tables.sql`, NOT normalized, propagates downstream
5. **Fix location:** Normalize in enrichment (migration) or rebuild (daily-sync) script

