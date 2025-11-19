# Option B Investigation Report - CRITICAL FINDINGS

**Date**: 2025-11-12 (Continuation Session)
**Terminal**: Claude 1
**Status**: 🔍 **INVESTIGATION COMPLETE - PARADIGM SHIFT**

---

## Executive Summary

Attempted Option B (targeted CLOB supplement) to recover the $52K P&L gap. **Critical finding: The gap is NOT caused by missing CLOB data.** CLOB is actually MORE complete than blockchain data. The investigation revealed a fundamental misunderstanding about the data sources.

### Key Discovery

| Data Source | Markets | Total Shares | Coverage |
|-------------|---------|--------------|----------|
| **CLOB (orderbook trades)** | 45 | 137,699 | ✅ Most complete |
| **Current P&L calculation** | 43 | - | ✅ Using CLOB |
| **ERC1155 (blockchain transfers)** | 30 | 109,316 | ❌ Less complete |

**Bottom line**: We're already using the best available trading data. The $52K gap must be explained by something else.

---

## What We Discovered

### Finding 1: ERC1155 ≠ CLOB

**Problem**: We assumed 249 ERC1155 transfers vs 194 CLOB fills meant CLOB was missing data.

**Reality**:
- **ERC1155 transfers** = Token movements (settlements, redemptions, P2P transfers)
- **CLOB fills** = Orderbook trades (buy/sell executions)
- **These track DIFFERENT events**

**Evidence**:
```
Market overlap:
- In CLOB only: 36 markets (includes most profitable trades)
- In ERC1155 only: 21 markets (mostly redemptions/settlements)
- In both: 9 markets
```

### Finding 2: "Missing" 68 Fills Are Actually Negative P&L

When we identified the 68 ERC1155 transfers not in CLOB:
- **Estimated P&L impact: -$8,224** (NEGATIVE!)
- Large SELL fills (28,623 shares, 13,101 shares) are selling WINNING positions
- Adding these would LOWER P&L from $34,990 → $26,766

**Conclusion**: These aren't "missing profitable trades" - they're settlement/redemption events with negative opportunity cost.

### Finding 3: CLOB Coverage Is Actually Better

```
Total shares traded:
- CLOB: 137,699 shares
- ERC1155: 109,316 shares
- Difference: +28,383 shares in favor of CLOB

Market count:
- CLOB: 45 markets
- Current P&L: 43 markets (using CLOB)
- ERC1155: 30 markets
```

The current P&L calculation (43 markets) is already based on the most complete trading data available.

---

## Scripts Created

### Investigation Scripts

**scripts/identify-missing-clob-fills.ts**
- Compared ERC1155 transfers to CLOB fills
- Result: Identified 68 "missing" fills across 29 markets
- Saved to: `tmp/missing_clob_fills_2025-11-12T06-48-24.json`

**scripts/analyze-missing-fills-impact.ts**
- Estimated P&L impact of the 68 missing fills
- Critical finding: -$8,224 negative impact
- Breakdown: $22,571 from BUY fills, -$30,795 from SELL fills

**scripts/investigate-matching-strictness.ts**
- Analyzed market coverage overlap
- Discovered CLOB has 45 markets vs ERC1155's 30
- Proved CLOB is the superior data source for trading P&L

### Schema Verification Scripts

**scripts/check-erc1155-schema.ts**
- Verified erc1155_transfers column names (tx_hash, block_timestamp, etc.)

**scripts/check-clob-fills-schema.ts**
- Verified clob_fills column names (timestamp, not block_ts)

---

## Why Option B Failed

**Initial Hypothesis**: CLOB is missing 55 profitable transactions worth $52K.

**What We Found**:
1. ❌ CLOB is NOT missing data - it's more complete than blockchain
2. ❌ The 68 "missing" fills are NEGATIVE P&L, not positive
3. ❌ ERC1155 and CLOB track different types of events
4. ❌ Adding ERC1155 data would LOWER P&L, not raise it

