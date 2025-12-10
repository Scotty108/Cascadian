# V27 Inventory Engine Benchmark Report

**Date:** 2025-12-05
**Terminal:** Claude 1
**Script:** `scripts/pnl/benchmark-v27-inventory.ts`

---

## Executive Summary

**VERDICT: V27 NEEDS WORK**

| Metric | V27 Inventory | V23 CLOB-only |
|--------|---------------|---------------|
| Pass Rate | 50.0% | 67.6% |
| Median Error | 1.25% | 0.18% |
| Mean Error | 174.26% | 12.49% |

**Root Cause:** V27 is **DOUBLE-COUNTING** PayoutRedemption cash flows.

---

## V27 Design

**State Machine Approach:**
- Track inventory per (conditionId, outcomeIndex)
- Track cost basis with proportional reduction on sells
- Process ALL source types: CLOB, PositionSplit, PositionsMerge, PayoutRedemption

**Formula:**
```
realized_pnl = cash_flow + (final_tokens × resolution_price)
```

**File:** `lib/pnl/inventoryEngineV27.ts`

---

## Benchmark Results (40 Wallets)

### Pass Rates by Category

| Category | Wallets | Threshold | V27 Pass | V23 Pass |
|----------|---------|-----------|----------|----------|
| Pure Traders | 26 | <1% | 57.7% | 69.2% |
| Market Makers | 8 | <5% | 25.0% | 62.5% |
| **OVERALL** | **34** | - | **50.0%** | **67.6%** |

*Note: 6 wallets hit ClickHouse max_query_size limits and errored*

### Top 10 Worst V27 Performers

| Wallet | UI PnL | V27 PnL | Error | Redeem Cash |
|--------|--------|---------|-------|-------------|
| 0x7fb7ad0d194d | $2.27M | $40.29M | 1678% | $62.62M |
| 0x461f3e886dca | $1.50M | $11.15M | 645% | $22.31M |
| 0x2f09642639ae | $1.49M | $9.98M | 570% | $19.61M |
| 0xa9878e59934a | $2.26M | $14.08M | 522% | $18.05M |
| 0x44c1dfe43260 | $1.56M | $9.08M | 481% | $22.60M |
| 0x6a72f61820b2 | $2.99M | $16.57M | 454% | $31.22M |
| 0x5bffcf561bca | $2.24M | $10.96M | 389% | $12.22M |
| 0x14964aefa2cd | $1.74M | $7.30M | 319% | $10.60M |
| 0xd38b71f3e8ed | $1.96M | $7.49M | 282% | $10.34M |
| 0x343d4466dc32 | $2.60M | $6.94M | 166% | $6.62M |

**Pattern:** All worst performers have LARGE redemption cash flows.

---

## Root Cause Analysis: DOUBLE-COUNTING

### The Problem

V27 formula is:
```
realized_pnl = cash_flow + (final_tokens × resolution_price)
```

For PayoutRedemption events:
1. `usdc_delta` (redemption payout) is added to `cash_flow`
2. `token_delta` reduces the token inventory
3. At resolution, remaining tokens × resolution_price is added

**BUT:** The redemption `usdc_delta` IS already `tokens × resolution_price`!

### Example

Wallet holds 100,000 tokens at resolution price = $1.00:
- PayoutRedemption: `usdc_delta = +$100,000`, `token_delta = -100,000`
- V27 cash_flow: +$100,000 (from redemption)
- V27 final_tokens: 0
- V27 realized_pnl: $100,000 + (0 × $1.00) = $100,000

This is CORRECT if tokens go to zero.

**BUT** if wallet partially redeems:
- Wallet has 100,000 tokens
- Redeems 50,000 tokens: `usdc_delta = +$50,000`, `token_delta = -50,000`
- Cash_flow: +$50,000
- Final_tokens: 50,000
- V27 realized_pnl: $50,000 + (50,000 × $1.00) = **$100,000**

**The problem:** We're counting the redeemed tokens TWICE:
1. Once as cash_flow ($50,000)
2. Once conceptually (should be subtracted from theoretical value)

### Why V23 CLOB-only Works

V23 only includes:
- CLOB trades (buying/selling tokens for cash)
- Resolution prices applied to CLOB-acquired tokens

V23 does NOT include:
- PayoutRedemption cash flows
- Split/Merge cash flows

This avoids double-counting because:
- Cash spent on CLOB trades is captured in `usdc_delta`
- Token value at resolution is `tokens × resolution_price`
- No redemption cash is added

---

## Cash Flow Breakdown (40 Wallets)

| Source | Total Cash Flow |
|--------|-----------------|
| CLOB | -$470.5M |
| Split | -$2.9M |
| Merge | +$14.4M |
| Redemption | +$246.8M |

**Key Insight:** Redemption is the largest positive cash flow, and it's being double-counted.

---

## Proposed Fix: V28 Approach

### Option 1: Cash-Flow Only (No Resolution Pricing)

For RESOLVED markets, just use total cash flow:
```
resolved_pnl = Σ(usdc_delta) for all source types
```

This works because:
- Redemption `usdc_delta` IS the final payout
- No need to multiply tokens by resolution price

### Option 2: Exclude Redemption from Cash Flow

Keep the V27 formula but exclude PayoutRedemption from cash_flow:
```
cash_flow = CLOB + Split + Merge (exclude Redemption)
resolved_pnl = cash_flow + (final_tokens × resolution_price)
```

### Option 3: Hybrid (Recommended)

For each market:
- If fully redeemed (tokens = 0): Use cash_flow only
- If partially redeemed: Use `cash_flow_excluding_redemption + (tokens × resolution_price)`
- If not redeemed: Use `cash_flow + (tokens × resolution_price)`

---

## Technical Issues

### Max Query Size Errors

6 wallets hit ClickHouse limits:
- 0x9d84ce0306f8
- 0xb786b8b6335e
- 0xee00ba338c59
- 0x204f72f35326
- 0x212954857f5e
- 0x2005d16a84ce

These wallets have many unique conditions, causing the `IN (...)` clause to exceed limits.

**Fix:** Use temporary table or batch conditions into smaller queries.

---

## Recommendations

1. **Do NOT deploy V27** - Double-counting makes it worse than V23
2. **Implement V28** - Use Option 3 (Hybrid) approach
3. **Fix query size limits** - Batch condition lookups
4. **Keep V23 canonical** - It's still the best performing engine

---

## Files Reference

| File | Purpose |
|------|---------|
| `lib/pnl/inventoryEngineV27.ts` | V27 Inventory Engine |
| `lib/pnl/shadowLedgerV23.ts` | V23 CLOB-only (CANONICAL) |
| `scripts/pnl/benchmark-v27-inventory.ts` | V27 benchmark script |
| `docs/systems/pnl/ENGINE_STATUS_2025_12_04.md` | Engine status overview |

---

*Report generated by Claude 1*
