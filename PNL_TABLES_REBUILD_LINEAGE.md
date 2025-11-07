# Cascadian P&L Tables: Complete Data Lineage & Rebuild Scripts

## Executive Summary

The core P&L tables (`outcome_positions_v2` and `trade_cashflows_v3`) are **VIEWS** rebuilt daily from two source tables:
- `erc1155_transfers` - Token holdings per wallet per market/outcome
- `erc20_transfers` - USDC cashflows per wallet per market

Both source tables are populated from raw blockchain data via a **parallel streaming backfill** pipeline.

**Critical Finding:** The hex vs integer inconsistency for `market_id` originates in the raw source data and propagates through all downstream views.

---

## Architecture Overview

```
Raw Blockchain (Polygon)
    ↓
RPC Logs (getLogs)
    ↓
[STAGING TABLES]
    erc20_transfers_staging
    erc1155_transfers_staging
    backfill_checkpoint (checkpoint)
    worker_heartbeats (monitoring)
    ↓
[ENRICHMENT & TRANSFORMATION]
    pm_erc1155_flats (flattened ERC1155 transfers)
    ctf_token_map (token ID → condition_id → market_id)
    pm_user_proxy_wallets (EOA → proxy mapping)
    pm_trades (CLOB fills from Polymarket API)
    ↓
[SOURCE TABLES]
    erc1155_transfers (summarized holdings)
    erc20_transfers (summarized cashflows)
    ↓
[REBUILD VIEWS - RECREATED DAILY]
    outcome_positions_v2 (VIEW - positions per wallet/market/outcome)
    trade_cashflows_v3 (VIEW - cashflows per wallet/market/outcome)
    realized_pnl_by_market_final (VIEW - final P&L calculation)
```

---

## 1. SOURCE DATA TABLES

### Source Table 1: `erc1155_transfers`
**Status:** View or materialized table aggregating from blockchain events
**Key Fields:**
- wallet (String - lowercase wallet address)
- market_id (String - **HEX or INTEGER format - INCONSISTENT**)
- condition_id_norm (String - normalized 64-char hex, lowercase, no 0x prefix)
- outcome_idx (Int16 - 0-based outcome index)
- balance (Float64 - net token balance transferred)

**Creation Source:** `scripts/flatten-erc1155.ts` and related pipeline

### Source Table 2: `erc20_transfers`
**Status:** View or materialized table aggregating from blockchain events
**Key Fields:**
- wallet (String - lowercase wallet address)
- market_id (String - **HEX or INTEGER format - INCONSISTENT**)
- condition_id_norm (String - normalized 64-char hex)
- value (Float64 - USDC amount transferred)
- token_type (String - 'USDC')

**Creation Source:** Blockchain event parsing, market mapping

---

## 2. CORE REBUILD SCRIPTS (In Execution Order)

### Phase 0: Create Staging Tables
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/create-transfer-staging-tables.ts`

Creates ReplacingMergeTree tables:
```typescript
erc20_transfers_staging
erc1155_transfers_staging
backfill_checkpoint
worker_heartbeats
```

### Phase 1-3: Backfill & Transform Raw Blockchain Data
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/step3-streaming-backfill-parallel.ts`

**What it does:**
1. Reads blockchain logs from Polygon RPC (getLogs for ERC20 & ERC1155 transfers)
2. Processes logs into staging tables
3. Day-based sharding across 8 workers (SHARDS=8, SHARD_ID 0-7)
4. Inserts logs into:
   - `erc20_transfers_staging` (USDC Transfer events)
   - `erc1155_transfers_staging` (ConditionalTokens Transfer events)
5. Checkpoints each day to prevent reprocessing

**Configuration:**
- TOTAL_DAYS: 1048 (from 2022-12-18 to 2025-10-31)
- CTF_ADDRESS: `0xd552174f4f14c8f9a6eb4d51e5d2c7bbeafccf61`
- USDC_ADDRESS: `0x2791bca1f2de4661ed88a30c99a7a9449aa84174`
- BLOCKS_PER_DAY: 43,200
- BATCH_ROWS: 5,000 per insert

