# PnL Engine V2 Design Document

**Date:** 2026-01-07
**Status:** In Progress
**Author:** Claude Code + Scotty

---

## Executive Summary

We discovered why PnL Engine V1 works for some wallets but fails for others:

| Oversell Type | Description | V1 Behavior | Result |
|---------------|-------------|-------------|--------|
| **Pure Oversell** | `bought=0, sold>0` | Caps proceeds to $0 | ✅ Correct |
| **Mixed Oversell** | `bought>0, sold>bought` | Partial cap (bought/sold ratio) | ❌ Overcounts |

**Copy-trading wallet has 33 mixed oversell outcomes ($3,592 proceeds) that V1 partially caps but still overcounts.**

---

## Root Cause Analysis

### V1's Sell Capping Formula

```sql
effective_sell = CASE
  WHEN sold > bought AND sold > 0 THEN sell_proceeds * (bought / sold)
  ELSE sell_proceeds
END
```

### Why Pure Oversell Works

When `bought = 0`:
- `effective_sell = proceeds * (0 / sold) = $0`
- All proceeds from oversold tokens are ignored
- This is correct because we don't know their cost basis

### Why Mixed Oversell Fails (Bundled Splits)

When `bought = 3.4, sold = 723`:
- `effective_sell = $712 * (3.4 / 723) = $3.34`
- V1 gives credit for $3.34 in proceeds
- **But the 719.6 oversold tokens came from splits with $0.50 cost each**
- True cost: 719.6 × $0.50 = $359.80
- V1 ignores this cost, overcounting by $359.80 on this one outcome alone

---

## The Bundled Split Pattern

### How It Works

1. **User executes split:** Deposits $X USDC → Gets X YES + X NO tokens
2. **Immediately sells one outcome:** In same transaction, sells NO tokens on CLOB
3. **Keeps the other outcome:** Holds YES tokens

### What We See in CLOB Data

For condition ABC with outcomes 0 (YES) and 1 (NO):

| Outcome | Side | Tokens | USDC | Source |
|---------|------|--------|------|--------|
| 0 (YES) | buy | 100 | $1.00 | Split allocation (fake buy!) |
| 1 (NO) | sell | 100 | $95.00 | CLOB sale (real) |

### The Problem

- We think outcome 0 was "bought" for $1.00 (but it came from a $50 split)
- We see outcome 1 sold for $95 (which is real)
- V1 calculates: $95 + settlement - $1 = $94 profit
- **True calculation:** Split cost $100 total ($50 per outcome), sold $95, holding $0-$100 value

---

## Validated Test Results

### Maker-Only Approach (Polymarket Subgraph)

For copy-trading wallet:
- **Maker-only PnL: $51.41**
- **UI shows: $57.71**
- **Difference: 10.9%** (acceptable!)

This confirms Polymarket uses maker-centric approach in their subgraph.

### All-Trades V1 Approach

For copy-trading wallet:
- **V1 PnL: $314.21**
- **UI shows: $57.71**
- **Difference: 444%** (unacceptable!)

---

## Proposed V2 Solution

### Option A: Bundled Split Detection (Recommended)

**Logic:**
1. Identify bundled splits: transactions where BOTH outcomes have trades AND one is buy, one is sell
2. For bundled splits:
   - Don't count the "buy" as CLOB cost (it's from the split)
   - Calculate split cost as `max(outcome_0_tokens, outcome_1_tokens) × $1.00`
   - Count sell proceeds normally
3. For non-bundled trades:
   - Use standard V1 formula

**Pros:**
- Accurate for copy-trading and similar patterns
- Still works for pure CLOB traders
- Doesn't require maker-only filtering

**Cons:**
- More complex query
- May have edge cases

### Option B: Hybrid Maker-Preference

**Logic:**
1. If wallet has significant oversell, use maker-only calculation
2. If wallet has minimal oversell, use all-trades V1

**Pros:**
- Simple to implement
- Proven to work (maker-only matched UI for copy-trading)

**Cons:**
- Misses taker-heavy profits for legitimate CLOB traders
- Arbitrary threshold for "significant oversell"

### Option C: Split Cost Inference at $0.50

**Logic:**
1. For any oversell tokens: add cost basis of $0.50 per token
2. PnL = proceeds + settlement - CLOB_cost - split_cost

**Cons:**
- Doesn't account for the OTHER outcome from the split
- V2 experiments showed this makes things WORSE

---

## Implementation Plan (Option A)

### Step 1: Detect Bundled Splits

```sql
WITH tx_patterns AS (
  SELECT
    tx_hash,
    condition_id,
    count(DISTINCT outcome_index) > 1
      AND sum(if(side='buy', 1, 0)) > 0
      AND sum(if(side='sell', 1, 0)) > 0 as is_bundled_split
  FROM trades
  GROUP BY tx_hash, condition_id
)
```

### Step 2: Separate Cost Attribution

For bundled splits:
- "Buy" tokens are from split: cost = $0.50 per token
- "Sell" tokens are CLOB sales: proceeds count normally

For regular trades:
- Buy/sell as normal CLOB activity

### Step 3: Calculate PnL

```
PnL = sell_proceeds
    + settlement_value
    - real_clob_buy_cost
    - split_cost (tokens × $0.50 for each outcome)
```

---

## Test Cases (TDD)

### Must Pass (CLOB-Only Wallets)

| Name | UI PnL | V2 Target | Tolerance |
|------|--------|-----------|-----------|
| original | $1.16 | $1.16 | 1% |
| maker_heavy_1 | -$12.60 | -$12.60 | 1% |
| maker_heavy_2 | $1,500.00 | $1,500.00 | 1% |
| taker_heavy_1 | -$47.19 | -$47.19 | 1% |
| taker_heavy_2 | -$73.00 | -$73.00 | 1% |
| mixed_1 | -$0.01 | -$0.01 | 1% |
| mixed_2 | $4,916.75 | $4,916.75 | 1% |

### Must Fix (Bundled Split Wallets)

| Name | UI PnL | V1 (broken) | V2 Target | Tolerance |
|------|--------|-------------|-----------|-----------|
| copy_trading | $57.71 | $314.21 | $57.71 | 10% |

---

## Key Metrics to Track

For each wallet, measure:
1. **Pure oversell outcomes** (bought=0, sold>0)
2. **Mixed oversell outcomes** (bought>0, sold>bought)
3. **Bundled split transactions** (both outcomes in same tx)
4. **Split cost inferred** (tokens × $0.50)

---

## Files to Modify

| File | Changes |
|------|---------|
| `lib/pnl/pnlEngineV2.ts` | Implement bundled split detection |
| `lib/pnl/pnlEngineV2.test.ts` | TDD test suite with all wallets |
| `docs/READ_ME_FIRST_PNL.md` | Update with V2 as canonical engine |

---

## Open Questions

1. **Edge cases:** What if a bundled split only shows one outcome in CLOB data?
2. **Multi-split transactions:** What if one tx has multiple splits across conditions?
3. **Partial splits:** What if only some tokens came from splits?
4. **ERC1155 transfers:** These also cause oversell but aren't splits

---

## Next Steps

1. Implement Option A (bundled split detection) in `pnlEngineV2.ts`
2. Run TDD tests against all wallets
3. If Option A doesn't work, fall back to Option B (maker-preference)
4. Update documentation

---

*Document created: 2026-01-07*