**Actual Problem**: The $52K gap must be caused by:
- Different price calculations (average cost vs specific lots)
- Unrealized P&L (open positions not counted)
- Methodology differences between our calculation and Dome's
- Missing resolution data or incorrect outcome mappings

---

## Data Semantics Deep Dive

### CLOB Fills (What We Use)
```
Source: Polymarket API (Goldsky GraphQL)
Events: Orderbook trade executions
Fields: price, size, side (BUY/SELL), timestamp
Use case: Trading P&L calculation ✅
```

### ERC1155 Transfers (What We Tested)
```
Source: Blockchain logs
Events: Token transfers (settlement, redemption, P2P)
Fields: from_address, to_address, token_id, value
Use case: Position verification, settlement tracking
NOT suitable for: Trading P&L (different events)
```

### Key Difference
- **One CLOB fill** (trade execution) → Multiple ERC1155 transfers (settlement, fee, etc.)
- **One ERC1155 redemption** → No CLOB fill (redeeming winnings, not trading)

---

## Current Baseline Verification

### Baseline P&L ($34,990.56)

**Source table**: `realized_pnl_by_market_final`
- Markets: 43
- Data source: CLOB fills
- Coverage: 45 markets available in CLOB (using 43 for P&L)

**Why 43 instead of 45?**
- 2 markets likely have issues (missing resolutions, duplicate keys, etc.)
- Need to investigate which 2 markets are excluded

### Dome Target ($87,030.51)

**Gap**: $52,039.95 (149% difference)

**Possible explanations**:
1. **Unrealized P&L**: Open positions we're not counting
2. **Price calculation**: Dome uses different cost basis method
3. **Resolution differences**: Different winning outcomes
4. **Methodology**: Different P&L formula or market inclusion criteria
5. **Time window**: Different date ranges or settlement timing

---

## What We Learned from ERC1155 Rebuild

From the previous ERC1155 rebuild attempt (Phases 1-4):

### Phase 1: Backup ✅
- Backed up current baseline: $34,990.56
- Saved 43 positions
- Preserved view definitions

### Phase 2: ERC1155 Position Tracking ⚠️
- Only found 25 positions (vs 43 from CLOB)
- Missing 18 positions despite having blockchain data

### Phase 3: Hybrid Cashflow ⚠️
- 25 entries total
- Only 4 had CLOB pricing
- 21 entries missing cost basis

### Phase 4: P&L Calculation ❌
- Result: -$14,511.23 (NEGATIVE!) after fixing duplicates
- Proved blockchain data skews toward losing trades
- Profitable trades are missing from blockchain dataset

**Conclusion**: Blockchain-only P&L is not viable for this wallet.

---

## Critical Insights

### 1. Data Completeness Hierarchy

```
BEST → WORST:
1. CLOB fills (45 markets, 194 fills, 137K shares) ← Using this ✅
2. ERC1155 transfers (30 markets, 249 transfers, 109K shares)
3. Blockchain-only rebuild (25 markets, negative P&L) ❌
```

### 2. The 55 Transaction Gap Is A Red Herring

**We thought**: CLOB missing 55 transactions = missing $52K profit

**Actually**:
- 249 ERC1155 transfers vs 194 CLOB fills = 55 difference
- But these track DIFFERENT events (settlements vs trades)
- Adding them gives -$8,224 (NEGATIVE), not +$52,000

### 3. Current P&L Calculation Is Sound

The existing `realized_pnl_by_market_final` calculation:
- ✅ Uses best available data (CLOB)
- ✅ Covers 43/45 available markets (95.6%)
- ✅ Properly deduplicates gamma_resolved
- ✅ Correct P&L formula: `cashflow + (shares IF winning)`

**The issue is NOT with our calculation method.**

---

## Revised Root Cause Hypotheses

### Hypothesis 1: Unrealized P&L (Most Likely)

