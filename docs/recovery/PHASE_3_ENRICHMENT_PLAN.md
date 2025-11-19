# Phase 3: Downstream Table Enrichment Plan
**ERC-1155 Recovery Session - 2025-11-11**

**STATUS:** ✅ **INVESTIGATION COMPLETE - PHASE 3 NOT NEEDED**

## Executive Decision

**RECOMMENDATION:** **SKIP Phase 3 Entirely** ✅

After thorough investigation, Phase 3 enrichment is **not needed** because:
1. `trades_raw` does NOT consume `erc1155_transfers` data
2. `trades_raw` already has perfect timestamps from independent CLOB/API source
3. No downstream analytics tables reference `erc1155_transfers`
4. Recovered data is self-contained and available for future use

**See:** `DATA_FLOW_INVESTIGATION.md` for complete analysis.

---

## Recovery Session Status

✅ **Phase 1 Complete:** Dual backups created and verified
- `erc1155_transfers_backup_20251111a` - 206,112 rows
- `erc1155_transfers_backup_20251111b` - 206,112 rows
- `tmp_block_timestamps_backup_20251111a` - 3,889 rows
- `tmp_block_timestamps_backup_20251111b` - 3,889 rows

✅ **Phase 2 Complete:** Production tables swapped
- `default.erc1155_transfers` - **61,379,951 rows** (was 206K - 297x improvement!)
- `default.tmp_block_timestamps` - **3,897,064 rows** (was 3.9K - 1,002x improvement!)
- Backup originals preserved as `_old` tables

✅ **Phase 3 Investigation Complete:** Data flow traced
- Confirmed: No downstream dependencies on `erc1155_transfers`
- Confirmed: `trades_raw` has independent timestamp source
- Confirmed: Recovered data is ready for future features

❌ **Phase 3 Enrichment:** SKIPPED (Not Needed)

---

## Investigation Summary

**Original Assumption:** Phase 3 would propagate ERC-1155 timestamps to `trades_raw` and downstream tables.

**Actual Finding:** `trades_raw` is a VIEW sourcing from `vw_trades_canonical`, which has its own timestamp source (likely CLOB API). The architecture uses **independent pipelines**:
- Pipeline 1: CLOB API → vw_trades_canonical → trades_raw → analytics
- Pipeline 2: ERC-1155 transfers → erc1155_transfers (self-contained)

---

## Target Tables Analysis

### Primary Targets (Direct Dependencies)

Based on schema analysis (`FINAL_DATABASE_SCHEMA.md`) and code grep, the following tables directly consume ERC-1155 data:

#### 1. `trades_raw` (Base Trade Table)
- **Current rows:** 159,574,259
- **Purpose:** Raw blockchain trade data built from ERC1155 + ERC20 flows
- **Dependency:** Joins `erc1155_transfers` to build complete trade records
- **Risk:** HIGH - Base table for all analytics
- **Enrichment method:** Append new trades from recovered blocks

#### 2. `vw_trades_canonical` (Primary Trade View)
- **Type:** View (not table)
- **Dependency:** Derived from `trades_raw`
- **Action:** No direct action needed (automatically reflects trades_raw)

#### 3. `wallet_metrics_complete` (Wallet Performance)
- **Current rows:** ~1,000,000 wallets
- **Purpose:** Aggregated wallet performance metrics
- **Dependency:** Computed from `vw_trades_canonical`
- **Risk:** MEDIUM - Analytics table
- **Enrichment method:** Recompute metrics for affected wallets

#### 4. Market Resolution Tables
- **Tables:** `market_resolutions_final`, `wallet_resolution_outcomes`
- **Dependency:** Uses block timestamps for resolution timing
- **Risk:** LOW - Timestamps may improve accuracy but not critical
- **Enrichment method:** UPDATE resolved_at where timestamps changed

---

### Secondary Targets (Indirect Dependencies)

These tables may benefit from refreshed data but are not critical:

- `outcome_positions_v2` - Position snapshots
- `wallet_pnl_summary_final` - Aggregated P&L (view, auto-updates)
- `realized_pnl_by_market_final` - Market-level P&L (view, auto-updates)

---

## Enrichment Strategy

### Step 1: Snapshot Pre-Enrichment State

**Before any INSERT/UPDATE operations:**

```sql
-- trades_raw
SELECT
  count() as total_rows,
  min(block_number) as min_block,
  max(block_number) as max_block,
  max(timestamp) as latest_timestamp
FROM default.trades_raw;

-- wallet_metrics_complete
SELECT
  count() as total_wallets,
  sum(total_trades) as sum_trades,
  max(last_trade_date) as latest_trade
FROM default.wallet_metrics_complete;

-- market_resolutions_final
SELECT
  count() as total_resolutions,
  max(resolved_at) as latest_resolution
FROM default.market_resolutions_final;
```

**Store results in:** `docs/recovery/pre_enrichment_snapshot.json`

---

### Step 2: Identify Affected Blocks

