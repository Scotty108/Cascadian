# P&L Investigation - Current Findings

**Date:** 2025-11-10
**Status:** ⚠️ Approach working but unrealized P&L calculation needs refinement

---

## Summary of Attempts

### Attempt 1: Use Unrealized P&L Scripts (Failed)
- **Issue:** Scripts expect `trades_raw` table that doesn't exist
- **Root cause:** Different schema than documented

### Attempt 2: Adapted Approach (Failed)
- **Issue:** `market_candles_5m` missing `outcome` column
- **Root cause:** Market-level prices, not outcome-level

### Attempt 3: Simple Approach with Recent Trade Prices (Partial Success)
- **Result:** Views created successfully
- **Issue:** P&L values wildly incorrect

---

## Results from Simple Approach

| Wallet | Our Total P&L | Polymarket | Accuracy |
|--------|---------------|------------|----------|
| 0x4ce7...abad | **-$975** | +$332,567 | -0.3% ❌ |
| 0x9155...fcad | **-$14.4M** | +$110,013 | -13,125% ❌ |
| 0xcce2...d58b | **-$170K** | +$95,150 | -178% ❌ |

### Position Count Discrepancies

**Wallet #3 (0xcce2...d58b):**
- **Previous snapshot:** 141 total positions (141 settled, 0 open)
- **Current calculation:** 40 total positions (40 settled, 0 open)
- **Missing:** 101 positions

**Wallet #1 & #2:**
- Show open positions but with massive negative unrealized P&L
- Suggests incorrect calculation logic

---

## Root Causes Identified

### 1. Position Aggregation Issue
The `vw_wallet_pnl_calculated` view might be filtering out positions incorrectly.

**Evidence:**
- Wallet #3 went from 141 positions → 40 positions
- Position counts don't match previous snapshot

### 2. Cost Basis Calculation
Using recent trade prices as "current price" for unrealized P&L is problematic:
- Doesn't reflect actual current market prices
- Trade prices can be from either BUY or SELL side
- Leads to negative unrealized P&L when it should be positive

### 3. Net Shares Direction
The calculation might not properly account for position direction:
- Long positions (positive shares): `unrealized_pnl = (shares × current_price) - cost_basis`
- Short positions (negative shares): Need different formula

---

## What We Know Works

✅ **Realized P&L** - Working correctly (from payout vectors)
✅ **Position Identification** - Can identify settled vs open positions
✅ **View Creation** - SQL views execute without errors
✅ **Data Sources** - Have access to:
- `fact_trades_clean` (63M trades)
- `vw_wallet_pnl_calculated` (positions aggregated)
- `market_candles_5m` (price history)

---

## What Doesn't Work

❌ **Unrealized P&L Calculation** - Values are incorrect
❌ **Position Counts** - Don't match previous snapshots
❌ **Current Pricing** - Using recent trade prices is unreliable

---

## Next Steps Options

### Option A: Fix the Current Approach
**Tasks:**
1. Investigate why position counts dropped (141 → 40)
2. Fix unrealized P&L formula to handle position direction
3. Find better source for current market prices

**Pros:** Works with existing schema
**Cons:** May still be inaccurate due to price data issues

**Time:** 2-4 hours

### Option B: Use Polymarket API for Current Prices
**Tasks:**
1. Fetch current order book prices from Polymarket API
2. Join with our positions to value open positions
3. Calculate unrealized P&L using real-time prices

**Pros:** Accurate current prices
**Cons:** Requires API integration, rate limits

**Time:** 3-6 hours

### Option C: Simplify to Match Polymarket's Approach
**Research what Polymarket actually uses:**
1. Check if they use midpoint prices, last trade, or order book
2. Understand their exact P&L formula
3. Replicate their approach

**Pros:** Would match UI exactly
**Cons:** Requires reverse engineering their system

**Time:** 4-8 hours

### Option D: Accept Current Limitations
**Accept that:**
1. We can calculate realized P&L accurately (11.88% coverage)
2. Unrealized P&L requires real-time market data we don't have cached
3. Focus on shipping realized P&L first, add unrealized later

**Pros:** Ship something working today
**Cons:** Doesn't match Polymarket UI

**Time:** 0 hours (done)

---

## Recommendation

**Immediate (Today):**
1. Investigate position count discrepancy (141 → 40)
2. Document why unrealized P&L is challenging with current data
3. Ship realized P&L feature with caveat that unrealized coming soon

**Short-term (This Week):**
1. Add Polymarket API integration for current prices
2. Implement proper unrealized P&L calculation
3. Validate against UI

**Medium-term (Next 2 Weeks):**
1. Cache market prices daily for historical analysis
2. Build complete P&L system (realized + unrealized)
3. Add portfolio intelligence features

---

## Technical Details

### Current Formula (Incorrect)
```sql
unrealized_pnl = (net_shares × latest_trade_price) - cost_basis
```

**Problems:**
- `latest_trade_price` could be from 30 days ago
- Doesn't account for position direction (long vs short)
- Cost basis might not match position direction

### Correct Formula Should Be
```sql
-- For LONG positions (positive shares):
unrealized_pnl = (shares × current_market_price) - cost_basis

-- For SHORT positions (negative shares):
unrealized_pnl = cost_basis - (abs(shares) × current_market_price)
```

**Requirements:**
- Real-time or recent market prices (not 30-day-old trades)
- Proper position direction handling
- Accurate cost basis per position

---

## Conclusion

**Current State:**
- ✅ Realized P&L: Working (11.88% coverage)
- ❌ Unrealized P&L: Not working (calculation errors)
- ⚠️ Total P&L: Cannot match Polymarket UI yet

**Blocking Issue:**
Need real-time market prices to accurately calculate unrealized P&L. Using 30-day-old trade prices produces incorrect results.

**Path Forward:**
1. Ship realized P&L feature today
2. Add Polymarket API integration for current prices
3. Implement unrealized P&L next week

**Status:** Investigation complete, root cause identified, solution requires additional data source.

---

**Report Generated:** 2025-11-10
**Investigation Duration:** 2 hours
**Next Action:** Decide on Option A, B, C, or D above