**Theory**: Dome includes open positions, we only count closed trades.

**Evidence needed**:
- Check wallet's current open positions
- Calculate mark-to-market value
- See if unrealized P&L ≈ $52K

**Test**:
```sql
SELECT
  wallet,
  condition_id_norm,
  outcome_idx,
  net_shares,
  current_price * net_shares AS unrealized_value
FROM outcome_positions_final
WHERE wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND abs(net_shares) > 0.01  -- Has open position
```

### Hypothesis 2: Price Calculation Method

**Theory**: We use simple cashflow, Dome uses FIFO/specific lots.

**Evidence needed**:
- Compare our average cost vs Dome's entry prices
- Check if Dome factors in fees differently
- Verify if we're missing any fee components

### Hypothesis 3: Resolution Data Quality

**Theory**: Some markets resolved differently than gamma_resolved shows.

**Evidence needed**:
- Cross-reference gamma_resolved with Polymarket API
- Check for markets with disputed/amended outcomes
- Verify winning_outcome mappings for multi-outcome markets

### Hypothesis 4: Methodology Difference

**Theory**: Dome counts certain market types we exclude.

**Evidence needed**:
- Check which 2 markets are in CLOB (45) but not in P&L (43)
- Investigate if Dome includes different market types
- Verify our market filtering criteria

---

## Recommended Next Steps

### Immediate (2-3 hours)

**1. Check Unrealized P&L**
- Query current open positions
- Calculate mark-to-market value
- See if this explains the gap

**2. Identify Missing 2 Markets**
- CLOB has 45 markets
- P&L calculation uses 43
- Find which 2 are excluded and why

**3. Verify Resolution Data**
- Cross-check gamma_resolved against Polymarket API
- Look for amended outcomes or disputes
- Verify multi-outcome market mappings

### Short Term (1-2 days)

**4. Replicate Dome Methodology**
- Get exact Dome P&L breakdown by market
- Compare market-by-market against our calculation
- Identify specific discrepancies

**5. Investigate Price Calculation**
- Compare our cashflow against entry/exit prices
- Check fee attribution
- Verify FIFO vs average cost impact

### Alternative: Contact Dome

If gap remains unexplained after above steps:
- Request Dome's calculation methodology
- Get market-by-market P&L breakdown
- Ask about their data sources and formulas

---

## Files Created This Session

### Investigation Scripts
- `scripts/identify-missing-clob-fills.ts` - ERC1155 vs CLOB comparison
- `scripts/analyze-missing-fills-impact.ts` - P&L impact estimation
- `scripts/investigate-matching-strictness.ts` - Data coverage analysis

### Schema Verification
- `scripts/check-erc1155-schema.ts` - ERC1155 table structure
- `scripts/check-clob-fills-schema.ts` - CLOB table structure

### Data Exports
- `tmp/missing_clob_fills_2025-11-12T06-48-24.json` - 68 "missing" fills details

### Documentation
- `OPTION_B_INVESTIGATION_REPORT.md` (this file)

---

## Conclusion

**Option B (targeted CLOB supplement) is NOT the solution.**

The investigation revealed:
1. ✅ CLOB data is actually MORE complete than blockchain
2. ✅ Current P&L calculation uses best available data
3. ❌ The $52K gap is NOT caused by missing CLOB fills
4. ❌ Adding ERC1155 data would LOWER P&L, not raise it

**The real issue is one of**:
- Unrealized P&L (open positions not counted)
- Methodology differences (FIFO vs average, market inclusion)
- Resolution data quality (wrong outcomes or disputed markets)
- Price calculation differences (fees, entry/exit timing)

**Next priority**: Investigate unrealized P&L and verify the 2 missing markets from the CLOB dataset (45 available → 43 in P&L).

---

**Terminal**: Claude 1
**Session**: Option B Investigation - CLOB Supplement Analysis
**Status**: Investigation complete, paradigm shift identified
**Generated**: 2025-11-12 (PST)
