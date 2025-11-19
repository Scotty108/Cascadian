# P&L Source Switchover Guide

**Status:** Interface layer ready for C2 integration
**Date:** 2025-11-16
**Phase:** Phase 4 - Prepare Interface for External Trades

---

## Overview

This document explains the **pm_trades_complete** interface layer and how C2 should integrate external trades (Dome/AMM) into the P&L pipeline.

### Current Architecture

```
pm_trades (CLOB-only)
    ↓
pm_trades_complete (interface layer - PASSTHROUGH)
    ↓
pm_wallet_market_pnl_resolved (P&L view)
    ↓
pm_wallet_pnl_summary (wallet aggregates)
```

### Target Architecture (After C2 Integration)

```
pm_trades (CLOB)          pm_trades_external (Dome/AMM)
    ↓                              ↓
    └──────────→ pm_trades_complete (UNION) ←────────┘
                        ↓
         pm_wallet_market_pnl_resolved (P&L view)
                        ↓
              pm_wallet_pnl_summary (wallet aggregates)
```

---

## Current Behavior (Passthrough Mode)

### pm_trades_complete View Definition

**Location:** Created by `scripts/127-create-pm-trades-complete-view.ts`

```sql
CREATE VIEW pm_trades_complete AS
SELECT
  *,
  'clob_only' AS data_source
FROM pm_trades
```

**Key Facts:**
- 38,945,566 total trades (CLOB-only as of 2025-11-16)
- All trades tagged with `data_source = 'clob_only'`
- Direct passthrough - no transformation or filtering
- Acts as interface layer between data sources and P&L logic

### Baseline P&L Snapshot

**File:** `reports/PNL_SNAPSHOT_xcnstrategy_2025-11-16.md`

**Baseline Metrics (xcnstrategy wallet, CLOB-only):**
- Total Markets: 45
- Total Trades: 194
- Total P&L (Net): **$42,789.76**
- Total P&L (Gross): $42,789.76
- Total Fees Paid: $0.00
- Net Shares: 81,988.03

This snapshot serves as the baseline for before/after comparison when C2 plugs in external trades.

---

## Future Behavior (After C2 Integration)

### pm_trades_complete View Definition (Target)

**What C2 Should Do:**

1. **Create pm_trades_external table** with same schema as pm_trades
2. **Update pm_trades_complete view** to union both sources:

```sql
CREATE OR REPLACE VIEW pm_trades_complete AS
SELECT
  *,
  'clob' AS data_source
FROM pm_trades

UNION ALL

SELECT
  *,
  data_source  -- 'dome', 'amm', etc. from pm_trades_external
FROM pm_trades_external
```

### Schema Requirements

**pm_trades_external must have exact same schema as pm_trades:**

Required columns:
- `wallet_address` (String)
- `canonical_wallet_address` (String) - uses proxy mapping
- `condition_id` (String, 64 chars, lowercase, no 0x prefix)
- `outcome_index` (UInt8, 0-based)
- `outcome_label` (String, "Yes", "No", etc.)
- `question` (String)
- `side` (String, "BUY" or "SELL")
- `shares` (Float64, always positive)
- `price` (Float64, 0.0 to 1.0)
- `fee_amount` (Float64, optional, defaults to 0.0)
- `block_time` (DateTime)
- `data_source` (String, e.g., 'dome', 'amm')

**Critical:** All columns must match types and nullability. Use `DESCRIBE pm_trades` to verify exact schema.

---

## Validation Steps (For C2)

### Step 1: Create pm_trades_external

```sql
-- Example structure (adjust as needed)
CREATE TABLE pm_trades_external (
  wallet_address String,
  canonical_wallet_address String,
  condition_id String,
  outcome_index UInt8,
  outcome_label String,
  question String,
  side String,
  shares Float64,
  price Float64,
  fee_amount Float64,
  block_time DateTime,
  data_source String  -- 'dome', 'amm', etc.
) ENGINE = ReplacingMergeTree()
ORDER BY (canonical_wallet_address, condition_id, block_time);
```

### Step 2: Backfill External Trades

Run your backfill script to populate pm_trades_external with Dome/AMM trades.

**Important:**
- Use canonical_wallet_address mapping (same as pm_trades)
- Normalize condition_id (lowercase, no 0x, 64 chars)
- Tag each source with appropriate data_source value

### Step 3: Update pm_trades_complete View

Run the updated view definition (see "Target" section above).

### Step 4: Verify Data Integrity

**Quick sanity checks:**

```sql
-- Check total trade counts
SELECT
  data_source,
  COUNT(*) as trade_count,
  COUNT(DISTINCT canonical_wallet_address) as wallet_count,
  COUNT(DISTINCT condition_id) as market_count
FROM pm_trades_complete
GROUP BY data_source;

-- Verify no duplicates between sources
SELECT
  canonical_wallet_address,
  condition_id,
  block_time,
  COUNT(*) as dup_count
FROM pm_trades_complete
GROUP BY canonical_wallet_address, condition_id, block_time
HAVING dup_count > 1
LIMIT 10;
```

