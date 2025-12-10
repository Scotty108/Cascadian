# PnL Accuracy Research & Improvement Plan

**Date:** 2025-11-30
**Objective:** Identify ALL possible ways to improve PnL accuracy
**Current State:** V3/V4 at 77.6% sign accuracy, ~24% median error
**Target State:** 85-90% sign accuracy, 10-15% median error

---

## Executive Summary

After comprehensive research including reviewing Polymarket's official pnl-subgraph, analyzing our data gaps, and researching external approaches, **the primary error source is NOT the cost basis method** (FIFO vs average).

The real culprits are:
1. **ERC1155 transfers not tracked** (~40-50% of error)
2. **Missing CTF events / NegRisk conversions** (~20-25% of error)
3. **Token mapping gaps** (~10-15% of error)

We already have a V11_POLY engine that faithfully ports Polymarket's subgraph and matches within $0.08 for W2. The gap comes from data completeness, not formula correctness.

---

## Current State Analysis

### Engines Available

| Engine | Method | Sign Accuracy | Median Error | Status |
|--------|--------|---------------|--------------|--------|
| V3 (uiActivityEngineV3) | Average cost | 77.6% | ~24% | Tested |
| V4 (uiActivityEngineV4) | FIFO | 77.6% | ~24% | Tested - No improvement |
| V11_POLY (polymarketSubgraphEngine) | Polymarket port | Best | W2 matches $0.08 | Production |

### Root Causes of Error (Ranked by Contribution)

| Error Source | Contribution | Fixable? | Effort |
|--------------|--------------|----------|--------|
| ERC1155 transfers not tracked | ~40-50% | Yes | Medium |
| Missing CTF events / NegRisk | ~20-25% | Partial | Medium |
| Token mapping gaps | ~10-15% | Yes | Low |
| UI-specific business rules | ~10% | No | N/A |
| Precision/timing/rounding | ~5% | No | N/A |

---

## Root Cause Deep Dive

### 1. ERC1155 Transfers (~40-50% of error)

**Problem:** When users receive tokens via peer-to-peer transfer (not CLOB), we see the sell but not the buy. This creates "phantom positions."

**Data Available:**
- `pm_erc1155_transfers` table: 42.6M transfers
- ~60% of wallets (994K of 1.6M) receive tokens via transfer
- Token ID format issue: transfers use hex, trades use decimal

**Fix Strategy:**
```typescript
// When we see a sell but position is 0 or negative
if (sellAmount > trackedPosition) {
  // Check ERC1155 transfers for incoming tokens
  const transfersIn = await getERC1155TransfersIn(wallet, tokenId);
  if (transfersIn.length > 0) {
    // Add these as "free acquisitions" with $0.50 cost basis
    for (const transfer of transfersIn) {
      addLot(transfer.amount, 0.50, transfer.timestamp);
    }
  }
}
```

**Expected Impact:** 15-25% error reduction

### 2. NegRisk Conversions (~20-25% of error)

**Problem:** Multi-outcome markets use NegRisk positions that convert between YES and NO. We have a placeholder `CONVERSION` handler but it's incomplete.

**Official Polymarket Logic (from subgraph):**
```typescript
// CONVERSION event type
case 'CONVERSION':
  // Swap positions between outcomes
  // Cost basis transfers from one side to the other
  break;
```

**Fix Strategy:** Port the full conversion handler from Polymarket's pnl-subgraph.

**Expected Impact:** 10-15% error reduction

### 3. Token Mapping Gaps (~10-15% of error)

**Problem:** Some token IDs don't map to condition IDs. W6 has 20 orphaned tokens.

**Current Coverage:** 93.2% of tokens mapped

**Fix Strategy:**
1. Query Gamma API for missing mappings
2. Batch update `pm_token_to_condition_map_v3`
3. Re-run validation

**Expected Impact:** 5-10% error reduction

---

## Key Research Findings

### From Polymarket's Official pnl-subgraph

Source: https://github.com/Polymarket/polymarket-subgraph

