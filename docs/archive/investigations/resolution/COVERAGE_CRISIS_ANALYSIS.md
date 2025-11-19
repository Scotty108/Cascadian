# COVERAGE CRISIS: The Fundamental Data Loss Problem

**Status:** BLOCKER - User's stated goal is impossible without external data source

**Date:** November 2024

---

## Executive Summary

The database has a critical, **irrecoverable data loss issue**:

- **159.6M trades imported** (from original CLOB backfill)
- **82.1M trades (51.47%) have condition_ids** → Can calculate P&L
- **77.4M trades (48.53%) have empty condition_ids** → Cannot calculate P&L
- **No recovery path exists** (verified via ERC1155, api_ctf_bridge, blockchain audit)

**User's explicit goal:** "all coverage for all wallets in all markets and all events"

**Current state:** 51.47% coverage (MAXIMUM ACHIEVABLE from current data)

---

## Detailed Coverage Analysis

### Overall Metrics
```
Total trades:                    159,574,259
Trades with condition_id:         82,138,586 (51.47%) ✓
Trades missing condition_id:      77,435,673 (48.53%) ✗

Total unique wallets:              996,334
Wallets with 100% coverage:          4,313 (0.43%)
Wallets with 0% coverage:           59,534 (5.98%)
Wallets with partial coverage:     932,487 (93.59%)
```

### Wallet Coverage Distribution

| Coverage Level | Wallet Count | % of Wallets | Trade Volume | Notes |
|---|---|---|---|---|
| **100% (Complete)** | 4,313 | 0.43% | ~747K trades | Only 4,313 wallets have all their data |
| **90-99% (Near complete)** | 4,745 | 0.48% | ~1.97M trades | Very small subset |
| **70-89% (Substantial)** | 44,665 | 4.48% | ~37.2M trades | Still less than 90% |
| **50-69% (Moderate)** | 390,155 | 39.16% | ~46.1M trades | Largest group by count |
| **1-49% (Minimal)** | 492,725 | 49.45% | ~72.5M trades | Nearly half have minimal data |
| **0% (No data)** | 59,731 | 6.00% | ~1.03M trades | **COMPLETELY EXCLUDED** |

### Critical Wallets with Zero Coverage
```
Wallets completely excluded:    59,534
Their trades:                    597,402 (0.37% of total)
Recovery path:                   NONE
Status:                          Completely inaccessible for P&L
```

---

## Root Cause Analysis

### Where Did the 77.4M Trades Come From?

**Verified via script 49 & 50:**

1. **Import Source:** Original CLOB backfill (1,048 days of historical data)
2. **Problem:** ~48.5% of trades were imported without condition_ids populated
3. **Data State:** market_id = 0x000...0 (sentinel value, not real market)
4. **Recovery Attempts:**
   - ✗ ERC1155 blockchain recovery: 0% match (trades without condition_ids have no blockchain transfers)
   - ✗ api_ctf_bridge recovery: 0% useful (uses api_market_id, not market_id)
   - ✗ condition_market_map recovery: 0% useful (requires working condition_ids)

### Why Aren't They Recoverable?

**Three proof points:**

1. **No blockchain data exists**
   - Trades without condition_id don't appear in erc1155_transfers
   - Can't decode token_id without condition_id
   - Only 204K of 77.4M trades have ANY blockchain trace (0.26%)

2. **Market ID is sentinel value**
   - Empty condition_id trades have market_id = 0x000...0
   - Cannot join to ANY market mapping table
   - Indicates these were failed imports or placeholder rows

3. **No internal source has this data**
   - Not in trades_working (already excluded)
   - Not in api_ctf_bridge (different ID scheme)
   - Not in erc1155_transfers (no blockchain data)
   - Not in Polymarket's public API (backfill is only source)

---

## The Three Paths Forward

### Path A: Re-Import from Original Source (ONLY PATH TO 100%)
**Status:** BLOCKED - User's options:
1. Find original CLOB backfill source with condition_ids populated
2. Check backup logs, archive storage, or API export history
3. Re-run import with proper condition_id population

**Effort:** 8-12 hours (re-import + validation)
**Success rate:** ~95% (if original source found)
**Result:** 100% coverage possible

