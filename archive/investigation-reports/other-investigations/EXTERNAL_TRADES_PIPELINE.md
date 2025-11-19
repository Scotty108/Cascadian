# External Trades Data Pipeline

**Purpose:** How external trade data flows from sources → ClickHouse → P&L calculations

**Created:** Phase 2 of C2 External Data Ingestion mission
**Agent:** C2 - External Data Ingestion

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL DATA SOURCES                       │
│                                                                  │
│  ┌──────────┐  ┌─────────┐  ┌───────────┐  ┌──────────────┐   │
│  │   Dome   │  │  Dune   │  │ Polymarket│  │ Polymarket   │   │
│  │   API    │  │Analytics│  │ Subgraph  │  │  Data API    │   │
│  └──────────┘  └─────────┘  └───────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │              │              │               │
         └──────────────┴──────────────┴───────────────┘
                                │
                                ▼
                ┌───────────────────────────────┐
                │  Ingestion Scripts (Phase 3)  │
                │  scripts/203-ingest-*.ts      │
                │                               │
                │  • Fetch from source          │
                │  • Normalize data             │
                │  • Validate schema            │
                └───────────────────────────────┘
                                │
                                ▼
                ┌───────────────────────────────┐
                │   external_trades_raw TABLE   │
                │   (Landing Zone)              │
                │                               │
                │  • Source tracking            │
                │  • Deduplication              │
                │  • Generic schema             │
                └───────────────────────────────┘
                                │
                                ▼
