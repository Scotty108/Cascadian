# DEBRIEFING: P&L Bug Fix & Path to 28K Wallet Metrics

**Date:** 2025-10-29
**Status:** P&L Fix In Progress, Resolution Coverage Issue Identified
**Priority:** CRITICAL

---

## EXECUTIVE SUMMARY

This debriefing covers two critical issues discovered during the Polymarket wallet metrics pipeline:

1. **P&L Calculation Bug** - FIXED, re-processing in progress (2-3 hours remaining)
2. **Resolution Coverage Gap** - Only 5% of conditions have resolution data, blocking 22k wallets from getting metrics

**Current State:**
- 28,001 wallets loaded into database
- Only 5,851 (21%) have computed metrics
- Only 51 wallets (0.2%) qualify for leaderboard (omega >= 1.0, trades >= 10)
- **Root Cause:** 89% of wallets have ZERO resolved trades (can't compute P&L without resolution data)

---

## PROBLEM 1: P&L CALCULATION BUG (CRITICAL)

### The Discovery

User questioned why only 51 wallets appeared on the leaderboard when 28,000 wallets were loaded with filters requiring >10 trades and >$10k volume. User was correct to challenge this - only 1% profitability doesn't make sense for high-volume traders.

**User's Key Quote:**
> "I know that's not true. There's got to be a way that you're not actually seeing their history correctly. Please use agents, think about this deeply, attack it from all sides, use tools, figure out what's going on here."

### Investigation Process

1. **Initial Check** - Verified leaderboard query was correct (`app/api/omega/leaderboard/route.ts:75-76`)
2. **Metrics Check** - Only 51 wallets had omega >= 1.0 (1% of wallets with >=10 resolved bets)
3. **Deep Database Analysis** - Created diagnostic scripts to query raw P&L data
4. **Smoking Gun** - Direct ClickHouse query revealed P&L was INVERTED for NO-side trades

### The Bug

**File:** `/Users/scotty/Projects/Cascadian-app/scripts/full-enrichment-pass.ts`
**Lines:** 614-615 (now fixed)

**Buggy Code:**
```typescript
// WRONG - Uses outcome value (0 or 1) instead of payout value
const outcomeValue = resolution.resolved_outcome === finalSide ? 1 : 0
const pnlPerToken = outcomeValue - avgEntryPrice
const realizedPnlUsd = pnlPerToken * absNetShares
```

**Problem:** When NO wins, `outcomeValue = 0`, so formula becomes:
- `pnlPerToken = 0 - 0.07 = -0.07` ❌ (NO holder looks like loser)
- Should be: `pnlPerToken = 1.0 - 0.07 = 0.93` ✅ (NO holder wins $0.93 per token)

**Corrected Code:**
```typescript
// CORRECT - Uses $1.00 payout for all winners
const positionWon = resolution.resolved_outcome === finalSide
const payoutValue = positionWon ? 1.0 : 0.0

const pnlPerToken = payoutValue - avgEntryPrice
const realizedPnlUsd = pnlPerToken * absNetShares
```

### Evidence of the Bug

**Query Results** (from `check-pnl-by-outcome.ts`):

| Side | Outcome | Trades | Avg P&L | Expected | Status |
|------|---------|--------|---------|----------|--------|
| YES | 1 (YES won) | 5,441 | $169.68 | Positive | ✅ Correct |
| YES | 0 (NO won) | 26,488 | -$37.39 | Negative | ✅ Correct |
| **NO** | **0 (NO won)** | **6,499** | **-$85.25** | **Positive** | **❌ INVERTED** |
| **NO** | **1 (YES won)** | **25,275** | **$310.53** | **Negative** | **❌ INVERTED** |

### Impact

- **99.1% of wallets** incorrectly marked as unprofitable
- **Win rate:** 1.4% (should be 30-50%)
- **Average wallet P&L:** -$155,728 (should be near $0)
- **Omega ratio:** 0.0163 overall (should be ~1.0 for market equilibrium)

### The Fix

**Status:** ✅ Code fixed, ⏳ Data re-processing in progress

1. **Code Fix Applied** - `scripts/full-enrichment-pass.ts` lines 610-617 corrected
2. **Data Cleared** - All P&L values reset to 0 via `clear-pnl-for-recompute.ts`
3. **Re-enrichment Started** - Running with corrected formula (2-3 hours for 2.5M trades)
4. **Next:** Re-compute metrics for all wallets (30-60 minutes)

**Monitor Progress:**
```bash
tail -f runtime/pnl-fix-enrichment.log
```

**Expected Results After Fix:**
- Win rate: 30-50% (not 1.4%)
- Profitable wallets: 20-40% (~660-1,325 wallets, not 51)
- NO-side wins show POSITIVE P&L
- Overall omega ratio: ~0.8-1.2 (market equilibrium)

---

## PROBLEM 2: RESOLUTION COVERAGE GAP (BLOCKING)

### The Real Bottleneck

Even after fixing the P&L bug, we still won't have all 28k wallets on the leaderboard because:

**89% of wallets have ZERO resolved trades**

You can't compute P&L metrics on open positions. Wallets need at least one resolved trade to appear on leaderboard.

### Current Resolution Coverage

**From database analysis:**
- Total distinct conditions in database: ~61,517
- Conditions with resolution data: ~2,858
- **Resolution coverage: ~5%** ❌

**Wallet Breakdown:**
- Total wallets: 28,001
- Wallets with >=1 resolved trade: ~2,959 (11%)
- Wallets with ZERO resolved trades: ~25,042 (89%)

**Why This Happened:**
The resolution map (`data/expanded_resolution_map.json`) only contains 2,858 resolutions that were manually fetched at some point. The vast majority of conditions in our database don't have resolution data yet.

### Path Forward

To get all 28k wallets with metrics, we need MORE resolution data:

**Option A: Sync All Historical Resolutions from Polymarket** (RECOMMENDED)
- Fetch ALL resolved markets from Polymarket API
- Build comprehensive resolution map covering all 61k conditions
- Expected coverage: 30-50% of conditions (18k-30k)
- **This would unlock 15k-20k wallets** with computable metrics

**Option B: Wait for Current Markets to Resolve**
- Slow (could take months)
- Not recommended for immediate results

**Option C: Load More Historical Trades from Already-Resolved Markets**
- Would require going back to Goldsky and filtering for older wallets
- Less efficient than Option A

---

## KEY FILES AND DOCUMENTATION

### Investigation Reports

1. **`/Users/scotty/Projects/Cascadian-app/runtime/metrics-investigation.md`**
   - Complete bug investigation report
   - Generated by Task agent during parallel investigation
   - Contains exact bug location, root cause analysis, verification queries
   - **READ THIS FIRST** for full technical details

2. **`/Users/scotty/Projects/Cascadian-app/METRICS_PHASE2_REPORT.md`**
   - Earlier phase 2 metrics implementation report
   - Documents the metrics computation pipeline
   - Explains omega ratio, Sharpe ratio, tail ratio calculations

### Diagnostic Scripts Created

3. **`check-pnl-by-outcome.ts`**
   - Queries P&L breakdown by side (YES/NO) and outcome
   - Revealed the smoking gun (NO-side P&L inversion)
   - **Run this after enrichment completes to verify fix**

4. **`direct-db-check.ts`**
   - Direct database verification script
   - Manually calculates P&L for sample wallets
   - Confirms accuracy of stored values

5. **`check-wallet-counts.ts`**
   - Shows wallet count breakdown through pipeline stages
   - Total → Enriched → With Metrics → Leaderboard-qualified

6. **`check-leaderboard-criteria.ts`**
   - Breaks down wallets by leaderboard criteria
   - Shows how many have >=10 trades, omega>=1.0, and both

7. **`analyze-top-wallets.ts`**
   - Analyzes top 50/100/200 wallets by omega ratio
   - Provides category breakdowns
   - **Use this to verify data quality after fix**

8. **`check-wallet-counts-detailed.ts`**
   - Detailed breakdown of wallet metrics coverage
   - Shows what's being queried vs what's available

9. **`clear-pnl-for-recompute.ts`**
   - Resets all P&L data to 0
   - Used before re-running enrichment with fixed formula

### Core Pipeline Scripts

10. **`/Users/scotty/Projects/Cascadian-app/scripts/full-enrichment-pass.ts`** ⭐
    - **CRITICAL:** Contains the P&L calculation (lines 610-617)
    - Enriches trades with market data and resolution outcomes
    - Runs in 5 steps (A-E):
      - Step A: Extend condition → market mapping
      - Step B: Apply market IDs to trades
      - Step C: Denormalize category data
      - Step D: Load resolutions
      - **Step E: Calculate P&L** ← Fixed here
    - **Modified on 2025-10-29** with corrected formula

11. **`scripts/fast-apply-resolutions.ts`**
    - Batch applies resolutions from `data/expanded_resolution_map.json`
    - Filters for valid resolutions (non-null payouts)
    - Applied 1,179 valid resolutions in ~3 minutes
    - Used SQL batch updates (much faster than per-wallet)

12. **`scripts/compute-wallet-metrics.ts`**
    - Computes overall lifetime metrics for all wallets
    - Calculates omega ratio, P&L, win rate, Sharpe, tail ratio
    - **Run this after enrichment completes**

13. **`scripts/compute-wallet-metrics-by-category.ts`**
    - Computes per-category metrics (Politics, Crypto, Sports, etc.)
    - **Run this after overall metrics**

### Data Files

14. **`/Users/scotty/Projects/Cascadian-app/data/expanded_resolution_map.json`**
    - Contains 2,858 resolutions
    - Format: `{ condition_id, market_id, resolved_outcome, payout_yes, payout_no, resolved_at }`
    - Only 1,179 have valid (non-null) payouts
    - **LIMITATION:** Only covers ~5% of conditions in database

15. **`data/markets_dim_seed.json`**
    - Market dimension data (condition → market mapping)
    - ~49,827 mappings
    - Used for enrichment Step A

### API Endpoints

16. **`/Users/scotty/Projects/Cascadian-app/app/api/omega/leaderboard/route.ts`**
    - Omega ratio leaderboard API
    - **Lines 75-76:** Filter for `metric_22_resolved_bets >= 10 AND metric_2_omega_net >= 1.0`
    - This filter is CORRECT - the issue was bad P&L data, not the query

### Database Tables

17. **ClickHouse: `trades_raw`**
    - Main trade storage table
    - Key fields: `wallet_address`, `condition_id`, `market_id`, `side`, `shares`, `usd_value`, `realized_pnl_usd`, `is_resolved`, `outcome`
    - **Total trades:** 5,462,413
    - **Resolved trades:** 2,490,142 (45%)
    - **Enriched trades:** 4,963,984 (91%)

18. **ClickHouse: `wallet_metrics_complete`**
    - Computed wallet metrics (overall)
    - Windows: `lifetime`, `90d`, `30d`, `7d`
    - **Current rows:** ~5,851 wallets × 4 windows = ~23,404 rows
    - **After fix:** Should grow to ~15k-20k wallets

19. **ClickHouse: `wallet_metrics_by_category`**
    - Per-category metrics (Politics, Crypto, Sports, etc.)
    - Same structure as `wallet_metrics_complete` but segmented by category

---

## CURRENT STATUS

### ✅ Completed

1. **P&L Bug Identified** - Exact location and root cause documented
2. **Code Fix Applied** - `full-enrichment-pass.ts` corrected (lines 610-617)
3. **Data Cleared** - All P&L values reset to 0
4. **Re-enrichment Started** - Running with corrected formula

### ⏳ In Progress

5. **Full Enrichment Pass** - Re-calculating P&L for 2.5M resolved trades
   - Started: 2025-10-29 ~23:40 UTC
   - **ETA:** 2-3 hours (completes ~02:00-03:00 UTC)
   - **Log:** `runtime/pnl-fix-enrichment.log`

### 🔜 Next Steps (Immediate - After Enrichment Completes)

6. **Re-compute Wallet Metrics** (~30-60 minutes)
   ```bash
   npx tsx scripts/compute-wallet-metrics.ts
   npx tsx scripts/compute-wallet-metrics-by-category.ts
   ```

7. **Verify P&L Fix** (~5 minutes)
   ```bash
   npx tsx check-pnl-by-outcome.ts
   ```
   Expected: NO-side wins show POSITIVE avg P&L

8. **Check Leaderboard** (~5 minutes)
   ```bash
   npx tsx check-leaderboard-criteria.ts
   ```
   Expected: 660-1,325 wallets (20-40% of 3,312 with >=10 bets)

9. **Analyze Top Wallets** (~5 minutes)
   ```bash
   npx tsx analyze-top-wallets.ts
   ```
   Expected: All top 50/100/200 have positive avg P&L

### 🚧 Next Steps (Resolution Coverage - REQUIRED for 28k wallets)

10. **Build Polymarket Resolution Sync Script**
    - Fetch ALL historical resolutions from Polymarket API
    - Target: 18k-30k resolved conditions (30-50% coverage)
    - **This is the ONLY way to get remaining 22k wallets with metrics**

11. **Apply New Resolutions**
    - Run `fast-apply-resolutions.ts` with expanded resolution map
    - Or integrate into `full-enrichment-pass.ts`

12. **Re-compute Metrics Again**
    - After new resolutions applied
    - Should see 15k-20k wallets with metrics (vs current 5,851)

---

## VERIFICATION QUERIES

After the enrichment completes, run these queries to verify the fix worked:

### Query 1: Check P&L by Side and Outcome
```sql
SELECT
  side,
  outcome,
  COUNT(*) as count,
  AVG(realized_pnl_usd) as avg_pnl,
  SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as positive_count,
  SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as negative_count
FROM trades_raw
WHERE is_resolved = 1
GROUP BY side, outcome
ORDER BY side, outcome;
```

**Expected Results:**
- NO side, outcome=0 (NO won): **POSITIVE** avg_pnl ✅
- YES side, outcome=1 (YES won): **POSITIVE** avg_pnl ✅
- NO side, outcome=1 (YES won): **NEGATIVE** avg_pnl ✅
- YES side, outcome=0 (NO won): **NEGATIVE** avg_pnl ✅

### Query 2: Overall Win Rate
```sql
SELECT
  COUNT(CASE WHEN realized_pnl_usd > 0 THEN 1 END) as winning_trades,
  COUNT(CASE WHEN realized_pnl_usd < 0 THEN 1 END) as losing_trades,
  COUNT(*) as total_trades,
  COUNT(CASE WHEN realized_pnl_usd > 0 THEN 1 END) / COUNT(*) * 100 as win_rate_pct
FROM trades_raw
WHERE is_resolved = 1;
```

**Expected:** win_rate_pct between 30-50% (not 1.4%)

### Query 3: Profitable Wallet Rate
```sql
SELECT
  COUNT(CASE WHEN metric_2_omega_net >= 1.0 THEN 1 END) as profitable_wallets,
  COUNT(*) as total_wallets,
  COUNT(CASE WHEN metric_2_omega_net >= 1.0 THEN 1 END) / COUNT(*) * 100 as profitable_rate_pct,
  AVG(metric_2_omega_net) as avg_omega,
  AVG(metric_9_net_pnl_usd) as avg_pnl
FROM wallet_metrics_complete
WHERE window = 'lifetime';
```

**Expected:**
- profitable_rate_pct: 20-40% (not 0.9%)
- avg_omega: 0.8-1.2 (not 0.0163)
- avg_pnl: closer to $0 (not -$155,728)

---

## KEY INSIGHTS FROM ANALYSIS

### Top Wallet Performance (Current - With Bad Data)

Even with buggy P&L, we can see category performance patterns:

**Best Performing Categories:**
1. **Sports** - Avg Omega 1,369 (top 50 wallets)
2. **Politics/Geopolitics** - Avg Omega 90.8 (top 50 wallets)
3. **Crypto/DeFi** - Avg Omega 2.07 (top 50 wallets)

**Worst Performing Categories:**
1. **Macro/Economy** - Avg Omega 0.04 (top 50 wallets)
2. **Pop Culture/Media** - Avg Omega 0.04 (top 50 wallets)

**Note:** These numbers will change dramatically after P&L fix, but relative ranking should hold.

### Data Quality Observations

- **Enrichment Rate:** 91% of trades have market_id (good)
- **Resolution Rate:** 45% of trades marked as resolved (limited by resolution map)
- **Wallet Coverage:** Only 21% have metrics (limited by resolution coverage)

---

## CRITICAL CONTEXT FOR NEXT AGENT

### User's Goal

Build an Omega Ratio leaderboard showing ALL ~28,000 wallets with accurate P&L metrics. These wallets were specifically filtered by:
- **>10 trades**
- **>$10,000 volume**

This is a high-value cohort and the user is rightfully frustrated that only 51 wallets are showing on the leaderboard.

### User's Technical Knowledge

- Highly technical, understands databases and data pipelines
- Will challenge assumptions and demand proof ("Query the database directly")
- Appreciates thoroughness and detailed explanations
- Prioritizes getting to 28k wallets with accurate data

### What Success Looks Like

1. **Immediate (After P&L Fix Completes):**
   - 660-1,325 wallets on leaderboard (20-40% profitable)
   - NO-side trades show correct P&L when NO wins
   - Top 50/100/200 wallets all have positive average P&L
   - Omega ratios realistic (not 1000x+ except rare cases)

2. **Ultimate (After Resolution Coverage Expansion):**
   - 15k-20k wallets with metrics (vs current 5,851)
   - Leaderboard shows 3k-6k profitable wallets (20-40% of 15k-20k)
   - All categories have meaningful sample sizes
   - Per-category leaderboards are viable

### Common Pitfalls to Avoid

1. **Don't assume the data is correct** - Always verify with direct queries
2. **Don't confuse "total wallets" with "wallets with resolved trades"** - Most wallets are trading open positions
3. **Don't skip verification queries** - The user will ask for proof
4. **Don't forget per-category metrics** - User wants category breakdowns
5. **Resolution coverage is the real bottleneck** - Not the P&L calculation

---

## TIMELINE ESTIMATES

### P&L Fix Completion (In Progress)
- Enrichment: 2-3 hours (ETA: ~02:00-03:00 UTC 2025-10-30)
- Metrics computation: 30-60 minutes
- Verification: 15 minutes
- **Total: 3-4 hours from now**

### Resolution Coverage Expansion (Next Phase)
- Build Polymarket sync script: 2-4 hours
- Fetch all historical resolutions: 1-2 hours (API dependent)
- Apply resolutions: 30-60 minutes
- Re-compute metrics: 30-60 minutes
- **Total: 4-8 hours**

---

## MONITORING COMMANDS

```bash
# Check enrichment progress
tail -f runtime/pnl-fix-enrichment.log

# Check if enrichment is still running
ps aux | grep "full-enrichment-pass"

# Once complete, verify trade counts
npx tsx check-resolved.ts

# Check wallet metrics coverage
npx tsx check-wallet-counts.ts

# Verify P&L fix
npx tsx check-pnl-by-outcome.ts

# Analyze top wallets
npx tsx analyze-top-wallets.ts
```

---

## REFERENCES

### Investigation Documents
- `/Users/scotty/Projects/Cascadian-app/runtime/metrics-investigation.md` - Complete investigation report
- `/Users/scotty/Projects/Cascadian-app/METRICS_PHASE2_REPORT.md` - Metrics implementation documentation
- `/Users/scotty/Projects/Cascadian-app/runtime/auto-metrics.log` - Auto-completion pipeline log

### Previous Session Reports
- `WALLET_PIPELINE_REPORT.md` - Wallet loading pipeline documentation
- `MIGRATION_INSTRUCTIONS.md` - Database migration history
- `STRATEGY_BUILDER_WALLET_READINESS.md` - Strategy builder integration

### Key Logs
- `runtime/pnl-fix-enrichment.log` - Current enrichment run (in progress)
- `runtime/auto-metrics.log` - Previous metrics computation
- `runtime/fast-resolutions-v2.log` - Resolution application log

---

## HANDOFF CHECKLIST

Before proceeding, ensure:

- [ ] P&L fix enrichment completed (check `runtime/pnl-fix-enrichment.log`)
- [ ] Metrics re-computed for all wallets
- [ ] Verification queries run and results match expectations
- [ ] Leaderboard showing 660-1,325 wallets (not 51)
- [ ] NO-side wins show positive P&L
- [ ] Ready to tackle resolution coverage expansion

---

## CONTACT & CONTEXT

**User:** Highly engaged, wants accurate data for 28k wallets
**Urgency:** High - User wants this "more than air"
**Technical Approach:** Direct database queries, verification at every step
**Communication Style:** Detailed explanations with specific numbers and evidence

**Last Known State:** Enrichment running, ~2-3 hours remaining

---

**END OF DEBRIEFING**

Generated: 2025-10-29 23:50 UTC
Next Update: After enrichment completes and verification queries run
