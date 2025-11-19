# Coverage Gap Root Cause - FINAL DIAGNOSIS ✅

**Date:** 2025-11-09
**Status:** ROOT CAUSE CONFIRMED - READY TO FIX

---

## 🎯 THE MYSTERY

After text-to-payout conversion:
- **Claimed:** 132,909 payout vectors inserted, coverage improved 34.2% → 59.0%
- **Reality:** Only 7.4% position coverage, wallet 0x4ce7 still at 0%
- **Sample test:** 101% coverage on 1,000 traded condition_ids ✓
- **Full P&L:** Minimal coverage ❌

**The Question:** Why does the data exist and sample joins work, but P&L views show no improvement?

---

## 🔍 ROOT CAUSE DISCOVERED

### Finding #1: P&L Views Don't Include New Resolution Table

**Checked these views:**
- `default.vw_wallet_pnl_calculated`
- `default.vw_wallet_pnl_summary`
- `default.vw_trades_canonical`

**Finding:** ❌ **NONE of them include resolutions_external_ingest**

They only query `market_resolutions_final`, which is why the 132,909 new resolutions aren't being picked up!

**Proof:**
```sql
-- Current P&L views use:
LEFT JOIN default.market_resolutions_final r
  ON lower(t.cid) = lower(r.condition_id_norm)

-- Should be:
LEFT JOIN (
  SELECT condition_id_norm as cid, payout_numerators, payout_denominator
  FROM default.market_resolutions_final
  WHERE payout_denominator > 0
  UNION ALL
  SELECT condition_id as cid, payout_numerators, payout_denominator
  FROM default.resolutions_external_ingest
  WHERE payout_denominator > 0
) r ON lower(t.cid) = lower(r.cid)
```

### Finding #2: Two Different Trade Tables with Different Schemas

**cascadian_clean.fact_trades_clean:**
- Column: `cid_hex` (String)
- Rows: 63,541,461
- Has `source` column
- Direction: Enum8

**default.fact_trades_clean:**
- Column: `cid` (String)  ⚠️ Different name!
- Rows: 63,380,204
- No `source` column
- Direction: LowCardinality(String)

**Impact:** P&L views use `default.fact_trades_clean` which has slightly fewer trades (160K less)

---

## 📊 THE COMPLETE PICTURE

```
Why Sample Joins Work (101% coverage):
├─ Test query explicitly includes resolutions_external_ingest ✅
├─ Uses correct UNION ALL logic ✅
└─ Properly normalizes condition_ids ✅

Why P&L Views Fail (7.4% coverage):
├─ Only query market_resolutions_final ❌
├─ Missing 132,909 resolutions from resolutions_external_ingest ❌
└─ No UNION logic to combine both sources ❌
```

**Translation:**
- The 132,909 new resolutions ARE in the database ✅
- They ARE joinable with trades ✅
- But P&L views don't know to look for them ❌

---

## 🔧 THE FIX

### Step 1: Update vw_wallet_pnl_calculated

**Current:**
```sql
CREATE VIEW default.vw_wallet_pnl_calculated AS
WITH trade_positions AS (
  SELECT ...
  FROM default.fact_trades_clean t
  LEFT JOIN default.market_resolutions_final r
    ON lower(t.cid) = lower(r.condition_id_norm)
  ...
)
```

**Fixed:**
```sql
CREATE VIEW default.vw_wallet_pnl_calculated AS
WITH
  all_resolutions AS (
    SELECT
      condition_id_norm as cid,
      payout_numerators,
      payout_denominator,
      winning_outcome
    FROM default.market_resolutions_final
    WHERE payout_denominator > 0
    UNION ALL
    SELECT
      condition_id as cid,
      payout_numerators,
      payout_denominator,
      NULL as winning_outcome  -- May need to compute this
    FROM default.resolutions_external_ingest
    WHERE payout_denominator > 0
  ),
  trade_positions AS (
    SELECT ...
    FROM default.fact_trades_clean t
    LEFT JOIN all_resolutions r
      ON lower(t.cid) = lower(r.cid)
    ...
  )
```

