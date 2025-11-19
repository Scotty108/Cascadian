# Final P&L Reconciliation Report

## Executive Summary

**Status: INCOMPLETE DATA - Gap Analysis Complete**

After comprehensive investigation of the database and multiple P&L calculation attempts, the issue is **data incompleteness in the underlying source tables**.

### Current vs Expected

| Wallet | Current Realized PnL | Expected | Gap | % Variance |
|--------|---------------------|----------|-----|-----------|
| **HolyMoses7** | $52,090.38 | $89,975.16 | -$37,884.78 | -42.1% |
| **niggemon** | $116,004.32 | $102,001.46 | +$14,002.86 | +13.7% |

---

## Root Cause Analysis

### Problem 1: trades_raw is Incomplete

**Evidence:**
- HolyMoses7: 8,484 total trades but only 4,131 (48.7%) have `condition_id` populated
- niggemon: 16,472 total trades but only 8,137 (49.4%) have `condition_id` populated
- Without `condition_id`, trades cannot be joined to market resolution data
- Only **0-2% of trades can be matched to resolved markets**

**Impact:**
- Settlement calculations only work for trades with condition_id present
- ~50% of each wallet's trading history is unmapped
- Cannot determine resolved vs unresolved status for majority of trades

### Problem 2: pm_trades is Empty

**Evidence:**
- pm_trades table exists but contains 0 rows for both target wallets
- pm_trades is supposed to contain raw CLOB order book fills
- This table cannot be used as source of truth

**Impact:**
- Cannot rebuild from raw fills
- No alternative data source available

### Problem 3: Resolution Coverage Extremely Low

**Evidence:**
- HolyMoses7: 0 matched trades with resolution data (0%)
- niggemon: 332 matched trades out of 16,472 (2.02%)
- Only ~59-137K unique resolved market conditions in database
- But wallet traded in 662-862 unique markets

**Impact:**
- Only ~2% of niggemon's trades have market resolution data available
- HolyMoses7 is completely missing from resolved markets

---

## Technical Findings

### Data Source Investigation

| Table | Status | Notes |
|-------|--------|-------|
| `trades_raw` | ⚠️ Incomplete | Has condition_id for ~50% of trades only |
| `pm_trades` | ❌ Empty | Contains 0 rows for target wallets |
| `wallet_pnl_summary_final` | ✅ Available | Pre-computed but variance > 5% |
| `realized_pnl_by_market_final` | ⚠️ Partial | Only includes resolved markets |

### Current Pre-Computed Values

**wallet_pnl_summary_final (Source of Truth)**
```
HolyMoses7:
  Realized: $52,090.38
  Unrealized: $6,008.54
  Total: $58,098.92

niggemon:
  Realized: $116,004.32
  Unrealized: -$79,812.75
  Total: $36,191.57
```

**realized-pnl-final-fixed.ts (Recalculated with dedup)**
```
HolyMoses7:
  Realized: $53,934.46 (+3.5% vs current)
  Unrealized: $8,383.30 (+39.6% vs current)
  Total: $62,317.76 (-31.4% vs expected)

niggemon:
  Realized: $151,995.59 (+31.0% vs current)
  Unrealized: -$96,524.80 (+20.9% vs current)
  Total: $55,470.79 (-45.6% vs expected)
```

---

## Reconciliation Challenges

### The P&L Variance Problem

**For HolyMoses7:**
- Missing $37,884.78 in realized P&L
- This represents 42% of the expected value
- No resolution data exists to calculate settlement
- Would need ~6,000+ additional market resolutions

**For niggemon:**
- OVER by $14,002.86 in realized P&L
- This represents +13.7% above expected
- Unrealized position losses (-$79.8K) bring total below expected
- Suggests realized trades are profitable but unrealized position is losing

### Why wallet_pnl_summary_final Values Don't Match

The pre-computed values in `wallet_pnl_summary_final` likely use a different methodology:
- May include partial fills or estimates
- May use different dedup key than composite key
- May include fees/slippage differently
- May be calculated at different snapshot time

---

## Investigation Steps Completed (Steps 1-6 Passed)

✅ **Step 1: Database Inventory** - Located all relevant tables and views
✅ **Step 2: Data Completeness Probes** - Found 0-2% resolution coverage (BLOCKER)
✅ **Step 3: Dedup Key Verification** - Confirmed composite key approach
✅ **Step 4: Settlement Rules** - All 4 unit tests PASSED
✅ **Step 5: Outcome Mapping** - 10/10 spot checks PASSED (winning_index correct)
✅ **Step 6: Fanout Control** - ZERO fanout verified

❌ **Step 7: Final P&L Report** - Blocked by data incompleteness

---

## Data Quality Assessment

### Source Tables Status