**Output:** Raw staging tables with blockchain event data

---

### Phase 4: Flatten & Enrich ERC1155 Events
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/flatten-erc1155.ts`

**What it does:**
1. Reads erc1155_transfers from blockchain
2. Decodes TransferSingle events (token_id, amount from data field)
3. Stores flattened result in `pm_erc1155_flats`
4. Decodes TransferBatch events (requires ABI decoding)

**Output:** `pm_erc1155_flats` table with decoded transfers

---

### Phase 5: Build Token Map & Enrich
**Files:**
- `scripts/build-approval-proxies.ts` - Creates `pm_user_proxy_wallets` (EOA → proxy mapping)
- `scripts/flatten-erc1155-correct.ts` - Further enriches transfers
- Migration: `migrations/clickhouse/016_enhance_polymarket_tables.sql`

**Creates/Updates:**
- `ctf_token_map` - token_id → condition_id_norm → market_id (enriched)
- `pm_user_proxy_wallets` - user_eoa → proxy_wallet mappings
- `erc1155_transfers_enriched` view

**Key SQL from migration:**
```sql
UPDATE ctf_token_map
SET
  market_id = m.market_id,
  outcome = arrayElement(m.outcomes, outcome_index + 1),
  question = m.question
FROM gamma_markets m
WHERE ctf_token_map.condition_id_norm = m.condition_id;
```

---

## 3. CRITICAL PnL REBUILD SCRIPTS (Daily Execution)

### Daily Rebuild: `outcome_positions_v2` & `trade_cashflows_v3`
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/daily-sync-polymarket.ts`

**Execution Time:** ~2-5 hours for full 1,048-day backfill

**Step 1: Rebuild outcome_positions_v2**
```typescript
CREATE TABLE outcome_positions_v2_new AS
SELECT
  wallet,
  market_id,
  condition_id_norm,
  outcome_idx,
  SUM(CAST(balance AS Float64)) AS net_shares
FROM erc1155_transfers
WHERE outcome_idx >= 0
GROUP BY wallet, market_id, condition_id_norm, outcome_idx
HAVING net_shares != 0;

RENAME TABLE outcome_positions_v2 TO outcome_positions_v2_old;
RENAME TABLE outcome_positions_v2_new TO outcome_positions_v2;
DROP TABLE outcome_positions_v2_old;
```

**Step 2: Rebuild trade_cashflows_v3**
```typescript
CREATE TABLE trade_cashflows_v3_new AS
SELECT
  wallet,
  market_id,
  condition_id_norm,
  SUM(CAST(value AS Float64)) AS cashflow_usdc
FROM erc20_transfers
WHERE token_type = 'USDC'
GROUP BY wallet, market_id, condition_id_norm;

RENAME TABLE trade_cashflows_v3 TO trade_cashflows_v3_old;
RENAME TABLE trade_cashflows_v3_new TO trade_cashflows_v3;
DROP TABLE trade_cashflows_v3_old;
```

---

### Alternative: Dedup + Materialization Approach
**Files:** 
- `scripts/build-trades-dedup-mat.ts`
- `scripts/fast-dedup-rebuild.ts`

Uses `trades_dedup_mat` (ReplacingMergeTree) as source instead:

```typescript
CREATE TABLE trades_dedup_mat (
  dedup_key String,
  wallet_address String,
  market_id String,
  condition_id String,
  outcome_index Int16,
  side LowCardinality(String),
  entry_price Float64,
  shares Float64,
  ... other fields ...
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY dedup_key;

// Then views reference trades_dedup_mat instead:
CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  wallet_address AS wallet,
  market_id,
  lower(replaceAll(condition_id,'0x','')) AS condition_id_norm,
  toInt16OrNull(outcome_index) AS outcome_idx,
  sum(if(side IN ('YES','BUY','Buy','buy','1'),  1.0, -1.0) * shares) AS net_shares
FROM trades_dedup_mat
WHERE market_id NOT IN ('12')
GROUP BY wallet_address, market_id, condition_id, outcome_index
```

---

