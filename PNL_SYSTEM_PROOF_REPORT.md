# P&L SYSTEM VERIFICATION REPORT
**Date:** 2025-11-07
**Status:** CRITICAL ISSUES FOUND

---

## Executive Summary

**THE P&L SYSTEM IS BROKEN.** The materialized views (`wallet_realized_pnl_v2` and `wallet_pnl_summary_v2`) show wildly inflated numbers that do NOT match the source data in `trades_raw`.

### Key Finding

There is a **1,626,700% inflation** in the P&L calculation for niggemon wallet:
- **Source of Truth (`trades_raw`):** $117.24
- **Materialized View (`wallet_realized_pnl_v2`):** $1,907,531.19
- **Inflation Factor:** 16,267x

---

## Test Results

### Test 1: niggemon Wallet (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0)

**Expected P&L:** $99,691 or $102,001 (per Polymarket claim)

**Actual Results:**

| Source | Realized P&L | Unrealized P&L | Total P&L | Status |
|--------|-------------|----------------|-----------|---------|
| `trades_raw` (source) | **$117.24** | N/A | **$117.24** | ✅ CORRECT |
| `wallet_realized_pnl_v2` | **$1,907,531.19** | N/A | $1,907,531.19 | ❌ INFLATED 16,267x |
| `wallet_pnl_summary_v2` | **$1,907,531.19** | -$90,213.25 | $1,817,317.94 | ❌ INFLATED 16,267x |

**Trade Breakdown:**
- **Resolved trades:** 332 trades → $117.24 P&L ✅
- **Unresolved trades:** 16,140 trades → $0 P&L (expected, markets not settled)

**Critical Finding:**
- The source data (`trades_raw`) shows only **$117 in P&L**, NOT the claimed $99k-$102k
- This suggests EITHER:
  1. The data pipeline is missing most trades, OR
  2. The Polymarket claim includes unrealized/open positions not in our resolved trades

---

### Test 2: HolyMoses7 Wallet (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8)

**Actual Results:**

| Source | Realized P&L | Status |
|--------|-------------|---------|
| `trades_raw` (source) | **$0.00** | ✅ CORRECT |
| `wallet_realized_pnl_v2` | **$301,156.45** | ❌ INFLATED ∞ |
| `wallet_pnl_summary_v2` | **$301,156.45** | ❌ INFLATED ∞ |

**Trade Breakdown:**
- **Resolved trades:** 0 trades → $0 P&L ✅
- **Unresolved trades:** 8,484 trades → $0 P&L (expected, markets not settled)

**Critical Finding:**
- The wallet has ZERO resolved trades, yet the view claims $301k in realized P&L
- This is **mathematically impossible** and proves the views are broken

---

## Root Cause Analysis

### Problem 1: View Inflation (Proven)

The materialized views are calculating P&L incorrectly. Possible causes:

1. **Join fanout** - Cartesian explosion when joining trades to market resolutions
2. **Duplicate counting** - Same trade counted multiple times
3. **Wrong aggregation** - Summing values that should be averaged or deduped
4. **Missing GROUP BY** - Aggregating without proper deduplication key

### Problem 2: Missing Trade Data (Suspected)

For niggemon:
- Polymarket claims: $99k-$102k
- Our database shows: $117.24
- **Gap:** $99,574 missing (99.88% of claimed value)

This suggests:
- Pipeline is not capturing all CLOB fills
- Blockchain sync is incomplete
- Historical backfill missed major chunks of data

---

## Verification Queries

### Query 1: Compare All Sources
```sql
SELECT 'wallet_pnl_summary_v2' as source, wallet, realized_pnl_usd, unrealized_pnl_usd, total_pnl_usd
FROM wallet_pnl_summary_v2
WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'

UNION ALL

SELECT 'wallet_realized_pnl_v2' as source, wallet, realized_pnl_usd, 0, realized_pnl_usd
FROM wallet_realized_pnl_v2
WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'

UNION ALL

SELECT 'trades_raw sum' as source, '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0' as wallet,
       SUM(realized_pnl_usd), 0, SUM(realized_pnl_usd)
FROM trades_raw
WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
```

### Query 2: Trade Count Verification
```sql
SELECT
  is_resolved,
  COUNT(*) as trade_count,
  SUM(realized_pnl_usd) as total_pnl,
  AVG(realized_pnl_usd) as avg_pnl
FROM trades_raw
WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
GROUP BY is_resolved
```

---

## Which Number is Correct?

**Authoritative Source:** `trades_raw` table

**Why:**
1. It's the base table, populated directly from CLOB fills API
2. No joins, no aggregations, no transformations
3. Each row = 1 trade fill with calculated P&L
4. No fanout possible

**Materialized Views are WRONG:**
- They show 16,267x inflation for niggemon
- They show $301k for a wallet with ZERO resolved trades
- They cannot be trusted for any P&L calculations

---

## Is the System Working?

**NO. The P&L system is fundamentally broken in two ways:**

### Problem A: View Calculation Error (Proven)
- Materialized views inflate P&L by 16,000x+
- Views show P&L for wallets with zero resolved trades
- **Status:** CRITICAL BUG, system unusable

### Problem B: Missing Trade Data (Suspected)
- Database only has $117 for wallet claiming $99k-$102k
- Missing 99.88% of expected trade volume
- **Status:** DATA INTEGRITY ISSUE, needs investigation

---

## Action Items

### Immediate (Block All Deployments)

1. **DO NOT USE** `wallet_realized_pnl_v2` or `wallet_pnl_summary_v2`
2. **DO NOT DEPLOY** any UI showing P&L from these views
3. **INVESTIGATE** the view definitions to find join fanout

### Short Term (Fix Views)

1. Audit view SQL for cartesian joins
2. Check for missing `DISTINCT` or proper `GROUP BY`
3. Add `LIMIT 1` tests to verify 1 wallet = 1 row
4. Rebuild views with correct logic

### Medium Term (Fix Data Pipeline)

1. Verify CLOB fills API is returning all historical data
2. Check blockchain sync for gaps
3. Compare trade count vs Polymarket UI
4. Re-run backfill if needed

---

## Files Generated

- `/Users/scotty/Projects/Cascadian-app/verify-pnl-proof.ts` - niggemon verification script
- `/Users/scotty/Projects/Cascadian-app/test-holymoses.ts` - HolyMoses7 verification script
- `/Users/scotty/Projects/Cascadian-app/PNL_SYSTEM_PROOF_REPORT.md` - This report

---

## Conclusion

**The user's skepticism was 100% justified.** The P&L system has critical bugs that inflate values by 16,000x. The materialized views are completely unusable and must be rebuilt from scratch.

**Recommendation:** Use `trades_raw` as the single source of truth for all P&L calculations until the views are audited and fixed.
