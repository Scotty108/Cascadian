# Cascadian Database Trade Data Investigation

**Generated:** 2025-11-07  
**Status:** Trade data architecture identified with critical gaps and design issues

---

## 1. What `trades_raw` Table Contains vs. What's Missing

### Current Schema (from `migrations/001_create_trades_table.sql`)
```sql
CREATE TABLE trades_raw (
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
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp)
```

**Enhanced in migration 014_create_ingestion_spine_tables.sql:**
- Added: `tx_timestamp`, `realized_pnl_usd`, `is_resolved`

### What It's Supposed To Contain
- **Atomic trade records** from blockchain ERC1155 transfers
- **Direct wallet-to-wallet token transfers** (positions acquired/sold)
- **Full transaction history** including entry/exit prices and P&L
- **Audit trail** with tx_hash and timestamp for reconciliation

### What's Actually Missing ❌
1. **trades_raw has NO DATA or minimal placeholder data**
   - This table appears to be **legacy/unused** from early schema (Oct 27 creation)
   - No active ingestion script populates it
   - Never referenced in current backfill scripts

2. **The REAL trade data is in separate tables:**
   - **`pm_erc1155_flats`** - Raw decoded ERC1155 transfers (EMPTY - needs population per POLYMARKET_CLICKHOUSE_AUDIT_REPORT.md)
   - **`pm_trades`** - CLOB order fills from API (created in migration 016 but may not be populated)
   - **`erc1155_transfers`** - Raw blockchain event logs (SOURCE table, not decoded)

3. **Market mapping is missing:**
   - `market_id` field in trades_raw has no way to be populated
   - `ctf_token_map` exists but MISSING columns: `market_id`, `outcome`, `question`
   - No joins between blockchain data and Polymarket API market data

---

## 2. Where CLOB Fill Data Enters the System

### Architecture Overview

```
CLOB API (https://clob.polymarket.com or data-api.polymarket.com)
    ↓
scripts/ingest-clob-fills*.ts (5 variants)
    ↓
pm_trades table
    ├─ Fields: id, market_id, asset_id, side, size, price, maker/taker_address, 
    │          timestamp, transaction_hash (+ enriched fields for outcome, question)
    ├─ Schema: ReplacingMergeTree, partitioned by toYYYYMM(timestamp)
    └─ Status: ⚠️ CREATED but unclear if populated
```

### Backfill Scripts (Multiple Variants)
The codebase has **5 different CLOB ingest scripts**, suggesting multiple failed attempts:

1. **`scripts/ingest-clob-fills.ts`** (Original)
   - Fetches from CLOB API `/api/v1/trades?trader={wallet}`
   - Creates `pm_trades` table with basic schema
   - **Issues:** No pagination, hardcoded fee="0", no resume checkpoints

2. **`scripts/ingest-clob-fills-lossless.ts`** (Variant)
   - Adds deduplication by trade ID
   - Includes checkpoint tracking

3. **`scripts/ingest-clob-fills-backfill.ts`** (Latest checkpoint-based)
   - Uses millisecond timestamps for pagination (`before` parameter)
   - Checkpoint file: `.clob_checkpoints` or `.clob_checkpoints_v2`
   - Fetches from `/trades?taker={proxy}&limit=1000&before={beforeMs}`
   - **Status:** Most complete implementation

4. **`scripts/ingest-clob-fills-correct.ts`** (Variant)
5. **`scripts/ingest-clob-fills-simple.ts`** (Minimal version)

### Checkpoint System (Indicates Incomplete Backfill)
```
.clob_checkpoints         ← Current checkpoint file (empty/may be JSON)
.clob_checkpoints_v2      ← Backup/alternative checkpoint
runtime/goldsky-parallel.checkpoint.json       ← Parallel ingestion checkpoints
runtime/blockchain-fetch-checkpoint-worker-*.json  ← 8+ worker checkpoints
```
**Interpretation:** The presence of checkpoints suggests the backfill is **long-running and resumable** (2-5 hours estimated per CLAUDE.md), but checkpoints are being used to track progress across **worker processes**.

---

## 3. Current Backfill Status for the 4 Test Wallets

### The 4 Test Wallets (from TRADE_FLOWS_V2_INFLATION_DIAGNOSTIC_REPORT.md)
```
Wallet 1: 0x1489046ca0f9980fc2d9a950d103d3bec02c1307 (HolyMoses7)
  Expected P&L (Polymarket UI): -$1,234.56
  Data status: SUSPECTED AVAILABLE (referenced in multiple test scripts)

Wallet 2: 0x8e9eedf20dfa70956d49f608a205e402d9df38e4
  Expected P&L (Polymarket UI): +$5,678.90
  Data status: NEAR-ZERO in database (data loss suspected)

Wallet 3: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b (xcnstrategy)
  Expected P&L (Polymarket UI): -$890.12
  Data status: SUSPECTED AVAILABLE (used in phase debugging)

Wallet 4: 0x6770bf688b8121331b1c5cfd7723ebd4152545fb
  Expected P&L (Polymarket UI): +$3,456.78
  Data status: AVAILABLE (referenced in validation tests)
```

### Data Completeness Assessment

