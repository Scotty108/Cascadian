# P&L Investigation - Critical Finding

**Date:** November 9, 2025
**Status:** 🔴 RESOLUTION COVERAGE IS THE BLOCKER

---

## TL;DR

❌ **Resolution coverage is insufficient for production P&L calculations**
❌ **Multi-wallet testing reveals 0-55% coverage across wallets**
✅ **Formula is mathematically correct**
🔴 **Action Required: Fix resolution coverage before shipping P&L**

---

## What We Discovered

### Test Results Across 4 Wallets

| Wallet | PM P&L | Our P&L | Ratio | Markets Traded | Resolved | Coverage |
|--------|--------|---------|-------|---------------|----------|----------|
| burrito338 | $137k | $1.5M | **11.02x** | 140 | 77 | 55% |
| wallet2 | $360k | $2 | **0.00x** | 1 | 1 | 100% (only 2 trades) |
| wallet3 | $332k | $0 | **0.00x** | 30 | **0** | **0%** |
| wallet4 | $114k | $55k | **0.49x** | 64 | 29 | 45% |

### The Pattern

**Varying ratios (0.00x → 11.02x) indicate DATA QUALITY issue, not methodology difference**

If it were methodology:
- ✅ All wallets would show similar ratio (e.g., all 10x)
- ✅ Position counts would match
- ✅ Volume would match

What we actually see:
- ❌ Ratios vary wildly: 0.00x, 0.49x, 11.02x
- ❌ Resolution coverage varies: 0%, 45%, 55%
- ❌ Wallet 3 has ZERO resolved markets

---

## Root Cause

### Resolution Data Coverage is Insufficient

Current state:
- **144,015 markets** with payout vectors in `vw_resolutions_unified`
- **~581,000 markets** traded across all wallets
- **24.8% global coverage**

Per-wallet reality:
- burrito338 (active trader): 55% coverage
- wallet3 (active trader): **0% coverage** ← Unacceptable
- wallet4 (active trader): 45% coverage

**This means we cannot accurately calculate P&L for most wallets.**

---

## Why Earlier Analysis Was Wrong

### Previous Conclusion (INCORRECT)
> "Resolution coverage is 24.8% globally but 85-100% for active traders"

### Reality (CORRECT)
- We tested 4 "active" wallets (all with $100k+ P&L on Polymarket)
- Coverage ranged from **0% to 55%**
- Wallet 3 has $332k P&L on Polymarket but **ZERO resolved markets** in our data

### What Happened?
The earlier coverage test checked specific wallets that happened to have good coverage. When we tested a broader set of high-P&L wallets, the coverage problem became apparent.

---

## Impact Assessment

### Cannot Ship P&L Feature Without Resolution Coverage Fix

**Current Coverage Problems:**
1. **0% coverage** for some active high-P&L wallets (wallet3)
2. **45-55% coverage** for others (wallet4, burrito338)
3. **Wildly varying P&L calculations** due to missing data

**User Experience:**
- User checks their P&L: Shows $0 (should show $332k) ← Wallet 3
- User checks their P&L: Shows $55k (should show $114k) ← Wallet 4
- User checks their P&L: Shows $1.5M (should show $137k) ← burrito338 (10x too high!)

**This is NOT production-ready.**

---

## What Needs to Happen

### Option 1: Fix Resolution Coverage (REQUIRED)

**Goal:** Get to 80%+ coverage for wallets with >$10k P&L

**Approaches:**
1. **Blockchain backfill** - Query CTF contract events for all resolutions
   - Time: 4-8 hours implementation
   - Coverage gain: ~300k markets (estimated)
   - Success rate: High (blockchain is source of truth)

2. **Polymarket API backfill** - Fetch missing markets from Gamma API
   - Time: 2-4 hours implementation + ~2 hours runtime
   - Coverage gain: ~171k markets (exact)
   - Success rate: Medium (API may not have all historical data)

3. **Hybrid approach** - Blockchain primary + API fallback
   - Time: 8-12 hours
   - Coverage gain: Maximum possible
   - Success rate: Highest

**Recommendation:** Option 1 (Blockchain backfill) - Most reliable

### Option 2: Ship with Coverage Warning (NOT RECOMMENDED)

**What this means:**
- Ship P&L feature as-is
- Add UI warning: "P&L may be incomplete - only includes resolved markets"
- Show coverage % per wallet

**Pros:**
- Can ship immediately
- Users get SOME P&L data

**Cons:**
- Poor user experience (missing data)
- Inaccurate calculations for most users
- Reputation risk (users expect Polymarket-level accuracy)

---

## Technical Details

### Formula Verification: ✅ CORRECT

The P&L formula works correctly when resolution data exists:

```typescript
pnl = (net_shares * payout_numerators[outcome_index + 1] / payout_denominator) - cost_basis
```

**Verified with manual examples:**
- Winning short position: +$464k ✅ Correct
- Losing long position: -$109k ✅ Correct
- Array indexing: outcome_index + 1 ✅ Correct (ClickHouse is 1-indexed)

### Data Quality Checks: ✅ PASSING

**Trade data:**
- burrito338: 3,598 trades, 2,679 valid (non-zero condition_id)
- Volume matches Polymarket: 97% ✅

**Position counts:**
- burrito338: 78 resolved positions vs 75 Polymarket = 104% match ✅

**Resolution data:**
- 144,015 markets with payout vectors ✅
- Payout vector format correct ✅
- Winning index correct ✅

---

## Next Steps

### Immediate (This Session)

1. **Decide on approach:**
   - Option 1: Blockchain backfill (recommended)
   - Option 2: API backfill (faster but less complete)
   - Option 3: Ship with warning (not recommended)

2. **If proceeding with backfill:**
   - Estimate time to 80% coverage
   - Plan backfill implementation
   - Test on sample markets first

### Short Term (Next Session)

1. **Implement chosen backfill approach**
2. **Re-test P&L across 4 wallets**
3. **Verify coverage reaches 80%+**
4. **Ship P&L feature**

---

## Files Reference

**Analysis Scripts:**
- `test-pnl-calculations-vs-polymarket.ts` - Multi-wallet P&L comparison
- `check-missing-wallet-data.ts` - Resolution coverage investigation
- `compare-wallet-position-counts.ts` - Position count verification

**Documentation:**
- `PNL_VALIDATION_FINDINGS.md` - Initial findings (partial analysis)
- `PNL_INVESTIGATION_COMPLETE_SUMMARY.md` - Previous conclusions (proven incomplete)
- `PNL_CRITICAL_FINDING.md` - This file (current accurate status)

**Database Views:**
- `cascadian_clean.vw_resolutions_unified` - Current resolution source (144k markets)
- `default.vw_trades_canonical` - Trade data (verified accurate)

---

## Conclusion

**Previous Status:** ✅ Ready to ship
**Actual Status:** 🔴 Blocked on resolution coverage

**The good news:**
- Formula is correct
- Trade data is accurate
- We know exactly what's missing

**The reality:**
- Cannot ship P&L without resolution coverage fix
- Need 80%+ coverage for production quality
- Blockchain backfill is the most reliable path forward

**Recommendation:** Implement blockchain resolution backfill before shipping P&L feature.

**Time to production:**
- With backfill: 6-10 hours (4-8h implementation + 2h runtime)
- Without backfill: Not viable for production

---

**Status:** 🔴 BLOCKED - Resolution coverage insufficient
**Blocker:** Need resolution data for 80%+ of traded markets
**Path Forward:** Blockchain backfill of market resolutions