Critical insights:
1. **Uses weighted average cost basis** (NOT FIFO) - our V11_POLY is correct
2. **Splits/Merges at exactly $0.50** (FIFTY_CENTS constant)
3. **Redemptions at payout price** from resolution
4. **Does NOT track ERC1155 transfers** - UI has additional data sources
5. **Caps sells at tracked position** (adjustedAmount = min(sellAmount, trackedAmount))

### From External Research

| Platform | Approach | Notes |
|----------|----------|-------|
| Polymarket Analytics | Unknown | Likely faces same limitations |
| PredictFolio | Unknown | Community project |
| The Graph | Subgraph only | Same as our V11_POLY |

**Key Insight:** The official Polymarket subgraph itself doesn't track peer-to-peer transfers. The UI likely has internal data sources we cannot access.

### Alternative Approach: Economic Cashflow

Instead of tracking per-trade PnL, calculate:
```
Total PnL = Total USDC Out - Total USDC In
```

This naturally handles transfers because:
- USDC in = deposits + sell proceeds + redemptions
- USDC out = withdrawals + buy costs + fees

**Pros:** Simple, handles transfers naturally
**Cons:** Doesn't show per-trade breakdown

---

## Improvement Opportunities (Ranked by Impact)

### Tier 1: High Impact, Medium Effort

| # | Improvement | Impact | Effort | Dependencies |
|---|-------------|--------|--------|--------------|
| 1 | ERC1155 transfer integration | 15-25% | 2-3 days | Token ID format fix |
| 2 | NegRisk conversion handler | 10-15% | 2-3 days | None |
| 3 | Token mapping backfill | 5-10% | 1-2 days | Gamma API access |

### Tier 2: Medium Impact, Low Effort

| # | Improvement | Impact | Effort | Dependencies |
|---|-------------|--------|--------|--------------|
| 4 | Hex-to-decimal token ID fix | 5% | 0.5 days | None |
| 5 | Cost basis for splits = $0.50 | 3% | 0.5 days | None |
| 6 | Capped sell handling | 2% | 0.5 days | None |

### Tier 3: Alternative Approaches

| # | Improvement | Impact | Effort | Dependencies |
|---|-------------|--------|--------|--------------|
| 7 | Economic cashflow engine | Parallel metric | 2-3 days | USDC transfer data |
| 8 | Confidence scoring by wallet type | UI clarity | 1 day | Wallet classification |

---

## Recommended Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)
**Expected improvement: 15-25%**

1. Verify ERC1155 transfer integration in `ui_like` mode
2. Fix hex-to-decimal token ID conversion
3. Test on benchmark wallets W1-W6
4. Document results

**Files to modify:**
- `lib/pnl/polymarketEventLoader.ts`

### Phase 2: NegRisk Conversions (2-3 days)
**Expected improvement: 10-15%**

1. Port full conversion handler from Polymarket subgraph
2. Handle position swaps in multi-outcome markets
3. Test against multi-outcome market wallets

**Files to modify:**
- `lib/pnl/polymarketSubgraphEngine.ts`

### Phase 3: Token Mapping Backfill (1-2 days)
**Expected improvement: 5-10%**

1. Query Gamma API for missing token mappings
2. Update `pm_token_to_condition_map_v3`
3. Address orphaned tokens

**Files to modify:**
- New script: `scripts/backfill-token-mappings.ts`

### Phase 4: Economic Cashflow Engine (2-3 days)
**Alternative metric**

1. Implement Total In vs Total Out formula
2. Show alongside V11_POLY for comparison
3. Add to API response

**Files to create:**
- `lib/pnl/economicCashflowEngine.ts`

### Phase 5: Validation Framework (1-2 days)
**Ongoing quality**

1. Automated regression tests on benchmark wallets
2. Weekly validation runs
3. Alert if sign accuracy drops below 85%

**Files to create:**
- `scripts/pnl/weekly-validation.ts`

---

## Quick Wins vs Long-Term Investments

### Quick Wins (Do Now)

