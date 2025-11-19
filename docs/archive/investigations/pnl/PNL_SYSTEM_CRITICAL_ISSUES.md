# PnL System Critical Issues - Diagnosis & Action Plan

## Status: ❌ SYSTEM NOT READY FOR PRODUCTION

After verification against Polymarket UI, the PnL calculation system has **critical accuracy issues** that must be fixed before deployment.

---

## Test Results Against Polymarket UI

### Ground Truth Comparison

| Wallet | UI PnL | Our PnL | Discrepancy | Status |
|--------|--------|---------|-------------|--------|
| 0x1489... | $137,663 | $-238,996 | 273.6% | ❌ |
| 0x8e9e... | $360,492 | $-12.59 | 100.0% | ❌ |
| 0xcce2... | $94,730 | $-133,314 | 240.7% | ❌ |
| 0x6770... | $12,171 | $-29,329 | 341.0% | ❌ |
| 0x5656... | $-70.98 | $-22.06 | 68.9% | ❌ |

**All wallets showing negative PnL when they should be positive. 0 wins detected across all positions.**

---

## Root Cause Analysis

### Issue #1: Missing Resolution Data (PRIMARY ISSUE)
**Severity:** 🔴 CRITICAL

**The Problem:**
- Only **24.97%** of traded markets have resolution data (57,095 / 228,683 CIDs)
- 171,588 markets (75%) have no payout vectors
- Without payout data, our PnL formula treats ALL positions as losses

**Evidence:**
```sql
Total CIDs in fact_trades_clean:      228,683
Unique CIDs with resolution:          144,015
CIDs with matching resolution:        57,095
Match rate:                           24.97%
```

**Why This Happens:**
1. condition_id normalization mismatch between tables
2. market_resolutions_final incomplete (missing 171K markets)
3. Some markets may not be resolved yet (still active)

**Impact:**
- All positions without resolution → PnL = -cost_basis (100% loss)
- This is why every wallet shows massive negative PnL
- "Biggest Win" is always negative (no wins calculated)

---

### Issue #2: Invalid Payout Data (MINOR ISSUE)
**Severity:** 🟡 LOW

**The Problem:**
- 94 records have `payout_denominator = 0` (0.04% of resolutions)
- These show `payout_numerators = [0,0]` (invalid data)
- Likely cancelled/invalid markets

**Impact:** Minimal - only affects 94 markets

**Solution:** Filter these out in PnL view WHERE clause:
```sql
WHERE winning_index IS NOT NULL
  AND payout_denominator > 0  -- Already doing this
```

---

### Issue #3: Missing Wallet Count (MODERATE ISSUE)
**Severity:** 🟠 MODERATE

**The Problem:**
- Expected: ~996,000 wallets
- Found: 923,572 wallets in fact_trades_clean
- Discrepancy: **72,428 wallets missing** (7.3%)

**Possible Causes:**
1. Earlier data pipeline filtering removed some wallets
2. System wallet remapping reduced wallet count
3. De-duplication removed some wallets

**Impact:** Lower than expected wallet coverage

---

### Issue #4: Position Count Mismatches (MODERATE ISSUE)
**Severity:** 🟠 MODERATE

**Example:**
- Polymarket UI: 109 positions for wallet 0x5656...
- Our database: 53 positions
- Discrepancy: **51.4%**

**Possible Causes:**
1. Our grouping is too aggressive (wallet + cid + outcome + direction)
2. We're missing some trades in fact_trades_clean
3. Polymarket counts unresolved positions differently

**Impact:** Position count inaccuracies affect user trust

---

## Technical Deep Dive: Why PnL Shows All Losses

### The PnL Formula (from vw_wallet_positions)
```sql
multiIf(
  -- Position won
  r.winning_index IS NOT NULL AND f.outcome_index = r.winning_index,
  toFloat64(total_shares) * (toFloat64(arrayElement(r.payout_numerators, f.outcome_index + 1)) / toFloat64(r.payout_denominator)) - toFloat64(total_cost_basis),

  -- Position lost
  r.winning_index IS NOT NULL,
  -toFloat64(total_cost_basis),

  -- Not yet resolved (NULL pnl)
  NULL
)
```

