# FINAL INVESTIGATION REPORT: Wallets 2-4 Resolution Data

**Date**: 2025-11-07
**Status**: ✅ RESOLVED
**Coverage**: 100% (424/424 conditions matched)

---

## Executive Summary

Successfully located and validated resolved condition data for wallets 2-4.

### Key Findings

1. **Resolution data EXISTS** in `market_resolutions` table
2. **Coverage is COMPLETE**: 100% of 424 unique conditions matched
3. **All 3,181 trades** from wallets 2-4 have resolution data
4. **Join pattern identified**: Normalization issue was blocking the connection

---

## Investigation Results

### Step 1: Table Inventory

Examined all database tables for resolution data:

| Table Name | Rows | Coverage | Status |
|---|---|---|---|
| `market_resolutions` | 137,391 | ✅ 100% | **Use this** |
| `market_resolutions_final` | ~5,000 | ❌ 0.24% | Do NOT use |

### Step 2: Condition ID Format Analysis

**Problem Identified**: Format mismatch between tables

| Source | Format | Example |
|---|---|---|
| `trades_raw.condition_id` | `0x` + 64 hex chars (66 total) | `0x6571ea6f...` |
| `market_resolutions.condition_id` | 64 hex chars lowercase | `6571ea6f...` |

**Solution**: Normalize both sides before join

### Step 3: Coverage Validation

Tested join with normalization:

```sql
ON lower(mr.condition_id) = lower(replaceAll(t.condition_id, '0x', ''))
```

**Results**:
- Wallet 2: 2/2 trades matched (100%)
- Wallet 3: 1385/1385 trades matched (100%)
- Wallet 4: 1794/1794 trades matched (100%)
- **Total: 3181/3181 trades matched (100%)**

### Step 4: Winning Outcome Analysis

Sample data from `market_resolutions.winning_outcome`:

| Value | Count | Percentage |
|---|---|---|
| "No" | 60,405 | 44% |
| "Yes" | 19,125 | 14% |
| "Up" | 13,551 | 10% |
| "Down" | 13,277 | 10% |
| "Over" | 3,663 | 3% |
| "Under" | 3,296 | 2% |
| Team names | 23,074 | 17% |

**Format**: Plain text strings (not binary, not empty)

---

## Corrected Database Query

### The Fix

```sql
-- BEFORE (Broken - 0% match)
FROM trades_raw t
LEFT JOIN market_resolutions_final mrf
  ON mrf.condition_id_norm = t.condition_id

-- AFTER (Working - 100% match)
FROM trades_raw t
LEFT JOIN market_resolutions mr
  ON lower(mr.condition_id) = lower(replaceAll(t.condition_id, '0x', ''))
```

### Complete P&L Query Template

```sql
WITH resolved_trades AS (
  SELECT
    t.wallet_address,
    t.condition_id,
    t.side,
    toFloat64(t.shares) as shares,
    toFloat64(t.entry_price) as entry_price,
    mr.winning_outcome,
    -- Need to determine if outcome matches what user bet on
    -- This requires matching outcome_index to winning_outcome
    -- (See next section for complete logic)
  FROM trades_raw t
  LEFT JOIN market_resolutions mr
    ON lower(mr.condition_id) = lower(replaceAll(t.condition_id, '0x', ''))
  WHERE t.wallet_address = :wallet_address
    AND mr.winning_outcome IS NOT NULL
)
SELECT
  SUM(...) as total_pnl
FROM resolved_trades
```

---

## Known Issues & Next Steps

### Issue: P&L Calculation Still Showing $0

**Root Cause**: The P&L logic I tested was overly simplified:
```sql
-- THIS IS WRONG
WHEN t.side = 'BUY' AND mr.winning_outcome != '' THEN ...
```

**Why it's wrong**: `winning_outcome` is NEVER empty for resolved markets. It's always "Yes", "No", "Up", etc.

**What's needed**: Map `t.outcome_index` to the actual outcome name, then compare to `mr.winning_outcome`.

### Required Data for Correct P&L

To calculate P&L correctly, we need:

1. ✅ **Have**: `trades_raw.side` (BUY/SELL)
2. ✅ **Have**: `trades_raw.shares`
3. ✅ **Have**: `trades_raw.entry_price`
4. ✅ **Have**: `trades_raw.outcome_index` (0, 1, 2, etc.)
5. ✅ **Have**: `market_resolutions.winning_outcome` ("Yes", "No", etc.)
6. ❌ **Missing**: **Mapping from outcome_index → outcome_name**

### Where is the Outcome Mapping?

The `outcome_index` (0, 1, 2) needs to be mapped to outcome names ("Yes", "No", "Up", "Down", etc.) for each condition.

**Possible sources**:
1. `markets` table with `outcomes` array column
2. API call to Polymarket to get market metadata
3. Hardcoded mappings for binary markets (0=Yes, 1=No)

**Recommendation**: Check the `markets` table for an `outcomes` column that contains this mapping.

---

## Deliverables

### 1. Resolution Data Location

| Item | Value |
|---|---|
| Table | `market_resolutions` |
| Rows | 137,391 |
| Key Column | `condition_id` (String, 64 chars lowercase) |
| Resolution Column | `winning_outcome` (String, e.g., "Yes", "No") |
| Coverage | 100% for wallets 2-4 |

### 2. Corrected JOIN Pattern

```sql
LEFT JOIN market_resolutions mr
  ON lower(mr.condition_id) = lower(replaceAll(t.condition_id, '0x', ''))
```

### 3. Investigation Files Created

All scripts saved in project root:

1. `find-resolution-data.ts` - Complete database inventory
2. `find-resolution-data-simple.ts` - Format analysis
3. `investigate-schema-types.ts` - Schema comparison
4. `find-correct-resolution-table.ts` - Table comparison
5. `final-resolution-diagnosis.ts` - Binary encoding analysis
6. `VALIDATE_RESOLUTION_FIX.ts` - Coverage validation
7. `check-winning-outcome-format.ts` - Outcome value analysis

### 4. Documentation

- `RESOLUTION_DATA_FOUND_REPORT.md` - Technical deep dive
- `FINAL_INVESTIGATION_REPORT.md` - This file (executive summary)

---

## Summary

### Question: Where does resolved condition data live for wallets 2-4?

**Answer**: `market_resolutions` table

### Question: Why wasn't it working?

**Answer**: Three reasons:
1. Wrong table (`market_resolutions_final` has only 0.24% coverage)
2. Format mismatch (0x prefix + case sensitivity)
3. Missing normalization in join condition

### Question: Is it fixed now?

**Answer**: ✅ **Partially**
- ✅ Resolution data: FOUND (100% coverage)
- ✅ Join pattern: FIXED
- ❌ P&L calculation: Still needs outcome_index → outcome_name mapping

---

## Next Investigation Required

**CRITICAL MISSING PIECE**: Outcome name mapping

Need to find where `outcome_index` (0, 1, 2) maps to `outcome_name` ("Yes", "No", "Up", "Down").

**Check these sources**:
1. `markets` table - look for `outcomes` column
2. `market_resolutions_final` table - may have this mapping
3. Polymarket API - may need to fetch market metadata

**Once found**, update P&L logic to:
```sql
CASE
  WHEN (user bet on outcome_index X) AND (X maps to winning_outcome) THEN
    (1.0 - entry_price) * shares  -- WIN
  ELSE
    -entry_price * shares  -- LOSS
END
```

---

## Files to Update

1. **`/Users/scotty/Projects/Cascadian-app/scripts/quick-pnl-check.ts`**
   - Change: Use `market_resolutions` table
   - Change: Fix join condition with normalization
   - Change: Add outcome_index → outcome_name mapping

2. **Any other wallet P&L queries in the codebase**

---

## Validation Metrics

- ✅ Tables examined: 12
- ✅ Queries tested: 20+
- ✅ Coverage achieved: 100% (3181/3181 trades)
- ✅ Investigation time: ~60 minutes
- ✅ Resolution data: FOUND
- ❌ P&L calculation: Requires outcome mapping (next step)

---

*Investigation complete. Resolution data location identified and validated.*
*Next: Find outcome_index → outcome_name mapping to complete P&L calculation.*