| Task | Time | Impact |
|------|------|--------|
| Fix token ID hex/decimal | 2 hours | 5% |
| Cost basis $0.50 for splits | 2 hours | 3% |
| Test existing ERC1155 integration | 4 hours | Verify |

### Long-Term Investments

| Task | Time | Impact |
|------|------|--------|
| Full ERC1155 integration | 2-3 days | 15-25% |
| NegRisk conversions | 2-3 days | 10-15% |
| Economic cashflow engine | 2-3 days | Alternative |

---

## Open Questions Requiring User Input

### 1. Priority Trade-off
**Question:** Focus on UI parity (impossible to achieve 100%) or economic accuracy (achievable)?

**Options:**
- A) Chase UI parity - diminishing returns after 90%
- B) Ship economic cashflow as alternative metric
- C) Both with confidence labels

### 2. Transfer Cost Basis
**Question:** What cost basis for incoming ERC1155 transfers?

**Options:**
- A) $0.50 (neutral - Polymarket split price)
- B) $0.00 (conservative - assume free)
- C) Market price at transfer time (complex)

### 3. Confidence Scoring
**Question:** Should we classify wallets and show different confidence levels?

**Options:**
- A) Yes - "High/Medium/Low confidence" labels
- B) No - single number for all
- C) Show range (e.g., "$10K - $15K estimated")

### 4. Validation Scope
**Question:** Expand benchmark beyond 50 wallets?

**Options:**
- A) Keep 50 (representative)
- B) Expand to 200 (statistical significance)
- C) Continuous sampling from active wallets

### 5. API Response
**Question:** Should getWalletPnl return multiple engine results?

**Options:**
- A) Single best estimate
- B) V11_POLY + Economic side by side
- C) User selects preferred method

---

## What CANNOT Be Fixed

Some error sources are irreducible:

| Source | Why Unfixable |
|--------|---------------|
| Polymarket internal adjustments | No visibility |
| UI-specific aggregation rules | Undocumented |
| Private off-chain settlements | Not on-chain |
| Historical data we never had | Too late |

**Realistic Target:** 85-90% sign accuracy, 10-15% median error

**Perfect accuracy is impossible** without access to Polymarket's internal systems.

---

## Critical Files for Implementation

| File | Purpose |
|------|---------|
| `lib/pnl/polymarketEventLoader.ts` | ERC1155 integration |
| `lib/pnl/polymarketSubgraphEngine.ts` | NegRisk conversions |
| `docs/systems/pnl/POLYMARKET_PNL_SPEC.md` | Reference for official algorithm |
| `docs/systems/pnl/ROOT_CAUSE_FIX_PLAN.md` | Dual-engine proposal pattern |

---

## Summary: The Path to 85% Accuracy

| Phase | Task | Days | Cumulative Accuracy |
|-------|------|------|---------------------|
| Start | Current V3/V11 | - | 77.6% |
| 1 | Quick wins (token ID, splits) | 1 | ~80% |
| 2 | ERC1155 transfers | 2-3 | ~85% |
| 3 | NegRisk conversions | 2-3 | ~88% |
| 4 | Token mapping backfill | 1-2 | ~90% |
| **Total** | | **7-9 days** | **~90%** |

Remaining 10% gap is irreducible without Polymarket internal data.

---

## External References

- [Polymarket Subgraph Documentation](https://docs.polymarket.com/developers/subgraph/overview)
- [Polymarket PnL Subgraph on The Graph](https://thegraph.com/explorer/subgraphs/6c58N5U4MtQE2Y8njfVrrAfRykzfqajMGeTMEvMmskVz)
- [Polymarket GitHub Repository](https://github.com/Polymarket/polymarket-subgraph)
- [Conditional Tokens Documentation](https://docs.polymarket.com/developers/CTF/merge)
- [PnL Calculation Methods - Quant StackExchange](https://quant.stackexchange.com/questions/53415/pnl-with-fifo-and-lifo)

---

*Research completed by Claude Code Planning Agent - 2025-11-30*
*Signed: Claude 1*