┌──────────────┐          ┌─────────────────────────────┐
│  pm_trades   │          │  pm_trades_with_external    │
│  (CLOB only) │──UNION───│  VIEW (Phase 2)             │
└──────────────┘   ALL    │                             │
                          │  • CLOB trades (unchanged)  │
                          │  • External trades (mapped) │
                          └─────────────────────────────┘
                                │
                                ▼
                ┌───────────────────────────────┐
                │      P&L CALCULATIONS         │
                │      (C1's Domain)            │
                │                               │
                │  • pm_wallet_market_pnl_...  │
                │  • pm_wallet_pnl_summary     │
                └───────────────────────────────┘
```

---

## Wallet Backfill Plan (Phase 6)

**Purpose:** Prioritize which wallets to ingest from external sources based on trading volume.

**Created:** Phase 6 of C2 External Data Ingestion mission

### Overview

The `wallet_backfill_plan` table tracks which wallets have been ingested and which are pending. This allows the backfill driver (Phase 7) to process wallets systematically in priority order.

### Table Schema

```sql
CREATE TABLE wallet_backfill_plan (
  wallet_address String,           -- Trader wallet (normalized, no 0x)
  trade_count UInt64,              -- Number of CLOB trades in pm_trades
  notional Float64,                -- Total USDC volume from pm_trades
  priority_rank UInt32,            -- 1 = highest priority (largest volume)
  status Enum8(                    -- Ingestion status
    'pending' = 1,                 --   Not yet ingested
    'in_progress' = 2,             --   Currently being ingested
    'done' = 3,                    --   Successfully ingested
    'error' = 4                    --   Ingestion failed
  ) DEFAULT 'pending',
  error_message String DEFAULT '', -- Error details if status='error'
  last_run_at Nullable(DateTime), -- Last ingestion timestamp
  ingested_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (priority_rank, wallet_address)
```

### Seeding Strategy

The plan is seeded with:
1. **xcnstrategy** (rank 0, status='done') - Already ingested in Phase 3
2. **Top 100 wallets** by notional volume from `pm_trades` (status='pending')

Total notional volume for top 100 wallets: **$1.93 billion**

### Sample Data

Top wallets by priority:

| Rank | Wallet | CLOB Trades | Notional Volume | Status |
|------|--------|-------------|-----------------|--------|
| 0 | `cce2b7c71f21e358b8e5e797e586cbc03160d58b` | 0 | $0 | done |
| 1 | `4bfb41d5b3570d...` | 8,031,085 | $1,091,505,119.77 | pending |
| 2 | `c5d563a36ae781...` | 2,826,201 | $343,656,071.05 | pending |
| 3 | `f29bb8e0712075...` | 3,587 | $22,525,579.07 | pending |
| 4 | `53757615de1c42...` | 72,144 | $16,018,408.95 | pending |
| 5 | `3cf3e8d5427aed...` | 106,685 | $12,665,674.16 | pending |

### Usage

**Check plan status:**
```bash
npx tsx scripts/check-wallet-backfill-plan.ts
```

**Rebuild plan (if needed):**
```bash
# Drop existing plan
clickhouse-client -q "DROP TABLE wallet_backfill_plan"

# Recreate
npx tsx scripts/205-build-wallet-backfill-plan.ts
```

**Query plan:**
```sql
-- Status breakdown
SELECT
  status,
  COUNT(*) as wallet_count,
  SUM(trade_count) as total_trades,
  SUM(notional) as total_notional
FROM wallet_backfill_plan
GROUP BY status
ORDER BY status;

-- Next wallet to process
SELECT * FROM wallet_backfill_plan
WHERE status = 'pending'
ORDER BY priority_rank ASC
LIMIT 1;
```

### Integration with Phase 7

The automated backfill driver (scripts/206-backfill-external-trades-from-data-api.ts) will:
1. Read pending wallets from `wallet_backfill_plan` in priority order
2. Call the generalized Data-API connector for each wallet
3. Update status to 'in_progress' → 'done' or 'error'
4. Resume from last position if interrupted

---

## Data Flow Steps

### Step 1: External Data Sources
Multiple sources provide trade data that our CLOB pipeline misses:
- **Dome:** Aggregated platform with P&L calculations
- **Dune:** Blockchain analytics with SQL interface
- **Polymarket Subgraph:** Official GraphQL endpoint for blockchain events
- **Polymarket Data API:** REST API for market and trade data

### Step 2: Ingestion Scripts (Phase 3)
Custom scripts for each source:
- `scripts/203-ingest-subgraph-trades.ts` - Polymarket Subgraph
- `scripts/203-ingest-dune-trades.ts` - Dune Analytics
- `scripts/203-ingest-dome-trades.ts` - Dome API (if available)

Each script:
1. Authenticates (if required)
2. Fetches trade data for target wallet(s) and market(s)
3. Normalizes to `external_trades_raw` schema
4. Inserts via `clickhouse.insert()`

### Step 3: Landing Zone (`external_trades_raw`)
All external trade data lands in a single table:
- **Purpose:** Neutral storage, source-agnostic schema
- **Engine:** MergeTree (partitioned by month)
- **Deduplication:** Via `external_trade_id` (upstream source's unique ID)

### Step 4: UNION View (`pm_trades_with_external`)
Combines CLOB and external trades:
```sql
CREATE VIEW pm_trades_with_external AS
  SELECT * FROM pm_trades          -- CLOB trades
  UNION ALL
  SELECT [mapped] FROM external_trades_raw  -- External trades
```

**Schema:** Identical to `pm_trades` for drop-in replacement.

### Step 5: P&L Calculations (C1's Domain)
C1 switches from `pm_trades` to `pm_trades_with_external`:
```sql
-- OLD
SELECT ... FROM pm_trades ...

-- NEW
SELECT ... FROM pm_trades_with_external ...
```

Zero code changes needed - just table name swap.

---

## Schema Mapping Details

### How `external_trades_raw` Maps to `pm_trades`

| pm_trades Column | external_trades_raw Source | Notes |
|------------------|---------------------------|-------|
| `fill_id` | `external_trade_id` | Unique ID from upstream source |
| `block_time` | `trade_timestamp` | When trade occurred |
| `block_number` | `0` (default) | Not available from most external sources |
| `tx_hash` | `tx_hash` | Blockchain hash if on-chain |
| `asset_id_decimal` | `''` (empty) | External sources don't provide CLOB asset IDs |
| `condition_id` | `condition_id` | Normalized (lowercase, no 0x, 64 chars) |
| `outcome_index` | `outcome_index` | 0-based index if available, else -1 |
| `outcome_label` | `side` | 'YES'/'NO' or generic outcome label |
| `question` | `market_question` | Market question for debugging |
| `wallet_address` | `wallet_address` | Trader wallet (lowercase, no 0x) |
| `operator_address` | `''` (empty) | External sources don't distinguish EOA vs proxy |
| `is_proxy_trade` | `0` | Default to non-proxy |
| `side` | `side` | 'BUY'/'SELL' or 'YES'/'NO' |
| `price` | `price` | Per share (0-1 range) |
| `shares` | `shares` | Number of shares traded |
| `collateral_amount` | `cash_value` | USDC notional value |
| `fee_amount` | `fees` | Trading fees if available |
| `data_source` | `source` | 'dome', 'dune', 'subgraph', etc. |

### Missing Fields
Some fields in `pm_trades` cannot be populated from external sources:
- `asset_id_decimal` - CLOB-specific, not in external data
- `block_number` - Blockchain-specific, may not be provided
- `operator_address` - External sources don't track EOA separately
- `is_proxy_trade` - Cannot distinguish without wallet identity map

These fields default to empty string or zero, which is acceptable for P&L calculations that rely on `condition_id`, `shares`, and `price`.

---

## Usage Examples

### For C1: Switching to Unified View

**Before (CLOB-only):**
```sql
SELECT
  wallet_address,
  condition_id,
  SUM(shares * price) as total_value
FROM pm_trades
WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
GROUP BY wallet_address, condition_id;
```

**After (CLOB + External):**
```sql
SELECT
  wallet_address,
  condition_id,
  SUM(shares * price) as total_value
FROM pm_trades_with_external  -- ← Only change needed
WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
GROUP BY wallet_address, condition_id;
```

### Debugging: Check Data Source Distribution

```sql
SELECT
  data_source,
  COUNT(*) as trade_count,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  COUNT(DISTINCT condition_id) as unique_markets,
  SUM(collateral_amount) as total_volume
FROM pm_trades_with_external
GROUP BY data_source
ORDER BY trade_count DESC;
```

Expected output after Phase 3:
```
data_source   | trade_count | unique_wallets | unique_markets | total_volume
clob_fills    | 38,945,566  | 686,926        | 123,244        | $X billion
subgraph      | 21          | 1              | 6              | ~$23,890
```

### Filter by Source if Needed

```sql
-- Only CLOB trades (old behavior)
SELECT * FROM pm_trades_with_external
WHERE data_source = 'clob_fills';

-- Only external trades (AMM, etc.)
SELECT * FROM pm_trades_with_external
WHERE data_source != 'clob_fills';

-- Everything (new default)
SELECT * FROM pm_trades_with_external;
```

---

## Data Quality Checks

### After Ingestion (Phase 3)

```sql
-- Verify expected trade count for xcnstrategy
SELECT
  COUNT(*) as total_trades,
  COUNT(DISTINCT condition_id) as unique_markets,
  SUM(shares) as total_shares
FROM pm_trades_with_external
WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND data_source != 'clob_fills';
-- Expected: total_trades = 21, unique_markets = 6, total_shares ≈ 23,890.13
```

### Check for Duplicates

```sql
-- Trades appearing in both CLOB and external sources
SELECT
  condition_id,
  wallet_address,
  block_time,
  COUNT(*) as cnt
FROM pm_trades_with_external
WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
GROUP BY condition_id, wallet_address, block_time
HAVING COUNT(*) > 1;
-- Expected: 0 rows (ghost markets should NOT be in CLOB)
```

### Validate Against Dome Stats

```sql
-- Per-market breakdown
SELECT
  condition_id,
  COUNT(*) as trades,
  SUM(shares) as total_shares,
  AVG(price) as avg_price
FROM pm_trades_with_external
WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND data_source != 'clob_fills'
GROUP BY condition_id
ORDER BY trades DESC;
```

Compare against C2_BOOTSTRAP_SUMMARY.md expected values:
- `0x293fb49...` (Satoshi Bitcoin): 1 trade, 1,000.00 shares
- `0xf2ce8d3...` (Xi Jinping): 14 trades, 19,999.99 shares
- `0xbff3fad...` (Trump Gold Cards): 3 trades, 2,789.14 shares
- etc.

---

## C1 Integration Guide

### When to Switch

**Switch from `pm_trades` to `pm_trades_with_external` when:**
1. Phase 3 ingestion complete (external_trades_raw populated)
2. Data quality checks pass (trade counts match Dome stats)
3. P&L gap reduction validated (compute provisional P&L and compare)

**How to switch:**
1. Update all views/queries that reference `pm_trades`
2. Replace with `pm_trades_with_external`
3. Recompute P&L views
4. Validate against Dome baseline wallet

### Files C1 Needs to Update

**P&L Views (likely locations):**
- `pm_wallet_market_pnl_resolved` - Market-level P&L
- `pm_wallet_pnl_summary` - Wallet-level aggregates
- Any other views/queries that use `pm_trades` as source

**Example Change:**
```sql
-- In pm_wallet_market_pnl_resolved view definition
-- OLD
FROM pm_trades pt
...

-- NEW
FROM pm_trades_with_external pt
...
```

### Rollback Plan

If issues arise, C1 can instantly rollback:
```sql
-- Revert to CLOB-only by switching back to pm_trades
FROM pm_trades  -- Instead of pm_trades_with_external
```

No data loss - `external_trades_raw` persists independently.

---

## Maintenance & Operations

### Adding New Trades from Same Source

Re-run ingestion script:
```bash
npx tsx scripts/203-ingest-subgraph-trades.ts
```

`external_trade_id` ensures deduplication at query time (MergeTree doesn't auto-dedupe).

### Adding New Data Source

1. Create new ingestion script: `scripts/203-ingest-[newsource]-trades.ts`
2. Use unique `source` identifier (e.g., `'new_api'`)
3. Map upstream fields to `external_trades_raw` schema
4. Insert via `clickhouse.insert()`

No changes needed to `pm_trades_with_external` view.

### Monitoring

```sql
-- Daily health check
SELECT
  data_source,
  MAX(block_time) as latest_trade,
  COUNT(*) as total_trades
FROM pm_trades_with_external
GROUP BY data_source
ORDER BY latest_trade DESC;

-- Alert if external sources haven't updated recently
SELECT
  data_source,
  MAX(ingested_at) as last_ingestion,
  now() - MAX(ingested_at) as hours_since_update
FROM external_trades_raw
GROUP BY data_source
HAVING hours_since_update > INTERVAL '24 HOURS';
```

---

## Performance Considerations

### Query Performance

`UNION ALL` is cheap in ClickHouse:
- No sorting or deduplication overhead
- Each sub-select uses its own indexes
- Parallel execution when possible

**Benchmark (estimated):**
- `pm_trades` alone: ~100ms for wallet query
- `pm_trades_with_external`: ~105ms (+5% overhead)

### Storage Impact

`external_trades_raw` for 6 ghost markets:
- 21 trades × ~500 bytes/row = ~10KB
- Negligible storage impact

For full-scale AMM ingestion (future):
- Estimate ~1-5% of CLOB volume
- ~2M trades × 500 bytes = ~1GB
- Still very manageable

### Index Strategy

Both tables have bloom filters on:
- `wallet_address` - Fast wallet lookups
- `condition_id` - Fast market lookups
- `data_source` / `source` - Filter by origin

No additional indexes needed for `pm_trades_with_external` view.

---

## Future Enhancements

### Phase 3+ Improvements

1. **Real-time streaming**
   - WebSocket to Polymarket Subgraph
   - Auto-ingest new trades as they occur

2. **Historical backfill**
   - Fetch all pre-Aug 21, 2024 trades
   - Populate complete history for all wallets

3. **AMM contract indexing**
   - Parse blockchain events directly
   - No API dependency
   - Source of truth for all AMM trades

4. **Asset ID enrichment**
   - Map subgraph trades to `asset_id_decimal`
   - Join with `pm_asset_token_map`
   - Complete schema parity with CLOB trades

---

## Next Steps

**Phase 3:** Implement ONE data source connector
- Target: Polymarket Subgraph (recommended) or Dune Analytics
- Fetch 21 trades for xcnstrategy + 6 ghost markets
- Insert into `external_trades_raw`
- Run data quality checks

**Phase 4:** Handoff to C1
- Validate against Dome stats
- Compute provisional P&L impact
- Document integration steps
- Hand off `pm_trades_with_external` for adoption

---

**Agent:** C2 - External Data Ingestion
**File:** `EXTERNAL_TRADES_PIPELINE.md`
**Status:** Phase 2 Complete
**Script:** `scripts/202-create-pm-trades-with-external-view.ts`
**View:** `pm_trades_with_external` (UNION of CLOB + external)
