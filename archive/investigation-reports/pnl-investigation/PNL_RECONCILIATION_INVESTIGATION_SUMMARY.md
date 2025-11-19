# P&L Reconciliation Investigation Summary
**Wallet:** `0x7f3c8979d0afa00007bae4747d5347122af05613`
**Date:** 2025-01-17
**Terminal:** Claude 1

---

## Executive Summary

We investigated why our P&L calculation ($2.19M) is **11.8x higher** than both Polymarket UI and Dome API ($185k). Despite testing multiple hypotheses, we have **not yet reconciled** the difference.

### Key Finding
**Our losses consistently match** Polymarket's ($205k vs $191k ✅), but **our gains are 2-6x too high** depending on calculation method.

---

## Data Comparison

| Source | Gains | Losses | Net P&L | Volume |
|--------|-------|--------|---------|--------|
| **Polymarket UI** | +$376,597 | -$190,735 | +$184,863 | $5.08M |
| **Dome API** | — | — | +$184,863 | — |
| **Our Calc (All)** | +$2.39M | -$205k | +$2.19M | $6.04M |

### Trade Coverage
- **Our trades:** 2,795 CLOB fills
- **Polymarket activities:** 2,724 activities
- **Match rate:** 97.5% ✅

---

## Hypotheses Tested

### ✅ 1. Fees Explain the Difference (Scripts 88-89)
**Result:** NO - All fees are $0
**Conclusion:** Fee column exists but contains no data for this wallet

### ✅ 2. Double-Counting Settlement + Trading P&L (Script 86)
**Result:** NO
**Analysis:**
- Trade P&L alone: $2.14M (without settlement)
- Settlement adds only: $42k
- Still 11.6x too high

### ✅ 3. Settlement-Only P&L (Script 92)
**Result:** NO
**Analysis:**
- Settlement gains: Only $1,766
- Settlement losses: $230k
- Doesn't match Polymarket's $377k gains

### ✅ 4. Winning Outcome Filter (Scripts 94-96)
**Result:** PARTIAL - Type mismatch discovered
**Findings:**
- `outcome_idx` = numeric (0, 1)
- `winning_outcome` = string ("NO", "YES", "")
- After mapping: 64 winners, 7 losers (out of 71 resolved)
- Still 2.27x too high: $856k vs $377k

### ✅ 5. Held Shares Only (Script 97)
**Result:** NO
**Analysis:**
- Only 4 of 71 positions held shares until settlement
- Held-shares P&L: -$28k
- Polymarket clearly includes trading profits, not just settlement

---

## Critical Discoveries

### Data Quality Issues

1. **Missing Resolution Data**
   - Total positions: 175
   - With resolution data: 71 (40.6%)
   - Missing data: 104 markets (59.4%)

2. **Outcome Mapping**
   - Found type mismatch between `outcome_idx` (Int8) and `winning_outcome` (String)
   - Mapped: 0→"NO", 1→"YES"
   - Empty strings in `winning_outcome` indicate unresolved/missing data

3. **Position Distribution**
   - Positions with shares held: 4 (5.6%)
   - Positions fully exited: 67 (94.4%)
   - This wallet primarily trades (buy/sell) rather than holds

### Consistent Patterns

1. **Losses Always Match** ✅
   - Every calculation method yields $191k-$230k losses
   - Matches Polymarket's $191k within ±20%
   - Suggests our loss calculation is correct

2. **Gains Always Too High** ❌
   - Ranges from 2.27x to 6.35x depending on method
   - Most consistent at ~6x multiplier
   - Suggests systematic overcounting of wins

---

## Possible Remaining Explanations

### 1. Time Period Differences
Polymarket may be:
- Filtering by date range (e.g., "All-Time" vs calendar year)
- Excluding trades before account creation date
- Using different timezone/cutoff logic

### 2. Market Filtering
Polymarket may exclude:
- Certain market types (AMM vs CLOB)
- Markets below volume threshold
- Invalid/test markets
- Markets without proper resolution

### 3. Proxy Wallet Issues
Despite checking:
- All 14 system wallets showed UI = on-chain (no proxies)
- But Polymarket may have internal wallet grouping logic
- Could be aggregating across multiple addresses

### 4. Unknown P&L Methodology
Polymarket might calculate P&L as:
- Per-trade basis (not per-position)
- Using FIFO/LIFO cost basis
- With proprietary adjustments
- Different aggregation logic

### 5. Data Source Mismatch
Our data source (CLOB fills) might differ from Polymarket's:
- We're missing some data source they have
- We're including data they exclude
- Different ingestion timestamps
- Different trade matching logic

---

## Scripts Created (86-97)

| Script | Purpose | Key Finding |
|--------|---------|-------------|
| 86 | Diagnose double-counting | Trade P&L alone is $2.14M |
| 87 | Check USD value scale | Values are correct, no scale issues |
| 88 | Check fee schema | Fee column exists but all $0 |
| 89 | Calculate with fees | Confirmed fees don't explain gap |
| 90 | Position-based P&L | Wins 6.35x too high, losses match |
| 91 | Sample winning positions | All top positions fully exited |
| 92 | Trading vs settlement | Settlement only $1.8k gains |
| 93 | Per-position wins/losses | Same as 90, confirms 6.35x |
| 94 | Filter by winning outcome | 0 matches due to type mismatch |
| 95 | Debug outcome mismatch | Found Int8 vs String issue |
| 96 | Outcome mapping | 64 winners, still 2.27x too high |
| 97 | Held shares only | Only 4 positions, -$28k P&L |

---

## Recommendations

### Immediate Next Steps

1. **Verify Wallet Address**
   - Double-check we're querying the correct wallet
   - Check for case-sensitivity issues
   - Verify no address normalization bugs

2. **Time Period Analysis**
   - Query Polymarket API for date ranges
   - Check if "All-Time" has filters
   - Compare earliest/latest trade timestamps

3. **Market-by-Market Comparison**
   - Pick 5-10 specific markets
   - Calculate P&L per market
   - Compare with Polymarket's per-market data
   - Identify which markets contribute to gap

4. **Contact Polymarket**
   - Ask for P&L calculation methodology
   - Request sample calculation for one market
   - Clarify what "Gain" and "Loss" mean in their UI

### Data Quality Fixes

1. **Resolution Coverage**
   - Investigate why 104 markets missing resolution data
   - Backfill missing resolutions
   - Verify join keys are correct

2. **Outcome Mapping**
   - Standardize outcome representation
   - Add validation for edge cases
   - Handle multi-outcome markets

### Investigation Tools Needed

1. **Per-Market P&L Script**
   - Break down by individual market
   - Show full calculation steps
   - Export to CSV for Excel comparison

2. **Polymarket API Comparison**
   - Fetch their per-market P&L
   - Compare trade-by-trade
   - Identify first divergence point

---

## Conclusion

We have **not resolved** the 11.8x P&L discrepancy. Our most reliable finding is that **losses match but gains are overcounted by ~6x**.

The next logical step is **per-market comparison** to identify which specific markets contribute to the gap. This will either reveal:
1. A systematic calculation error in our formula
2. A data filtering difference
3. A fundamental methodology difference

Until we can match at least ONE market's P&L with Polymarket, we cannot confidently deploy our P&L calculation.

---

**Claude 1**
*Session: P&L Reconciliation Investigation*
*2025-01-17*