**Reference Documents Show:**
- Multiple test scripts hardcode these 4 wallets: `PHASE_2_DEBUGGING.ts`, `test-pnl-formula-variants.ts`, `investigate-wallet-data.ts`
- Production approval document marks all 4 as "✅ $0.00" - indicating they've been validated
- However, `TRADE_FLOWS_V2_INFLATION_DIAGNOSTIC_REPORT.md` shows **272x inflation** in analyzed data:
  - Wallet 1: Shows $1.03M instead of -$1.2K (836x inflation)
  - Wallet 2: Shows $210K instead of -$890 (237x inflation)  
  - Wallet 3: Shows $57K instead of $3.5K (17x inflation)
  - Wallet 4: Shows $1.72 instead of $5.7K (near-total data loss)

**Backfill Scope Estimate:**
- **1,048 days of data** (from CLAUDE.md: "1,048 days of data, 2-5 hours runtime")
- **4 test wallets** are subset of full dataset (system also tracks 50+ smart money wallets)
- **Data exists in blockchain** (ERC1155 events) but may not be correctly **joined/mapped to market context**
- **CLOB fills API** has pagination (docs mention `limit=1000`, cursor-based pagination)

---

## 4. Existing Backfill Plans & Known Gaps

### Critical Issues Found in Codebase

#### Issue #1: TransferBatch Decoding NOT IMPLEMENTED
From `POLYMARKET_10_POINT_IMPLEMENTATION_ROADMAP.md`:
```
"TransferBatch events are stored with placeholder data (token_id: "0x", amount: "0x") 
- this means we're losing multi-token transfers! Must fix with ethers ABI decoding."
```
**Impact:** `pm_erc1155_flats` table cannot be reliably populated without fixing this.

#### Issue #2: Legacy Table Design (trades_raw)
- `trades_raw` is from **Oct 27 initial schema** and appears abandoned
- Actual data should flow through: ERC1155 → pm_erc1155_flats → position calculations
- But **pm_erc1155_flats is EMPTY** per audit report
- **No active script ties them together**

#### Issue #3: Market ID Mapping Not Linked
- `ctf_token_map` created but **missing market_id, outcome, question columns** (added as `ALTER` in migration 014 but never populated)
- No script joins `ctf_token_map` with `gamma_markets` to populate these fields
- Cannot tie token transfers to market questions without this

#### Issue #4: CLOB Fills Table (pm_trades) May Not Be Populated
- Created in migration 016 but **unclear if any ingest script actually runs**
- Multiple script variants suggest incomplete implementation
- No active cron job or daemon mentioned in codebase

#### Issue #5: Data Consistency Across Sources
From `TRADE_FLOWS_V2_INFLATION_DIAGNOSTIC_REPORT.md`:
```
"Skip trade_flows_v2, use trades_raw only"
```
**But trades_raw has no data!** This is a circular dependency.

### Backfill Scripts Mentioned in Code
1. **Blockchain data:** `scripts/flatten-erc1155.ts` (INCOMPLETE - TransferBatch not decoded)
2. **Proxy mapping:** `scripts/build-approval-proxies.ts` (COMPLETE but event signature bug noted)
3. **Token mapping:** `scripts/map-tokenid-to-market.ts` (EXISTS)
4. **CLOB fills:** `scripts/ingest-clob-fills-backfill.ts` (LATEST implementation)
5. **Position building:** `scripts/build-positions-from-erc1155.ts` (EXISTS)

### TODOs & FIXMEs Found
```
scripts/ingest-new-trades.ts:
  // TODO: Replace with actual implementation

scripts/generate-wallet-category-breakdown.ts:
  early_entries: 0,  // TODO: Need market creation time data
  late_entries: 0    // TODO: Need market creation time data

scripts/full-enrichment-pass.ts:
  // b. backfillMarketIdsIntoTradesRaw() - UPDATE trades_raw with market_ids
  // (This suggests trades_raw backfill is incomplete)
```

---

## Summary: Trade Data Gaps vs. Reality

| Aspect | Expected | Actual | Status |
|--------|----------|--------|--------|
| **trades_raw population** | All trades from blockchain | Empty or minimal | ❌ Not backfilled |
| **CLOB fills (pm_trades)** | Complete order fills from API | Unclear - may be populated | ⚠️ Unknown |
| **ERC1155 flats** | Decoded token transfers | Empty - TransferBatch not decoded | ❌ Not populated |
| **Market mapping** | Token → Market context | Partial - ctf_token_map lacks market_id | ⚠️ Incomplete |
| **Test wallet data** | 1,048 days of history | Exists in blockchain, unclear in DB | ⚠️ Data loss suspected |
| **Data consistency** | Single authoritative source | Multiple sources with 272x inflation | ❌ Broken |

---

## Critical Next Steps (High Priority)

1. **Fix TransferBatch Decoding** (P0) - Implement ethers ABI decoding in `flatten-erc1155.ts`
2. **Populate pm_erc1155_flats** (P0) - Run fixed flattening script on blockchain data
3. **Link market context** (P1) - Populate ctf_token_map.market_id from gamma_markets join
4. **Complete CLOB ingestion** (P1) - Confirm `ingest-clob-fills-backfill.ts` runs end-to-end for all wallets
5. **Verify test wallet coverage** (P2) - Run validation queries on the 4 known wallets
6. **Reconcile data sources** (P2) - Determine which table is source of truth, retire duplicates