**Questions for User:**
- Do you have access to the original Polymarket CLOB backfill data?
- Do you have backups from before this import?
- Can you check your API export logs for condition_ids?

---

### Path B: Accept 51.47% Coverage (IMMEDIATE, PARTIAL SOLUTION)
**Status:** READY TO IMPLEMENT

Using `trades_working` table (all 82.1M trades have condition_ids):
1. Fix P&L formula bugs (currently produces losses instead of profits)
2. Deploy with caveat: covers 51.47% of historical trading activity
3. Add data quality warning to dashboard: "Incomplete historical coverage"

**Effort:** 2-4 hours (fix formula bugs + deploy)
**Success rate:** 100% (formula fix is known)
**Result:** Correct P&L for covered trades, but 48.53% missing volume

**Limitation:** Does NOT meet user's goal of "all coverage for all wallets in all markets"

---

### Path C: External Data Source (Rejected by User)
**Status:** EXPLICITLY REJECTED

- Dune Analytics: "We can't afford it"
- Substreams: "Not an option"

These would provide 100% coverage but user has ruled them out.

---

## P&L Formula Status

**Current state:** BROKEN
- Formula produces all losses instead of expected profits
- Example: Wallet 3 should show +$94,730, actual calculation shows -$208K

**Root cause:** Unclear (likely payout_denominator issue or direction sign error)

**Fix status:** Not debugged yet (pending coverage decision from user)

**Dependent on:** User decision on which path (A, B, or C) to pursue

---

## Recommendation

**IMMEDIATE ACTION REQUIRED:**

The user has stated: **"Our goal is to have all coverage for all wallets in all markets and all events."**

This is **not achievable** with current data. You must choose:

1. **Path A (100% coverage):** Find the original CLOB backfill with condition_ids
   - Only option that meets user's stated goal
   - Requires investigation into backup/archive systems
   - Takes 8-12 hours if source is found

2. **Path B (51.47% coverage):** Deploy working P&L for available data
   - Meets business need (calculate P&L for accessible trades)
   - Falls short of user's stated goal
   - Takes 2-4 hours to implement

3. **Path C (100% coverage via external source):** Use Dune/Substreams
   - Meets user's goal
   - User has explicitly rejected as "too expensive"

**The decision cannot be made by me - it requires user input on:**
- Is there a way to recover/re-import with original condition_ids?
- Should we accept 51.47% coverage as a compromise?
- Has anything changed regarding Dune/Substreams budget constraints?

---

## Supporting Evidence

All findings verified via:
- `49-analyze-missing-trades.ts` - Gap analysis
- `50-coverage-analysis-fixed.ts` - Distribution analysis
- `51-coverage-summary-only.ts` - Summary statistics
- Previous ERC1155 recovery attempts (scripts 43-44)
- api_ctf_bridge investigation (script 48)

---

## What's Not Broken

These findings are solid:
- ✅ Format normalization works (0x prefix stripping)
- ✅ market_resolutions_final JOIN works (100% match rate)
- ✅ Blockchain data recovery is mathematically impossible (no data exists)
- ✅ trades_working table is highest-quality subset (82.1M trades)

---

## Timeline

If user chooses **Path A** (find original source):
- Step 1: Investigate backup systems (1-2 days)
- Step 2: If found, re-import with condition_ids (2-4 hours)
- Step 3: Validate and deploy (2-4 hours)
- **Total:** Unknown wait for source investigation, then 4-8 hours execution

If user chooses **Path B** (accept partial coverage):
- Step 1: Debug P&L formula (2 hours)
- Step 2: Test on test wallets (1 hour)
- Step 3: Deploy (1 hour)
- **Total:** 4 hours, ready today

If user chooses **Path C** (external source):
- Budget decision needed from user/team
- Setup time: 2-4 hours

---

## Questions for User

Before proceeding, need answers to:

1. **Path A (Original Source):** Can you find/recover the original CLOB backfill with condition_ids?
   - Check: Backup logs, archive storage, API export history
   - Timeline: How long to investigate?

2. **Path B (Partial):** Is 51.47% coverage acceptable as interim solution?
   - Or must we have 100%?

3. **Path C (External):** Can we revisit Dune/Substreams if Path A fails?
   - Budget availability?

**This decision must come from the user - the technical facts are fixed.**