## 4. PnL CALCULATION VIEW
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/fix-realized-pnl-view.ts`

```typescript
CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
WITH win AS (
  SELECT condition_id_norm, toInt16(win_idx) AS win_idx, resolved_at 
  FROM winning_index
)
SELECT
  p.wallet,
  p.market_id,
  p.condition_id_norm,
  w.resolved_at,
  round(
    sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx)
    + sum(-toFloat64(c.cashflow_usdc))
  , 4) AS realized_pnl_usd
FROM outcome_positions_v2 p
ANY LEFT JOIN trade_cashflows_v3 c
  ON c.wallet = p.wallet
 AND c.market_id = p.market_id
 AND c.condition_id_norm = p.condition_id_norm
 AND c.outcome_idx = p.outcome_idx
ANY LEFT JOIN win w
  ON lower(replaceAll(w.condition_id_norm,'0x','')) = 
     lower(replaceAll(p.condition_id_norm,'0x',''))
WHERE w.win_idx IS NOT NULL
GROUP BY p.wallet, p.market_id, p.condition_id_norm, w.resolved_at
```

---

## 5. THE HEX vs INTEGER INCONSISTENCY PROBLEM

### Root Cause Location

The inconsistency originates in **raw blockchain event processing**:

```
Blockchain ERC1155 Transfer Event:
  - Emits token_id (256-bit integer encoded as uint256)
  - No explicit "market_id" in the event
  
Step 1: Decode token_id
  - token_id = BigInt parsed from event data
  - Could be stored as HEX (0x...) or INTEGER (base-10)

Step 2: Map token_id → market_id
  - Lookup in ctf_token_map
  - If market_id is set as STRING, could be:
    - HEX format: "0x123abc..."
    - INTEGER format: "12345" (base-10)
    - Empty: "" (if lookup failed)

Step 3: Propagate to erc1155_transfers
  - market_id inherited from token_map
  - No normalization step
  
Step 4: Aggregate to outcome_positions_v2
  - market_id passed through as-is
  - GROUP BY market_id groups HEX and INTEGER separately
  - Creates duplicate rows for same market in different formats
```

### Where Format Decision Was Made

**File:** `scripts/flatten-erc1155.ts` (lines 101-103)
```typescript
const tokenId = "0x" + row.data.slice(2, 66);  // HEX format
const amount = "0x" + row.data.slice(66, 130);

batch.push({
  token_id: tokenId,  // Stored as HEX string
  ...
});
```

**Problem:** When token_id is later mapped to market_id via `ctf_token_map`, the format depends on how `ctf_token_map.market_id` was populated.

### Migration File That Should Normalize
**File:** `migrations/clickhouse/016_enhance_polymarket_tables.sql` (line 272)

```sql
UPDATE ctf_token_map
SET
  market_id = m.market_id,
  ...
FROM gamma_markets m
WHERE ctf_token_map.condition_id_norm = m.condition_id;
```

**Issue:** `gamma_markets.market_id` format is unknown - could be HEX or INTEGER depending on Polymarket API response.

---

## 6. SCRIPTS THAT TOUCH market_id FIELD

### Read/Use market_id
1. `scripts/daily-sync-polymarket.ts` - Groups by market_id
2. `scripts/build-trades-dedup-mat.ts` - Views use market_id in GROUP BY
3. `scripts/fix-realized-pnl-view.ts` - PnL view joins on market_id
4. `scripts/build-dedup-mat-simple.ts` - Views normalize condition_id but not market_id
5. `scripts/fast-dedup-rebuild.ts` - Lowercase market_id but no hex normalization

### Write/Transform market_id
1. `scripts/flatten-erc1155.ts` - Does NOT set market_id (only token_id)
2. `scripts/flatten-erc1155-correct.ts` - Further processing
3. `scripts/backfill-market-ids.ts` - **CRITICAL** - Attempts to backfill missing market_ids
4. Migration `016_enhance_polymarket_tables.sql` - Updates ctf_token_map.market_id

---

## 7. FIELD NORMALIZATION PATTERNS

### Properly Normalized Fields
**condition_id_norm:**
```typescript
lower(replaceAll(condition_id, '0x', ''))
// Expected: 64 chars, lowercase, no 0x prefix
// Type: String (never cast to FixedString64)
```

### NOT Normalized
**market_id:**
```typescript
// No normalization applied in any view!
// Just lowercase in some places:
lower(market_id)  // But doesn't convert HEX to INTEGER or vice versa
```

---

## 8. SCRIPT EXECUTION ORDER (Full Pipeline)

```
1. create-transfer-staging-tables.ts
   └─ Creates: erc20_transfers_staging, erc1155_transfers_staging, backfill_checkpoint