The recovered data spans blocks 37,000,001 → 78,876,523 (Dec 2022 → Oct 2025). We need to identify which trades in this range need refreshing.

```sql
-- Count trades in recovered block range
SELECT count() as affected_trades
FROM default.trades_raw
WHERE block_number BETWEEN 37000001 AND 78876523;

-- Check for timestamp mismatches
SELECT
  countIf(timestamp = toDateTime(0)) as zero_timestamps,
  count() as total_in_range
FROM default.trades_raw
WHERE block_number BETWEEN 37000001 AND 78876523;
```

**Expected:** High number of zero timestamps in original data that can now be corrected.

---

### Step 3: Enrich `trades_raw` (Append-Only)

**WARNING:** Do NOT use `UPDATE` on large ranges. Use CREATE TABLE → RENAME pattern.

**Option A: Rebuild trades_raw from ERC1155 + ERC20 (Recommended)**

This is the safest approach - rebuild the entire table from scratch:

```typescript
// Script: scripts/rebuild-trades-from-erc1155.ts
// Estimated runtime: 15-30 minutes

// Step 1: Create new trades_raw with correct timestamps
CREATE TABLE default.trades_raw_v2 ENGINE = SharedMergeTree
ORDER BY (wallet_address, timestamp)
PARTITION BY toYYYYMM(timestamp)
AS
SELECT
  trade_id,
  wallet_address,
  market_id,
  condition_id,
  COALESCE(e.block_timestamp, toDateTime(0)) as timestamp,  -- Use new timestamps
  side,
  entry_price,
  exit_price,
  shares,
  usd_value,
  pnl,
  is_closed,
  transaction_hash,
  outcome_index,
  e.block_number,
  log_index,
  canonical_category,
  question,
  outcomes_json,
  tags_json
FROM default.trades_raw t
INNER JOIN default.erc1155_transfers e
  ON lower(t.transaction_hash) = lower(e.tx_hash)
  AND t.block_number = e.block_number;

-- Step 2: Verify row counts
SELECT count() FROM default.trades_raw;     -- 159,574,259
SELECT count() FROM default.trades_raw_v2;  -- Should match

-- Step 3: Atomic swap
RENAME TABLE default.trades_raw TO default.trades_raw_old_20251111;
RENAME TABLE default.trades_raw_v2 TO default.trades_raw;

-- Step 4: Verify timestamp improvement
SELECT
  countIf(timestamp = toDateTime(0)) as zero_timestamps_old
FROM default.trades_raw_old_20251111;

SELECT
  countIf(timestamp = toDateTime(0)) as zero_timestamps_new
FROM default.trades_raw;

-- Expected: zero_timestamps_new << zero_timestamps_old
```

**Option B: Append-Only Update (If rebuild too slow)**

```sql
-- Create enriched subset
CREATE TABLE default.trades_raw_enriched ENGINE = SharedMergeTree
ORDER BY (wallet_address, timestamp)
AS
SELECT
  t.*,
  e.block_timestamp as new_timestamp
FROM default.trades_raw t
INNER JOIN default.erc1155_transfers e
  ON lower(t.transaction_hash) = lower(e.tx_hash)
WHERE t.block_number BETWEEN 37000001 AND 78876523
  AND t.timestamp = toDateTime(0)
  AND e.block_timestamp > toDateTime(0);

-- Merge back (use ReplacingMergeTree logic)
-- This is complex - prefer Option A
```

**Recommendation:** Use Option A (full rebuild) for data integrity.

---

### Step 4: Refresh Wallet Metrics

After `trades_raw` is enriched, recompute wallet metrics for affected wallets:

```sql
-- Find wallets with trades in recovered block range
CREATE TABLE default.affected_wallets ENGINE = Memory AS
SELECT DISTINCT wallet_address
FROM default.trades_raw
WHERE block_number BETWEEN 37000001 AND 78876523;

-- Recompute metrics for affected wallets
INSERT INTO default.wallet_metrics_complete
SELECT
  wallet_address,
  count() as total_trades,
  sum(usd_value) as total_volume,
  sum(pnl) as total_pnl,
  100.0 * countIf(pnl > 0) / count() as win_rate,
  avg(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
  avg(CASE WHEN pnl < 0 THEN pnl END) as avg_loss,
  stddevPop(pnl) as pnl_stddev,
  (avg(pnl) / nullIf(stddevPop(pnl), 0)) * sqrt(count()) as sharpe_ratio,
  min(pnl) as max_drawdown,
  count(DISTINCT market_id) as total_markets,
  count(DISTINCT toDate(timestamp)) as active_days,
  min(timestamp) as first_trade_date,
  max(timestamp) as last_trade_date,
  avg(usd_value) as avg_trade_size,
  quantile(0.5)(usd_value) as median_trade_size
FROM default.trades_raw
WHERE wallet_address IN (SELECT wallet_address FROM default.affected_wallets)
GROUP BY wallet_address;

-- Clean up
DROP TABLE default.affected_wallets;
```

---