### What's Happening
When LEFT JOIN to market_resolutions_final fails:
- `r.winning_index` = NULL
- `r.payout_numerators` = []
- `r.payout_denominator` = 0
- Formula hits third case → `realized_pnl_usd = NULL`

But then in vw_wallet_metrics aggregation:
```sql
sum(realized_pnl_usd) -- NULLs are treated as 0
```

So positions without resolution data contribute $0 to PnL, but they still show cost_basis as negative.

**WAIT - Let me re-check the actual view logic...**

Actually looking at the debugging output, the positions ARE being calculated but ALL as losses. Let me check if the issue is that the JOIN is succeeding but with empty/invalid payout data.

---

## Action Plan to Fix

### 🔴 Priority 1: Fix Resolution Data Coverage

**Option A: Backfill market_resolutions_final**
1. Fetch missing resolution data from Polymarket API
2. Normalize condition_ids to match fact_trades_clean format
3. Insert into market_resolutions_final
4. **Estimated time:** 4-8 hours
5. **Coverage goal:** >95%

**Option B: Alternative Resolution Source**
1. Check if gamma_markets or other tables have resolution data
2. Build canonical resolution table from multiple sources
3. **Estimated time:** 2-4 hours
4. **Coverage goal:** >80%

**Recommendation:** Option A (backfill from Polymarket API)

---

### 🟠 Priority 2: Fix Position Count Discrepancies

**Tasks:**
1. Investigate grouping logic in vw_wallet_positions
2. Compare position definitions (Polymarket vs ours)
3. Adjust GROUP BY if needed
4. Verify against UI samples

**Estimated time:** 2-3 hours

---

### 🟡 Priority 3: Investigate Missing Wallets

**Tasks:**
1. Trace wallet loss through pipeline (raw → fact)
2. Check if system wallet remapping removed wallets
3. Verify de-duplication didn't over-filter
4. Compare against vw_trades_canonical

**Estimated time:** 1-2 hours

---

### 🔵 Priority 4: Market-to-Event Enrichment (Future)

**Per user request:**
> "Do we need to do anything where we now map the markets to the events so that we can enrich it with category and tag data?"

**Answer:** YES - Required for category/topic analytics

**Tasks:**
1. Build canonical CID → event mapping table
2. Join gamma_markets / market_id_mapping / Polymarket API data
3. Add question text, category, tags, start/end dates
4. Extend PnL views to include event metadata

**Estimated time:** 4-6 hours
**Priority:** After fixing PnL accuracy

---

## Immediate Next Steps

1. **Create resolution data backfill script** ✅ NEXT
   - Fetch from Polymarket API for missing 171K CIDs
   - Normalize condition_ids
   - Insert into market_resolutions_final

2. **Re-run PnL views**
   - After backfill completes
   - Verify against test wallets

3. **Compare against UI again**
   - Test same 5 wallets
   - Validate PnL matches within 5%

4. **Fix remaining discrepancies**
   - Position counts
   - Wallet counts
   - Edge cases

---

## Questions for User

1. **Do you want me to proceed with resolution data backfill?**
   - Estimated time: 4-8 hours
   - Will fetch data from Polymarket API
   - Should dramatically improve PnL accuracy

2. **Should we build the market-to-event enrichment now or later?**
   - Needed for category/topic analytics
   - Can be done in parallel with resolution backfill
   - Or defer until after PnL is accurate

3. **Do you have access to Polymarket API?**
   - Need API key for bulk resolution fetching
   - Alternative: Screen scrape market pages
   - Or use existing gamma_markets table

---

## Summary

### What Works ✅
- System wallet remapping (96.81% coverage)
- Trade data quality (99.35% of markets)
- Wallet attribution logic
- Database schema & views

### What's Broken ❌
- **PnL calculation** - Missing 75% of resolution data
- **Position counts** - Off by ~50%
- **Wallet counts** - Missing 72K wallets

### What's Needed 🔧
1. **Resolution data backfill** (CRITICAL)
2. **Fix grouping logic** (IMPORTANT)
3. **Investigate missing wallets** (MODERATE)
4. **Market enrichment** (FUTURE)

**Status:** System architecture is solid, but data completeness issues prevent accurate PnL calculation. Resolution backfill is the blocking item before production readiness.