**Expected results:**
- `data_source = 'clob'` should show 38.9M trades (existing baseline)
- `data_source = 'dome'` should show your new external trades
- No duplicates (dup_count > 1) should exist

### Step 5: Rebuild P&L Views

The P&L views will automatically pick up the new data. No changes needed to:
- `pm_wallet_market_pnl_resolved`
- `pm_wallet_pnl_summary`

Just verify they refresh correctly:

```bash
# P&L views are VIEWs, so they auto-refresh on query
# But verify they're working:
npx tsx scripts/125-validate-pnl-consistency.ts --wallet xcnstrategy
```

### Step 6: Generate "After" Snapshot

```bash
npx tsx scripts/126-xcn-pnl-snapshot.ts --wallet xcnstrategy --out md
```

**Compare to baseline:**
- Before (CLOB-only): $42,789.76
- After (CLOB + external): TBD (should be higher if external trades include profitable positions)

**Key metrics to check:**
- Total trades should increase
- Total markets may increase (if external trades include markets not in CLOB)
- P&L may increase or decrease depending on external trade performance

### Step 7: Multi-Wallet Validation

Run health checks on baseline wallets:

```bash
npx tsx scripts/124b-dump-wallet-coverage-multi.ts  # Coverage report
npx tsx scripts/125b-validate-pnl-consistency-multi.ts  # Consistency checks
```

All checks should pass. If any fail, investigate before deploying.

---

## Rollback Plan

If issues arise, rollback is simple:

```sql
-- Revert to passthrough mode
CREATE OR REPLACE VIEW pm_trades_complete AS
SELECT
  *,
  'clob_only' AS data_source
FROM pm_trades;
```

This immediately removes external trades from P&L calculations. No data loss.

---

## Phase 5 (Optional): Diff Mode

**Future Enhancement:**

Add `--compare-view` argument to script 126 to show deltas:

```bash
npx tsx scripts/126-xcn-pnl-snapshot.ts --wallet xcnstrategy --compare-view
```

**Output would show:**
- CLOB-only P&L: $42,789.76
- CLOB + external P&L: $XX,XXX.XX
- Delta: +$X,XXX.XX
- New markets: N
- New trades: M

---

## Critical Notes

### Data Deduplication

**IMPORTANT:** Ensure external trades don't duplicate CLOB trades. Use:
- Unique transaction IDs or composite keys (wallet + condition_id + block_time)
- If a trade appears in both CLOB and external sources, keep CLOB version only
- Use `ReplacingMergeTree` with proper ordering key to handle deduplication

### Proxy Wallet Mapping

External trades **must** use `canonical_wallet_address` for proper aggregation:
- If external source has EOA wallet, look up proxy using `canonical_wallet_map`
- If no mapping exists, create one or use EOA as canonical
- Consistency critical: same wallet must map to same canonical across all sources

### Resolution Status

External trades should only include markets that are:
- Resolved (status = 'resolved')
- Have resolution data in `pm_markets` or `gamma_resolved`

If external source includes unresolved markets, P&L calculations will show 0 until resolution.

---

## Monitoring and Alerts

After integration, monitor:

1. **Trade counts by source:**
   ```sql
   SELECT data_source, COUNT(*) FROM pm_trades_complete GROUP BY data_source;
   ```

2. **P&L consistency:**
   ```bash
   npx tsx scripts/125b-validate-pnl-consistency-multi.ts
   ```

3. **Coverage gaps:**
   ```bash
   npx tsx scripts/124b-dump-wallet-coverage-multi.ts
   ```

Set up alerts if:
- Any data_source drops to 0 (indicates ingestion failure)
- Validation checks start failing
- Coverage gaps increase unexpectedly

---

## Questions for C2

1. **Schema:** Does your external trade data match pm_trades schema exactly?
2. **Deduplication:** How are you ensuring no CLOB/external duplicates?
3. **Proxy mapping:** Are you using canonical_wallet_address for all trades?
4. **Resolution data:** Do you have resolution timestamps for all markets?
5. **Backfill timeline:** When will pm_trades_external be ready to test?

---

## References

- **Interface Layer:** `scripts/127-create-pm-trades-complete-view.ts`
- **P&L View:** `scripts/90-build-pm_wallet_market_pnl_resolved_view.ts`
- **Summary View:** `scripts/95-build-pm_wallet_pnl_summary_view.ts`
- **Snapshot Tool:** `scripts/126-xcn-pnl-snapshot.ts`
- **Coverage Tool:** `scripts/124b-dump-wallet-coverage-multi.ts`
- **Validation Tool:** `scripts/125b-validate-pnl-consistency-multi.ts`
- **Health Checks:** `PNL_PIPELINE_HEALTHCHECKS.md`
- **Baseline Snapshot:** `reports/PNL_SNAPSHOT_xcnstrategy_2025-11-16.md`

---

**Authored by:** C1
**Date:** 2025-11-16
**Status:** Ready for C2 integration