### Step 2: Update vw_wallet_pnl_summary

Same pattern - add CTE for `all_resolutions` that UNIONs both sources.

### Step 3: Update vw_trades_canonical (if needed)

Check if this view also needs resolution data and apply same fix.

---

## 📈 EXPECTED IMPACT

**Before Fix:**
- Position coverage: 7.4%
- Wallet 0x4ce7: 0% coverage
- Resolution sources: 1 (market_resolutions_final only)

**After Fix:**
- Position coverage: 55-65% (based on sample tests)
- Wallet 0x4ce7: 50-60% coverage (if markets are in resolutions_external_ingest)
- Resolution sources: 2 (market_resolutions_final + resolutions_external_ingest)

**Coverage Breakdown:**
```
Total Markets Traded:           227,838
├─ In market_resolutions_final:  76,861 (34%)
├─ In resolutions_external_ing: 132,909 (59%)
└─ Union (deduplicated):        ~190,000 (83%+)
```

Note: Some markets may be in both tables (overlap), so actual coverage might be slightly less than 93%.

---

## 🚨 IMPLEMENTATION NOTES

### Critical Considerations:

1. **winning_outcome field**
   - market_resolutions_final has this field
   - resolutions_external_ingest may not (needs verification)
   - Solution: Compute from payout_numerators array (winning index = position of 1)

2. **Schema differences**
   - market_resolutions_final: `condition_id_norm` column
   - resolutions_external_ingest: `condition_id` column
   - Both need to be normalized in UNION

3. **Backward compatibility**
   - Existing queries depend on these views
   - Test thoroughly before deploying
   - Consider creating new views first, then swapping

4. **Performance**
   - UNION ALL is fast (no deduplication)
   - May want to materialize the all_resolutions CTE as a table later
   - For now, view should be fine

---

## 🎯 ACTION PLAN

### Phase 1: Fix P&L Views (30 min)

1. ✅ Identified root cause
2. Create fix script: `fix-pnl-views-with-external-ingest.ts`
3. Backup existing views
4. Apply UNION ALL logic
5. Test on sample wallets
6. Verify coverage improvement

### Phase 2: Validate Results (15 min)

1. Re-run `verify-pnl-coverage-after-conversion.ts`
2. Check wallet 0x4ce7 specifically
3. Verify top 10 wallets
4. Confirm position-level coverage matches market-level

### Phase 3: Still Missing Markets (optional, later)

Even after this fix, we'll still have:
- 66,658 markets missing from api_markets_staging (29% gap)
- Need market-level backfill by condition_id (separate task)

But this fix should get us from 7.4% → 55-65% coverage immediately.

---

## 📊 SUCCESS CRITERIA

**Fix is successful when:**
- ✅ Position coverage > 50%
- ✅ Wallet 0x4ce7 shows >0% coverage
- ✅ Top 10 wallets show realistic coverage numbers
- ✅ No errors in view definitions
- ✅ Query performance acceptable

---

## 🎯 FINAL VERDICT

**Why the conversion "worked" but P&L didn't improve:**
1. Text-to-payout conversion successfully inserted 132,909 rows ✓
2. Data is queryable and joins work in isolation ✓
3. But P&L views have hardcoded reference to only market_resolutions_final ✓
4. Views never check resolutions_external_ingest ✓

**The fix is simple:** Add UNION ALL to include both resolution sources.

**Time to fix:** 30-45 minutes including testing.

**This explains everything:**
- Why sample queries showed 101% coverage (they used UNION)
- Why P&L views showed 7.4% coverage (they didn't use UNION)
- Why data exists but doesn't show up (views don't look for it)

---

**Status:** Ready to implement fix. The mystery is solved. 🎉
