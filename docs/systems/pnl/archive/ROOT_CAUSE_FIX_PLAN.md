# Root Cause Fix Plan: Operator PnL Divergence

**Date:** 2025-11-29
**Status:** Research Complete, Implementation Pending

---

## Executive Summary

We have identified the ROOT CAUSE of operator PnL divergence. It is NOT a calculation bug - it is a **data completeness gap** that Polymarket intentionally accepts.

---

## Root Cause Analysis

### The Problem
The official Polymarket pnl-subgraph tracks these events:
- ✅ ORDER_MATCHED (CLOB trades)
- ✅ POSITION_SPLIT (minting)
- ✅ POSITIONS_MERGE (burning)
- ✅ PAYOUT_REDEMPTION (settlement)

It intentionally does NOT track:
- ❌ TransferSingle (ERC1155 wallet-to-wallet transfers)
- ❌ TransferBatch (ERC1155 batch transfers)

### Why This Causes Divergence
1. Operator A buys 1000 tokens at $0.60 (avgPrice = $0.60)
2. Operator A transfers 500 tokens to Operator B
3. Operator B's subgraph position = 0 (transfer not tracked)
4. Operator B sells 500 tokens at $0.70
5. **Expected PnL:** (0.70 - 0.60) × 500 = +$50
6. **Actual Subgraph:** Capped to 0 because trackedAmount = 0

### Quantifying the Gap
From our `pm_erc1155_transfers` table:

| Transfer Type | Count | % of Total |
|--------------|-------|------------|
| FROM_EXCHANGE | 17.6M | 41.22% |
| TO_EXCHANGE | 11.3M | 26.45% |
| MINT (from 0x0) | 8.1M | 18.94% |
| BURN (to 0x0) | 4.3M | 10.17% |
| NEGRISK_ADAPTER | 1.2M | 2.80% |
| **WALLET_TO_WALLET** | **180K** | **0.42%** |

The gap is only 0.42% of transfers, but affects ~2,660 unique wallets.

---

## Fix Options

### Option A: Match Polymarket Exactly (Current)
**Implementation:** None needed - already implemented
**Pros:**
- Matches official UI for validation
- No risk of diverging from "source of truth"
**Cons:**
- Operators see "low confidence" warnings
- PnL understated for wallets receiving transfers

**Recommendation:** Keep for now - it's what we have.

---

### Option B: Track Transfers with Zero Cost Basis
**Implementation:**
1. Add wallet-to-wallet transfers to unified ledger
2. Treat received transfers as "BUY at $0.00"
3. Remove sell capping

**Pros:**
- Complete position tracking
- No capping issues
**Cons:**
- Overstates gains (assumes tokens were gifted)
- May not match UI

**Recommendation:** Don't implement - incorrect cost basis.

---

### Option C: Track Transfers with Sender's avgPrice
**Implementation:**
1. When A transfers to B, look up A's avgPrice for that token
2. Assign that avgPrice to B as their cost basis
3. Decrease A's position, increase B's position

**Pros:**
- Accurate cost basis inheritance
- Complete audit trail
**Cons:**
- Requires cross-wallet lookup (expensive)
- Sender may have multiple lots at different prices
- Still won't match Polymarket UI

**Recommendation:** Too complex for marginal benefit.

---

### Option D: Total In vs Total Out (from Research Report)
**Implementation:**
```
Total_Invested = sum(USDC spent on buys) + sum(USDC locked in splits)
Total_Returned = sum(USDC from sells) + sum(USDC from merges) + sum(USDC from redemptions)
Current_Value = sum(holdings × current_market_price)

PnL = (Total_Returned + Current_Value) - Total_Invested
```

**Pros:**
- Simple, robust formula
- Handles all edge cases (splits, merges, transfers)
- No capping needed
- Matches the "economic reality" of cashflow
**Cons:**
- Different methodology than Polymarket's avgPrice/FIFO
- Harder to explain individual trade PnL
- Requires market prices for unrealized

**Recommendation:** Best for "Cascadian Standard" PnL metric.

---

## Recommended Approach: Dual-Engine

For Cascadian v2, implement BOTH methods:

### Engine 1: Polymarket-Compatible (V11_POLY)
- Keep current implementation
- Use for UI parity validation
- Show "confidence" badges

### Engine 2: Cascadian Economic (NEW)
- Total In vs Total Out formula
- Include wallet-to-wallet transfers
- Use for analytics and reporting

### Display Logic
```typescript
interface WalletPnlV2 {
  // V11_POLY result
  polymarket: {
    pnl: number;
    matchesUI: boolean;
    confidence: 'high' | 'medium' | 'low';
  };

  // Economic cashflow result
  cascadian: {
    totalInvested: number;
    totalReturned: number;
    currentValue: number;
    pnl: number;  // (returned + value) - invested
  };

  // Recommended display value
  displayPnl: number;  // Use cascadian for operators, polymarket for retail
}
```

---

## Implementation Plan

### Phase 1: Economic Engine (1-2 days)
1. Create `computeEconomicPnl.ts`
2. Query: sum(usdc_delta) from unified ledger
3. Add unrealized component from open positions
4. Test against benchmark wallets

### Phase 2: Transfer Integration (2-3 days)
1. Create `pm_unified_ledger_v6` that includes wallet-to-wallet transfers
2. Treat transfers as position changes (no USDC delta)
3. Update position tracking

### Phase 3: Dual-Engine API (1 day)
1. Update `getWalletPnl` to return both engines
2. Add display logic for retail vs operator
3. Update API responses

### Phase 4: Validation (1 day)
1. Compare both engines on benchmark wallets
2. Verify economic invariant: `cashflow + costBasis - realizedPnl = cappedValue`
3. Document discrepancy explanations

---

## Why This Fixes the Root Cause

The root cause is: **tokens arrive via transfer without cost basis tracking**.

The fix is: **use economic cashflow (Total In vs Total Out) instead of per-trade PnL**.

Economic cashflow:
- Doesn't need cost basis for individual tokens
- Only cares about: How much USDC went in? How much came out?
- Naturally handles transfers (they don't change USDC)
- Is the "true" measure of profitability

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `lib/pnl/computeEconomicPnl.ts` | CREATE - Economic engine |
| `lib/pnl/getWalletPnl.ts` | MODIFY - Return both engines |
| `scripts/pnl/create-unified-ledger-v6.ts` | CREATE - Include transfers |
| `scripts/pnl/validate-dual-engine.ts` | CREATE - Validation script |
| `docs/systems/pnl/POLYMARKET_PNL_SPEC.md` | KEEP - Official algorithm |
| `docs/systems/pnl/CASCADIAN_ECONOMIC_SPEC.md` | CREATE - Our methodology |

---

## References

1. **Official Polymarket PnL Subgraph:** github.com/Polymarket/polymarket-subgraph/pnl-subgraph
2. **Paulie's Substreams Package:** substreams.dev/packages/polymarket-pnl/v0.3.1
3. **Research Report:** User-provided comprehensive playbook
4. **GPT Analysis:** Confirms Total In vs Total Out is standard approach

---

*This plan addresses the ROOT CAUSE (missing transfer data) with a practical solution (economic cashflow) that provides MORE useful data than Polymarket's native approach.*