2. step3-streaming-backfill-parallel.ts (8 shards)
   └─ Fetches blockchain logs, inserts into staging tables
   └─ Duration: 2-5 hours

3. flatten-erc1155.ts
   └─ Decodes staged transfers into: pm_erc1155_flats

4. build-approval-proxies.ts
   └─ Creates: pm_user_proxy_wallets

5. flatten-erc1155-correct.ts
   └─ Further enrichment of ERC1155 flats

6. Migration: 016_enhance_polymarket_tables.sql
   └─ Updates: ctf_token_map with market metadata

7. [DAILY] daily-sync-polymarket.ts
   └─ Rebuilds: outcome_positions_v2, trade_cashflows_v3
   └─ Duration: Minutes

8. [OPTIONAL] build-trades-dedup-mat.ts
   └─ Rebuilds: trades_dedup_mat
   └─ Creates alternative views pointing to dedup_mat
```

---

## 9. MARKET_ID INCONSISTENCY DIAGNOSIS

### Step-by-step where format diverges:

**Step A: Token ID Storage (flatten-erc1155.ts)**
- Format: HEX (e.g., "0x123abc...")

**Step B: Token Map Lookup (ctf_token_map)**
- Source: gamma_markets.market_id
- **UNKNOWN FORMAT** - depends on Polymarket API

**Step C: Enrichment (016_enhance_polymarket_tables.sql)**
- Copies market_id from gamma_markets
- **No normalization**

**Step D: Aggregation (outcome_positions_v2)**
- Groups by market_id
- If some rows have "12345" and others have "0x3039", they're separate groups
- Manifests as duplicate position records

### Verification Query
```sql
SELECT 
  market_id,
  count(*) AS cnt,
  COUNT(DISTINCT wallet) AS wallets
FROM outcome_positions_v2
GROUP BY market_id
ORDER BY cnt DESC
LIMIT 50;

-- Will show:
-- "12345" - 1000 rows
-- "0x3039" - 800 rows
-- Both are the same market but counted separately
```

---

## 10. FILES SUMMARY

| File | Purpose | Status |
|------|---------|--------|
| create-transfer-staging-tables.ts | Create staging tables | Setup Phase |
| step3-streaming-backfill-parallel.ts | Fetch blockchain logs | Backfill (2-5h) |
| flatten-erc1155.ts | Decode ERC1155 events | Transform |
| flatten-erc1155-correct.ts | Further enrichment | Transform |
| build-approval-proxies.ts | EOA→proxy mapping | Enrich |
| 016_enhance_polymarket_tables.sql | Update token map | Enrich |
| daily-sync-polymarket.ts | Rebuild PnL tables | Daily Cron |
| build-trades-dedup-mat.ts | Dedup alternative | Optional |
| fix-realized-pnl-view.ts | PnL calculation | View Definition |
| backfill-market-ids.ts | Recover missing market_ids | Recovery Script |

---

## Conclusion

**The hex vs integer market_id inconsistency originates in:**
1. `flatten-erc1155.ts` storing token_id as HEX
2. `ctf_token_map` receiving market_id in **unknown format** from Polymarket API
3. No normalization step in `016_enhance_polymarket_tables.sql`
4. Propagation through all downstream views without fixing

**Fix Strategy:** Normalize market_id in one of:
- `016_enhance_polymarket_tables.sql` (at enrichment time), OR
- `daily-sync-polymarket.ts` (at rebuild time), OR
- `build-trades-dedup-mat.ts` (in view definitions)

All three locations need consistent normalization once chosen.