### Step 5: Update Market Resolutions (If Needed)

Check if resolution timestamps need updating:

```sql
-- Find resolutions with potentially incorrect timestamps
SELECT count() as resolutions_in_recovered_blocks
FROM default.market_resolutions_final
WHERE resolved_at BETWEEN
  (SELECT min(block_timestamp) FROM default.erc1155_transfers WHERE block_number >= 37000001)
  AND
  (SELECT max(block_timestamp) FROM default.erc1155_transfers WHERE block_number <= 78876523);

-- If count > 0, update resolution timestamps
-- Use CREATE TABLE → RENAME pattern (not UPDATE)
```

---

## Guardrails & Validation

### Before Each Table Enrichment:

1. **Snapshot row counts:**
   ```bash
   npx tsx scripts/snapshot-table-state.ts <table_name>
   ```

2. **Estimate impact:**
   ```sql
   SELECT count() as affected_rows
   FROM <table_name>
   WHERE block_number BETWEEN 37000001 AND 78876523;
   ```

3. **Verify no concurrent writes:**
   ```sql
   SELECT * FROM system.processes WHERE query LIKE '%INSERT INTO%<table_name>%';
   ```

### After Each Table Enrichment:

1. **Verify row count delta:**
   ```sql
   -- Should match or be close to pre-snapshot count
   SELECT count() FROM <table_name>;
   ```

2. **Check timestamp quality:**
   ```sql
   SELECT
     countIf(timestamp = toDateTime(0)) as zero_timestamps,
     count() as total_rows,
     100.0 * zero_timestamps / total_rows as zero_pct
   FROM <table_name>;

   -- Expected: zero_pct < 0.01% (exceptional quality)
   ```

3. **Sample verification:**
   ```sql
   SELECT * FROM <table_name>
   ORDER BY timestamp DESC
   LIMIT 10;
   ```

4. **Log results:**
   - Append to `docs/recovery/erc1155_restore.md`
   - Include: table name, old count, new count, timestamp improvement

---

## Stop Points & Rollback

**Pause after each major table enrichment** and verify:
- Row counts match expectations
- Timestamp quality improved (fewer zeros)
- No data corruption (sample checks)

**If anything looks wrong:**

```sql
-- Rollback trades_raw example
RENAME TABLE default.trades_raw TO default.trades_raw_failed;
RENAME TABLE default.trades_raw_old_20251111 TO default.trades_raw;

-- Verify
SELECT count() FROM default.trades_raw;  -- Should be 159,574,259
```

**All backups preserved until you explicitly approve cleanup.**

---

## Execution Order

1. ✅ **Phase 2 Complete** - Production tables swapped
2. 🔲 **Snapshot pre-enrichment state** (5 min)
3. 🔲 **Rebuild trades_raw** with new timestamps (20-30 min)
4. 🔲 **Verify trades_raw** quality (5 min)
5. 🔲 **Refresh wallet_metrics_complete** (10-15 min)
6. 🔲 **Verify wallet_metrics** quality (5 min)
7. 🔲 **Update market resolutions** (if needed, 5-10 min)
8. 🔲 **Final verification** across all tables (10 min)
9. 🔲 **Document results** in session report

**Total estimated time:** 60-90 minutes

---

## Commands for Phase 3 Execution

### Pre-Enrichment Snapshot
```bash
npx tsx scripts/snapshot-pre-enrichment.ts > docs/recovery/pre_enrichment_snapshot.json
```

### Step 1: Rebuild trades_raw
```bash
npx tsx scripts/rebuild-trades-from-erc1155.ts
```

### Step 2: Refresh wallet_metrics
```bash
npx tsx scripts/refresh-wallet-metrics.ts
```

### Step 3: Verify everything
```bash
npx tsx scripts/verify-enrichment-complete.ts
```

---

## Success Criteria

- ✅ `trades_raw` row count unchanged (159,574,259)
- ✅ Timestamp quality improved: < 0.01% zero timestamps
- ✅ `wallet_metrics_complete` recomputed for affected wallets
- ✅ All views (vw_trades_canonical, wallet_pnl_summary) reflect new data
- ✅ No data loss or corruption
- ✅ All backups preserved until explicit cleanup approval

---

## Rollback Points

Multiple safety nets in place:

1. **Dual backups** (`_backup_20251111a/b`)
2. **Old production** (`_old` tables from Phase 2)
3. **Pre-enrichment backups** (`_old_20251111` from Phase 3)
4. **Staging tables** (can re-swap if needed)

**Maximum rollback depth:** 4 levels

---

## Next Steps

**Awaiting user approval to proceed with:**
1. Pre-enrichment snapshot
2. trades_raw rebuild (Option A - full rebuild recommended)
3. Wallet metrics refresh

**Or user may prefer:**
- Different execution order
- Additional validation steps
- Manual review between steps

---

**Created:** 2025-11-11 (PST)
**Status:** Ready for Phase 3 execution pending user approval
**Estimated completion:** 60-90 minutes after approval