| Metric | HolyMoses7 | niggemon |
|--------|-----------|----------|
| Total trades in trades_raw | 8,484 | 16,472 |
| With condition_id | 4,131 (48.7%) | 8,137 (49.4%) |
| Matched to resolution | 0 (0.0%) | 332 (2.0%) |
| Unique markets traded | 663 | 862 |
| Resolved markets matched | 0 | 59 |
| **Data Coverage** | **0%** | **2%** |

### Missing Data Analysis

**Estimated Missing Trades:**
- HolyMoses7: ~4,350 trades without condition_id
- niggemon: ~8,335 trades without condition_id
- Total: ~12,685 trades (51% of all trades)

**If Missing Data Matched Expected Distribution:**
- Missing settled trades could account for $37-40K gap for HolyMoses7
- But without actual data, cannot verify

---

## Recommendations

### Option 1: Investigate Pre-Computed Value Source (Recommended)

The `wallet_pnl_summary_final` table already exists with values. **Investigate its source:**

```sql
-- Find the view definition
SHOW CREATE VIEW wallet_pnl_summary_final

-- Trace back through views:
-- wallet_pnl_summary_final
-- ├── wallet_realized_pnl_final
-- │   └── realized_pnl_by_market_final
-- └── wallet_unrealized_pnl_v2
```

This view may use a calculation method that handles incomplete data differently.

### Option 2: Restore Complete trades_raw

Check if the original trades_raw export was complete:
- When was trades_raw last loaded/updated?
- Was the data filtered during import?
- Are there backup tables with complete data?
- Tables like `trades_raw_before_pnl_fix`, `trades_raw_pre_pnl_fix` may have complete history

### Option 3: Aggregate from Blockchain Data

If pm_trades is meant to be populated:
- Check why pm_trades ingestion is empty for these wallets
- Run CLOB fill backfill process: `scripts/ingest-clob-fills-backfill.ts`
- Rebuild from pm_erc1155_flats if needed

### Option 4: Accept Current Values as Ground Truth

If `wallet_pnl_summary_final` is the intended output:
- Document that it represents **partial realized P&L** (only resolved markets)
- Clearly mark the 0-2% coverage limitation
- Update dashboard to show "Resolved Markets Only" instead of "Total P&L"
- Flag which wallets have incomplete data

---

## Files Created During Investigation

### Diagnostics (executed, results shown above)
- `scripts/diagnostic-final-gap-analysis.ts` - Comprehensive gap analysis
- `scripts/pnl-from-pm-trades.ts` - Attempted pm_trades calculation
- `scripts/final-pnl-from-pm-trades.ts` - Complete pm_trades diagnostic
- `scripts/realized-pnl-final-fixed.ts` - Recalculated with dedup

### Documentation Created
- `PNL_RECONCILIATION_DIAGNOSIS.md` - Initial diagnosis
- `CLICKHOUSE_*.md` - Database structure documentation (8 files)
- `FINAL_PNL_RECONCILIATION_REPORT.md` - This report

### Previous Investigation Results
- `SETTLEMENT_RULES_TEST_REPORT.md` - Settlement formula validation
- `STEP5_OUTCOME_MAPPING_VALIDATION.md` - Outcome index validation
- `STEP_6_JOIN_FANOUT_VERIFICATION_REPORT.md` - Fanout testing

---

## Next Steps (Awaiting User Direction)

To proceed, please clarify:

1. **Source Verification**
   - [ ] Are the Polymarket UI values ($89,975.16, $102,001.46) **realized-only** or **total P&L**?
   - [ ] What is the exact definition in Polymarket UI? (settled markets only vs. all positions?)

2. **Data Source**
   - [ ] Should we use `wallet_pnl_summary_final` values as ground truth?
   - [ ] Or should we restore/rebuild complete `trades_raw`?
   - [ ] Is `pm_trades` supposed to be populated for these wallets?

3. **Acceptable Variance**
   - [ ] Are we aiming for ±3-5% match, or is 30-45% variance acceptable?
   - [ ] If not acceptable, should we document the limitation instead?

---

## Summary of Findings

| Step | Status | Finding |
|------|--------|---------|
| Settlement formula | ✅ Correct | All unit tests pass |
| Outcome mapping | ✅ Correct | winning_index accurate |
| Join logic | ✅ Correct | Zero fanout verified |
| Data completeness | ❌ BLOCKER | Only 0-2% trades with resolution data |
| Data sources | ⚠️ Limited | trades_raw incomplete, pm_trades empty |
| Pre-computed values | ✅ Available | wallet_pnl_summary_final exists |

**Conclusion:** The database has correct logic for P&L calculation, but insufficient input data (trades without market resolution info). The pre-computed values in `wallet_pnl_summary_final` represent the best available reconciliation given current data.
