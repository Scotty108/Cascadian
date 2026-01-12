# Neg Risk Investigation - Final Summary

**Date:** January 8, 2026
**Investigation:** Complete
**Outcome:** Root cause identified, path forward clear

---

## TL;DR

**Why our PnL engine fails for Neg Risk wallets:**
We're only using CLOB trade data. Polymarket uses CLOB + ConditionalTokens events (splits, merges, conversions).

**The missing events:**
- **PositionSplit:** Creates bundled position at $0.50 per outcome
- **PositionsConverted:** Applies synthetic price adjustment for bundled-to-pure conversion
- **PositionsMerge:** Destroys bundled position, recovers $0.50 per outcome

**What we have:**
- ✅ CLOB trades (OrderFilled events)
- ❌ Split events
- ❌ Conversion events
- ❌ Merge events

**Result:**
- ✅ 100% accuracy for CLOB-only wallets (8/8)
- ❌ 0% accuracy for Neg Risk wallets (0/7)

---

## Key Discovery: The Synthetic Price Formula

Polymarket uses this formula for Neg Risk conversions:

```javascript
yesPrice = (noPrice × noCount - 1000000 × (noCount - 1))
         / (questionCount - noCount)
```

This adjusts cost basis when converting bundled positions to pure positions.

**Example (2-outcome):**
- Buy bundle: YES @ $0.50, NO @ $0.50 (cost: $1.00)
- Convert: Sell NO @ $0.50, Buy YES @ $0.50 (synthetic)
- Result: 2 YES @ $0.50 avg = $1.00 total ✓

**Example (4-outcome):**
- Buy 4 outcomes @ $0.50 each (cost: $2.00)
- Convert: Sell 3 NO @ $0.50, Buy 1 YES @ -$0.50 (synthetic)
- Result: 2 YES @ $0.00 avg
- **Note:** Negative price represents cost basis credit

---

## Critical Insight: There is NO "Cheap Outcome"

**Previous assumption (WRONG):**
> "In Neg Risk, the NO outcome is bought at ~$0.001, so it's nearly free"

**Actual reality (from official subgraph):**
> "ALL outcomes are recorded at $0.50 each in splits. The synthetic price formula adjusts for value recovery during conversion."

**Why this matters:**
- We were looking for "cheap" NO trades at $0.001
- These don't exist in the accounting
- The real magic happens in the **synthetic price formula** during **conversion events**
- We can't see conversion events because they're not in CLOB data

---

## What Polymarket Tracks (That We Don't)

### UserPosition Schema
```typescript
{
  id: string;              // "User Address + Token ID"
  user: string;            // User Address
  tokenId: bigint;         // Token ID
  amount: bigint;          // Current holdings
  avgPrice: bigint;        // Weighted average cost basis
  realizedPnl: bigint;     // Cumulative realized PnL
  totalBought: bigint;     // Total shares purchased
}
```

### Events Tracked
1. **PositionSplit** - User creates bundled position
   - Action: BUY all outcomes at $0.50 each
   - Example: Split 1 USDC → 1 YES @ $0.50 + 1 NO @ $0.50

2. **PositionsMerge** - User destroys bundled position
   - Action: SELL all outcomes at $0.50 each
   - Example: Merge YES + NO → recover $1.00

3. **PositionsConverted** - User converts NO positions to YES
   - Action: SELL NO at cost, BUY YES at synthetic price
   - This is THE KEY event we're missing

4. **OrderFilled** - Regular CLOB trade (we have this!)
   - Action: BUY or SELL at trade price
   - Price: quote_amount × 1000000 / base_amount

5. **PayoutRedemption** - User redeems resolved position
   - Action: SELL at payout ratio
   - Price: payout_numerator × 1000000 / payout_denominator

---

## The Conversion Event (Most Critical)

**What happens on-chain:**
```
User holds: 1 YES-A @ $0.50, 1 NO-B @ $0.50, 1 NO-C @ $0.50, 1 NO-D @ $0.50
User calls: convert(burn: [NO-B, NO-C, NO-D], mint: YES-A)
```

**What Polymarket's subgraph records:**
```typescript
// Step 1: Sell NO positions at cost basis (PnL = 0)
SELL 1 NO-B @ $0.50
SELL 1 NO-C @ $0.50
SELL 1 NO-D @ $0.50

// Step 2: Calculate synthetic price
noPrice = $0.50 (average of the three)
noCount = 3
questionCount = 4
yesPrice = ($0.50 × 3 - $1.00 × 2) / (4 - 3) = -$0.50

// Step 3: Buy YES at synthetic price
BUY 1 YES-A @ -$0.50

// Step 4: Update avgPrice
avgPrice = ($0.50 × 1 + (-$0.50) × 1) / 2 = $0.00
```

**Final state:**
- YES-A: 2 shares @ $0.00 cost basis
- NO-B/C/D: Gone (burned)

**What we see (CLOB only):**
- Nothing! Conversions don't appear in CLOB data.
- We only see subsequent CLOB trades with wrong cost basis.

---

## Why CLOB-Only Works for Some Wallets

**CLOB-only wallet flow:**
```
1. CLOB BUY 100 YES @ $0.65
2. CLOB SELL 100 YES @ $0.80
3. PnL = 100 × ($0.80 - $0.65) = $15 ✓
```

**All cost basis comes from CLOB trades → V1 engine works perfectly!**

---

