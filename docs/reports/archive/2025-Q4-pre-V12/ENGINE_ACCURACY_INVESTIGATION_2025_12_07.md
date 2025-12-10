# PnL Engine Accuracy Investigation Report

**Date:** 2025-12-07
**Goal:** Improve V11, V29, V23C engine accuracy against Dome (realized PnL) benchmark

## Executive Summary

Investigated PnL engine accuracy issues and discovered two critical bugs:
1. **Outdated data sources**: V11 was using V3 token map (358K tokens) instead of V5 (400K+ tokens)
2. **Synthetic pair trading pattern**: V11 doesn't account for "BUY YES + SELL NO" atomic trades, understating profits

Fixes improved some wallets dramatically but the problem is more complex than a simple formula fix.

## Initial State

| Engine | Pass Rate | Avg Time |
|--------|-----------|----------|
| V11    | 10%       | 2.6s     |
| V29    | 10%       | 0.4s     |
| V23C   | 10%       | 35.5s    |

## Issues Discovered

### 1. Outdated Token Mapping (Fixed)

**File:** `lib/pnl/uiActivityEngineV11.ts:130`

**Problem:** V11 was using `pm_token_to_condition_map_v3` (358K tokens) instead of V5 (400K tokens), causing 40K+ tokens to be unmapped → $0 PnL for those trades.

**Fix:**
```typescript
// Before
INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec

// After
INNER JOIN pm_token_to_condition_map_v5 m ON fills.token_id = m.token_id_dec
```

**Impact:** V11 pass rate improved from 10% to 20%

### 2. Outdated Unified Ledger (Fixed)

**Files:** `lib/pnl/shadowLedgerV23.ts`, `lib/pnl/shadowLedgerV23c.ts`

**Problem:** V23C was using `pm_unified_ledger_v7` instead of V8 (347M rows).

**Fix:** Updated all references to `pm_unified_ledger_v8_tbl`

### 3. Synthetic Pair Trading Pattern (Partially Fixed)

**New File:** `lib/pnl/uiActivityEngineV11b.ts`

**Problem:** Polymarket allows atomic "BUY YES + SELL NO" trades in the same transaction. This is economically equivalent to minting a YES/NO pair for $1 and selling the NO.

Example:
- BUY 17,857 YES @ $0.56 (pays $10,000)
- SELL 17,857 NO @ $0.44 (receives $7,857)
- Net cost: $2,143 for 17,857 YES tokens = **$0.12 per token**

V11 records cost basis as $0.56 (BUY price only), missing the $7,857 credit.

**Impact on Resolution PnL:**
- V11 thinks: Profit = (1 - 0.56) × 17,857 = $7,857
- Reality: Profit = (1 - 0.12) × 17,857 = **$15,714** (2x difference!)

**V11b Fix:** Detects same-tx BUY/SELL pairs on opposite outcomes and credits the SELL proceeds to reduce the BUY's cost basis.

### V11b Results (Mixed)

| Wallet | Dome | V11 | V11b | Pairs Detected |
|--------|------|-----|------|----------------|
| 0x199aefef | $19,222 | $1,718 | **$19,219** ✓ | 28 |
| 0x258a6d3f | $102,200 | $102,200 ✓ | $102,200 ✓ | 0 |
| 0x569e2cb3 | $50,558 | -$89,427 | $27,474 | 205 |
| 0xe62d0223 | $71,046 | $74,704 ✓ | $275,796 ✗ | 7,242 |

**Problem:** V11b over-adjusts when there are many synthetic pairs. The 7,242 pairs for wallet 0xe62d0223 caused massive over-correction.

## Root Cause Analysis

The fundamental issue is that **our CLOB data doesn't distinguish between**:
1. A genuine short sell (closing a position you hold)
2. A "phantom sell" (selling newly minted tokens you never held)

Dome (Polymarket's official PnL) has access to the full trade graph and can correctly attribute these patterns. Our engines see each trade independently and must infer the pattern.

## Recommendations

### Short-term (Quick Wins)

1. **Keep V5 token map fix** - Already done, improves coverage
2. **Keep V8 unified ledger fix** - Already done
3. **Don't deploy V11b yet** - Over-corrects for some wallets

### Medium-term (Accuracy Improvements)

1. **Improve synthetic pair detection**:
   - Only apply adjustment when BUY and SELL amounts are proportional
   - Track which sells are matched to which buys
   - Don't apply adjustment after partial sells

2. **Consider cash-flow-only approach**:
   - Simple formula: `sum(cash_flow) + sum(tokens * payout)` for resolved positions
   - This sidesteps the cost basis tracking entirely
   - But requires accurate token tracking

3. **Investigate Dome's methodology**:
   - What exactly does Dome compute?
   - Do they use scaledCostBasis, scaledAmountInvested, etc.?

### Long-term (Ideal Solution)

1. **Build synthetic pair detection at ingestion time**:
   - When loading trades, identify tx-level pairs
   - Tag events as "synthetic_split" vs "genuine_trade"
   - Store the pairing relationship in the unified ledger

2. **Implement Polymarket subgraph formula exactly**:
   - The subgraph has very specific handling for these patterns
   - See `normalizeSyntheticClobPairs.ts` for existing implementation
   - Integrate this into V11 properly

## Files Modified

1. `lib/pnl/uiActivityEngineV11.ts` - Fixed V3 → V5 token map
2. `lib/pnl/shadowLedgerV23.ts` - Fixed V7 → V8 ledger
3. `lib/pnl/shadowLedgerV23c.ts` - Fixed V7 → V8 ledger

## New Files Created

1. `lib/pnl/uiActivityEngineV11b.ts` - V11 with synthetic pair handling (experimental)
2. `scripts/pnl/validate-fast-concurrent.ts` - Fast concurrent validation
3. `scripts/pnl/debug-resolution-loading.ts` - Resolution debugging
4. `scripts/pnl/detailed-v11-trace.ts` - Detailed V11 trace
5. `scripts/pnl/test-v11b-single.ts` - V11b single wallet test
6. `scripts/pnl/compare-v11-v11b.ts` - V11 vs V11b comparison

## Conclusion

The 10-20% pass rate is not just a bug fix away. The core challenge is that our data model doesn't capture the full semantics of Polymarket trades. Improving accuracy will require either:
- More sophisticated pattern detection (hard to get right)
- Better data from Polymarket (API that exposes scaledCostBasis)
- Accepting some level of inaccuracy for copy-trade leaderboards

For copy-trade leaderboards, a 6% error threshold may be too strict. Consider:
- Using relative ranking instead of absolute PnL
- Using win rate / trade count as primary metrics
- Using PnL as secondary/tie-breaker
