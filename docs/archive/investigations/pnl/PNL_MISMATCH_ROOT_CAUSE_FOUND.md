# P&L MISMATCH ROOT CAUSE ANALYSIS

**Date:** 2025-11-09
**Status:** ROOT CAUSE IDENTIFIED
**Severity:** CRITICAL

## Executive Summary

All 12 test wallets show massive P&L mismatches (Polymarket: $332K, us: -$677) due to a **condition_id normalization bug** causing 0% join success between trades and resolutions.

## The Smoking Gun

### Data Coverage Analysis

```
Total traded conditions:     227,839
Total resolutions in DB:     157,319 (69% theoretical coverage)
Actual matched conditions:         0 (0% ACTUAL coverage)
```

### Root Cause: Normalization Mismatch

**Table: `vw_trades_canonical`**
- Column: `condition_id_norm` (Type: String)
- Format: **`0xde8ea3fffad1287485571fff9ac284e03608362fd474a56f7a4cebf698c86fea`** (WITH 0x prefix)

**Table: `market_resolutions_final`**
- Column: `condition_id_norm` (Type: FixedString(64))
- Format: **`000294b17dca50d91dbce24bbe381c4cc05a3f681d104694efa07fce9342ce8f`** (WITHOUT 0x prefix)

**Result:** ALL joins between trades and resolutions fail silently, causing:
- 0% resolution coverage
- 0% midprice coverage (midprices also use `0x` prefix format)
- All positions valued at -$cost_basis (total loss)

## Impact on Wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad

### Position Analysis (Top 10)

| Position | Shares | Cost Basis | Resolution | Midprice | Status |
|----------|--------|-----------|------------|----------|---------|
| 1 | 2,793.60 | -$4,965 | MISSING | MISSING | Would be +$7,759 with price |
| 2 | 1,005.12 | -$704 | MISSING | MISSING | Would be +$1,704 with price |
| 3 | -1,077.52 | $144 | MISSING | MISSING | Would be -$284 with price |
| 4 | -379.41 | $140 | MISSING | MISSING | Would be -$141 with price |
| 5 | 82.36 | -$74 | MISSING | MISSING | Would be +$153 with price |
| 6 | -172.40 | $70 | MISSING | MISSING | Would be -$70 with price |
| 7 | 70.00 | -$44 | MISSING | MISSING | Would be +$78 with price |
| 8 | 50.00 | -$43 | MISSING | MISSING | Would be +$87 with price |
| 9 | 50.00 | -$42 | MISSING | MISSING | Would be +$92 with price |
| 10 | -40.00 | $18 | MISSING | MISSING | Would be -$57 with price |

**All 10 positions analyzed:**
- 100% missing resolutions
- 100% missing midprices
- ALL due to ID normalization bug

## Why This Causes Negative P&L

Current P&L calculation logic:

```typescript
if (hasResolution) {
  pnl = isWinner ? shares - cost : -cost;
} else if (hasMidprice) {
  pnl = (shares * midprice) - cost;
} else if (lastTradePrice) {
  pnl = (shares * lastTradePrice) - cost;
} else {
  pnl = -cost;  // ← WE END UP HERE FOR ALL POSITIONS
}
```

Since joins fail:
- `hasResolution` = false (can't find resolutions)
- `hasMidprice` = false (can't find current prices)
- `lastTradePrice` works but may not be current

Result: Positions show as **total losses** equal to their cost basis.

## The Fix

### Immediate (1 hour)

**Option A: Normalize at join time**
```sql
-- In P&L calculation view
JOIN market_resolutions_final r
  ON replaceAll(t.condition_id_norm, '0x', '') = r.condition_id_norm
```

**Option B: Add view column**
```sql
-- In market_resolutions_final
ALTER TABLE market_resolutions_final
  ADD COLUMN condition_id_with_prefix String
  MATERIALIZED concat('0x', condition_id_norm);

-- Then join on:
JOIN market_resolutions_final r
  ON t.condition_id_norm = r.condition_id_with_prefix
```

### Permanent (4 hours)

**Establish ID normalization standard (IDN skill):**

1. **Pick ONE format:** `0x` + 64-char lowercase hex (String type)
2. **Apply everywhere:**
   - `vw_trades_canonical.condition_id_norm` ✓ (already correct)
   - `market_resolutions_final.condition_id_norm` ✗ (needs 0x prefix added)
   - `midprices_latest.market_cid` ? (needs verification)
3. **Create normalization function:**
   ```sql
   CREATE FUNCTION normalize_condition_id AS (id) ->
     lower(if(startsWith(id, '0x'), id, concat('0x', id)))
   ```
4. **Add CHECK constraint on new tables**
5. **Backfill existing tables** with atomic rebuild (AR skill)

## Validation Plan

After fix, re-run coverage check:

```sql
SELECT
  COUNT(DISTINCT t.condition_id_norm) as total_conditions,
  COUNT(DISTINCT r.condition_id_norm) as matched_conditions,
  round(matched_conditions / total_conditions * 100, 2) as coverage_pct
FROM vw_trades_canonical t
INNER JOIN market_resolutions_final r
  ON replaceAll(t.condition_id_norm, '0x', '') = r.condition_id_norm
WHERE t.condition_id_norm != ''
```

**Expected result:** ~69% coverage (157K/227K)

Then re-calculate wallet P&L:
- Should jump from -$677 → ~$332K (matching Polymarket)

## Files Generated

1. `/Users/scotty/Projects/Cascadian-app/diagnose-pnl-mismatch.ts` - Diagnostic script
2. `/Users/scotty/Projects/Cascadian-app/pnl-mismatch-diagnosis.txt` - Full output
3. `/Users/scotty/Projects/Cascadian-app/PNL_MISMATCH_ROOT_CAUSE_FOUND.md` - This file

## Next Steps

1. **Immediate:** Apply Option A fix to P&L views (1 hour)
2. **Verify:** Re-run wallet P&L calculations, confirm match with Polymarket
3. **Permanent:** Implement IDN standard across all tables (4 hours)
4. **Prevent:** Add tests that validate join success rates on key tables

---

**Critical Insight:** This bug was silent because:
- No errors thrown (joins just return 0 rows)
- Queries execute successfully
- Only detectable by checking join row counts
- Affects EVERY P&L calculation across the entire system

**Lesson:** Always validate join success rates when building dimensional models.