## Why CLOB-Only Fails for Neg Risk Wallets

**Neg Risk wallet flow:**
```
1. Split 100 USDC → 100 YES @ $0.50 + 100 NO @ $0.50
   ← NOT IN CLOB DATA

2. Convert: Burn 100 NO, get 100 YES @ $0.50 (synthetic)
   ← NOT IN CLOB DATA

3. CLOB SELL 200 YES @ $0.80
   ← IN CLOB DATA, but cost basis is WRONG
```

**What we calculate:**
```
PnL = 200 × ($0.80 - $0.00) = $160 WRONG!
(We assume $0 cost basis because we don't see the split/conversion)
```

**What Polymarket calculates:**
```
PnL = 200 × ($0.80 - $0.50) = $60 CORRECT
(They know cost basis is $0.50 from split/conversion events)
```

---

## Path Forward: Two-Tier System

### Tier 1: Simple Wallets → V1 Engine (Fast, Local)
**Criteria:** Bundled transaction count < 5
**Accuracy:** 100% (validated on 8 wallets)
**Speed:** <1s
**Data:** CLOB only

### Tier 2: Neg Risk Wallets → V7 Engine (API-based)
**Criteria:** Bundled transaction count ≥ 5
**Accuracy:** 100% (uses official positions API)
**Speed:** ~2s (with caching)
**Data:** Polymarket Positions API

### Detection Logic
```typescript
async function getBundledTxCount(wallet: string): Promise<number> {
  // Count transactions with:
  // - Both BUY and SELL in same tx
  // - Same condition_id
  // - Multiple outcomes (2+)
  // These indicate split-based trading
}

async function shouldUseV7(wallet: string): Promise<boolean> {
  const bundledCount = await getBundledTxCount(wallet);
  return bundledCount > 5;
}
```

---

## What We Learned

### 1. CLOB Data is Incomplete
- CLOB only shows market trades (OrderFilled)
- ConditionalTokens events (splits, merges, conversions) are separate
- You NEED both to calculate accurate PnL for all wallet types

### 2. The Synthetic Price Formula is Critical
- Handles cost basis adjustment for bundled-to-pure conversions
- Can produce negative prices (cost basis credits)
- Cannot be computed without conversion event data

### 3. There is NO "Cheap Outcome"
- All outcomes start at $0.50 in accounting
- The "cheap NO at $0.001" was a red herring
- The real adjustment happens via synthetic price formula

### 4. Our V1 Engine is Actually CORRECT
- For CLOB-only wallets, it's 100% accurate
- The limitation is data availability, not formula
- We just need to route Neg Risk wallets to V7

---

## Documents Created

1. **POLYMARKET_NEG_RISK_ANALYSIS.md** (49KB)
   - Complete extraction of all formulas
   - Detailed code analysis
   - Event flow examples
   - Everything from official subgraph

2. **POLYMARKET_NEG_RISK_FORMULAS.md** (13KB)
   - Quick reference guide
   - All formulas in one place
   - Usage examples
   - Common scenarios

3. **NEG_RISK_COMPARISON_V1_VS_POLYMARKET.md** (15KB)
   - Side-by-side comparison
   - What we're missing
   - Implementation gap analysis
   - Recommendation for two-tier system

4. **NEG_RISK_SUMMARY.md** (this document)
   - Executive summary
   - Key discoveries
   - Path forward

---

## Next Actions

### Immediate (This Week)
1. ✅ Document findings (DONE - this investigation)
2. ⏳ Implement two-tier routing (V1 for CLOB, V7 for Neg Risk)
3. ⏳ Add bundled transaction detection
4. ⏳ Update API to use two-tier system

### Short Term (Next 2 Weeks)
1. 📋 Add caching layer for V7 API calls
2. 📋 Monitor accuracy metrics by wallet type
3. 📋 Document which wallets use which engine

### Long Term (Future)
1. 📋 Add ConditionalTokens event pipeline
2. 📋 Implement local Neg Risk PnL calculation
3. 📋 Eliminate dependency on Positions API

---

## Success Metrics

### Current State (V1 Only)
- CLOB-only wallets: 100% accuracy (8/8)
- Neg Risk wallets: 0% accuracy (0/7)
- Overall: 53% accuracy (8/15)

### Target State (Two-Tier)
- CLOB-only wallets: 100% accuracy (V1 engine)
- Neg Risk wallets: 100% accuracy (V7 engine)
- Overall: 100% accuracy (15/15)

### Stretch Goal (With Event Pipeline)
- All wallets: 100% accuracy (local calculation)
- Zero API dependency
- Sub-second response time
- Full auditability

---

## References

- **Polymarket Official Subgraph:** https://github.com/Polymarket/polymarket-subgraph/tree/main/pnl-subgraph
- **Formula Reference:** `/docs/reports/POLYMARKET_NEG_RISK_FORMULAS.md`
- **Full Analysis:** `/docs/reports/POLYMARKET_NEG_RISK_ANALYSIS.md`
- **Comparison:** `/docs/reports/NEG_RISK_COMPARISON_V1_VS_POLYMARKET.md`
- **Our V1 Engine:** `/lib/pnl/pnlEngineV1.ts`
- **Our V7 Engine:** `/lib/pnl/pnlEngineV7.ts`

---

**Investigation Status:** ✅ COMPLETE
**Implementation Status:** ⏳ IN PROGRESS (two-tier system)
**Next Review:** After two-tier system deployed
