# Coverage Gap Root Cause Analysis

**Date:** 2025-12-07
**Terminal:** Claude 1
**Status:** FIXED (non-destructive)

## Executive Summary

Investigated and fixed a significant coverage gap where the unified ledger (`pm_unified_ledger_v8_tbl`) was missing events compared to the source table (`pm_trader_events_v2`).

**Root Causes Identified:**
1. **role='maker' filter** excluded taker events (wallets predominantly trading as market order aggressors)
2. **True duplicates** in pm_trader_events_v2 from backfill re-ingestion (2x duplication)

**Fix Applied:**
- Created `vw_pm_trader_events_wallet_dedup_v1` - a normalized view that:
  - Includes BOTH maker AND taker events
  - Deduplicates by (event_id, trader_wallet)
- Updated `materialize-v8-ledger.ts` to read from this view
- **Original tables remain UNCHANGED**

---

## Investigation Details

### Sample Wallet: 0xe1b40c6772bd0d57597ae00cae4df34e70bf46ac

| Metric | Value |
|--------|-------|
| Total rows in pm_trader_events_v2 | 866 |
| Distinct event_ids | 433 |
| Distinct (event_id, wallet) pairs | 433 |
| True duplicates (2x backfill) | 433 (every event duplicated) |
| Maker events | 71 (16.4%) |
| Taker events | 362 (83.6%) |
| Previous unified_ledger CLOB count | 71 (maker-only) |

### Data Model Understanding

In `pm_trader_events_v2`, each trade has two rows globally:
- **Maker row**: The wallet whose limit order was filled
- **Taker row**: The wallet who hit that order (different wallet)

For a **single wallet**, each event_id appears only ONCE (either as maker OR taker, never both).

The duplicates we found are **true duplicates** (same wallet, same role, same values) from backfill re-ingestion, NOT maker/taker pairs.

### Mapping Table Check

| Metric | Value |
|--------|-------|
| Total rows in pm_token_to_condition_map_v5 | 400,155 |
| Distinct token_ids | 400,155 |
| Duplicates | 0 |

The mapping table is clean - not contributing to the problem.

---

## Solution Implemented

### 1. Created Normalized View

**File:** `scripts/pnl/create-normalized-trader-events-view.ts`

```sql
CREATE VIEW vw_pm_trader_events_wallet_dedup_v1 AS
SELECT
  event_id,
  trader_wallet,
  any(side) AS side,
  any(role) AS role,
  any(token_id) AS token_id,
  any(usdc_amount) AS usdc_amount,
  any(token_amount) AS token_amount,
  any(fee_amount) AS fee_amount,
  min(trade_time) AS trade_time,
  any(transaction_hash) AS transaction_hash,
  any(block_number) AS block_number
FROM pm_trader_events_v2
WHERE is_deleted = 0
GROUP BY event_id, trader_wallet
```

**Result for test wallet:**
- Raw table: 866 rows
- Normalized view: 433 rows (deduped correctly)
- Maker-only: 71 events → All events: 433 events (+362 taker events gained)

### 2. Updated Materialization Script

**File:** `scripts/pnl/materialize-v8-ledger.ts`

Changed to read from `vw_pm_trader_events_wallet_dedup_v1` instead of `pm_trader_events_v2` directly.

---

## Next Steps

1. **Rematerialize unified ledger** using the updated script
   - This will rebuild with ALL events (maker + taker)
   - Backfill duplicates will be handled automatically

2. **Re-run validation** on the 45-wallet truth set
   - Expected: Many wallets currently in TIER_C (data gap) should move to TIER_A/B
   - Expected: Accuracy should improve for previously-excluded taker-heavy wallets

3. **Update cleanliness classifier** if needed
   - The "trader_events surplus" metric should drop significantly
   - Negative inventory flags may also decrease

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/pnl/create-normalized-trader-events-view.ts` | Creates the dedupe view |
| `scripts/pnl/materialize-v8-ledger.ts` | Updated to use the view |
| `lib/pnl/clobCleanlinessDbRules.ts` | DB-only cleanliness classifier |
| `tmp/investigate-true-duplicates.ts` | Investigation script |

---

## Safety Notes

- **NO DATA WAS DELETED OR MODIFIED**
- Original `pm_trader_events_v2` table is unchanged
- Original `pm_unified_ledger_v8_tbl` table is unchanged
- Created a new VIEW (not a table copy)
- Full rematerialization should be done carefully with monitoring
